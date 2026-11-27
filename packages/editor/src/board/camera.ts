// The board's view: a camera over the board, which has no edge. It is where the view's top left corner lies on the
// board, in the board's own units (0.01 mm, below zero too), and the zoom. Nothing here grows, scrolls or springs back:
// moving the board moves the camera. Plain sums, so they are tested without a browser.
import type { Box } from '@shellnote/core'
import { PX_PER_MM, ZOOM_STEPS } from '../geometry.js'

export interface Camera {
  /** The board point at the view's top left corner. */
  x: number
  y: number
  zoom: number
}

/** A board zooms further out than a page: from 10 % to 400 %. */
export const BOARD_MIN_ZOOM = 0.1
export const BOARD_MAX_ZOOM = 4
/** The zoom levels a board steps through. */
export const BOARD_ZOOM_STEPS = [0.1, 0.15, 0.2, ...ZOOM_STEPS] as const

export const clampBoardZoom = (zoom: number): number => Math.min(BOARD_MAX_ZOOM, Math.max(BOARD_MIN_ZOOM, zoom))

/** Screen pixels for one board unit at a zoom. */
export const pxPerUnit = (zoom: number): number => (PX_PER_MM / 100) * zoom

/** A board point as a point of the view, in screen pixels from its top left corner. */
export function toView(camera: Camera, x: number, y: number): { x: number; y: number } {
  const k = pxPerUnit(camera.zoom)
  return { x: (x - camera.x) * k, y: (y - camera.y) * k }
}

/** A point of the view, in screen pixels from its top left corner, as a board point. */
export function toBoard(camera: Camera, x: number, y: number): { x: number; y: number } {
  const k = pxPerUnit(camera.zoom)
  return { x: camera.x + x / k, y: camera.y + y / k }
}

/** The camera at a new zoom with the board point under a point of the view kept under it. */
export function zoomAt(camera: Camera, zoom: number, x: number, y: number): Camera {
  const held = toBoard(camera, x, y)
  const k = pxPerUnit(zoom)
  return { x: held.x - x / k, y: held.y - y / k, zoom }
}

/** The camera moved by some screen pixels, as a drag moves the board under it. */
export function panBy(camera: Camera, dx: number, dy: number): Camera {
  const k = pxPerUnit(camera.zoom)
  return { ...camera, x: camera.x - dx / k, y: camera.y - dy / k }
}

/** The part of the board a view of a size shows. */
export function seen(camera: Camera, width: number, height: number): Box {
  const k = pxPerUnit(camera.zoom)
  return { x: camera.x, y: camera.y, w: width / k, h: height / k }
}

/**
 * The camera that shows a box whole in a view of a size, its middle in the view's middle, with `margin` screen pixels
 * round it, zoomed no further in than `most` (actual size: a small board is not blown up) and no further out than a
 * board goes.
 */
export function fitting(box: Box, width: number, height: number, margin = 48, most = 1): Camera {
  const room = { w: Math.max(1, width - 2 * margin), h: Math.max(1, height - 2 * margin) }
  const fit = Math.min(room.w / Math.max(1, box.w), room.h / Math.max(1, box.h)) / pxPerUnit(1)
  const zoom = clampBoardZoom(Math.min(most, fit))
  const k = pxPerUnit(zoom)
  return { x: box.x + box.w / 2 - width / 2 / k, y: box.y + box.h / 2 - height / 2 / k, zoom }
}

/** The camera with the board point `at` in the middle of a view of a size. */
export function centredOn(at: { x: number; y: number }, width: number, height: number, zoom: number): Camera {
  const k = pxPerUnit(zoom)
  return { x: at.x - width / 2 / k, y: at.y - height / 2 / k, zoom }
}

/** The next zoom step in or out on a board. */
export function stepBoardZoom(zoom: number, direction: 1 | -1): number {
  const next = direction > 0 ? BOARD_ZOOM_STEPS.find((step) => step > zoom + 1e-9) : [...BOARD_ZOOM_STEPS].reverse().find((step) => step < zoom - 1e-9)
  return next ?? (direction > 0 ? BOARD_MAX_ZOOM : BOARD_MIN_ZOOM)
}

/** The middle of a board point to the nearest dot of its paper (5 mm), as a moved or drawn step is placed: core's. */
export { DOT, toDot } from '@shellnote/core'
