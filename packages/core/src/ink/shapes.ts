// Straight lines and shapes. Geometry, not a model: a stroke of 50 to 200
// points is resampled, its corners found, and fitted to a line, a polygon, an
// ellipse, an arc or a curve; the rest (heart, cloud, speech bubble) are
// matched against templates, point cloud to point cloud (the method of the $P
// recogniser, Vatavu, Anthony and Wobbrock, written fresh here). It takes well
// under a millisecond. When it is not sure, it leaves the stroke as drawn: a
// wrong snap is worse than none.
//
// A recognised shape is kept as a stroke (so everything that handles strokes
// still does) with its kind and key points, from which it is drawn out again
// whenever it is changed.
import type { ShapeKind } from '../schema/doc.js'
import { angleAt, boxOf, centroid, diagonal, dist, lineDistance, meanPressure, median, MM, pathLength, resample, respace, segmentDistance, simplify, type Pt } from './geometry.js'

export interface RecognisedShape {
  kind: ShapeKind
  /** The shape's key points and sizes, whole numbers, in the stroke's units (see drawShape). */
  key: number[]
  /** The shape drawn out, ready to keep as the stroke's points. */
  points: Pt[]
}

const DEG = Math.PI / 180

// ----- straight lines -----------------------------------------------

/** The brief's rule: at least 12 mm long, and never further than max(0.6 mm, 3 % of the length) from the line through the ends. */
export const LINE_MIN = 12 * MM

/**
 * A straight line, when a stroke is one: its ends, the angle snapped to
 * horizontal, vertical or 45° within 4°. `held`: the person held the pen still
 * to ask for it, so a looser rule applies (6 %, 1 mm, 5 mm long).
 */
export function straightLine(points: readonly Pt[], held = false): { a: Pt; b: Pt } | undefined {
  if (points.length < 2) return undefined
  const a = points[0]!
  const b = points.at(-1)!
  const length = dist(a, b)
  if (length < (held ? 5 * MM : LINE_MIN)) return undefined
  const limit = Math.max(held ? MM : 0.6 * MM, (held ? 0.06 : 0.03) * length)
  for (const pt of points) if (lineDistance(pt, a, b) > limit) return undefined
  // A stroke that goes and comes back is not a line, however close to one it stays.
  if (pathLength(points) > length * 1.5) return undefined
  return { a, b: snapAngle(a, b) }
}

/** The end b moved so a–b is horizontal, vertical or at 45°, when it is within `within` of one. */
export function snapAngle(a: Pt, b: Pt, within = 4 * DEG): Pt {
  const angle = Math.atan2(b.y - a.y, b.x - a.x)
  const step = Math.PI / 4
  const snapped = Math.round(angle / step) * step
  if (Math.abs(angle - snapped) > within) return b
  const length = dist(a, b)
  return { x: a.x + Math.cos(snapped) * length, y: a.y + Math.sin(snapped) * length, p: b.p }
}

// ----- corners ------------------------------------------------------------------------------

/**
 * The corners of a stroke, as indexes into `points` (resampled evenly), the
 * ends included: where a short chord is much shorter than elsewhere
 * (ShortStraw, Wolin, Eoff and Hammond, 2008), then tidied so each piece
 * between two corners is straight.
 */
export function corners(points: readonly Pt[], window = 3): number[] {
  const n = points.length
  if (n < 2 * window + 2) return [0, n - 1]
  const straws: number[] = []
  for (let i = window; i < n - window; i++) straws.push(dist(points[i - window]!, points[i + window]!))
  const threshold = median(straws) * 0.95
  const found = [0]
  // A real corner also turns, between two straight stretches: over twice the window, the line bends by more
  // than 30°, and the line on each side is nearly straight. A wobbling or tightly bending curve has short straws
  // too, but its sides curve.
  // The few points nearest the corner itself are left out: a corner found a point or two off its true place
  // would make the side it falls on look bent.
  const flat = (a: number, b: number): boolean => b - a < 2 || dist(points[a]!, points[b]!) / Math.max(1e-9, pathLength(points.slice(a, b + 1))) > 0.95
  const turns = (i: number): boolean => {
    const a = Math.max(0, i - 2 * window)
    const b = Math.min(n - 1, i + 2 * window)
    const near = Math.ceil(window / 2)
    return angleAt(points[a]!, points[i]!, points[b]!) < 150 * DEG && flat(a, Math.max(a, i - near)) && flat(Math.min(b, i + near), b)
  }
  for (let i = window; i < n - window; i++) {
    const straw = straws[i - window]!
    if (straw >= threshold) continue
    // The lowest straw of a run below the threshold.
    let best = i
    while (i + 1 < n - window && straws[i + 1 - window]! < threshold) {
      i++
      if (straws[i - window]! < straws[best - window]!) best = i
    }
    if (turns(best)) found.push(best)
  }
  found.push(n - 1)
  const straight = (from: number, to: number): boolean => dist(points[from]!, points[to]!) / Math.max(1e-9, pathLength(points.slice(from, to + 1))) > 0.95
  // A piece that bends sharply has a corner the straws missed: add one where it bends most.
  for (let k = 0; k < found.length - 1; k++) {
    const from = found[k]!
    const to = found[k + 1]!
    if (to - from > 4 && !straight(from, to) && sharpBend(points, from, to)) {
      let at = -1
      let worst = 0
      for (let i = from + 2; i <= to - 2; i++) {
        const off = lineDistance(points[i]!, points[from]!, points[to]!)
        if (off > worst) {
          worst = off
          at = i
        }
      }
      if (at > 0) {
        found.splice(k + 1, 0, at)
        k--
      }
    }
  }
  // A corner with a nearly straight angle is no corner.
  for (let k = 1; k < found.length - 1; k++) {
    if (angleAt(points[found[k - 1]!]!, points[found[k]!]!, points[found[k + 1]!]!) > 160 * DEG && straight(found[k - 1]!, found[k + 1]!)) {
      found.splice(k, 1)
      k--
    }
  }
  return found
}

/** Whether the piece from..to bends at one point (an angle), rather than all along (a curve). */
function sharpBend(points: readonly Pt[], from: number, to: number): boolean {
  let at = from
  let worst = 0
  for (let i = from + 1; i < to; i++) {
    const off = lineDistance(points[i]!, points[from]!, points[to]!)
    if (off > worst) {
      worst = off
      at = i
    }
  }
  if (at === from) return false
  // Straight on both sides of the farthest point: an angle.
  const side = (a: number, b: number): boolean => b - a < 3 || dist(points[a]!, points[b]!) / Math.max(1e-9, pathLength(points.slice(a, b + 1))) > 0.97
  return side(from, at) && side(at, to)
}

// ----- recognising ----------------------------------------------------------------------------

/**
 * The shape a stroke was meant to be, or undefined. `held`: the person held
 * the pen still at the end to ask for a shape.
 */
