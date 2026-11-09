// Moving and resizing a block placed on a page, as plain geometry: from the
// box a drag started with and how far the pointer went, in document units, to
// the box it gives. The block stays on its page, and a resized picture or
// diagram keeps its shape.
import type { Page } from '@shellnote/core'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** A corner of a box: north-west, north-east, south-west or south-east. */
export type Corner = 'nw' | 'ne' | 'sw' | 'se'
export const CORNERS: readonly Corner[] = ['nw', 'ne', 'sw', 'se']

/** The smallest a resize makes a block: 5 mm on its shorter side. */
export const MIN_SIDE = 500

type Sheet = Pick<Page, 'w' | 'h'>

/** The box moved by (dx, dy), kept on the page. */
export function moveBox(box: Box, dx: number, dy: number, page: Sheet): Box {
  return { ...box, x: Math.round(within(box.x + dx, 0, page.w - box.w)), y: Math.round(within(box.y + dy, 0, page.h - box.h)) }
}

/**
 * The box resized by dragging one corner by (dx, dy). The opposite corner
 * stays put and the shape is kept: the dragged corner follows the pointer
 * along the box's diagonal, so a pull in any direction, even straight in,
 * resizes it. It stays at least MIN_SIDE on its shorter side, and on the page.
 */
export function resizeBox(box: Box, corner: Corner, dx: number, dy: number, page: Sheet): Box {
  if (box.w <= 0 || box.h <= 0) return box
  const east = corner === 'ne' || corner === 'se'
  const south = corner === 'sw' || corner === 'se'
  const fixedX = east ? box.x : box.x + box.w
  const fixedY = south ? box.y : box.y + box.h
  // Where the pointer took the corner, from the fixed corner, projected on the diagonal.
  const across = box.w + (east ? dx : -dx)
  const down = box.h + (south ? dy : -dy)
  const pull = (across * box.w + down * box.h) / (box.w * box.w + box.h * box.h)
  const smallest = MIN_SIDE / Math.min(box.w, box.h)
  const largest = Math.min((east ? page.w - fixedX : fixedX) / box.w, (south ? page.h - fixedY : fixedY) / box.h)
  const scale = Math.max(smallest, Math.min(pull, largest))
  const w = Math.max(1, Math.round(box.w * scale))
  const h = Math.max(1, Math.round(box.h * scale))
  return { x: east ? fixedX : fixedX - w, y: south ? fixedY : fixedY - h, w, h }
}

/** value, kept between low and high; at low when the range is empty. */
function within(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high))
}
