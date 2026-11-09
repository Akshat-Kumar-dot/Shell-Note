// Places on a page (note control, step 4, 24 October 2026). The model says where in
// words, never in millimetres: a part of the page (the top right, the bottom), beside or
// below a block; code finds the spot. A part that is taken gets the nearest free room in it, and none at all is said,
// with the parts that have room: a block never lands on another. Resizing is for what is placed on the page,
// boxes and tables: a block in the text follows its column.
import type { Box } from '../ink/geometry.js'
import type { Asset, Block, Doc } from '../schema/doc.js'
import { MARGIN } from '../units.js'
import type { Drawn } from './picture.js'

/** The parts of a page a block may be put in, in the words models and people use. */
export const PLACES = ['top', 'bottom', 'left', 'right', 'middle', 'top left', 'top right', 'bottom left', 'bottom right'] as const
export type PlaceWord = (typeof PLACES)[number]

/** How a block's width changes: a share of the page's width inside the margins (a table's, of its column), or a step. */
export const SPANS = ['half', 'third', 'full', 'wider', 'narrower'] as const
export type Span = (typeof SPANS)[number]

/** Space kept around a block that is placed: 3 mm. */
const GAP = 300
/** How finely spots are tried: 2.5 mm. */
const STEP = 250
/** The smallest a block is made: 10 mm wide. */
const LEAST = 1000

type Size = { w: number; h: number }

/** A place word as written: "top-right", "the top right corner", "centre", "upper left". */
export function placeWord(written: string): PlaceWord | undefined {
  const words = written
    .toLowerCase()
    .replace(/[-_]/gu, ' ')
    .replace(/\b(?:the|of|page|corner|side|part|area|half|edge)\b/gu, ' ')
    .replace(/\bupper\b/gu, 'top')
    .replace(/\blower\b/gu, 'bottom')
    .replace(/\b(?:centre|center|centred|centered)\b/gu, 'middle')
    .replace(/\s+/gu, ' ')
    .trim()
  const flipped = words.replace(/^(left|right) (top|bottom)$/u, '$2 $1')
  return (PLACES as readonly string[]).includes(flipped) ? (flipped as PlaceWord) : undefined
}

/** Which third of the page a place word names, across and down; an axis it leaves open is undefined. */
function thirds(word: PlaceWord): { across?: 0 | 1 | 2; down?: 0 | 1 | 2 } {
  if (word === 'middle') return { across: 1, down: 1 }
  const down = word.startsWith('top') ? 0 : word.startsWith('bottom') ? 2 : undefined
  const across = word.endsWith('left') ? 0 : word.endsWith('right') ? 2 : undefined
  return { ...(down !== undefined ? { down } : {}), ...(across !== undefined ? { across } : {}) }
}

/** The boxes on a page a block placed there keeps clear of: its blocks placed on it, a frame as tall as it is drawn. */
export function boxesOn(doc: Doc, pageId: string, drawn: ReadonlyMap<string, Drawn> | undefined, ignore: ReadonlySet<string> = new Set()): Box[] {
  const page = doc.page[pageId]
  if (!page) return []
  return page.free.flatMap((id): Box[] => {
    const block = doc.block[id]
    if (!block || ignore.has(id) || !('page' in block)) return []
    if (block.type !== 'frame') return [{ x: block.x, y: block.y, w: block.w, h: block.h }]
    // A frame's h is a layout cache: as drawn when it is, and at least a line.
    const seen = drawn?.get(id)
    return [{ x: block.x, y: block.y, w: block.w, h: Math.max(block.h, seen?.page === undefined || seen.page === pageId ? (seen?.h ?? 0) : 0, 600) }]
  })
}

const clear = (box: Box, others: readonly Box[]): boolean => others.every((o) => box.x + box.w + GAP <= o.x || o.x + o.w + GAP <= box.x || box.y + box.h + GAP <= o.y || o.y + o.h + GAP <= box.y)

/** Steps from `from` to `to`, both kept, ordered from the end a place word prefers. */
function steps(from: number, to: number, order: 'up' | 'down' | number): number[] {
  if (to < from) return []
  const all: number[] = []
  for (let at = from; at < to; at += STEP) all.push(at)
  all.push(to)
  if (order === 'up') return all
  if (order === 'down') return all.reverse()
  return all.sort((a, b) => Math.abs(a - order) - Math.abs(b - order))
}

/**
 * Where a block of `size` goes in the part of a page a place word names: the free spot nearest that part's edge, its
 * middle inside the part's third; undefined when the part has no room.
 */