export function recognise(drawn: readonly Pt[], held = true): RecognisedShape | undefined {
  if (drawn.length < 3) return undefined
  const length = pathLength(drawn)
  if (length < 5 * MM) return undefined
  const pressure = Math.round(meanPressure(drawn))
  const line = straightLine(drawn, held)
  if (line) return made('line', [line.a.x, line.a.y, line.b.x, line.b.y], pressure)

  const box = boxOf(drawn)
  const size = diagonal(box)
  // About 48 points to the diagonal: the tests below see a shape alike at any size.
  const points = respace(drawn, Math.max(size / 48, 20))
  // Closed: its ends meet, and the pen went far enough, about twice the diagonal, to have gone round.
  const closed = dist(drawn[0]!, drawn.at(-1)!) < Math.max(0.2 * size, 2 * MM) && length > 2 * size * 0.9
  return closed ? closedShape(points, pressure) : openShape(points, pressure, held)
}

function closedShape(points: Pt[], pressure: number): RecognisedShape | undefined {
  // A star and a cloud first: they have tests of their own, and the corner count below stops at eight.
  const size = diagonal(boxOf(points))
  const star = starByPoints(points)
  if (star) return made('star', star, pressure)
  if (bumpy(points)) return made('cloud', ((b) => [b.x, b.y, b.w, b.h])(boxOf(points)), pressure)
  const at = corners(points, Math.max(2, Math.round(points.length / 24)))
  // The first and last corners are the same point of a closed shape.
  const vertices = at.slice(0, -1).map((i) => points[i]!)
  const sides = merged(vertices)
  // An ellipse or a polygon: whichever the points keep closer to.
  const round = ellipseFit(points)
  const polygonOff = sides.length >= 3 ? outlineOff(points, [...sides, sides[0]!]) / size : Infinity
  if (round && round.off / size <= polygonOff) {
    const { cx, cy, rx, ry, angle } = round
    if (ry / rx > 0.85) return made('circle', [cx, cy, (rx + ry) / 2], pressure)
    return made('ellipse', [cx, cy, rx, ry, Math.round(angle * 1000)], pressure)
  }
  // Not round, and its sides not within 4 % of its size: perhaps a heart, a cloud or a bubble.
  if (polygonOff > 0.04) return template(points, pressure)
  if (sides.length === 3) return made('triangle', sides.flatMap((v) => [v.x, v.y]), pressure)
  if (sides.length === 4) {
    const angles = sides.map((v, i) => angleAt(sides[(i + 3) % 4]!, v, sides[(i + 1) % 4]!))
    const lengths = sides.map((v, i) => dist(v, sides[(i + 1) % 4]!))
    const even = Math.min(...lengths) / Math.max(...lengths) > 0.82
    if (angles.every((a) => Math.abs(a - 90 * DEG) < 16 * DEG)) return rectangle(sides, even, pressure)
    if (even) return made('rhombus', sides.flatMap((v) => [v.x, v.y]), pressure)
    return made('polygon', [...sides, sides[0]!].flatMap((v) => [v.x, v.y]), pressure)
  }
  if (sides.length >= 5 && sides.length <= 8) return made('polygon', [...sides, sides[0]!].flatMap((v) => [v.x, v.y]), pressure)
  return template(points, pressure)
}

/** How far points are, on average, from a polyline through `outline`. */
function outlineOff(points: readonly Pt[], outline: readonly Pt[]): number {
  let sum = 0
  for (const pt of points) {
    let min = Infinity
    for (let i = 1; i < outline.length; i++) min = Math.min(min, segmentDistance(pt, outline[i - 1]!, outline[i]!))
    sum += min
  }
  return sum / Math.max(1, points.length)
}

function openShape(points: Pt[], pressure: number, held: boolean): RecognisedShape | undefined {
  const arrow = arrowFit(points, held ? 0 : ONE_BARB_MIN)
  if (arrow) return made('arrow', arrow, pressure)
  // Two or three straight pieces: an angle, or a zigzag of a few lines.
  const at = corners(points, Math.max(2, Math.round(points.length / 24)))
  if (at.length >= 3 && at.length <= 4) {
    // Each piece keeps within 3 % of its length from the line between its ends: a gentle curve bows out further.
    const straight = at.slice(1).every((to, k) => {
      const from = at[k]!
      const length = dist(points[from]!, points[to]!)
      for (let i = from + 1; i < to; i++) if (lineDistance(points[i]!, points[from]!, points[to]!) > 0.03 * length + 20) return false
      return true
    })
    if (straight) return made('polygon', at.map((i) => points[i]!).flatMap((v) => [v.x, v.y]), pressure)
  }
  // A sharp corner, as at the tip of a triangle drawn open, is never smoothed into a curve.
  // Sharpness is measured close round each corner, a twelfth of the stroke either side: a rounded bend opens out there.
  const near = Math.max(2, Math.round(points.length / 12))
  for (const i of at.slice(1, -1)) {
    if (angleAt(points[Math.max(0, i - near)]!, points[i]!, points[Math.min(points.length - 1, i + near)]!) < 100 * DEG) return undefined
  }
  const bends = smoothCurve(points)
  if (bends === undefined) return undefined
  // An arc bends one way only.
  const arc = bends === 0 ? arcFit(points) : undefined
  if (arc) return made('arc', arc, pressure)
  // A smooth curve, drawn again through a few of its own points.
  const kept = simplify(points, diagonal(boxOf(points)) * 0.03)
  return kept.length >= 3 ? made('curve', kept.flatMap((v) => [v.x, v.y]), pressure) : undefined
}

/**
 * Whether an open stroke is one smooth curve, such as an arc or an S, looked
 * at in 15 even pieces, coarse enough that the pen's jitter does not show: it
 * turns no more than a full turn in all, never more than 60° from one piece
 * to the next, and changes the way it bends at most twice. Handwriting turns
 * three times as much or more, and scribbles bend back and forth. Gives how
 * many times it changes the way it bends, or undefined when it is no smooth
 * curve.
 */
function smoothCurve(points: readonly Pt[]): number | undefined {
  const ring = resample(points, 16)
  let total = 0
  let changes = 0
  let bend = 0
  let run = 0
  for (let i = 1; i + 1 < ring.length; i++) {
    let turn = Math.atan2(ring[i + 1]!.y - ring[i]!.y, ring[i + 1]!.x - ring[i]!.x) - Math.atan2(ring[i]!.y - ring[i - 1]!.y, ring[i]!.x - ring[i - 1]!.x)
    if (turn > Math.PI) turn -= 2 * Math.PI
    if (turn < -Math.PI) turn += 2 * Math.PI
    if (Math.abs(turn) > 60 * DEG) return undefined
    total += Math.abs(turn)
    // A change of bend counts once the stroke has turned 20° the new way, not for every wobble.
    run = run === 0 || Math.sign(turn) === Math.sign(run) ? run + turn : turn
    if (Math.abs(run) > 20 * DEG && Math.sign(run) !== bend) {
      if (bend !== 0) changes++
      bend = Math.sign(run)
    }
  }
  return total <= 2 * Math.PI && changes <= 2 ? changes : undefined
}

