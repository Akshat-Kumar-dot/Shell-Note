// Placement rules. The AI never outputs coordinates or
// sizes: code finds a place for a free block.
import type { Doc, FreeBlock, Id } from '../schema/doc.js'
import { MARGIN } from '../units.js'

/** Space left between blocks placed one under another: 5 mm. */
export const GAP = 500

export interface Spot {
  page: Id
  x: number
  y: number
  w: number
  h: number
}

/**
 * The first free space at or below `y` in the column [x, x + w) of a page,
 * tall enough for `h`. Undefined when it would run past the bottom margin.
 */
export function freeSpace(doc: Doc, page: Id, x: number, y: number, w: number, h: number, ignore: Id[] = []): Spot | undefined {
  const sheet = doc.page[page]
  if (!sheet) return undefined
  const others = sheet.free
    .filter((id) => !ignore.includes(id))
    .map((id) => doc.block[id] as FreeBlock)
    .filter((b) => b.x < x + w && x < b.x + b.w)
    .sort((a, b) => a.y - b.y)
  let top = Math.max(y, MARGIN)
  for (let moved = true; moved; ) {
    moved = false
    for (const b of others) {
      // A frame's height is a layout cache that may still be 0; count it as at least one line.
      const bottom = b.y + Math.max(b.h, b.type === 'frame' ? 1000 : 0)
      if (top < bottom + GAP && b.y < top + h + GAP) {
        top = bottom + GAP
        moved = true
      }
    }
  }
  return top + h <= sheet.h - MARGIN ? { page, x, y: top, w, h } : undefined
}

/**
 * Where to put a new or moved free block next to `ref`: just below it ("after"),
 * or just above it ("before") when there is room, in the same column.
 * Undefined when the page is full below it.
 */
export function besideFree(doc: Doc, ref: FreeBlock, at: 'after' | 'before', h: number, ignore: Id[] = []): Spot | undefined {
  if (at === 'before') {
    const y = ref.y - h - GAP
    if (y >= MARGIN) {
      const spot = freeSpace(doc, ref.page, ref.x, y, ref.w, h, [...ignore, ref.id])
      if (spot && spot.y + h + GAP <= ref.y) return spot
    }
  }
  return freeSpace(doc, ref.page, ref.x, ref.y + Math.max(ref.h, 1000) + GAP, ref.w, h, ignore)
}