export function spotIn(doc: Doc, pageId: string, word: PlaceWord, size: Size, others: readonly Box[]): { x: number; y: number } | undefined {
  const page = doc.page[pageId]
  if (!page) return undefined
  const { across, down } = thirds(word)
  const right = page.w - MARGIN - size.w
  const bottom = page.h - MARGIN - size.h
  if (right < MARGIN || bottom < MARGIN) return undefined
  const inThird = (start: number, length: number, whole: number, third: 0 | 1 | 2 | undefined): boolean => third === undefined || Math.min(2, Math.floor(((start + length / 2) / whole) * 3)) === third
  const xs = steps(MARGIN, right, across === 0 ? 'up' : across === 2 ? 'down' : (MARGIN + right) / 2)
  const ys = steps(MARGIN, bottom, down === 2 ? 'down' : down === 1 ? (MARGIN + bottom) / 2 : 'up')
  for (const y of ys) {
    if (!inThird(y, size.h, page.h, down)) continue
    for (const x of xs) {
      if (!inThird(x, size.w, page.w, across)) continue
      if (clear({ x, y, ...size }, others)) return { x, y }
    }
  }
  return undefined
}

/** The parts of a page with room for a block of `size`: said when the part asked has none. */
export function roomyPlaces(doc: Doc, pageId: string, size: Size, others: readonly Box[]): PlaceWord[] {
  return PLACES.filter((word) => word.includes(' ') || word === 'middle').filter((word) => spotIn(doc, pageId, word, size, others) !== undefined)
}

/**
 * Where a block of `size` goes next to another's box: beside it (to its right, else its left, its top level with the
 * other's, or as near below as there is room) or below it (under it, from its left edge).
 */
export function spotNear(doc: Doc, pageId: string, near: Box, side: 'beside' | 'below', size: Size, others: readonly Box[]): { x: number; y: number } | undefined {
  const page = doc.page[pageId]
  if (!page) return undefined
  const right = page.w - MARGIN - size.w
  const bottom = page.h - MARGIN - size.h
  if (right < MARGIN || bottom < MARGIN) return undefined
  const fits = (x: number, y: number): boolean => x >= MARGIN && x <= right && y >= MARGIN && y <= bottom && clear({ x, y, ...size }, others)
  if (side === 'beside') {
    const ys = steps(Math.max(MARGIN, near.y), Math.min(bottom, near.y + Math.max(near.h, size.h)), 'up')
    for (const x of [near.x + near.w + GAP, near.x - GAP - size.w]) for (const y of ys) if (fits(x, y)) return { x, y }
    return undefined
  }
  const xs = steps(MARGIN, right, Math.min(right, Math.max(MARGIN, near.x)))
  for (const y of steps(Math.min(bottom, near.y + near.h + GAP), bottom, 'up')) for (const x of xs) if (fits(x, y)) return { x, y }
  return undefined
}

/** A picture's size from its pixels at 96 to the inch, fitted to the page's width and half its height (as a pasted one is). */
function pictureSize(meta: Asset | undefined, page: Size): Size {
  const own = meta?.w !== undefined && meta.h !== undefined
  const w = own ? (meta.w! * 2540) / 96 : 8000
  const h = own ? (meta.h! * 2540) / 96 : 6000
  const fit = Math.min(1, (page.w - 2 * MARGIN) / w, (page.h - 2 * MARGIN) / 2 / h)
  return { w: Math.max(LEAST, Math.round(w * fit)), h: Math.max(LEAST, Math.round(h * fit)) }
}

/** The size a block taken out of the text onto the page has: as it is drawn now, else its picture's own, else a usual one. */
export function sizeOutOfText(doc: Doc, block: Block, drawn: ReadonlyMap<string, Drawn> | undefined, pageId: string): Size {
  const seen = drawn?.get(block.id)
  if (seen && seen.w > 0 && seen.h > 0) return { w: Math.round(seen.w), h: Math.round(seen.h) }
  const page = doc.page[pageId] ?? { w: 21000, h: 29700 }
  if (block.type === 'image') return pictureSize(doc.asset[block.asset], page)
  return block.type === 'math' ? { w: 8000, h: 1500 } : { w: 12000, h: 8000 }
}

/** A width made `span` of `whole`, or a step from `now`; never under 10 mm nor over `whole`. */
export function spanned(now: number, span: Span, whole: number): number {
  const w = span === 'half' ? whole / 2 : span === 'third' ? whole / 3 : span === 'full' ? whole : span === 'wider' ? now * 1.25 : now * 0.8
  return Math.round(Math.max(LEAST, Math.min(whole, w)))
}