/** Corners closer than a tenth of the shape's size are one. */
function merged(vertices: readonly Pt[]): Pt[] {
  const size = diagonal(boxOf(vertices))
  const out: Pt[] = []
  for (const v of vertices) if (!out.some((o) => dist(o, v) < size / 10)) out.push(v)
  return out
}

/** A rectangle, square up to the page when it is within 8° of it. */
function rectangle(sides: Pt[], even: boolean, pressure: number): RecognisedShape {
  const c = centroid(sides)
  const along = Math.atan2(sides[1]!.y - sides[0]!.y, sides[1]!.x - sides[0]!.x)
  let angle = Math.round(along / (Math.PI / 2)) * (Math.PI / 2)
  if (Math.abs(along - angle) > 8 * DEG) angle = along
  const w = (dist(sides[0]!, sides[1]!) + dist(sides[2]!, sides[3]!)) / 2
  const h = (dist(sides[1]!, sides[2]!) + dist(sides[3]!, sides[0]!)) / 2
  const [hw, hh] = even ? [(w + h) / 4, (w + h) / 4] : [w / 2, h / 2]
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const corner = (u: number, v: number): [number, number] => [c.x + u * cos - v * sin, c.y + u * sin + v * cos]
  return made(even ? 'square' : 'rect', [...corner(-hw, -hh), ...corner(hw, -hh), ...corner(hw, hh), ...corner(-hw, hh)], pressure)
}

/** An ellipse through closed points: its centre, radii and angle, and how far the points stray from it, as a share of the radius and in units. */
function ellipseFit(points: readonly Pt[]): { cx: number; cy: number; rx: number; ry: number; angle: number; residual: number; off: number } | undefined {
  const c = centroid(points)
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (const pt of points) {
    sxx += (pt.x - c.x) ** 2
    syy += (pt.y - c.y) ** 2
    sxy += (pt.x - c.x) * (pt.y - c.y)
  }
  const n = points.length
  sxx /= n
  syy /= n
  sxy /= n
  // sxx, syy and sxy are the points' covariance; l1 and l2 below are its eigenvalues, the spread along the long axis
  // and along the short one, and `angle` the long axis's direction.
  const trace = sxx + syy
  const det = sxx * syy - sxy * sxy
  const gap = Math.sqrt(Math.max(0, (trace * trace) / 4 - det))
  const l1 = trace / 2 + gap
  const l2 = trace / 2 - gap
  if (l2 <= 0) return undefined
  // Points spread evenly around an ellipse have a variance of half its radius squared along each axis.
  const rx = Math.sqrt(2 * l1)
  const ry = Math.sqrt(2 * l2)
  let angle = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const square = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2)
  if (Math.abs(angle - square) < 10 * DEG) angle = square
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  // For each point, how far its distance from the centre is from the ellipse's, as a share (1 is on the ellipse).
  let residual = 0
  for (const pt of points) {
    const u = (pt.x - c.x) * cos + (pt.y - c.y) * sin
    const v = -(pt.x - c.x) * sin + (pt.y - c.y) * cos
    residual += Math.abs(Math.hypot(u / rx, v / ry) - 1)
  }
  residual /= n
  return residual < 0.12 ? { cx: c.x, cy: c.y, rx, ry, angle, residual, off: residual * ((rx + ry) / 2) } : undefined
}

/**
 * A cloud: round as a whole, with five or more bumps along its edge, and a
 * notch between them. Going round, the distance from the centre, as a share
 * of the ellipse's there, rises and falls by more than 4 % at least five
 * times; and the edge turns back the other way at least four times, where
 * the bumps meet. A polygon's corners stick out too, but its edge never
 * turns back.
 */
function bumpy(points: readonly Pt[]): boolean {
  const ring = resample(points, 160)
  const round = ellipseFit(ring)
  if (!round || round.residual > 0.12) return false
  if (notches(ring) < 4) return false
  const cos = Math.cos(round.angle)
  const sin = Math.sin(round.angle)
  const share = ring.map((pt) => {
    const u = (pt.x - round.cx) * cos + (pt.y - round.cy) * sin
    const v = -(pt.x - round.cx) * sin + (pt.y - round.cy) * cos
    return Math.hypot(u / round.rx, v / round.ry)
  })
  const n = share.length
  let bumps = 0
  for (let i = 0; i < n; i++) {
    const r = share[i]!
    let highest = true
    for (let d = -5; d <= 5 && highest; d++) if (d !== 0 && share[(i + d + n) % n]! > r) highest = false
    if (!highest) continue
    // Higher than the lowest point on each side, within a tenth of the way round.
    const low = (step: number): number => {
      let min = r
      for (let d = 1; d <= n / 10; d++) min = Math.min(min, share[(i + step * d + n) % n]!)
      return min
    }
    if (r - low(-1) > 0.04 && r - low(1) > 0.04) bumps++
  }
  return bumps >= 5
}

/** How many times a closed outline turns back against its own way round, by more than 12° over a few points. */
function notches(ring: readonly Pt[]): number {
  const n = ring.length
  const k = 4
  const heading = (a: Pt, b: Pt): number => Math.atan2(b.y - a.y, b.x - a.x)
  const turns = ring.map((pt, i) => {
    let turn = heading(pt, ring[(i + k) % n]!) - heading(ring[(i - k + n) % n]!, pt)
    if (turn > Math.PI) turn -= 2 * Math.PI
    if (turn < -Math.PI) turn += 2 * Math.PI
    return turn
  })
  const way = Math.sign(turns.reduce((sum, t) => sum + t, 0))
  let count = 0
  let inside = false
  for (const turn of turns) {
    const back = turn * way < -12 * DEG
    if (back && !inside) count++
    inside = back
  }
  // A notch that runs over the start was counted at both ends.
  if (inside && turns[0]! * way < -12 * DEG) count--
  return count
}

/**
 * A five-pointed star: going round, the distance from the centre rises to
 * five clear peaks (the tips) with deep valleys between them.
 */
function starByPoints(points: readonly Pt[]): number[] | undefined {
  const ring = resample(points, 120)
  const c = centroid(ring)
  const radii = ring.map((pt) => dist(pt, c))
  const n = radii.length
  const smooth = radii.map((_, i) => (radii[(i + n - 1) % n]! + 2 * radii[i]! + radii[(i + 1) % n]!) / 4)
  const top = Math.max(...smooth)
  const peaks: number[] = []
  for (let i = 0; i < n; i++) {
    const r = smooth[i]!
    let highest = true
    for (let d = -6; d <= 6 && highest; d++) if (d !== 0 && smooth[(i + d + n) % n]! > r) highest = false
    if (highest && r > top * 0.6 && !peaks.some((p) => Math.min(Math.abs(p - i), n - Math.abs(p - i)) < 8)) peaks.push(i)
  }
  if (peaks.length !== 5) return undefined
  peaks.sort((a, b) => a - b)
  // Between each two tips, a valley well inside them.
  const valleys = peaks.map((p, k) => {
    const q = peaks[(k + 1) % 5]!
    let low = Infinity
    for (let i = p; i !== q; i = (i + 1) % n) low = Math.min(low, smooth[i]!)
    return low
  })
  const R = median(peaks.map((p) => radii[p]!))
  const r = median(valleys)
  if (r > R * 0.65) return undefined
  const tip = ring[peaks[0]!]!
  return [c.x, c.y, R, r, Math.round(Math.atan2(tip.y - c.y, tip.x - c.x) * 1000)]
}

