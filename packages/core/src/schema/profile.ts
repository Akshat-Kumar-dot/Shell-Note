// A person's pen profile: their own
// strokes, each with what it is, from which the pen learns how they draw
// symbols, shapes, lines and scratch-outs, instead of rules set to one
// person's hand. Made from the stroke recorder ("Teach my pen") and from the
// corrections they undo. Kept in the library, beside the notes, never inside
// a note.
import { z } from 'zod'

/**
 * What a stroke is. `none`: plain ink, such as a letter, left as written.
 * Symbols carry which way they open (0 opens right, as "(", 1 left, as ")"). Shapes are by
 * family: a circle is an `ellipse`, a square a `rect`, and their fitting tells
 * them apart. `shade`: shading, such as hatching inside a drawing, which goes
 * back and forth over ink as a scratch-out does and must delete nothing
 * (profiles made before kept shading as `none`, and still read).
 */
export const InkLabel = z.enum([
  'none',
  'line',
  'scratch',
  'shade',
  'paren0',
  'paren1',
  'bracket0',
  'bracket1',
  'brace0',
  'brace1',
  'comma',
  'at',
  'arrow',
  'arc',
  'curve',
  'ellipse',
  'triangle',
  'rect',
  'rhombus',
  'polygon',
  'star',
  'heart',
  'cloud',
  'bubble',
])
export type InkLabel = z.infer<typeof InkLabel>

// One pass, without copying, as for a stroke's points: a profile holds hundreds of strokes.
function isXYList(xy: unknown): boolean {
  if (!Array.isArray(xy) || xy.length < 4 || xy.length % 2 !== 0) return false
  for (const value of xy as unknown[]) if (!Number.isSafeInteger(value)) return false
  return true
}

export const PenExample = z.strictObject({
  label: InkLabel,
  /** x, y, repeated: the stroke as it was drawn on the screen, in 0.01 mm at the size the hand drew it (the page's units times the zoom), its box's corner at 0, 0. */
  xy: z.custom<number[]>(isXYList, { error: 'xy holds x, y pairs, whole numbers, at least two points.' }),
  /** From the stroke recorder, or a correction the person undid. */
  from: z.enum(['recorder', 'undo']),
})
export type PenExample = z.infer<typeof PenExample>

const Margin = z.number().int().min(1000).max(1_000_000)

/**
 * How much nearer a stroke must be to the person's own examples of a thing than
 * to the rest before the pen acts, worked out from their strokes at Teach my
 * pen (learn.ts tune), in thousandths: 1500 is 1.5. `scratch`: a zigzag the
 * rules missed; `unscratch`: one the rules found, left alone as writing;
 * `shade`: one left alone as the person's shading. Missing in profiles made
 * before, which use fixed margins.
 */
export const PenMargins = z.strictObject({ symbol: Margin, shape: Margin, line: Margin, scratch: Margin, unscratch: Margin, shade: Margin })
export type PenMargins = z.infer<typeof PenMargins>

export const PenProfile = z.strictObject({
  v: z.literal(1),
  /** When it last changed, as an ISO date and time. */
  updated: z.string(),
  examples: z.array(PenExample),
  tuned: PenMargins.optional(),
})
export type PenProfile = z.infer<typeof PenProfile>
