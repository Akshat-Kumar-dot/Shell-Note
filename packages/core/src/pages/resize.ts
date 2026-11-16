// A note's page size and which way up its pages are. Changing either fits what each page holds to the new page: the
// margins stay, and what lies between them stretches or shrinks with the writing area. Typed text keeps its size and
// flows in its frame, which widens or narrows with the column. Ink, pictures, formulas and diagrams are scaled down
// when the writing area shrinks, never up. Then whatever lies across a page's line moves on (settle.ts).
import { apply } from '../apply.js'
import { isEndless, type Clip, type Doc, type FreeBlock, type InkBlock, type SizedPage, type Stroke } from '../schema/doc.js'
import type { Op } from '../schema/ops.js'
import { marginOf, settle } from './settle.js'

/** The page sizes a person chooses from, upright, in units of 0.01 mm. */
export const SHEETS = {
  A4: { w: 21000, h: 29700 },
  A5: { w: 14800, h: 21000 },
  A6: { w: 10500, h: 14800 },
  Letter: { w: 21590, h: 27940 },
} as const
export type Sheet = keyof typeof SHEETS
/** Which way up a page is: taller than wide (upright), or wider than tall (across). */
export type Turn = 'upright' | 'across'

/** A sheet's size, either way up. */
export function sheetSize(sheet: Sheet, turn: Turn): { w: number; h: number } {
  const { w, h } = SHEETS[sheet]
  return turn === 'across' ? { w: h, h: w } : { w, h }
}

/** Which sheet a page is, and which way up; no sheet for a size of its own. */
export function sheetOf(page: Pick<SizedPage, 'w' | 'h'>): { sheet: Sheet | undefined; turn: Turn } {
  const turn: Turn = page.w > page.h ? 'across' : 'upright'
  const long = Math.max(page.w, page.h)
  const short = Math.min(page.w, page.h)
  const sheet = (Object.keys(SHEETS) as Sheet[]).find((name) => SHEETS[name].w === short && SHEETS[name].h === long)
  return { sheet, turn }
}

/** Along one side: what lies in a margin keeps its distance from the edge; what lies between them is stretched. */
function along(from: number, to: number, fromMargin: number, toMargin: number): (at: number) => number {
  const scale = (to - 2 * toMargin) / Math.max(1, from - 2 * fromMargin)
  return (at) => {
    if (at <= fromMargin) return Math.round(Math.min(at, toMargin))
    if (at >= from - fromMargin) return Math.round(to - Math.min(from - at, toMargin))
    return Math.round(toMargin + (at - fromMargin) * scale)
  }
}

/** A stroke scaled by `s` about its block's corner. */
function scaledStroke(stroke: Stroke, s: number): Stroke {
  const pts = stroke.pts.slice()
  for (let i = 0; i + 2 < pts.length; i += 3) {
    pts[i] = Math.round(pts[i]! * s)
    pts[i + 1] = Math.round(pts[i + 1]! * s)
  }
  const out: Stroke = { ...stroke, pts }
  if (stroke.shape) out.shape = { kind: stroke.shape.kind, key: stroke.shape.key.map((value) => Math.round(value * s)) }
  return out
}

/**
 * The operations that make every page of a note `size`, fitting what is on each to it. One change: undo takes it
 * all back. None when every page is that size already.
 */
export function resizeOps(doc: Doc, size: { w: number; h: number }): Op[] {
  const ops: Op[] = []
  const touched: string[] = []
  const clips: Clip[] = [...(doc.clips ?? [])]
  for (const id of doc.pages) {
    const page = doc.page[id]!
    // A board's endless page has no size to change.
    if (isEndless(page)) continue
    if (page.w === size.w && page.h === size.h) continue
    const from = marginOf(page)
    const to = marginOf(size)
    const x = along(page.w, size.w, from, to)
    const y = along(page.h, size.h, from, to)
    const across = (size.w - 2 * to) / Math.max(1, page.w - 2 * from)
    const down = (size.h - 2 * to) / Math.max(1, page.h - 2 * from)
    const s = Math.min(1, across, down)
    ops.push({ op: 'update', id, set: { w: size.w, h: size.h } })
    page.free.forEach((blockId, index) => {
      const block = doc.block[blockId] as FreeBlock | undefined
      if (!block) return
      touched.push(block.id)
      if (block.type === 'frame') {
        // Typed text keeps its size: its frame goes with the column, and its lines flow again.
        const left = x(block.x)
        ops.push({ op: 'move', id: block.id, to: { page: id, x: left, y: y(block.y), w: Math.max(1, x(block.x + block.w) - left), h: block.h } })
        return
      }
      const w = Math.max(1, Math.round(block.w * s))
      const h = Math.max(1, Math.round(block.h * s))
      if (block.type === 'ink' && s !== 1) {
        const strokes = block.strokes.map((stroke) => scaledStroke(stroke, s))
        const ink: InkBlock = { ...block, x: x(block.x), y: y(block.y), w, h, strokes }
        // Written again at its place in the page's order: its strokes scaled about its corner.
        ops.push({ op: 'remove', id: block.id }, { op: 'add', block: ink, at: index })
        return
      }
      ops.push({ op: 'move', id: block.id, to: { page: id, x: x(block.x), y: y(block.y), w, h } })
    })
    clips.forEach((clip, i) => {
      if (clip.page === id) clips[i] = { ...clip, x: x(clip.x), y: y(clip.y) }
    })
  }
  if (ops.length === 0) return ops
  if (doc.clips && clips.some((clip, i) => clip !== doc.clips![i])) ops.push({ op: 'update', id: doc.id, set: { clips } })
  // What now lies across a line moves on.
  const fitted = apply(doc, ops).doc
  return [...ops, ...settle(fitted, touched)]
}