// ----- arrows (taken as the pen lifts, small ones too) -----------------------

/** The shortest arrow taken, as drawn on the screen: arrows an inch long and under are common in notes. */
export const ARROW_MIN = 8 * MM
/**
 * Below this length an arrow taken unasked needs a barb on each side: an
 * arrow with one barb that small is the shape of a 1 with its flag.
 */
export const ONE_BARB_MIN = 25 * MM

/** Which side of the line from a through b a point is on: -1, 0 or 1. */
const sideOf = (a: Pt, b: Pt, pt: Pt): number => Math.sign((b.x - a.x) * (pt.y - a.y) - (b.y - a.y) * (pt.x - a.x))

/**
 * The size of the head at tip `t` of a shaft from `tail`, `length` long, or
 * undefined when `head` is no arrow's head. Its barbs (its points more than
 * 1 mm or a tenth of the shaft from the tip; a flick as the pen lifts is
 * shorter) all go back from the tip to the side, 10° to 80° off straight
 * back. Points straight back along the shaft are allowed only across a
 * closed head, between its two barbs: the hook of a J comes back up its
 * stem. Shorter than `oneBarbMin`, a barb on each side.
 */
function headSize(tail: Pt, t: Pt, head: readonly Pt[], length: number, oneBarbMin: number): number | undefined {
  const out = head.filter((pt) => dist(pt, t) > Math.max(MM, 0.1 * length))
  const barbs = out.filter((pt) => angleAt(tail, t, pt) >= 10 * DEG)
  if (barbs.length === 0 || barbs.some((pt) => angleAt(tail, t, pt) > 80 * DEG)) return undefined
  const sides = new Set(barbs.map((pt) => sideOf(tail, t, pt)).filter((sign) => sign !== 0))
  if (sides.size < 2 && length < oneBarbMin) return undefined
  const reach = Math.max(...barbs.map((pt) => dist(pt, t)))
  if (sides.size < 2 ? out.length > barbs.length : out.some((pt) => dist(pt, t) > reach)) return undefined
  return reach
}

/**
 * An arrow drawn from its tail: the tip is the point farthest from the start.
 * The shaft runs from the start along the line to the tip until the stroke
 * reaches the tip or leaves the line for the head (a writer draws a barb in to
 * the tip from its outer end), and ends where it got furthest; it covers most
 * of the way and never turns back. The head is all that follows: near the tip,
 * no longer than the shaft. Every limit grows with the arrow, so an arrow an
 * inch long is judged as one a hand long.
 */
function arrowFrom(points: readonly Pt[], oneBarbMin: number): number[] | undefined {
  const start = points[0]!
  let tip = 0
  for (let i = 1; i < points.length; i++) if (dist(points[i]!, start) > dist(points[tip]!, start)) tip = i
  const t = points[tip]!
  const length = dist(start, t)
  if (length < ARROW_MIN) return undefined
  const near = Math.max(0.8 * MM, 0.06 * length)
  const off = Math.max(0.5 * MM, 0.05 * length)
  let run = 0
  while (run < tip && dist(points[run + 1]!, t) > near && lineDistance(points[run + 1]!, start, t) <= off) run++
  let furthest = 0
  for (let i = 1; i <= run; i++) {
    const along = dist(points[i]!, start)
    if (along < dist(points[furthest]!, start) - off) return undefined
    if (along > dist(points[furthest]!, start)) furthest = i
  }
  if (dist(start, points[furthest]!) < 0.6 * length) return undefined
  const head = points.slice(furthest)
  if (head.some((pt) => dist(pt, t) > 0.5 * length) || pathLength(head) > length) return undefined
  const size = headSize(start, t, head, length, oneBarbMin)
  if (size === undefined) return undefined
  const end = snapAngle(start, t)
  return [start.x, start.y, end.x, end.y, Math.min(size, 0.35 * length)]
}

/**
 * An arrow in one stroke, however it was drawn: one barb, two (one before the
 * tip, or each from the tip), a closed head, or the head first and then the
 * shaft. `oneBarbMin`: as headSize.
 */
function arrowFit(points: readonly Pt[], oneBarbMin: number): number[] | undefined {
  return arrowFrom(points, oneBarbMin) ?? arrowFrom([...points].reverse(), oneBarbMin)
}

/** The smallest quick arrow taken (quickArrow): its shaft at least this long, as drawn on the screen. */
export const SMALL_ARROW_MIN = 4 * MM

/** The angle between two directions, 0 to π. */
const between = (ux: number, uy: number, vx: number, vy: number): number => Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1))))

/**
 * An arrow written quickly and small, its head a barb on each side (a test page
 * of arrows, 17 October 2026: 5 to 20 mm, the shaft bowing a little, a hook up
 * to the upper barb's end, the tip off the shaft's line, the head as big as the
 * shaft). The shaft is found first: the longest start of the stroke within 6 %
 * of the line between its ends, never turning back. The head is judged from the
 * shaft's own line: its tip, the point furthest along it, no more than half the
 * shaft ahead of the shaft's end or a third of it aside; all of the head within
 * three quarters of the shaft of the tip, its path no more than twice the
 * shaft. Its barbs (its points more than 0.6 mm or an eighth of the shaft from
 * the tip) go back from the tip, 10° to 80° off the shaft's line, and reach out
 * from that line on both sides, by a fifth of the head's size: a J's or a t's
 * hook reaches out to one side only. Points straight back along the shaft only
 * between the barbs.
 */
