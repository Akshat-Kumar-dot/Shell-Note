// Which strokes are where: under the eraser, inside a lasso or a Select box.
// Every test first skips blocks and strokes whose boxes are nowhere near, so a
// page of 2,000 strokes costs a few thousand box checks, then measures only the
// strokes left. Points given here are page coordinates; strokes keep theirs
// relative to their block.
import type { Doc, Id, InkBlock, Stroke } from '../schema/doc.js'
import { boxOfFlat, grown, insidePolygon, overlaps, segmentDistance, type Box } from './geometry.js'
import { reachOf } from './pens.js'

type XY = { x: number; y: number }

/** A stroke: its block and its index there. */
export interface StrokeRef {
  block: Id
  index: number
}

// A stroke never changes (apply makes a new one), so its box is worked out once.
const boxes = new WeakMap<Stroke, Box>()

/** The box a stroke's ink covers, relative to its block: its points' box, grown by how far the pen reaches. */
export function strokeBox(stroke: Stroke): Box {
  let box = boxes.get(stroke)
  if (!box) {
    box = grown(boxOfFlat(stroke.pts), reachOf(stroke))
    boxes.set(stroke, box)
  }
  return box
}

/** The ink blocks on a page, front to back. */
export function inkBlocks(doc: Doc, page: Id): InkBlock[] {
  const free = doc.page[page]?.free ?? []
  const out: InkBlock[] = []
  for (let i = free.length - 1; i >= 0; i--) {
    const block = doc.block[free[i]!]
    if (block?.type === 'ink') out.push(block)
  }
  return out
}

const inks = new WeakMap<InkBlock, Box>()

/** The box all a block's ink covers, on the page. Its own box should hold it, but a file need not keep to that. */
export function inkBox(block: InkBlock): Box {
  let box = inks.get(block)
  if (!box) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const stroke of block.strokes) {
      const b = strokeBox(stroke)
      minX = Math.min(minX, b.x)
      minY = Math.min(minY, b.y)
      maxX = Math.max(maxX, b.x + b.w)
      maxY = Math.max(maxY, b.y + b.h)
    }
    box = minX === Infinity ? { x: block.x, y: block.y, w: 0, h: 0 } : { x: block.x + minX, y: block.y + minY, w: maxX - minX, h: maxY - minY }
    inks.set(block, box)
  }
  return box
}
const moved = (pts: readonly XY[], dx: number, dy: number): XY[] => pts.map((pt) => ({ x: pt.x - dx, y: pt.y - dy }))
const boxAround = (pts: readonly XY[]): Box => {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const pt of pts) {
    minX = Math.min(minX, pt.x)
    minY = Math.min(minY, pt.y)
    maxX = Math.max(maxX, pt.x)
    maxY = Math.max(maxY, pt.y)
  }
  return minX === Infinity ? { x: 0, y: 0, w: 0, h: 0 } : { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** How far apart two segments are: 0 when they cross. */
export function segmentsDistance(a: XY, b: XY, c: XY, d: XY): number {
  const cross = (o: XY, p: XY, q: XY): number => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x)
  const d1 = cross(c, d, a)
  const d2 = cross(c, d, b)
  const d3 = cross(a, b, c)
  const d4 = cross(a, b, d)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0
  return Math.min(segmentDistance(a, c, d), segmentDistance(b, c, d), segmentDistance(c, a, b), segmentDistance(d, a, b))
}

/** Whether a stroke's ink comes within `radius` of a path, both in the block's coordinates. */
function touches(stroke: Stroke, path: readonly XY[], radius: number): boolean {
  const pts = stroke.pts
  const near = radius + reachOf(stroke)
  const count = pts.length / 3
  // A single point is a segment of no length, for a stroke (a dot) and for a path (a tap) alike.
  for (let i = 0; i < Math.max(1, count - 1); i++) {
    const j = Math.min(i + 1, count - 1)
    const a = { x: pts[i * 3]!, y: pts[i * 3 + 1]! }
    const b = { x: pts[j * 3]!, y: pts[j * 3 + 1]! }
    for (let k = 0; k < Math.max(1, path.length - 1); k++) {
      if (segmentsDistance(a, b, path[k]!, path[Math.min(k + 1, path.length - 1)]!) <= near) return true
    }
  }
  return false
}

/**
 * The strokes a path passes within `radius` of, front to back: what an
 * eraser drag removes. A path of one point is a tap.
 */
export function strokesAlong(doc: Doc, page: Id, path: readonly XY[], radius: number): StrokeRef[] {
  if (path.length === 0) return []
  const reach = grown(boxAround(path), radius)
  const out: StrokeRef[] = []
  for (const block of inkBlocks(doc, page)) {
    if (!overlaps(inkBox(block), reach)) continue
    const local = moved(path, block.x, block.y)
    const near = grown(boxAround(local), radius)
    for (let index = block.strokes.length - 1; index >= 0; index--) {
      const stroke = block.strokes[index]!
      if (overlaps(strokeBox(stroke), near) && touches(stroke, local, radius)) out.push({ block: block.id, index })
    }
  }
  return out
}

/** The strokes under a point, within `radius` of it, front to back. */
export function strokesAt(doc: Doc, page: Id, at: XY, radius: number): StrokeRef[] {
  return strokesAlong(doc, page, [at], radius)
}

/** Strokes with more than half their points passing `inside`, front to back. */
function strokesWhere(doc: Doc, page: Id, area: Box, inside: (pt: XY) => boolean): StrokeRef[] {
  const out: StrokeRef[] = []
  for (const block of inkBlocks(doc, page)) {
    if (!overlaps(inkBox(block), area)) continue
    const local = { x: area.x - block.x, y: area.y - block.y, w: area.w, h: area.h }
    for (let index = block.strokes.length - 1; index >= 0; index--) {
      const stroke = block.strokes[index]!
      if (!overlaps(strokeBox(stroke), local)) continue
      const pts = stroke.pts
      const count = pts.length / 3
      let held = 0
      for (let i = 0; i < pts.length; i += 3) if (inside({ x: pts[i]! + block.x, y: pts[i + 1]! + block.y })) held++
      if (held * 2 > count) out.push({ block: block.id, index })
    }
  }
  return out
}

/** The strokes mostly inside a closed loop, such as a lasso: more than half their points inside it. */
export function strokesInLoop(doc: Doc, page: Id, loop: readonly XY[]): StrokeRef[] {
  if (loop.length < 3) return []
  return strokesWhere(doc, page, boxAround(loop), (pt) => insidePolygon(pt, loop))
}

/** The strokes mostly inside a box, such as the Select box: more than half their points inside it. */
export function strokesInBox(doc: Doc, page: Id, box: Box): StrokeRef[] {
  return strokesWhere(doc, page, box, (pt) => pt.x >= box.x && pt.x <= box.x + box.w && pt.y >= box.y && pt.y <= box.y + box.h)
}
