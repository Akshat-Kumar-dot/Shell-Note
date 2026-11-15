// A note is pages inside, however it is shown. What is placed freely on a page (ink, a picture, a formula, a
// diagram) lies on its page clear of the line to the next: above the bottom margin (a page's top margin and its
// writing area are one room, to write in anywhere), or wholly in the bottom margin. So the line between two pages
// never runs through anything: the seamless view, which folds the margins between two pages away, shows each thing
// whole (a margin that holds something is shown), and printing cuts nothing.
//
// A thing that would lie across the line moves, whole, onto the next page's writing area, or down onto its own
// page's when it reaches over the page's top edge. What touches it goes with it, and ink on its line of writing, so a word keeps its line
// and an arrow its box. When its place there is taken, everything on that page lower than it moves down together, just
// enough, so what sat side by side still does. What then lies across that page's line moves on in turn, and a page
// like the last is added at the end when needed. Only ink taller than a whole writing area is cut, at the line: where
// a stroke crosses, the point on the line is kept in both parts, so they meet exactly. A picture, formula or diagram
// that tall is made smaller to fit. Typed text keeps its own rule: a frame's lines flow into its continuation on the
// next page (the editor's overflow), so a frame is never moved here, only pushed down to make room.
//
// Everything returns operations for apply(). Ids are made from what they continue, so a note settles the same way on
// every device.
import { apply } from '../apply.js'
import { idTaken } from '../ids.js'
import { boxOfFlat, overlaps, type Box } from '../ink/geometry.js'
import { editInk, JOIN_GAP, shifted } from '../ink/group.js'
import { strokeBox } from '../ink/hit.js'
import type { Block, Doc, FreeBlock, Id, InkBlock, Page, Stroke } from '../schema/doc.js'
import type { Op } from '../schema/ops.js'
import { sameBlock } from '../sync/diff.js'
import { idFrom } from '../sync/merge.js'
import { MARGIN } from '../units.js'

/** The room kept between a thing moved onto a page and what moves down to make way for it: 2 mm. */
export const MAKE_ROOM_GAP = 200

/** Steps at most in one settling, so that a note which cannot settle (none should) never holds the app. */
const MOST_STEPS = 5000

/** A page's margin: 20 mm, or a quarter of a page shorter than 80 mm, so that every page keeps a writing area. */
export function marginOf(page: Pick<Page, 'h'>): number {
  return Math.min(MARGIN, Math.floor(page.h / 4))
}

/** The top and bottom of a page's writing area, in its units. */
export function writingArea(page: Pick<Page, 'h'>): { top: number; bottom: number } {
  const margin = marginOf(page)
  return { top: margin, bottom: page.h - margin }
}

/** A block placed freely on a page that is not a frame of typed text: what this rule moves. */
export type PlacedBlock = Exclude<FreeBlock, { type: 'frame' }>

export function isPlacedBlock(block: Block | undefined): block is PlacedBlock {
  return block !== undefined && 'page' in block && block.type !== 'frame'
}

// A block never changes (apply makes a new one), so its body is worked out once.
const bodies = new WeakMap<Block, Box>()

/**
 * Where a thing lies, for this rule: a picture's, a formula's or a diagram's box; for ink, the box of its strokes'
 * points, without the pen's width, so the two parts of a cut stroke meet exactly at the line.
 */
export function bodyOf(block: PlacedBlock): Box {
  if (block.type !== 'ink') return { x: block.x, y: block.y, w: block.w, h: block.h }
  let box = bodies.get(block)
  if (!box) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const stroke of block.strokes) {
      const b = boxOfFlat(stroke.pts)
      minX = Math.min(minX, b.x)
      minY = Math.min(minY, b.y)
      maxX = Math.max(maxX, b.x + b.w)
      maxY = Math.max(maxY, b.y + b.h)
    }
    box = minX === Infinity ? { x: block.x, y: block.y, w: 0, h: 0 } : { x: block.x + minX, y: block.y + minY, w: maxX - minX, h: maxY - minY }
    bodies.set(block, box)
  }
  return box
}

/**
 * True when a thing lies on its page clear of the line to the next page: above the bottom margin (the top margin and
 * the writing area are one room), or wholly in the bottom margin.
 */
export function liesInOneBand(block: PlacedBlock, page: Pick<Page, 'h'>): boolean {
  const { y, h } = bodyOf(block)
  const margin = marginOf(page)
  const bottom = y + h
  return (y >= 0 && bottom <= page.h - margin) || (y >= page.h - margin && bottom <= page.h)
}