function quickArrowFrom(points: readonly Pt[]): number[] | undefined {
  const p0 = points[0]!
  let shaftEnd = 0
  // Every end is tried, not stopped at the first that fails: a bow may leave the band, and a longer chord take it back.
  for (let j = 1; j < points.length; j++) {
    const chord = dist(p0, points[j]!)
    if (chord < SMALL_ARROW_MIN / 2) continue
    const band = Math.max(0.4 * MM, 0.06 * chord)
    const ux = (points[j]!.x - p0.x) / chord
    const uy = (points[j]!.y - p0.y) / chord
    let furthest = 0
    let straight = true
    for (let i = 1; i < j && straight; i++) {
      const along = (points[i]!.x - p0.x) * ux + (points[i]!.y - p0.y) * uy
      if (lineDistance(points[i]!, p0, points[j]!) > band || along < furthest - band) straight = false
      furthest = Math.max(furthest, along)
    }
    if (straight) shaftEnd = j
  }
  const end = points[shaftEnd]!
  const length = dist(p0, end)
  if (length < SMALL_ARROW_MIN) return undefined
  const ux = (end.x - p0.x) / length
  const uy = (end.y - p0.y) / length
  // A point's place along the shaft's line, from the tail, and how far off that line to one side.
  const forward = (pt: Pt): number => (pt.x - p0.x) * ux + (pt.y - p0.y) * uy
  const lateral = (pt: Pt): number => (pt.y - p0.y) * ux - (pt.x - p0.x) * uy
  const head = points.slice(shaftEnd)
  if (head.length < 2) return undefined
  const t = head.reduce((best, pt) => (forward(pt) > forward(best) ? pt : best))
  if (forward(t) > 1.5 * length || Math.abs(lateral(t)) > 0.3 * length) return undefined
  if (head.some((pt) => dist(pt, t) > 0.75 * length) || pathLength(head) > 2 * length) return undefined
  const out = head.filter((pt) => dist(pt, t) > Math.max(0.6 * MM, 0.12 * length))
  const back = (pt: Pt): number => between(-ux, -uy, pt.x - t.x, pt.y - t.y)
  const barbs = out.filter((pt) => back(pt) >= 10 * DEG)
  if (barbs.length === 0 || barbs.some((pt) => back(pt) > 80 * DEG)) return undefined
  const reach = Math.max(...barbs.map((pt) => dist(pt, t)))
  const outward = Math.max(0.4 * MM, 0.2 * reach)
  const sides = new Set(barbs.filter((pt) => Math.abs(lateral(pt)) > outward).map((pt) => Math.sign(lateral(pt))))
  if (sides.size < 2 || out.some((pt) => dist(pt, t) > reach)) return undefined
  const tip = snapAngle(p0, { x: p0.x + ux * forward(t), y: p0.y + uy * forward(t), p: t.p })
  return [p0.x, p0.y, tip.x, tip.y, Math.min(reach, 0.45 * forward(t))]
}

/**
 * An arrow taken from a stroke as the pen lifts, unasked: by arrowFit (one
 * barb only from ONE_BARB_MIN up), or else as a quick small arrow with a
 * barb on each side (quickArrowFrom), either way round.
 */
export function arrowShape(drawn: readonly Pt[]): RecognisedShape | undefined {
  if (drawn.length < 3) return undefined
  const size = diagonal(boxOf(drawn))
  if (size < SMALL_ARROW_MIN) return undefined
  const points = respace(drawn, Math.max(size / 48, 20))
  const key = (size >= ARROW_MIN ? arrowFit(points, ONE_BARB_MIN) : undefined) ?? quickArrowFrom(points) ?? quickArrowFrom([...points].reverse())
  return key && made('arrow', key, Math.round(meanPressure(drawn)))
}

/** The ends of a stroke drawn as a straight line, or kept as one: at least ARROW_MIN long, within 0.5 mm or 5 % of the line between its ends, never turning back. */
function lineEnds(points: readonly Pt[]): { a: Pt; b: Pt } | undefined {
  if (points.length < 2) return undefined
  const a = points[0]!
  const b = points.at(-1)!
  const length = dist(a, b)
  if (length < ARROW_MIN) return undefined
  const off = Math.max(0.5 * MM, 0.05 * length)
  let furthest = 0
  for (const pt of points) {
    if (lineDistance(pt, a, b) > off) return undefined
    const along = dist(pt, a)
    if (along < furthest - off) return undefined
    furthest = Math.max(furthest, along)
  }
  return { a, b }
}

/**
 * An arrow drawn in two strokes: a
 * straight line, and its head (a V, one barb, a closed head) as the stroke
 * just before or just after it. The head touches one end of the line, within
 * 1.5 mm or a tenth of it, stays within half the line's length of that end,
 * and goes back along the line as one stroke's head does (headSize): so the
 * V of a Y, which opens away, the < of a K, which touches the middle, and the
 * bar of a T, across, are left alone.
 */
export function twoStrokeArrow(first: readonly Pt[], second: readonly Pt[]): RecognisedShape | undefined {
  return headOn(first, second) ?? headOn(second, first)
}

function headOn(line: readonly Pt[], head: readonly Pt[]): RecognisedShape | undefined {
  const ends = lineEnds(line)
  if (!ends || head.length < 2) return undefined
  const length = dist(ends.a, ends.b)
  for (const [tail, t] of [[ends.a, ends.b], [ends.b, ends.a]] as const) {
    if (head.some((pt) => dist(pt, t) > 0.5 * length)) continue
    const touch = head.reduce((nearest, pt) => (dist(pt, t) < dist(nearest, t) ? pt : nearest))
    if (dist(touch, t) > Math.max(1.5 * MM, 0.1 * length)) continue
    const size = headSize(tail, t, head, length, ONE_BARB_MIN)
    if (size === undefined) continue
    const end = snapAngle(tail, t)
    return made('arrow', [tail.x, tail.y, end.x, end.y, Math.min(size, 0.35 * length)], Math.round(meanPressure(line)))
  }
  return undefined
}

/** An arc: an open stroke along a circle, between 30° and 330° of it. */
function arcFit(points: readonly Pt[]): number[] | undefined {
  // The least-squares circle (Kåsa): x² + y² + Dx + Ey + F = 0, solved in three unknowns.
  const c = centroid(points)
  // Measured from the points' middle, the sums of u and v are zero, which leaves two equations in the centre (uc, vc).
  let suu = 0
  let suv = 0
  let svv = 0
  let suuu = 0
  let svvv = 0
  let suvv = 0
  let svuu = 0
  for (const pt of points) {
    const u = pt.x - c.x
    const v = pt.y - c.y
    suu += u * u
    suv += u * v
    svv += v * v
    suuu += u * u * u
    svvv += v * v * v
    suvv += u * v * v
    svuu += v * u * u
  }
  const det = suu * svv - suv * suv
  if (Math.abs(det) < 1e-9) return undefined
  const b1 = (suuu + suvv) / 2
  const b2 = (svvv + svuu) / 2
  const uc = (b1 * svv - b2 * suv) / det
  const vc = (b2 * suu - b1 * suv) / det
  const cx = uc + c.x
  const cy = vc + c.y
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / points.length)
  const off = points.reduce((sum, pt) => sum + Math.abs(dist(pt, { x: cx, y: cy }) - r), 0) / points.length
  if (off / r > 0.06) return undefined
  const a0 = Math.atan2(points[0]!.y - cy, points[0]!.x - cx)
  // The sweep, summed step by step, so it keeps its direction.
  let sweep = 0
  for (let i = 1; i < points.length; i++) {
    let d = Math.atan2(points[i]!.y - cy, points[i]!.x - cx) - Math.atan2(points[i - 1]!.y - cy, points[i - 1]!.x - cx)
    if (d > Math.PI) d -= 2 * Math.PI
    if (d < -Math.PI) d += 2 * Math.PI
    sweep += d
  }
  if (Math.abs(sweep) < 30 * DEG || Math.abs(sweep) > 330 * DEG) return undefined
  return [cx, cy, r, Math.round(a0 * 1000), Math.round(sweep * 1000)]
}

// ----- fitting a shape already known --------------------------------------------------------------------

