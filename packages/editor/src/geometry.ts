// From document units to the screen. A page is drawn at its real size in CSS
// millimetres and scaled as a whole for zoom, so positions inside a page need
// no arithmetic: x = 2000 is simply left: 20mm.
import { MARGIN, type Asset, type Page } from '@shellnote/core'

/** Document units (0.01 mm) as a CSS length. */
export const mm = (units: number): string => `${units / 100}mm`

/** CSS fixes 96 pixels to the inch, so a millimetre is 96 / 25.4 pixels. */
export const PX_PER_MM = 96 / 25.4

/** Document units to CSS pixels at a zoom. */
export const px = (units: number, zoom = 1): number => (units / 100) * PX_PER_MM * zoom

/** Space between pages, and around them, in screen pixels: room for the bar above each page (PageView). */
export const PAGE_GAP = 32

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 4
/** The zoom levels the buttons step through. */
export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4] as const

export const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

/** The next zoom step in or out from the current zoom. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const next = direction > 0 ? ZOOM_STEPS.find((step) => step > zoom + 1e-9) : [...ZOOM_STEPS].reverse().find((step) => step < zoom - 1e-9)
  return next ?? (direction > 0 ? MAX_ZOOM : MIN_ZOOM)
}

/**
 * Which pages to draw: the ones that overlap the visible band of the scroll
 * area, plus `overscan` pages either side so that scrolling never shows a
 * blank page. Heights are on-screen pixels; pages are stacked with PAGE_GAP
 * above each, and below the last.
 */
export function pagesInView(heights: readonly number[], scrollTop: number, viewport: number, overscan = 1): { first: number; last: number } {
  if (heights.length === 0) return { first: 0, last: -1 }
  const top = scrollTop
  const bottom = scrollTop + viewport
  let y = PAGE_GAP
  let first = -1
  let last = -1
  heights.forEach((h, i) => {
    if (y + h >= top && y <= bottom) {
      if (first === -1) first = i
      last = i
    }
    y += h + PAGE_GAP
  })
  // Scrolled into a gap below every page: show the last one.
  if (first === -1) first = last = top <= PAGE_GAP ? 0 : heights.length - 1
  return { first: Math.max(0, first - overscan), last: Math.min(heights.length - 1, last + overscan) }
}

/** The page at a height in the scroll area (on-screen pixels): the one there, or the nearer one when y is in a gap. */
export function pageAt(heights: readonly number[], y: number): number {
  let top = PAGE_GAP
  for (let i = 0; i < heights.length; i++) {
    const bottom = top + heights[i]!
    if (y < bottom + PAGE_GAP / 2) return i
    top = bottom + PAGE_GAP
  }
  return Math.max(0, heights.length - 1)
}

/**
 * The size of a picture in a frame's text: its pixels at 96 to the inch, but
 * no wider than the frame, and its own shape while it loads. A picture that
 * gives no size is as wide as the frame.
 */
export function inFrameSize(asset: Asset | undefined): { width: string; aspectRatio?: string } {
  if (!asset?.w || !asset.h) return { width: '100%' }
  return { width: `min(100%, ${Math.round((asset.w * 2540) / 96) / 100}mm)`, aspectRatio: `${asset.w} / ${asset.h}` }
}

/** A frame made on bare paper is at least 50 mm wide, and its first line sits on the point. */
const MIN_FRAME_WIDTH = 5000
const HALF_LINE = 300

/**
 * Where a frame made at a point of bare paper goes, in document units: its
 * first line on the point, reaching to the right margin, at least 50 mm wide
 * and on the page.
 */
export function frameSpotAt(page: Page, x: number, y: number): { x: number; y: number; w: number } {
  const w = Math.max(MIN_FRAME_WIDTH, page.w - MARGIN - x)
  return { x: Math.max(0, Math.min(x, page.w - w)), y: Math.max(0, y - HALF_LINE), w }
}