/** A thing reaching over its page's top edge: it moves down onto its own page's writing area. */
function reachesUp(block: PlacedBlock): boolean {
  return bodyOf(block).y < 0
}

const boxOf = (block: FreeBlock): Box => ({ x: block.x, y: block.y, w: block.w, h: block.h })
const sideBySide = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w

/** Two things that go together: they touch, or both are ink on one line of writing with no more than 15 mm between. */
function together(a: PlacedBlock, b: PlacedBlock): boolean {
  const boxA = boxOf(a)
  const boxB = boxOf(b)
  if (overlaps(boxA, boxB)) return true
  if (a.type !== 'ink' || b.type !== 'ink') return false
  const shared = Math.min(boxA.y + boxA.h, boxB.y + boxB.h) - Math.max(boxA.y, boxB.y)
  const apart = Math.max(0, boxA.x - (boxB.x + boxB.w), boxB.x - (boxA.x + boxA.w))
  return shared > 0 && shared * 2 >= Math.min(boxA.h, boxB.h) && apart <= JOIN_GAP
}

/** These things and what goes with them on their page, and what goes with that, and so on. */
function withTheirs(doc: Doc, page: Page, seeds: readonly PlacedBlock[]): PlacedBlock[] {
  const unit = [...seeds]
  const held = new Set(seeds.map((block) => block.id))
  const others: PlacedBlock[] = []
  for (const id of page.free) {
    const block = doc.block[id]
    if (isPlacedBlock(block) && !held.has(id)) others.push(block)
  }
  for (let i = 0; i < unit.length; i++) {
    const thing = unit[i]!
    for (const other of others) {
      if (held.has(other.id) || !together(thing, other)) continue
      held.add(other.id)
      unit.push(other)
    }
  }
  return unit
}

/** From the top of the highest thing to the bottom of the lowest. */
function spanOf(unit: readonly PlacedBlock[]): { top: number; bottom: number } {
  let top = Infinity
  let bottom = -Infinity
  for (const block of unit) {
    const body = bodyOf(block)
    top = Math.min(top, body.y)
    bottom = Math.max(bottom, body.y + body.h)
  }
  return { top, bottom }
}

const heightOf = (unit: readonly PlacedBlock[]): number => {
  const { top, bottom } = spanOf(unit)
  return bottom - top
}

/**
 * Moves that put things on a page with the highest one's top at `top`, keeping where they lie to each other and
 * their order front to back. Returns the moves and the things where they land.
 */
function land(doc: Doc, unit: readonly PlacedBlock[], pageId: Id, top: number): { ops: Op[]; landed: PlacedBlock[] } {
  const dy = top - spanOf(unit).top
  const order = (block: PlacedBlock): number => doc.page[block.page]?.free.indexOf(block.id) ?? 0
  const back = [...unit].sort((a, b) => order(a) - order(b))
  const ops: Op[] = back.map((block) => ({ op: 'move', id: block.id, to: { page: pageId, x: block.x, y: block.y + dy } }))
  return { ops, landed: unit.map((block) => ({ ...block, page: pageId, y: block.y + dy }) as PlacedBlock) }
}

/**
 * Room on a page for things just put there: when what is there is in their way, everything on the page reaching
 * lower than `top` moves down together, as little as makes room, keeping its own gaps and what sits side by side.
 */
function makeRoom(doc: Doc, pageId: Id, landed: readonly PlacedBlock[], top: number): Op[] {
  const page = doc.page[pageId]
  if (!page) return []
  const mine = new Set(landed.map((block) => block.id))
  const lower: FreeBlock[] = []
  for (const id of page.free) {
    const block = doc.block[id]
    if (block && 'page' in block && !mine.has(id) && block.y + block.h > top) lower.push(block)
  }
  let by = 0
  for (;;) {
    let more = by
    for (const thing of landed) {
      const a = boxOf(thing)
      for (const other of lower) {
        if (!sideBySide(a, other)) continue
        const y = other.y + by
        if (y < a.y + a.h + MAKE_ROOM_GAP && y + other.h > a.y) more = Math.max(more, a.y + a.h + MAKE_ROOM_GAP - other.y)
      }
    }
    if (more === by) break
    by = more
  }
  return by > 0 ? lower.map((block) => ({ op: 'move', id: block.id, to: { page: pageId, x: block.x, y: block.y + by } })) : []
}

/** Things reaching up over the top line of their page, put down onto its writing area. */
function downOnItsPage(doc: Doc, page: Page, up: readonly PlacedBlock[]): Op[] {
  const area = writingArea(page)
  let unit = withTheirs(doc, page, up)
  if (heightOf(unit) > area.bottom - area.top) unit = [...up]
  const { ops, landed } = land(doc, unit, page.id, area.top)
  return [...ops, ...makeRoom(doc, page.id, landed, area.top)]
}