/** The shapes a person's held stroke may be taken for, by family: a circle is fitted as an ellipse that may come out round, a square as a rectangle. */
export type ShapeFamily = 'line' | 'arrow' | 'arc' | 'curve' | 'ellipse' | 'triangle' | 'rect' | 'rhombus' | 'polygon' | 'star' | 'heart' | 'cloud' | 'bubble'

/** The family each recognised kind belongs to. */
export const FAMILY: Readonly<Partial<Record<ShapeKind, ShapeFamily>>> = {
  line: 'line',
  arrow: 'arrow',
  arc: 'arc',
  curve: 'curve',
  circle: 'ellipse',
  ellipse: 'ellipse',
  triangle: 'triangle',
  rect: 'rect',
  square: 'rect',
  rhombus: 'rhombus',
  polygon: 'polygon',
  star: 'star',
  heart: 'heart',
  cloud: 'cloud',
  bubble: 'bubble',
}

/**
 * A stroke fitted as a shape of the family already known (from the person's
 * own strokes, learn.ts), more loosely than recognising it from nothing: an
 * arrow's head, a rhombus's corners, a cloud's bumps need not be drawn
 * cleanly. Undefined when the stroke cannot be that shape at all.
 */
export function fitAs(family: ShapeFamily, drawn: readonly Pt[]): RecognisedShape | undefined {
  if (drawn.length < 3) return undefined
  const pressure = Math.round(meanPressure(drawn))
  const box = boxOf(drawn)
  const size = diagonal(box)
  if (size < 2 * MM) return undefined
  const points = respace(drawn, Math.max(size / 48, 20))
  const boxed = (kind: 'heart' | 'cloud' | 'bubble'): RecognisedShape => made(kind, [box.x, box.y, box.w, box.h], pressure)
  /** The closed shape's corners, merged; for a closed stroke the last is the first. */
  const vertices = (): Pt[] => merged(corners(points, Math.max(2, Math.round(points.length / 24))).slice(0, -1).map((i) => points[i]!))
  switch (family) {
    case 'line': {
      const a = drawn[0]!
      return made('line', [a.x, a.y, ...((b) => [b.x, b.y])(snapAngle(a, drawn.at(-1)!))], pressure)
    }
    case 'arrow': {
      const fitted = arrowFit(points, 0)
      if (fitted) return made('arrow', fitted, pressure)
      // The tip is the point farthest from the start; the head is as big as the farthest point after it.
      const start = points[0]!
      let tip = 0
      for (let i = 1; i < points.length; i++) if (dist(points[i]!, start) > dist(points[tip]!, start)) tip = i
      const shaft = dist(start, points[tip]!)
      if (shaft < 5 * MM) return undefined
      const head = points.slice(tip).reduce((most, pt) => Math.max(most, dist(pt, points[tip]!)), 0)
      const end = snapAngle(start, points[tip]!)
      return made('arrow', [start.x, start.y, end.x, end.y, Math.min(0.35 * shaft, Math.max(0.12 * shaft, head))], pressure)
    }
    case 'arc': {
      const arc = arcFit(points)
      if (arc) return made('arc', arc, pressure)
      return fitAs('curve', drawn)
    }
    case 'curve': {
      const kept = simplify(points, size * 0.03)
      return kept.length >= 3 ? made('curve', kept.flatMap((v) => [v.x, v.y]), pressure) : undefined
    }
    case 'ellipse': {
      const round = ellipseFit(points) ?? { cx: box.x + box.w / 2, cy: box.y + box.h / 2, rx: Math.max(box.w, box.h) / 2, ry: Math.min(box.w, box.h) / 2, angle: box.w >= box.h ? 0 : Math.PI / 2 }
      const { cx, cy, rx, ry, angle } = round
      if (ry / rx > 0.85) return made('circle', [cx, cy, (rx + ry) / 2], pressure)
      return made('ellipse', [cx, cy, rx, ry, Math.round(angle * 1000)], pressure)
    }
    case 'triangle': {
      let sides = vertices()
      if (sides.length !== 3) {
        // The biggest triangle on the stroke: the point farthest from the middle, the one farthest from it, and the one farthest from the line between them.
        const c = centroid(points)
        const a = points.reduce((best, pt) => (dist(pt, c) > dist(best, c) ? pt : best))
        const b = points.reduce((best, pt) => (dist(pt, a) > dist(best, a) ? pt : best))
        const third = points.reduce((best, pt) => (lineDistance(pt, a, b) > lineDistance(best, a, b) ? pt : best))
        sides = [a, b, third]
      }
      return made('triangle', sides.flatMap((v) => [v.x, v.y]), pressure)
    }
    case 'rect': {
      const sides = vertices()
      const four: Pt[] =
        sides.length === 4
          ? sides
          : [
              { x: box.x, y: box.y, p: pressure },
              { x: box.x + box.w, y: box.y, p: pressure },
              { x: box.x + box.w, y: box.y + box.h, p: pressure },
              { x: box.x, y: box.y + box.h, p: pressure },
            ]
      const lengths = four.map((v, i) => dist(v, four[(i + 1) % 4]!))
      return rectangle(four, Math.min(...lengths) / Math.max(...lengths) > 0.82, pressure)
    }
    case 'rhombus': {
      let sides = vertices()
      if (sides.length !== 4) {
        // Its corners are where it reaches furthest up, right, down and left.
        const most = (score: (pt: Pt) => number): Pt => points.reduce((best, pt) => (score(pt) > score(best) ? pt : best))
        sides = [most((pt) => -pt.y), most((pt) => pt.x), most((pt) => pt.y), most((pt) => -pt.x)]
      }
      return made('rhombus', sides.flatMap((v) => [v.x, v.y]), pressure)
    }
    case 'polygon': {
      const sides = vertices()
      return sides.length >= 3 && sides.length <= 8 ? made('polygon', [...sides, sides[0]!].flatMap((v) => [v.x, v.y]), pressure) : undefined
    }
    case 'star': {
      const star = starByPoints(points)
      return star ? made('star', star, pressure) : undefined
    }
    case 'heart':
    case 'cloud':
    case 'bubble':
      return boxed(family)
  }
}

// ----- templates: heart, cloud, speech bubble ----------------------------------------------------------

const UNIT = { x: 0, y: 0, w: 1000, h: 1000 }
const TEMPLATES: readonly { kind: 'heart' | 'cloud' | 'bubble'; cloud: Pt[] }[] = (['heart', 'cloud', 'bubble'] as const).map((kind) => ({ kind, cloud: normalised(outline(kind, [UNIT.x, UNIT.y, UNIT.w, UNIT.h], 128)) }))

/** Points scaled into a unit box and moved to their centre, 32 of them. */
function normalised(points: readonly Pt[]): Pt[] {
  const sampled = resample(points, 32)
  const box = boxOf(sampled)
  const scale = Math.max(box.w, box.h) || 1
  const c = centroid(sampled)
  return sampled.map((pt) => ({ x: (pt.x - c.x) / scale, y: (pt.y - c.y) / scale, p: 0 }))
}

