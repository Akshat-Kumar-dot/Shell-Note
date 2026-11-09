// The eraser: whole strokes, part of a stroke, and a scratch-out
// over strokes. Each returns operations for apply(), one undo step for one sweep
// of the eraser.
import type { Doc, Id, Stroke } from '../schema/doc.js'
import type { Op } from '../schema/ops.js'
import { boxOf, diagonal, dist, insidePolygon, lerp, overlaps, pathLength, pointsOf, respace, segmentDistance, simplify, type Pt } from './geometry.js'
import { editInk } from './group.js'
import { inkBlocks, inkBox, segmentsDistance, strokeBox, strokesAlong, type StrokeRef } from './hit.js'
import { KEEP_TOLERANCE } from './smooth.js'

type XY = { x: number; y: number }

/** The strokes given, removed whole: one edit per block. */
export function eraseOps(doc: Doc, refs: readonly StrokeRef[]): Op[] {
  const byBlock = new Map<Id, Map<number, readonly Stroke[]>>()
  for (const ref of refs) {
    const gone = byBlock.get(ref.block) ?? new Map<number, readonly Stroke[]>()
    gone.set(ref.index, [])
    byBlock.set(ref.block, gone)
  }
  return [...byBlock].flatMap(([id, replace]) => editInk(doc, id, { replace }))
}

/** How far a point is from a path; a path of one point is a tap. */
function pathDistance(pt: XY, path: readonly XY[]): number {
  if (path.length === 1) return dist(pt, path[0]!)
  let min = Infinity
  for (let i = 1; i < path.length; i++) min = Math.min(min, segmentDistance(pt, path[i - 1]!, path[i]!))
  return min
}

/** A stroke's points with tilt, if it has one, so tilt is cut along with them. */
type TiltPt = Pt & { tilt: number }

const between = (a: TiltPt, b: TiltPt, t: number): TiltPt => ({ ...lerp(a, b, t), tilt: a.tilt + (b.tilt - a.tilt) * t })

/**
 * What is left of a stroke after the eraser passes along `path` (both in the
 * block's coordinates) with `radius`: the pieces outside the eraser, cut
 * where its edge crosses the line. Undefined when the eraser misses the
 * stroke; empty when it takes all of it. A piece is no longer the shape the
 * stroke was snapped to, so it keeps only its look.
 */
export function cutStroke(stroke: Stroke, path: readonly XY[], radius: number): Stroke[] | undefined {
  if (path.length === 0) return undefined
  const count = stroke.pts.length / 3
  const points: TiltPt[] = []
  for (let i = 0; i < count; i++) points.push({ x: stroke.pts[i * 3]!, y: stroke.pts[i * 3 + 1]!, p: stroke.pts[i * 3 + 2]!, tilt: stroke.tilt?.[i] ?? 0 })
  // Long segments are split first, so no part of the line passes under the eraser between two points.
  const step = Math.max(radius / 2, 5)
  const dense: TiltPt[] = [points[0]!]
  for (let i = 1; i < points.length; i++) {
    const n = Math.ceil(dist(points[i - 1]!, points[i]!) / step)
    for (let s = 1; s <= n; s++) dense.push(between(points[i - 1]!, points[i]!, s / n))
  }
  const under = dense.map((pt) => pathDistance(pt, path) <= radius)
  if (!under.includes(true)) return undefined
  // Where the eraser's edge crosses the line between a point outside it and one under it.
  const edge = (outside: TiltPt, inside: TiltPt): TiltPt => {
    let lo = 0
    let hi = 1
    for (let k = 0; k < 12; k++) {
      const mid = (lo + hi) / 2
      if (pathDistance(between(outside, inside, mid), path) <= radius) hi = mid
      else lo = mid
    }
    return between(outside, inside, lo)
  }
  const pieces: TiltPt[][] = []
  let piece: TiltPt[] = []
  dense.forEach((pt, i) => {
    if (under[i]) {
      if (piece.length > 0) {
        piece.push(edge(dense[i - 1]!, pt))
        pieces.push(piece)
        piece = []
      }
      return
    }
    if (piece.length === 0 && i > 0) piece.push(edge(pt, dense[i - 1]!))
    piece.push(pt)
  })
  if (piece.length > 0) pieces.push(piece)
  return pieces
    .map((pts) => simplify(pts, KEEP_TOLERANCE) as TiltPt[])
    .filter((pts) => pts.length > 1 && pathLength(pts) >= 10)
    .map((pts) => {
      const out: Stroke = { pts: pts.flatMap((pt) => [Math.round(pt.x), Math.round(pt.y), Math.max(0, Math.min(255, Math.round(pt.p)))]), color: stroke.color, width: stroke.width }
      if (stroke.tool) out.tool = stroke.tool
      if (stroke.tilt) out.tilt = pts.map((pt) => Math.max(0, Math.min(90, Math.round(pt.tilt))))
      if (stroke.straight) out.straight = true
      if (stroke.vt) out.vt = stroke.vt
      if (stroke.pm) out.pm = stroke.pm
      return out
    })
}