/** Things lying across the bottom line of the page at `index`, put onto the next page's writing area. */
function ontoNextPage(doc: Doc, index: number, wrong: readonly PlacedBlock[], fresh: (seed: string) => Id): Op[] {
  const page = doc.page[doc.pages[index]!]!
  const ops: Op[] = []
  const after = doc.pages[index + 1]
  let next = after === undefined ? undefined : doc.page[after]
  if (!next) {
    next = { id: fresh(`${page.id}:next`), w: page.w, h: page.h, bg: page.bg, free: [] }
    ops.push({ op: 'page', add: next, at: index + 1 })
  }
  const area = writingArea(next)
  const room = area.bottom - area.top

  // One taller than a whole writing area: ink is cut at this page's line; anything else is made smaller to fit.
  const tall = wrong.find((block) => bodyOf(block).h > room)
  if (tall) {
    const line = writingArea(page).bottom
    if (tall.type === 'ink' && bodyOf(tall).y < line) {
      const cut = cutInk(doc, tall, line, next.id, area.top, fresh)
      return [...ops, ...cut.ops, ...makeRoom(doc, next.id, [cut.rest], area.top)]
    }
    if (tall.type === 'ink') {
      // All of it below this page's line: it goes on whole, and is cut there.
      const { ops: moves, landed } = land(doc, [tall], next.id, area.top)
      return [...ops, ...moves, ...makeRoom(doc, next.id, landed, area.top)]
    }
    const h = room
    const w = Math.max(1, Math.round((tall.w * room) / Math.max(1, tall.h)))
    const smaller = { ...tall, page: next.id, y: area.top, w, h } as PlacedBlock
    ops.push({ op: 'move', id: tall.id, to: { page: next.id, x: tall.x, y: area.top, w, h } })
    return [...ops, ...makeRoom(doc, next.id, [smaller], area.top)]
  }

  let unit = withTheirs(doc, page, wrong)
  if (heightOf(unit) > room) unit = [...wrong]
  if (heightOf(unit) > room) {
    // They cannot go together: the lowest goes first, so those above it, going after, stay above it.
    const lowest = wrong.reduce((a, b) => (bodyOf(b).y > bodyOf(a).y ? b : a))
    unit = withTheirs(doc, page, [lowest])
    if (heightOf(unit) > room) unit = [lowest]
  }
  const { ops: moves, landed } = land(doc, unit, next.id, area.top)
  return [...ops, ...moves, ...makeRoom(doc, next.id, landed, area.top)]
}

/** One point of a stroke, with its tilt when it has one. */
interface Point {
  x: number
  y: number
  p: number
  t: number | undefined
}

const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y && a.p === b.p && a.t === b.t

/**
 * A stroke cut at the line y = `at`, in its own units: its parts above the line (and on it) and below it. Where it
 * crosses, the point on the line ends one part and starts the next, so they meet exactly. A cut part is no longer the
 * shape it was snapped to, so it keeps no shape; it keeps everything else.
 */
export function splitStrokeAt(stroke: Stroke, at: number): { above: Stroke[]; below: Stroke[] } {
  const { pts, tilt } = stroke
  const runs: { above: boolean; points: Point[] }[] = []
  let run: { above: boolean; points: Point[] } | undefined
  for (let i = 0; i + 2 < pts.length; i += 3) {
    const point: Point = { x: pts[i]!, y: pts[i + 1]!, p: pts[i + 2]!, t: tilt?.[i / 3] }
    const above = point.y <= at
    if (!run || run.above !== above) {
      const last = run?.points[run.points.length - 1]
      let start: Point[] = []
      if (run && last) {
        const f = (at - last.y) / (point.y - last.y)
        const cross: Point = {
          x: Math.round(last.x + (point.x - last.x) * f),
          y: at,
          p: Math.round(last.p + (point.p - last.p) * f),
          t: last.t === undefined || point.t === undefined ? undefined : Math.round(last.t + (point.t - last.t) * f),
        }
        if (!samePoint(cross, last)) run.points.push(cross)
        start = samePoint(cross, point) ? [] : [cross]
      }
      run = { above, points: start }
      runs.push(run)
    }
    run.points.push(point)
  }
  // A part lying all on the line adds nothing its neighbours do not hold, unless it is all there is.
  const parts = runs.length > 1 ? runs.filter((part) => part.points.some((point) => point.y !== at)) : runs
  const made = (points: readonly Point[]): Stroke => {
    const out: Stroke = { pts: points.flatMap((point) => [point.x, point.y, point.p]), color: stroke.color, width: stroke.width }
    if (stroke.tool) out.tool = stroke.tool
    if (tilt) out.tilt = points.map((point) => point.t ?? 0)
    if (stroke.straight) out.straight = true
    if (stroke.vt) out.vt = stroke.vt
    if (stroke.pm) out.pm = stroke.pm
    return out
  }
  return { above: parts.filter((part) => part.above).map((part) => made(part.points)), below: parts.filter((part) => !part.above).map((part) => made(part.points)) }
}

