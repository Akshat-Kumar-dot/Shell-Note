// Which ink block a stroke joins, and keeping each ink block's box round its
// ink. Strokes are kept relative to their block, so moving a block moves only
// its corner. Everything here returns operations for apply(), as every change to
// a note does.
import type { Doc, Id, InkBlock, Stroke } from '../schema/doc.js'
import type { Op } from '../schema/ops.js'
import { MM, type Box } from './geometry.js'
import { inkBlocks, inkBox, strokeBox } from './hit.js'
import { movedKey } from './shapes.js'

/** A stroke joins the block of the stroke before it when it starts within 2 s of that one ending... */
export const JOIN_TIME = 2000
/** ...and within 15 mm of the block's ink. */
export const JOIN_GAP = 15 * MM

/** Where the last stroke went, and when it ended, in milliseconds. */
export interface LastStroke {
  block: Id
  at: number
}

/** A stroke moved by dx, dy, its shape's key too. The same stroke when it does not move. */
export function shifted(stroke: Stroke, dx: number, dy: number): Stroke {
  if (dx === 0 && dy === 0) return stroke
  const pts = stroke.pts.slice()
  for (let i = 0; i + 1 < pts.length; i += 3) {
    pts[i] = pts[i]! + dx
    pts[i + 1] = pts[i + 1]! + dy
  }
  const out: Stroke = { ...stroke, pts }
  if (stroke.shape) out.shape = { kind: stroke.shape.kind, key: movedKey(stroke.shape.kind, stroke.shape.key, dx, dy) }
  return out
}

/** How far apart two boxes are: 0 when they touch or overlap. */
function gap(a: Box, b: Box): number {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w))
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h))
  return Math.hypot(dx, dy)
}

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/**
 * The ink block a new stroke joins: the last stroke's, when this one starts
 * soon after and near it; otherwise the front-most ink block holding at least
 * half of it, as when adding to a drawing later. Undefined: a new block.
 */
export function joinedBlock(doc: Doc, page: Id, box: Box, now: number, last?: LastStroke): InkBlock | undefined {
  if (last && now - last.at <= JOIN_TIME) {
    const block = doc.block[last.block]
    if (block?.type === 'ink' && block.page === page && gap(inkBox(block), box) <= JOIN_GAP) return block
  }
  const area = Math.max(1, box.w * box.h)
  return inkBlocks(doc, page).find((block) => overlapArea(inkBox(block), box) * 2 >= area)
}

/**
 * The operations that put a new stroke on a page: into the block it joins,
 * or a new ink block at the front. `stroke` is in page coordinates; `now` is
 * when it began.
 */
export function placeStroke(doc: Doc, page: Id, stroke: Stroke, options: { now: number; last?: LastStroke | undefined; newId: () => Id }): { ops: Op[]; block: Id } {
  const box = strokeBox(stroke)
  const block = joinedBlock(doc, page, box, options.now, options.last)
  if (block) return { block: block.id, ops: editInk(doc, block.id, { add: [shifted(stroke, -block.x, -block.y)] }) }
  const id = options.newId()
  const ink: InkBlock = { id, r: 0, type: 'ink', page, x: box.x, y: box.y, w: box.w, h: box.h, strokes: [shifted(stroke, -box.x, -box.y)] }
  return { block: id, ops: [{ op: 'add', block: ink }] }
}

/** A change to an ink block's strokes, in the block's coordinates: strokes replaced by others (none, to remove them), and strokes added in front. */
export interface InkEdit {
  replace?: ReadonlyMap<number, readonly Stroke[]>
  add?: readonly Stroke[]
}

/**
 * The operations for an InkEdit, keeping the block's box tight round its ink:
 * one stroke operation each, and a new size. When the box must move left or
 * up, every stroke moves the other way so the ink stays put, and the block is
 * written again (one remove, one add, at the same place in the page's order).
 * A block left with no strokes goes.
 */
export function editInk(doc: Doc, id: Id, edit: InkEdit): Op[] {
  const block = doc.block[id]
  if (block?.type !== 'ink') return []
  const replace = edit.replace ?? new Map<number, readonly Stroke[]>()
  const add = edit.add ?? []
  const strokes: Stroke[] = []
  block.strokes.forEach((stroke, index) => strokes.push(...(replace.get(index) ?? [stroke])))
  strokes.push(...add)
  if (strokes.length === 0) return [{ op: 'remove', id }]

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const stroke of strokes) {
    const b = strokeBox(stroke)
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.w)
    maxY = Math.max(maxY, b.y + b.h)
  }
  const w = maxX - minX
  const h = maxY - minY
  if (minX === 0 && minY === 0) {
    const ops: Op[] = []
    // From the last index down, so the ones below keep their place.
    for (const index of [...replace.keys()].sort((a, b) => b - a)) {
      if (index >= block.strokes.length) continue
      ops.push({ op: 'stroke', id, at: index, remove: true })
      replace.get(index)!.forEach((stroke, k) => ops.push({ op: 'stroke', id, at: index + k, add: stroke }))
    }
    add.forEach((stroke, k) => ops.push({ op: 'stroke', id, at: strokes.length - add.length + k, add: stroke }))
    if (w !== block.w || h !== block.h) ops.push({ op: 'update', id, set: { w, h } })
    return ops
  }
  const at = doc.page[block.page]?.free.indexOf(id) ?? -1
  const moved: InkBlock = { ...block, x: block.x + minX, y: block.y + minY, w, h, strokes: strokes.map((stroke) => shifted(stroke, -minX, -minY)) }
  return [{ op: 'remove', id }, at >= 0 ? { op: 'add', block: moved, at } : { op: 'add', block: moved }]
}