/** The partial eraser: every stroke the path passes over (page coordinates) is cut where the eraser went. */
export function cutOps(doc: Doc, page: Id, path: readonly XY[], radius: number): Op[] {
  const byBlock = new Map<Id, Map<number, readonly Stroke[]>>()
  for (const ref of strokesAlong(doc, page, path, radius)) {
    const block = doc.block[ref.block]
    if (block?.type !== 'ink') continue
    const local = path.map((pt) => ({ x: pt.x - block.x, y: pt.y - block.y }))
    const pieces = cutStroke(block.strokes[ref.index]!, local, radius)
    if (!pieces) continue
    const replace = byBlock.get(ref.block) ?? new Map<number, readonly Stroke[]>()
    replace.set(ref.index, pieces)
    byBlock.set(ref.block, replace)
  }
  return [...byBlock].flatMap(([id, replace]) => editInk(doc, id, { replace }))
}

// ----- scratching out ------------------------------------------------------------------------------

/** How many times a stroke turns back along one axis, counting only turns of at least a third of its reach that way. */
function reversals(values: readonly number[]): number {
  const spread = Math.max(...values) - Math.min(...values)
  const least = spread / 3
  let count = 0
  let way = 0
  let from = values[0]!
  for (const v of values) {
    const moved = v - from
    if (way === 0) {
      if (Math.abs(moved) >= least) {
        way = Math.sign(moved)
        from = v
      }
    } else if (Math.sign(moved) === way) {
      from = v
    } else if (Math.abs(moved) >= least) {
      count++
      way = -way
      from = v
    }
  }
  return count
}

/**
 * Whether a stroke could be a scratch-out: it goes back and forth at least
 * twice (four passes), up and down or side to side, covering its ground twice
 * over. Handwriting often does too; what makes it a scratch-out is the ink it
 * covers and crosses (scratchTargets).
 */
export function isScratch(points: readonly Pt[]): boolean {
  if (points.length < 8) return false
  const size = diagonal(boxOf(points))
  if (size < 300 || pathLength(points) < 2 * size) return false
  return Math.max(reversals(points.map((pt) => pt.x)), reversals(points.map((pt) => pt.y))) >= 3
}

/** The smallest convex outline round points (Andrew's monotone chain). */
export function hull(points: readonly XY[]): XY[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (sorted.length < 3) return sorted
  const cross = (o: XY, a: XY, b: XY): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: XY[] = []
  for (const pt of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, pt) <= 0) lower.pop()
    lower.push(pt)
  }
  const upper: XY[] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const pt = sorted[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, pt) <= 0) upper.pop()
    upper.push(pt)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

/** How many times a path (page coordinates) crosses a block's stroke. */
function crossings(path: readonly XY[], stroke: Stroke, dx: number, dy: number): number {
  let count = 0
  const pts = stroke.pts
  for (let i = 3; i + 1 < pts.length; i += 3) {
    const a = { x: pts[i - 3]! + dx, y: pts[i - 2]! + dy }
    const b = { x: pts[i]! + dx, y: pts[i + 1]! + dy }
    for (let k = 1; k < path.length; k++) if (segmentsDistance(a, b, path[k - 1]!, path[k]!) === 0) count++
  }
  return count
}

/** How much of a stroke's length, placed on the page by dx, dy, lies inside an outline: 0 to 1. A dot is all in or all out. */
function shareInside(stroke: Stroke, dx: number, dy: number, outline: readonly XY[]): number {
  const points = pointsOf(stroke.pts).map((pt) => ({ ...pt, x: pt.x + dx, y: pt.y + dy }))
  const even = points.length < 2 || pathLength(points) === 0 ? points : respace(points, 50)
  return even.filter((pt) => insidePolygon(pt, outline)).length / Math.max(1, even.length)
}

/**
 * What a scratch-out deletes: each stroke it covers, at least 40 % of the
 * stroke's length inside the ground the scratch went over, or 20 % when the
 * scratch also crosses it twice, so scribbling over part of a long word takes
 * the word. Handwriting goes back and forth as much, so it counts only when
 * it crosses that ink at least three times, as a scratch over writing does: a
 * word written beside ink, or a ring drawn round words, deletes nothing.
 * Empty when the stroke is no scratch-out: then it is kept as drawn.
 * `scratchy` says whether a stroke could be one: the rules, or with a pen
 * profile, the person's own scratch-outs too (learn.ts scratchTest).
 */
export function scratchTargets(doc: Doc, page: Id, points: readonly Pt[], scratchy: (points: readonly Pt[]) => boolean = isScratch): StrokeRef[] {
  if (!scratchy(points)) return []
  const outline = hull(points)
  const area = boxOf(outline)
  const targets: StrokeRef[] = []
  let crossed = 0
  for (const block of inkBlocks(doc, page)) {
    if (!overlaps(inkBox(block), area)) continue
    const local = { x: area.x - block.x, y: area.y - block.y, w: area.w, h: area.h }
    block.strokes.forEach((stroke, index) => {
      if (!overlaps(strokeBox(stroke), local)) return
      const share = shareInside(stroke, block.x, block.y, outline)
      if (share < 0.2) return
      const crosses = crossings(points, stroke, block.x, block.y)
      if (share >= 0.4 || crosses >= 2) {
        targets.push({ block: block.id, index })
        crossed += crosses
      }
    })
  }
  return crossed >= 3 ? targets : []
}