/** How far two point clouds are from each other: each point to its nearest unused match, the earlier ones weighing more ($P). */
function cloudDistance(a: readonly Pt[], b: readonly Pt[]): number {
  let best = Infinity
  // Matching each point to its nearest unused one depends on where it starts: every fourth start is tried.
  for (let start = 0; start < a.length; start += 4) {
    const used = new Uint8Array(b.length)
    let sum = 0
    for (let k = 0; k < a.length; k++) {
      const i = (start + k) % a.length
      let min = Infinity
      let at = -1
      for (let j = 0; j < b.length; j++) {
        if (used[j]) continue
        const d = dist(a[i]!, b[j]!)
        if (d < min) {
          min = d
          at = j
        }
      }
      used[at] = 1
      sum += (1 - k / a.length) * min
    }
    best = Math.min(best, sum)
  }
  return best
}

function template(points: Pt[], pressure: number): RecognisedShape | undefined {
  const cloud = normalised(points)
  const scored = TEMPLATES.map((t) => ({ kind: t.kind, score: cloudDistance(cloud, t.cloud) })).sort((a, b) => a.score - b.score)
  const [first, second] = scored
  // Close to one template, and clearly closer to it than to the next.
  if (!first || first.score > 1.6 || (second && second.score - first.score < 0.25)) return undefined
  const box = boxOf(points)
  return made(first.kind, [box.x, box.y, box.w, box.h], pressure)
}

// ----- drawing a shape out ---------------------------------------------------------------------------

function made(kind: ShapeKind, key: number[], pressure: number): RecognisedShape {
  // Whole numbers: nothing with a fraction goes into a saved file.
  const whole = key.map(Math.round)
  return { kind, key: whole, points: drawShape(kind, whole, pressure) }
}

/**
 * How far a shape's drawn points may stray from its true outline: 0.03 mm.
 * The live layer and the page draw the very same points, so this is only
 * how true to the outline it is, and a circle keeps a few dozen points.
 */
export const SHAPE_TOLERANCE = 3

/**
 * A shape drawn out as points at one pressure, from its kind and key: traced
 * every 0.5 mm, then only the points that change its line are kept, as for a
 * stroke (smooth.ts), so a line keeps its two ends and a circle a few dozen:
 *
 * line [x1, y1, x2, y2] · arrow [x1, y1, x2, y2, head] · arc [cx, cy, r, start, sweep] (angles in thousandths of a radian)
 * · curve [x, y, …] (the points it passes through) · triangle, rect, square, rhombus [x, y, …] (corners)
 * · polygon [x, y, …] (corners; closed when the last is the first) · star [cx, cy, R, r, angle]
 * · ellipse [cx, cy, rx, ry, angle] · circle [cx, cy, r] · heart, cloud, bubble [x, y, w, h] (the box)
 * · paren, bracket, brace [x, y, w, h, side] (the box; side 0 opens, as "(", 1 closes) · comma, at [x, y, w, h]
 */
export function drawShape(kind: ShapeKind, key: readonly number[], pressure = 128): Pt[] {
  return simplify(
    respace(outline(kind, key, pressure), 50).map((pt) => ({ x: Math.round(pt.x), y: Math.round(pt.y), p: Math.max(0, Math.min(255, Math.round(pt.p))) })),
    SHAPE_TOLERANCE,
  )
}

/** How many x, y pairs a kind's key starts with; the numbers after them are sizes and angles. Every number is a pair's for a curve or a corner list. */
const PLACES: Readonly<Partial<Record<ShapeKind, number>>> = { line: 2, arrow: 2, arc: 1, star: 1, ellipse: 1, circle: 1, heart: 1, cloud: 1, bubble: 1, paren: 1, bracket: 1, brace: 1, comma: 1, at: 1 }

/** A shape's key moved by dx, dy: its points move, its sizes and angles stay. */
export function movedKey(kind: ShapeKind, key: readonly number[], dx: number, dy: number): number[] {
  const pairs = PLACES[kind] ?? key.length / 2
  return key.map((v, i) => (i < pairs * 2 ? v + (i % 2 === 0 ? dx : dy) : v))
}

/** Which numbers of a kind's key, after its points, are sizes; the rest are angles. */
const SIZES: Readonly<Partial<Record<ShapeKind, readonly number[]>>> = { arrow: [4], arc: [2], star: [2, 3], ellipse: [2, 3], circle: [2], heart: [2, 3], cloud: [2, 3], bubble: [2, 3], paren: [2, 3], bracket: [2, 3], brace: [2, 3], comma: [2, 3], at: [2, 3] }

/** A shape's key grown or shrunk by `factor` about `anchor`: its points move with it, its sizes scale, its angles stay. Whole numbers. */
export function scaledKey(kind: ShapeKind, key: readonly number[], anchor: { x: number; y: number }, factor: number): number[] {
  const pairs = PLACES[kind] ?? key.length / 2
  const sizes = SIZES[kind] ?? []
  return key.map((v, i) => {
    if (i < pairs * 2) return Math.round((i % 2 === 0 ? anchor.x : anchor.y) + (v - (i % 2 === 0 ? anchor.x : anchor.y)) * factor)
    return sizes.includes(i) ? Math.round(v * factor) : v
  })
}

/** A recognised shape at another scale, such as from the screen's units back to the page's: its key scaled about 0, 0, and drawn again. */
export function scaledShape(shape: RecognisedShape, factor: number): RecognisedShape {
  if (factor === 1) return shape
  const key = scaledKey(shape.kind, shape.key, { x: 0, y: 0 }, factor)
  return { kind: shape.kind, key, points: drawShape(shape.kind, key, shape.points[0]?.p ?? 128) }
}

/**
 * The corners and curves a shape is drawn through, worked out from its key. A shape is kept as the few numbers that say
 * what it is (a line's two ends; an arc's centre, radius, start and sweep): the key is what a stretch or a resize
 * changes, and `drawShape` respaces this outline into the stroke's points. Each kind's numbers are read in its case.
 */
