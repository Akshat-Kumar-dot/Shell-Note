// A stroke recording (the app's ?record=strokes page) read as a person's
// examples: what each recorded stroke is, and the stroke as the pen would
// have seen it. The recorder's "Teach my pen" makes a profile from it, and
// the ink tests check the learner on every recording in their fixtures, so
// whoever records is checked the same way.
import { z } from 'zod'
import type { InkLabel, PenExample } from '../schema/profile.js'
import { exampleOf } from './learn.js'
import { PointFilter, StrokeModel, type TimedPt } from './smooth.js'

// Samples: x and y in 0.01 mm on the screen, pressure 0 to 1, tilt x and y, time in ms, contact width and height. Checked in one pass.
function isSampleList(samples: unknown): boolean {
  if (!Array.isArray(samples)) return false
  for (const sample of samples as unknown[]) {
    if (!Array.isArray(sample) || sample.length < 6) return false
    for (let i = 0; i < 6; i++) if (typeof sample[i] !== 'number' || !Number.isFinite(sample[i])) return false
  }
  return true
}

export const Recording = z.object({
  v: z.literal(1),
  started: z.string().optional(),
  items: z.array(
    z.object({
      kind: z.string(),
      strokes: z.array(z.object({ type: z.string(), samples: z.custom<number[][]>(isSampleList, { error: 'samples hold x, y, pressure, tilt x, tilt y and time.' }) })),
    }),
  ),
})
export type Recording = z.infer<typeof Recording>

/** What each one-stroke ask is: shapes by family, symbols with which way they open. */
const ONE_STROKE: Readonly<Record<string, InkLabel>> = {
  line: 'line',
  'line-held': 'line',
  curve: 'curve',
  arc: 'arc',
  circle: 'ellipse',
  ellipse: 'ellipse',
  triangle: 'triangle',
  rect: 'rect',
  square: 'rect',
  rhombus: 'rhombus',
  pentagon: 'polygon',
  arrow: 'arrow',
  'arrow-small': 'arrow',
  star: 'star',
  heart: 'heart',
  cloud: 'cloud',
  bubble: 'bubble',
  'paren-open': 'paren0',
  'paren-close': 'paren1',
  'bracket-open': 'bracket0',
  'bracket-close': 'bracket1',
  'brace-open': 'brace0',
  'brace-close': 'brace1',
  comma: 'comma',
  at: 'at',
}

/**
 * Asks whose every stroke is plain ink, to leave alone: letters, digits, pairs,
 * a name and a sentence. ("[a, b]" mixes symbols with letters, and a palm is no
 * stroke at all, so neither is used.) Shading inside a shape the recorder drew
 * is a kind of its own, `shade`: taught as plain ink, it made a person's quick
 * zigzag over a word look like their writing, so scratch-outs needed a lot of
 * hard scribbling (a test hand check, 16 October 2026).
 */
const plainWriting = (kind: string): boolean => /^(glyph|pair|letter|digit)-/.test(kind) || kind === 'word' || kind === 'sentence'

/** A recorded stroke, its label, and which recorded item it came from. */
export interface RecordedStroke {
  label: InkLabel
  item: number
  points: TimedPt[]
}

/** A recorded stroke as the pen's live layer would have kept it: smoothed at the person's level, its pressure left out (the learner looks only at its line). */
export function penPoints(samples: readonly (readonly number[])[], smoothing: number): TimedPt[] {
  const filter = new PointFilter(smoothing)
  const model = new StrokeModel(smoothing)
  const out: TimedPt[] = []
  for (const [x, y, , , , t] of samples) out.push(...model.add(filter.add({ x: x!, y: y!, p: 128, t: t! })))
  out.push(...model.finish())
  return out
}

/**
 * Every recorded stroke the learner can use, labelled: a one-stroke ask's
 * longest stroke, every stroke of plain writing and of shading, and the last
 * stroke of a scratch-out (the strokes before it are the word it crosses out).
 */
export function recordedStrokes(recording: Recording, smoothing = 1): RecordedStroke[] {
  const out: RecordedStroke[] = []
  recording.items.forEach((item, index) => {
    if (item.strokes.length === 0) return
    const add = (label: InkLabel, samples: readonly (readonly number[])[]): void => {
      if (samples.length >= 2) out.push({ label, item: index, points: penPoints(samples, smoothing) })
    }
    const one = ONE_STROKE[item.kind]
    if (one) add(one, item.strokes.reduce((a, b) => (b.samples.length > a.samples.length ? b : a)).samples)
    else if (plainWriting(item.kind)) for (const stroke of item.strokes) add('none', stroke.samples)
    else if (item.kind === 'shade') for (const stroke of item.strokes) add('shade', stroke.samples)
    else if (item.kind === 'scratch') item.strokes.forEach((stroke, i) => add(i === item.strokes.length - 1 ? 'scratch' : 'none', stroke.samples))
  })
  return out
}

/** A recording as a profile's examples. */
export function recordedExamples(recording: Recording, smoothing = 1): PenExample[] {
  return recordedStrokes(recording, smoothing).flatMap((stroke) => exampleOf(stroke.label, stroke.points, 'recorder') ?? [])
}
