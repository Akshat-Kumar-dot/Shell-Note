// How wide each pen draws. A stroke keeps a width token and a pen kind
// (schema/doc.ts), and each point a pressure: 128 draws the stroke at its
// width, 255 at twice it, 64 at half (: the app learns each
// person's own pressure when it records the point, so a note looks the same on
// every device). This turns them into sizes, so the box round a stroke, the
// eraser and the drawing all agree on where ink reaches.
import type { PenKind, Stroke, StrokeWidth } from '../schema/doc.js'

/** Each pen's width at normal pressure, in 0.01 mm: the plain pen 0.15 to 1.6 mm, a marker twice that, a highlighter 1.5 to 8 mm. */
export const PEN_SIZE: Readonly<Record<PenKind | 'pen', Readonly<Record<StrokeWidth, number>>>> = {
  pen: { xs: 15, s: 30, m: 60, l: 100, xl: 160 },
  pencil: { xs: 15, s: 30, m: 60, l: 100, xl: 160 },
  fountain: { xs: 15, s: 30, m: 60, l: 100, xl: 160 },
  marker: { xs: 30, s: 60, m: 120, l: 200, xl: 320 },
  highlighter: { xs: 150, s: 250, m: 400, l: 600, xl: 800 },
}

/** The pressure that draws a stroke at its own width. */
export const NORMAL_PRESSURE = 128
/** A point never draws thinner than a quarter of its stroke's width. */
const THINNEST = 0.25

/** How wide a stroke draws at normal pressure, in 0.01 mm. */
export const sizeOf = (stroke: Pick<Stroke, 'tool' | 'width'>): number => PEN_SIZE[stroke.tool ?? 'pen'][stroke.width]

/** A marker and a highlighter draw at one width, whatever the pressure. */
export const keepsWidth = (tool: PenKind | undefined): boolean => tool === 'marker' || tool === 'highlighter'

/** A pencil leant over draws wider: up to 40 % when it lies flat. */
const leant = (tilt: number | undefined): number => 1 + (0.4 * (tilt ?? 0)) / 90

/** How wide a stroke draws at one of its points, from the point's kept pressure and (a pencil's) tilt, in 0.01 mm. */
export function pointWidth(stroke: Pick<Stroke, 'tool' | 'width'>, pressure: number, tilt?: number): number {
  const factor = keepsWidth(stroke.tool) ? 1 : Math.max(THINNEST, pressure / NORMAL_PRESSURE)
  return sizeOf(stroke) * factor * (stroke.tool === 'pencil' ? leant(tilt) : 1)
}

/** How wide a stroke draws at each of its points, in 0.01 mm. */
export function strokeWidths(stroke: Pick<Stroke, 'pts' | 'tool' | 'width' | 'tilt'>): number[] {
  const out: number[] = []
  for (let i = 2; i < stroke.pts.length; i += 3) out.push(pointWidth(stroke, stroke.pts[i]!, stroke.tilt?.[(i - 2) / 3]))
  return out
}

/** How far a stroke's ink reaches from the line through its points: half its widest, rounded up. */
export const reachOf = (stroke: Pick<Stroke, 'pts' | 'tool' | 'width' | 'tilt'>): number => Math.ceil(Math.max(0, ...strokeWidths(stroke)) / 2)