/**
 * Ink cut at the line `at` of its page: what is above stays in the block; what is below becomes a new ink block on
 * page `onto`, the line put at `top` there.
 */
function cutInk(doc: Doc, block: InkBlock, at: number, onto: Id, top: number, fresh: (seed: string) => Id): { ops: Op[]; rest: InkBlock } {
  const line = at - block.y
  const replace = new Map<number, Stroke[]>()
  const below: Stroke[] = []
  block.strokes.forEach((stroke, index) => {
    const parts = splitStrokeAt(stroke, line)
    if (parts.below.length === 0) return
    replace.set(index, parts.above)
    // On the page it goes to: the line of this page at `top` there.
    for (const part of parts.below) below.push(shifted(part, block.x, block.y - at + top))
  })
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const stroke of below) {
    const b = strokeBox(stroke)
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.w)
    maxY = Math.max(maxY, b.y + b.h)
  }
  const rest: InkBlock = {
    id: fresh(`${block.id}:rest`),
    r: 0,
    type: 'ink',
    page: onto,
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
    strokes: below.map((stroke) => shifted(stroke, -minX, -minY)),
  }
  return { ops: [...editInk(doc, block.id, { replace }), { op: 'add', block: rest }], rest }
}

/**
 * The operations that settle a note after a change: each of the `touched` blocks that lies across a page's line,
 * and whatever moving it moves, goes where this rule puts it. None when nothing lies across a line. The note given is
 * not changed.
 */
export function settle(doc: Doc, touched: Iterable<Id>): Op[] {
  const watch = new Set<Id>()
  for (const id of touched) if (isPlacedBlock(doc.block[id])) watch.add(id)
  const out: Op[] = []
  if (watch.size === 0) return out
  let work = doc
  const fresh = (seed: string): Id => {
    for (let n = 0; ; n++) {
      const id = idFrom(`${seed}:${n}`)
      if (!idTaken(work, id)) return id
    }
  }
  let steps = 0
  for (let index = 0; index < work.pages.length && steps <= MOST_STEPS; index++) {
    for (;;) {
      const page = work.page[work.pages[index]!]!
      const wrong: PlacedBlock[] = []
      for (const id of page.free) {
        const block = work.block[id]
        if (isPlacedBlock(block) && watch.has(id) && !liesInOneBand(block, page)) wrong.push(block)
      }
      if (wrong.length === 0 || ++steps > MOST_STEPS) break
      const up = wrong.filter(reachesUp)
      const ops = up.length > 0 ? downOnItsPage(work, page, up) : ontoNextPage(work, index, wrong, fresh)
      if (ops.length === 0) {
        for (const block of wrong) watch.delete(block.id)
        continue
      }
      work = apply(work, ops).doc
      out.push(...ops)
      for (const op of ops) {
        if (op.op === 'move' && isPlacedBlock(work.block[op.id])) watch.add(op.id)
        if (op.op === 'add' && isPlacedBlock(work.block[op.block.id])) watch.add(op.block.id)
      }
    }
  }
  return out
}

/**
 * A note brought together from two versions (sync's merge), settled: what came from the other version, or lies on a
 * page whose size changed there, goes to its place if it lies across a line, as after any change. `before` is this
 * device's version. Both devices settle the same merge the same way. Should settling fail, the merge is kept as it is.
 */
export function settleMerged(before: Doc, merged: Doc): Doc {
  const touched: Id[] = []
  for (const [id, block] of Object.entries(merged.block)) {
    if (!isPlacedBlock(block)) continue
    const was = before.page[block.page]
    const now = merged.page[block.page]
    if (!sameBlock(before.block[id], block) || !was || !now || was.w !== now.w || was.h !== now.h) touched.push(id)
  }
  try {
    const ops = settle(merged, touched)
    return ops.length === 0 ? merged : apply(merged, ops).doc
  } catch {
    return merged
  }
}