function outline(kind: ShapeKind, key: readonly number[], p: number): Pt[] {
  const pt = (x: number, y: number): Pt => ({ x, y, p })
  const k = (i: number): number => key[i] ?? 0
  const pairs = (): Pt[] => {
    const out: Pt[] = []
    for (let i = 0; i + 1 < key.length; i += 2) out.push(pt(key[i]!, key[i + 1]!))
    return out
  }
  const around = (n: number, at: (t: number) => Pt): Pt[] => Array.from({ length: n + 1 }, (_, i) => at((i / n) * 2 * Math.PI))
  switch (kind) {
    case 'line':
      return [pt(k(0), k(1)), pt(k(2), k(3))]
    case 'arrow': {
      const a = pt(k(0), k(1))
      const b = pt(k(2), k(3))
      const along = Math.atan2(b.y - a.y, b.x - a.x)
      const head = k(4) || dist(a, b) * 0.25
      const wing = (side: number): Pt => pt(b.x - head * Math.cos(along + side * 28 * DEG), b.y - head * Math.sin(along + side * 28 * DEG))
      return [a, b, wing(1), b, wing(-1)]
    }
    case 'arc': {
      const [cx, cy, r] = [k(0), k(1), k(2)]
      const start = k(3) / 1000
      const sweep = k(4) / 1000
      const n = Math.max(8, Math.ceil(Math.abs(sweep) * 16))
      return Array.from({ length: n + 1 }, (_, i) => pt(cx + r * Math.cos(start + (sweep * i) / n), cy + r * Math.sin(start + (sweep * i) / n)))
    }
    case 'curve':
      return catmullRom(pairs(), p)
    case 'triangle':
    case 'rect':
    case 'square':
    case 'rhombus': {
      const corners = pairs()
      return [...corners, corners[0]!]
    }
    case 'polygon':
      return pairs()
    case 'star': {
      const [cx, cy, R, r] = [k(0), k(1), k(2), k(3)]
      const angle = k(4) / 1000
      const points = Array.from({ length: 10 }, (_, i) => {
        const radius = i % 2 === 0 ? R : r
        const a = angle + (i * Math.PI) / 5
        return pt(cx + radius * Math.cos(a), cy + radius * Math.sin(a))
      })
      return [...points, points[0]!]
    }
    case 'ellipse': {
      const [cx, cy, rx, ry] = [k(0), k(1), k(2), k(3)]
      const angle = k(4) / 1000
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      return around(96, (t) => pt(cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos))
    }
    case 'circle':
      return around(96, (t) => pt(k(0) + k(2) * Math.cos(t), k(1) + k(2) * Math.sin(t)))
    case 'heart': {
      // The classic heart curve, scaled into the box, point down.
      const [x, y, w, h] = [k(0), k(1), k(2), k(3)]
      return around(96, (t) => {
        const hx = 16 * Math.sin(t) ** 3
        const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
        return pt(x + ((hx + 16) / 32) * w, y + ((12 - hy) / 29) * h)
      })
    }
    case 'cloud': {
      // Eight bumps around an ellipse.
      const [x, y, w, h] = [k(0), k(1), k(2), k(3)]
      const cx = x + w / 2
      const cy = y + h / 2
      return around(160, (t) => {
        // 1.12 times the 0.89 below is about 1: the bumps' tops reach the box.
        const bump = 1 + 0.12 * Math.abs(Math.sin(4 * t))
        return pt(cx + (w / 2) * 0.89 * bump * Math.cos(t), cy + (h / 2) * 0.89 * bump * Math.sin(t))
      })
    }
    case 'paren': {
      // A shallow curve between its ends, bulging to the side it opens from.
      const [x, y, w, h] = [k(0), k(1), k(2), k(3)]
      const opens = k(4) === 0
      const end = opens ? x + w : x
      return bezier(pt(end, y), pt(opens ? x - w : x + 2 * w, y + h / 2), pt(end, y + h), 24)
    }
    case 'bracket': {
      const [x, y, w, h] = [k(0), k(1), k(2), k(3)]
      const [spine, tips] = k(4) === 0 ? [x, x + w] : [x + w, x]
      return [pt(tips, y), pt(spine, y), pt(spine, y + h), pt(tips, y + h)]
    }
    case 'brace': {
      // Down from the top end to a spine, in to a point in the middle, out again, and down to the bottom end.
      const [x, y, w, h] = [k(0), k(1), k(2), k(3)]
      const [end, tip] = k(4) === 0 ? [x + w, x] : [x, x + w]
      const spine = x + w / 2
      return [
        ...bezier(pt(end, y), pt(spine, y), pt(spine, y + 0.18 * h), 8),
        ...bezier(pt(spine, y + 0.36 * h), pt(spine, y + 0.5 * h), pt(tip, y + 0.5 * h), 8),
        ...bezier(pt(tip, y + 0.5 * h), pt(spine, y + 0.5 * h), pt(spine, y + 0.64 * h), 8),
        ...bezier(pt(spine, y + 0.82 * h), pt(spine, y + h), pt(end, y + h), 8),
      ]
    }
    case 'comma': {
      // A short tick down and to the left, wide at its head and thin at its tail.
      const [x, y, w, h] = [k(0), k(1), k(2), k(3)]
      return bezier(pt(x + 0.7 * w, y), pt(x + 1.05 * w, y + 0.55 * h), pt(x, y + h), 12).map((point, i) => ({ ...point, p: p * (1.7 - (1.2 * i) / 12) }))
    }
    case 'at': {
      // An a in the middle (once round, then its stem), and from the foot of the stem a ring round it all, ending low on the right.
      const [x, y, w, h] = [k(0), k(1), k(2), k(3)]
      const cx = x + w / 2
      const cy = y + h / 2
      const [ix, iy, irx, iry] = [cx - 0.04 * w, cy, 0.2 * w, 0.24 * h]
      const inner = Array.from({ length: 33 }, (_, i) => {
        const a = (-30 - (360 * i) / 32) * DEG
        return pt(ix + irx * Math.cos(a), iy + iry * Math.sin(a))
      })
      const stem = [pt(ix + irx * 0.87, iy + iry), pt(ix + irx * 1.2, iy + iry * 1.05)]
      const ring = Array.from({ length: 49 }, (_, i) => {
        const a = (25 - (300 * i) / 48) * DEG
        return pt(cx + (w / 2) * Math.cos(a), cy + (h / 2) * Math.sin(a))
      })
      return [...inner, ...stem, ...ring]
    }
    case 'bubble': {
      // A rounded body in the top four fifths of the box, and a tail to its bottom left corner.
      const [x, y, w, h] = [k(0), k(1), k(2), k(3)]
      const cx = x + w / 2
      const cy = y + h * 0.4
      const rx = w / 2
      const ry = h * 0.4
      const body = around(96, (t) => pt(cx + rx * Math.cos(t), cy + ry * Math.sin(t)))
      // The tail leaves the body below and to the left of its centre, at about 105°, and comes back at about 120°.
      const from = Math.round((96 * 105) / 360)
      const to = Math.round((96 * 120) / 360)
      return [...body.slice(0, from), pt(x + w * 0.18, y + h), ...body.slice(to)]
    }
  }
}

/** A quadratic Bézier curve from a to b, bending towards c, in `steps` pieces. */
function bezier(a: Pt, c: Pt, b: Pt, steps: number): Pt[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps
    const u = 1 - t
    return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y, p: a.p }
  })
}

/** A smooth curve through points (Catmull–Rom), eight steps between each two. */
function catmullRom(points: readonly Pt[], p: number): Pt[] {
  if (points.length < 3) return [...points]
  const out: Pt[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!
    const p1 = points[i]!
    const p2 = points[i + 1]!
    const p3 = points[Math.min(points.length - 1, i + 2)]!
    for (let s = 0; s < 8; s++) {
      const t = s / 8
      const t2 = t * t
      const t3 = t2 * t
      const at = (a: number, b: number, c: number, d: number): number => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3)
      out.push({ x: at(p0.x, p1.x, p2.x, p3.x), y: at(p0.y, p1.y, p2.y, p3.y), p })
    }
  }
  out.push({ ...points.at(-1)!, p })
  return out
}
