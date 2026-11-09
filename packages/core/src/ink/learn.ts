// The pen learns each person's hand. Rules
// set to one person's strokes fit that person and fail the next, so whoever
// records their strokes (the stroke recorder's "Teach my pen") gets a pen
// profile (schema/profile.ts): their own symbols, shapes, lines, scratch-outs
// and plain writing. A stroke is then compared with those, measure by
// measure, and taken for a symbol or a shape only when it is clearly nearer
// that person's own than any of their plain strokes: nearest neighbours, with
// their letters as the "leave it alone" class. Until someone records, the
// general rules (shapes.ts, symbols.ts, erase.ts) decide, as before.
//
// The spike, on a test recording, each stroke left out in turn: symbols 92 %
// right (rules: about 30 %), held shapes 97 % (rules: 74 %), all real lines
// kept straight and no letter stroke straightened, under 1 % of letters taken
// for anything.
import { InkLabel, type PenExample, type PenMargins, type PenProfile } from '../schema/profile.js'
import { boxOf, diagonal, dist, pathLength, resample, respace, simplify, type Pt } from './geometry.js'
import { arrowShape, FAMILY, fitAs, recognise, scaledShape, SMALL_ARROW_MIN, straightLine, twoStrokeArrow, type RecognisedShape, type ShapeFamily } from './shapes.js'
import { isScratch } from './erase.js'

/** The symbols, by label, as the kind and which way it opens. */
export const SYMBOL_LABELS = {
  paren0: ['paren', 0],
  paren1: ['paren', 1],
  bracket0: ['bracket', 0],
  bracket1: ['bracket', 1],
  brace0: ['brace', 0],
  brace1: ['brace', 1],
  comma: ['comma', undefined],
  at: ['at', undefined],
} as const satisfies Partial<Record<InkLabel, readonly [string, 0 | 1 | undefined]>>
export type SymbolLabel = keyof typeof SYMBOL_LABELS

export const SHAPE_LABELS: readonly (InkLabel & ShapeFamily)[] = ['line', 'arrow', 'arc', 'curve', 'ellipse', 'triangle', 'rect', 'rhombus', 'polygon', 'star', 'heart', 'cloud', 'bubble']

/**
 * How much nearer a stroke must be to the person's own examples of a thing
 * than to the rest before the pen acts. `symbol`, `shape`, `scratch` (a
 * zigzag the rules missed): nearer that than their plain strokes. `line`,
 * `unscratch`: a line, or a zigzag, the rules found is left alone when that
 * much nearer their plain strokes; `shade`: a zigzag left alone when that much
 * nearer their shading than their scratch-outs.
 */
export interface Margins {
  readonly symbol: number
  readonly shape: number
  readonly line: number
  readonly scratch: number
  readonly unscratch: number
  readonly shade: number
}

/**
 * The margins of a profile made before the pen worked them out from each
 * person's strokes (tune below). They were set on a test recording,
 * which is why each person's own now replace them.
 */
export const LEARN_MARGIN: Margins = { symbol: 1.2, shape: 1.4, line: 1.5, scratch: 1.5, unscratch: 1.5, shade: 1.5 }

/** Examples needed of a thing before the pen goes by them, and plain strokes before it acts on anything learned. */
const MIN_EXAMPLES = 2
const MIN_PLAIN = 20
/**
 * With too few examples of a thing to compare, a stroke this near one of the
 * person's plain strokes is taken as plain: about the distance between two
 * of one person's same strokes at their closest (0.15 to 0.6, median 0.28).
 */
const SAME = 0.25

/**
 * The spread of each measure across ordinary strokes (letters, shapes and
 * symbols together, measured on the first recording, 15 October 2026). It
 * only puts the measures on one footing, so a difference of one is as big in
 * each; it decides nothing. A learner with enough of a person's strokes
 * (SCALED_FROM) puts them on that person's own footing instead (weightsOf).
 * They go by position, in the order of the measures in described(): a new measure needs its scale here, in its place.
 */
const SCALES = [1.2, 0.9, 0.9, 1.4, 0.35, 0.35, 0.33, 0.36, 0.38, 0.4, 0.46, 0.96, 0.91, 0.82, 0.78, 0.58, 0.25, 0.45, 0.24, 0.22, 0.16, 0.27, 0.17, 0.32]
/** How much the stroke's path, sixteen points in its box, counts beside the measures. */
const PATH_WEIGHT = 0.5
const PATH_POINTS = 16

/** A stroke as the learner compares it. */
export interface Described {
  /** The measures, each divided by its scale. */
  readonly f: Float64Array
  /** Sixteen points along it, as shares of its box's width and height. */
  readonly path: Float64Array
}

/** Points every 0.4 mm, each the average of itself and its neighbours, so no jitter is left. */
function cleaned(points: readonly Pt[]): Pt[] {
  let out = respace(points, 40)
  for (let pass = 0; pass < 2; pass++) {
    out = out.map((pt, i) => (i === 0 || i === out.length - 1 ? pt : { x: (out[i - 1]!.x + 2 * pt.x + out[i + 1]!.x) / 4, y: (out[i - 1]!.y + 2 * pt.y + out[i + 1]!.y) / 4, p: pt.p }))
  }
  return out
}

/** A difference of two directions, back in -π to π: a turn from 170° to -170° is 20°, not 340°. */
const wrap = (turn: number): number => (turn > Math.PI ? turn - 2 * Math.PI : turn < -Math.PI ? turn + 2 * Math.PI : turn)

/**
 * A stroke described, as it was drawn on the screen (0.01 mm at the size the
 * hand drew it): its proportions, length, how it turns (in all, on balance,
 * at its sharpest, how often it changes way, in each third), where it starts
 * and ends in its box, how far its middle bulges, its size, which ways it
 * runs, how near its ends come, and its path; a loop from its top, clockwise
 * (loopOf). Undefined for a dot. A straight stroke kept as its two ends, as
 * a profile keeps a line, is described from points spaced along it, like any
 * other: needing three points dropped such an example from the learner, so
 * undoing a line straightened taught nothing (found in the pen review, 16
 * October 2026).
 */
export function described(points: readonly Pt[]): Described | undefined {
  if (points.length < 2) return undefined
  const drawn = cleaned(points)
  const length = pathLength(drawn)
  if (length < 50 || drawn.length < 3) return undefined
  const box = boxOf(drawn)
  const w = Math.max(box.w, 20)
  const h = Math.max(box.h, 20)
  const diagonal = Math.hypot(w, h)
  const gap = dist(drawn[0]!, drawn.at(-1)!)
  const s = gap <= 0.2 * diagonal && length >= 1.8 * diagonal ? loopOf(drawn) : drawn
  // Turning, in 24 even pieces.
  const ring = resample(s, 25)
  const turns: number[] = []
  for (let i = 1; i + 1 < ring.length; i++) {
    turns.push(wrap(Math.atan2(ring[i + 1]!.y - ring[i]!.y, ring[i + 1]!.x - ring[i]!.x) - Math.atan2(ring[i]!.y - ring[i - 1]!.y, ring[i]!.x - ring[i - 1]!.x)))
  }
  let total = 0
  let net = 0
  let sharpest = 0
  let changes = 0
  let bend = 0
  let run = 0
  for (const turn of turns) {
    total += Math.abs(turn)
    net += turn
    sharpest = Math.max(sharpest, Math.abs(turn))
    // A change of way counts once the stroke has turned 20° the new way, not for every wobble.
    run = run === 0 || Math.sign(turn) === Math.sign(run) ? run + turn : turn
    if (Math.abs(run) > 0.35 && Math.sign(run) !== bend) {
      if (bend !== 0) changes++
      bend = Math.sign(run)
    }
  }
  const thirds = [0, 1, 2].map((k) => turns.slice(k * 8, k * 8 + 8).reduce((sum, turn) => sum + turn, 0) / Math.PI)
  // The share of its length running each of eight ways.
  const ways = new Array<number>(8).fill(0)
  for (let i = 1; i < s.length; i++) {
    const dx = s[i]!.x - s[i - 1]!.x
    const dy = s[i]!.y - s[i - 1]!.y
    ways[(((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8)]! += Math.hypot(dx, dy) / length
  }
  const a = s[0]!
  const b = s.at(-1)!
  const middle = resample(s, 21)[10]!
  // By position, as SCALES and the weights are. A profile keeps a stroke's points, not these, so they are worked out
  // anew from its strokes; only its margins (tune) were set with the measures as they then were.
  const measures = [
    Math.log(h / w),
    length / diagonal,
    net / (2 * Math.PI),
    total / (2 * Math.PI),
    sharpest / Math.PI,
    Math.min(changes, 4) / 4,
    (a.x - box.x) / w,
    (a.y - box.y) / h,
    (b.x - box.x) / w,
    (b.y - box.y) / h,
    (middle.x - (a.x + b.x) / 2) / h,
    Math.log(diagonal / 100),
    ...thirds,
    ...ways.map((share) => 2 * share),
    gap / diagonal,
  ]
  const f = new Float64Array(measures.length)
  for (let i = 0; i < measures.length; i++) f[i] = measures[i]! / SCALES[i]!
  const path = new Float64Array(2 * PATH_POINTS)
  resample(s, PATH_POINTS).forEach((pt, i) => {
    path[2 * i] = (pt.x - box.x) / w
    path[2 * i + 1] = (pt.y - box.y) / h
  })
  return { f, path }
}

/**
 * A stroke that goes round and back to its start, as its loop alone, from its
 * topmost point, clockwise on the screen: where the pen began a circle, and
 * which way it went round, say nothing of what it is.
 */
function loopOf(s: readonly Pt[]): Pt[] {
  // The loop ends where the stroke comes back nearest its start, in its last quarter (hands go a little past).
  const total = pathLength(s)
  let walked = 0
  let end = s.length - 1
  let nearest = Infinity
  for (let i = 1; i < s.length; i++) {
    walked += dist(s[i - 1]!, s[i]!)
    const back = dist(s[i]!, s[0]!)
    if (walked >= 0.75 * total && back < nearest) {
      nearest = back
      end = i
    }
  }
  const loop = s.slice(0, end + 1)
  let top = 0
  for (let i = 1; i < loop.length; i++) if (loop[i]!.y < loop[top]!.y) top = i
  // Round to start at the top; the loop's first point is left out, as its last stands for it.
  const from = [...loop.slice(top), ...loop.slice(1, top + 1)]
  // Its signed area: positive goes clockwise on the screen, where y runs down.
  let area = 0
  for (let i = 0; i < from.length; i++) {
    const p = from[i]!
    const q = from[(i + 1) % from.length]!
    area += p.x * q.y - q.x * p.y
  }
  return area >= 0 ? from : [from[0]!, ...from.slice(1).reverse()]
}

/**
 * How unlike two strokes are: the measures' distance, each measure weighed by
 * `w` (weightsOf), plus the path's (the mean gap between their points, as
 * shares of the box).
 */
function distance(p: Described, q: Described, w: Float64Array): number {
  let sum = 0
  for (let i = 0; i < p.f.length; i++) sum += (w[i]! * (p.f[i]! - q.f[i]!)) ** 2
  let gap = 0
  for (let i = 0; i < p.path.length; i += 2) gap += Math.hypot(p.path[i]! - q.path[i]!, p.path[i + 1]! - q.path[i + 1]!)
  return Math.sqrt(sum / p.f.length) + PATH_WEIGHT * (gap / (p.path.length / 2))
}

/** A described example: what it is, the stroke, and the profile's example it came from. */
export interface Known {
  readonly label: InkLabel
  readonly d: Described
  readonly from?: PenExample
}

/** Strokes needed before the measures are put on the person's own footing: below, the fixed SCALES. */
const SCALED_FROM = 300
const MEASURES = SCALES.length

/**
 * How much each measure counts for this person: one over its spread (standard
 * deviation) across their own strokes, so a difference as big as their usual
 * spread counts one, whoever they are. The measures are already divided by the
 * fixed SCALES, which therefore cancel out. With fewer than SCALED_FROM
 * strokes, too few to say, every weight is one: the fixed SCALES. (The median
 * absolute deviation was tried too: it shrinks the spread of measures most
 * letters share, so those counted too much, and the test symbols fell from 92 %
 * to 84 %.)
 */
function weightsOf(examples: readonly Known[]): Float64Array {
  const w = new Float64Array(MEASURES).fill(1)
  if (examples.length < SCALED_FROM) return w
  for (let i = 0; i < MEASURES; i++) {
    let sum = 0
    let squares = 0
    for (const known of examples) {
      sum += known.d.f[i]!
      squares += known.d.f[i]! ** 2
    }
    const mean = sum / examples.length
    const spread = Math.sqrt(Math.max(0, squares / examples.length - mean * mean))
    // A measure every stroke shares says nothing either way: left at one.
    if (spread > 1e-6) w[i] = 1 / spread
  }
  return w
}

/** A profile's margins, or the fixed ones for a profile made before they were worked out. */
const marginsOf = (tuned: PenMargins | undefined): Margins =>
  tuned ? { symbol: tuned.symbol / 1000, shape: tuned.shape / 1000, line: tuned.line / 1000, scratch: tuned.scratch / 1000, unscratch: tuned.unscratch / 1000, shade: tuned.shade / 1000 } : LEARN_MARGIN

/** One person's strokes, ready to compare. */
export class Learner {
  readonly #examples: readonly Known[]
  readonly #counts = new Map<InkLabel, number>()
  readonly #w: Float64Array
  /** How sure it must be before acting, for this person. */
  readonly margin: Margins

  constructor(examples: readonly Known[], margin: Margins = LEARN_MARGIN) {
    this.#examples = examples
    for (const { label } of examples) this.#counts.set(label, (this.#counts.get(label) ?? 0) + 1)
    this.#w = weightsOf(examples)
    this.margin = margin
  }

  /** A profile's strokes, described (a few tens of milliseconds for a whole recording), with its margins. */
  static of(profile: PenProfile): Learner {
    return new Learner(knownOf(profile.examples), marginsOf(profile.tuned))
  }

  /**
   * The same, with the examples `keep` refuses taken away and `added` ones
   * described and put in: what Learner.of would make of the profile so
   * changed, without describing every example again (the pen review's R6:
   * past 300 undone corrections, each new one made the learner again, 34 ms).
   */
  edited(keep: (known: Known) => boolean, added: readonly PenExample[]): Learner {
    return new Learner([...this.#examples.filter(keep), ...knownOf(added)], this.margin)
  }

  /** How many examples of a thing it has. */
  count(label: InkLabel): number {
    return this.#counts.get(label) ?? 0
  }

  /** Whether it has enough of a thing to go by. */
  knows(label: InkLabel): boolean {
    return this.count(label) >= MIN_EXAMPLES
  }

  /** For each label wanted, how far the stroke is from it: the mean of its two nearest examples. */
  #scores(d: Described, labels: ReadonlySet<InkLabel>): Map<InkLabel, number> {
    const nearest = new Map<InkLabel, [number, number]>()
    for (const example of this.#examples) {
      if (!labels.has(example.label)) continue
      const gap = distance(d, example.d, this.#w)
      const two = nearest.get(example.label) ?? [Infinity, Infinity]
      if (gap < two[0]) nearest.set(example.label, [gap, two[0]])
      else if (gap < two[1]) nearest.set(example.label, [two[0], gap])
    }
    const scores = new Map<InkLabel, number>()
    for (const [label, [first, second]] of nearest) scores.set(label, Number.isFinite(second) ? (first + second) / 2 : first)
    return scores
  }

  /**
   * Which of `labels` the stroke is, when it is `margin` times nearer that
   * than the person's plain strokes; undefined when not sure, or when it has
   * too few plain strokes to know what is plain.
   */
  pick(d: Described, labels: readonly InkLabel[], margin: number): InkLabel | undefined {
    const known = labels.filter((label) => label !== 'none' && this.knows(label))
    if (known.length === 0 || this.count('none') < MIN_PLAIN) return undefined
    const scores = this.#scores(d, new Set<InkLabel>([...known, 'none']))
    const plain = scores.get('none') ?? Infinity
    let best: InkLabel | undefined
    let bestScore = Infinity
    for (const label of known) {
      const score = scores.get(label) ?? Infinity
      if (score < bestScore) {
        best = label
        bestScore = score
      }
    }
    return best !== undefined && bestScore * margin < plain ? best : undefined
  }

  /** Whether the stroke is `margin` times nearer the person's `label`s than their `other`s. */
  prefers(d: Described, label: InkLabel, other: InkLabel, margin: number): boolean {
    const scores = this.#scores(d, new Set<InkLabel>([label, other]))
    return (scores.get(label) ?? Infinity) * margin < (scores.get(other) ?? Infinity)
  }

  /**
   * Whether the stroke is plain ink rather than `label`: `margin` times nearer
   * the person's plain strokes than their examples of it; or, with too few
   * of those, nearly the same as one of their plain strokes (one they undid a
   * correction of, say).
   */
  plain(d: Described, label: InkLabel, margin: number): boolean {
    if (this.count('none') === 0) return false
    const scores = this.#scores(d, new Set<InkLabel>([label, 'none']))
    const plain = scores.get('none')!
    if (this.knows(label)) return plain * margin < scores.get(label)!
    let nearest = Infinity
    for (const example of this.#examples) if (example.label === 'none') nearest = Math.min(nearest, distance(d, example.d, this.#w))
    return nearest < SAME
  }
}

/** Examples described, those that cannot be (a dot) left out. */
function knownOf(examples: readonly PenExample[]): Known[] {
  const known: Known[] = []
  for (const example of examples) {
    const d = described(pointsOfExample(example))
    if (d) known.push({ label: example.label, d, from: example })
  }
  return known
}

/**
 * How a stroke on the page is judged: at the size the hand drew it, `zoom`
 * times its size on the page (1 at 100 %), by the general rules and, when the
 * person has taught the pen, by their own strokes (`learner`). The rules
 * judged page sizes until the pen review's R5 (16 October 2026), so at 400 %
 * they saw strokes four times smaller than drawn: a line drawn 30 mm long on
 * the screen was too short to straighten, and at 50 % a letter's stroke long
 * enough.
 */
export interface Taught {
  learner?: Learner
  zoom: number
}

/** Page points as drawn on the screen: the page's units times the zoom. */
export function onScreen(points: readonly Pt[], zoom: number): Pt[] {
  return zoom === 1 ? [...points] : points.map((pt) => ({ x: pt.x * zoom, y: pt.y * zoom, p: pt.p }))
}

/** The points the rules judge: as drawn on the screen (the same array at 100 %). */
const drawnSize = (points: readonly Pt[], zoom: number): readonly Pt[] => (zoom === 1 ? points : onScreen(points, zoom))

const describedBefore = new WeakMap<readonly Pt[], { zoom: number; length: number; d: Described | undefined }>()

/**
 * A page stroke described at the size it was drawn on the screen. On lifting
 * it is asked for a symbol, a line and a scratch-out, so it is described once;
 * a stroke still being drawn only grows, so its length says when it changed.
 */
export function describedOn(points: readonly Pt[], zoom: number): Described | undefined {
  const before = describedBefore.get(points)
  if (before && before.zoom === zoom && before.length === points.length) return before.d
  const d = described(onScreen(points, zoom))
  describedBefore.set(points, { zoom, length: points.length, d })
  return d
}

/**
 * A held stroke's shape: the rules' shape, unless the person's own strokes
 * clearly say it is another, then fitted as that one (an arrow, a cloud, a
 * rhombus the rules missed).
 */
export function heldShape(points: readonly Pt[], taught?: Taught): RecognisedShape | undefined {
  const zoom = taught?.zoom ?? 1
  const drawn = drawnSize(points, zoom)
  const onPage = (shape: RecognisedShape | undefined): RecognisedShape | undefined => shape && scaledShape(shape, 1 / zoom)
  const rule = recognise(drawn, true)
  const learner = taught?.learner
  if (!learner) return onPage(rule)
  const d = describedOn(points, zoom)
  if (!d) return onPage(rule)
  const picked = learner.pick(d, SHAPE_LABELS, learner.margin.shape) as ShapeFamily | undefined
  const ruled = rule && FAMILY[rule.kind]
  if (!picked || ruled === picked) return onPage(rule)
  // The rules found another shape: the person's own strokes overrule them only when clearly nearer theirs.
  if (ruled && learner.knows(ruled) && !learner.prefers(d, picked, ruled, learner.margin.shape)) return onPage(rule)
  return onPage(fitAs(picked, drawn) ?? rule)
}

/** A stroke straightened as the pen lifts: the rules' line, unless it is much more like one of the person's letter strokes (the arms of a K or an X). */
export function straightOnLift(points: readonly Pt[], taught?: Taught): ReturnType<typeof straightLine> {
  const zoom = taught?.zoom ?? 1
  const drawn = straightLine(drawnSize(points, zoom))
  const line = drawn && (zoom === 1 ? drawn : { a: { ...drawn.a, x: drawn.a.x / zoom, y: drawn.a.y / zoom }, b: { ...drawn.b, x: drawn.b.x / zoom, y: drawn.b.y / zoom } })
  if (!line || !taught?.learner) return line
  const d = describedOn(points, zoom)
  return d && taught.learner.plain(d, 'line', taught.learner.margin.line) ? undefined : line
}

/**
 * An arrow taken as the pen lifts, with no hold, as a clearly straight line is:
 * the rules' arrow, unless the stroke is clearly nearer the person's plain
 * writing than their arrows; or, where the rules miss, one clearly nearer their
 * own arrows than their plain writing and every other shape they drew (as their
 * own held arrows are), from 4 mm, so the small arrows they recorded are
 * learned.
 */
export function arrowOnLift(points: readonly Pt[], taught?: Taught): RecognisedShape | undefined {
  const zoom = taught?.zoom ?? 1
  const drawn = drawnSize(points, zoom)
  const onPage = (shape: RecognisedShape | undefined): RecognisedShape | undefined => shape && scaledShape(shape, 1 / zoom)
  const rule = arrowShape(drawn)
  const learner = taught?.learner
  if (!learner) return onPage(rule)
  const d = describedOn(points, zoom)
  if (!d) return onPage(rule)
  if (rule) return learner.plain(d, 'arrow', learner.margin.shape) ? undefined : onPage(rule)
  if (diagonal(boxOf(drawn)) < SMALL_ARROW_MIN || straightLine(drawn, true)) return undefined
  return learner.pick(d, SHAPE_LABELS, learner.margin.shape) === 'arrow' ? onPage(fitAs('arrow', drawn)) : undefined
}

/** An arrow drawn in two strokes, the one before and this one, judged at the size drawn on the screen. */
export function arrowOfTwo(before: readonly Pt[], now: readonly Pt[], zoom = 1): RecognisedShape | undefined {
  const shape = twoStrokeArrow(drawnSize(before, zoom), drawnSize(now, zoom))
  return shape && scaledShape(shape, 1 / zoom)
}

/**
 * A scratch-out: by the rules, unless it is plainly the person's writing; or
 * like their own scratch-outs, which the rules missed. When the person has
 * recorded shading too, a zigzag is also judged against it: one the
 * rules call a scratch-out is one unless it is clearly nearer their shading
 * than their scratch-outs, and one the rules missed must be clearly nearer
 * their scratch-outs than their shading; so their shading across a drawing
 * deletes nothing, and a quick zigzag over a word still does. With no shading,
 * or no scratch-outs, to compare, shading is left out, as before.
 */
export function scratchTest(taught?: Taught): (points: readonly Pt[]) => boolean {
  const zoom = taught?.zoom ?? 1
  const learner = taught?.learner
  if (!learner) return zoom === 1 ? isScratch : (points) => isScratch(drawnSize(points, zoom))
  const margin = learner.margin
  const shading = learner.knows('shade') && learner.knows('scratch')
  return (points) => {
    const rule = isScratch(drawnSize(points, zoom))
    if (points.length < 8) return false
    const d = describedOn(points, zoom)
    if (!d) return rule
    if (rule) return !learner.plain(d, 'scratch', margin.unscratch) && !(shading && learner.prefers(d, 'shade', 'scratch', margin.shade))
    return learner.pick(d, ['scratch'], margin.scratch) === 'scratch' && (!shading || learner.prefers(d, 'scratch', 'shade', margin.scratch))
  }
}

// ----- margins worked out from the person's own strokes -----------------------------------------

/** The share of a person's strokes the pen may get wrong, each left out in turn: plain strokes acted on, or their own examples missed. */
const WRONG_SHARE = 0.005
const allowedOf = (count: number): number => Math.floor(WRONG_SHARE * count)

/** A described example with its points, for the rules. */
export interface Tunable extends Known {
  readonly points: readonly Pt[]
}

/**
 * A margin for a thing the pen acts on when a stroke's ratio is above it
 * (higher is surer: a symbol, a shape, a scratch-out the rules missed).
 * `wrong`: the ratios of strokes it must leave alone (their plain strokes),
 * `allowed` of which may be above it; `right`: those of the person's own
 * examples of the thing, of which at most WRONG_SHARE may be under it. When
 * both can be met, the margin is midway between the two limits (on a ratio's
 * scale), the most room either side; when they cannot, leaving plain strokes
 * alone comes first. Never under one, so a stroke nearer plain writing is
 * never taken.
 */
function surer(wrong: readonly number[], allowed: number, right: readonly number[]): number {
  const bound = Math.max(1, [...wrong].sort((a, b) => b - a)[allowed] ?? 1)
  const need = [...right].sort((a, b) => a - b)[allowedOf(right.length)]
  return need !== undefined && need > bound ? Math.sqrt(bound * need) : bound
}

/**
 * A margin for a thing the rules found, which the pen acts on when a stroke's
 * ratio is at or under it (higher acts more: a line straightened, a zigzag
 * deleted). `wrong`: the ratios of strokes it must leave alone, `allowed` of
 * which may be at or under it; `right`: the person's own examples, of which
 * at most WRONG_SHARE may be over it. Midway between the two limits when both
 * can be met, else leaving alone comes first; with too few strokes to leave
 * alone to bound it, the person's own decide, so a correction they undo still
 * teaches. Never under one.
 */
function looser(wrong: readonly number[], allowed: number, right: readonly number[]): number {
  const bound = [...wrong].sort((a, b) => a - b)[allowed]
  const need = Math.max(1, [...right].sort((a, b) => b - a)[allowedOf(right.length)] ?? 1)
  if (bound === undefined) return need
  // `bound * (1 - 1e-9)`: just under the limit, as a ratio exactly at the margin is acted on.
  return Math.max(1, need < bound ? Math.sqrt(need * bound) : bound * (1 - 1e-9))
}

/**
 * Each person's margins, worked out at Teach my pen from their own strokes,
 * each left out in turn, in place of the fixed LEARN_MARGIN set on a test
 * recording. Each is set between what their plain strokes allow (at most
 * WRONG_SHARE of them acted on: taken for a symbol, a shape or a scratch-out,
 * or straightened) and what their own examples need (at most WRONG_SHARE of
 * them missed); for held shapes, also so that their own shapes are not taken
 * from the rules' right family for a wrong one; for shading, so that at most
 * WRONG_SHARE of their shading is taken for a scratch-out. Undefined with too
 * few plain strokes to say.
 */
export function tune(examples: readonly Tunable[]): Margins | undefined {
  const n = examples.length
  const labels = InkLabel.options
  const L = labels.length
  const index = new Map(labels.map((label, i) => [label, i]))
  const of = examples.map((e) => index.get(e.label)!)
  const counts = new Array<number>(L).fill(0)
  for (const l of of) counts[l]!++
  const knows = (label: InkLabel): boolean => counts[index.get(label)!]! >= MIN_EXAMPLES
  if (!(counts[index.get('none')!]! >= MIN_PLAIN)) return undefined
  // The two nearest of each label to each example, but itself: one pass over the pairs.
  const w = weightsOf(examples)
  // A row per example and a column per label: the two nearest of that label to that example.
  const first = new Float64Array(n * L).fill(Infinity)
  const second = new Float64Array(n * L).fill(Infinity)
  const near = (i: number, l: number, gap: number): void => {
    const k = i * L + l
    if (gap < first[k]!) {
      second[k] = first[k]!
      first[k] = gap
    } else if (gap < second[k]!) second[k] = gap
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const gap = distance(examples[i]!.d, examples[j]!.d, w)
      near(i, of[j]!, gap)
      near(j, of[i]!, gap)
    }
  }
  const score = (i: number, label: InkLabel): number => {
    const k = i * L + index.get(label)!
    return Number.isFinite(second[k]!) ? (first[k]! + second[k]!) / 2 : first[k]!
  }
  const nearest = (i: number, among: readonly InkLabel[]): InkLabel => among.reduce((a, b) => (score(i, b) < score(i, a) ? b : a))
  const all = (label: InkLabel | readonly InkLabel[]): number[] => examples.flatMap((e, i) => (e.label === label || (Array.isArray(label) && label.includes(e.label)) ? [i] : []))
  const plain = all('none')
  const allowed = allowedOf(plain.length)
  const scratchy = (i: number): boolean => isScratch(examples[i]!.points)
  const straight = (i: number): boolean => straightLine(examples[i]!.points) !== undefined
  /** Plain over the nearest of `among`, for each of `from` that `when` lets through: above the margin, it is taken. */
  const plainOver = (from: readonly number[], among: readonly InkLabel[], when: (i: number) => boolean = () => true): number[] =>
    from.filter(when).map((i) => score(i, 'none') / score(i, nearest(i, among)))
  /** `label` over `other`, for each of `from` that `when` lets through: at or under the margin, it is acted on. */
  const over = (from: readonly number[], label: InkLabel, other: InkLabel, when: (i: number) => boolean = () => true): number[] => from.filter(when).map((i) => score(i, label) / score(i, other))
  const fallback = LEARN_MARGIN
  const symbols = (Object.keys(SYMBOL_LABELS) as InkLabel[]).filter(knows)
  const shapes = SHAPE_LABELS.filter(knows)
  let shape = fallback.shape
  if (shapes.length > 0) {
    const mine = all(shapes)
    // A held shape the rules found is changed to the nearest family only when that is the margin nearer: wrongly, when it is not what was drawn.
    const wrong: number[] = []
    const right: number[] = []
    for (const i of mine) {
      const ruled = recognise(examples[i]!.points, true)
      const family = ruled && FAMILY[ruled.kind]
      if (!family || !knows(family)) continue
      const picked = nearest(i, shapes)
      if (picked === family) continue
      // Changing to the nearest family is right only when that is what the person drew.
      ;(picked === examples[i]!.label ? right : wrong).push(score(i, family) / score(i, picked))
    }
    shape = Math.max(surer(plainOver(plain, shapes), allowed, plainOver(mine, shapes)), surer(wrong, allowedOf(mine.length), right))
  }
  const scratches = all('scratch')
  return {
    symbol: symbols.length > 0 ? surer(plainOver(plain, symbols), allowed, plainOver(all(symbols), symbols)) : fallback.symbol,
    shape,
    line: knows('line') ? looser(over(plain, 'line', 'none', straight), allowed, over(all('line'), 'line', 'none', straight)) : fallback.line,
    scratch: knows('scratch') ? surer(plainOver(plain, ['scratch'], (i) => !scratchy(i)), allowed, plainOver(scratches, ['scratch'], (i) => !scratchy(i))) : fallback.scratch,
    unscratch: knows('scratch') ? looser(over(plain, 'scratch', 'none', scratchy), allowed, over(scratches, 'scratch', 'none', scratchy)) : fallback.unscratch,
    shade: knows('shade') && knows('scratch') ? looser(over(all('shade'), 'scratch', 'shade'), allowedOf(all('shade').length), over(scratches, 'scratch', 'shade')) : fallback.shade,
  }
}

/** Margins as a profile keeps them: whole thousandths, within what it accepts, rounded the surer way (up where higher is surer). */
const keptMargins = (m: Margins): PenMargins => {
  const k = (v: number, round: (v: number) => number): number => Math.min(1_000_000, Math.max(1000, round(v * 1000)))
  return { symbol: k(m.symbol, Math.ceil), shape: k(m.shape, Math.ceil), line: k(m.line, Math.floor), scratch: k(m.scratch, Math.ceil), unscratch: k(m.unscratch, Math.floor), shade: k(m.shade, Math.floor) }
}

// ----- profiles -------------------------------------------------------------------------------------------

/** Strokes the person's undone corrections may add before the oldest of them go. */
export const MAX_UNDONE = 300
/** How closely a profile keeps a stroke: 0.05 mm, far finer than the learner looks. */
const KEEP = 5

/** A stroke as a profile keeps it: points as drawn on the screen, whole numbers, its box's corner at 0, 0. */
export function exampleOf(label: InkLabel, points: readonly Pt[], from: PenExample['from']): PenExample | undefined {
  if (points.length < 2) return undefined
  const kept = simplify(points, KEEP)
  const box = boxOf(kept)
  const xy = kept.flatMap((pt) => [Math.round(pt.x - box.x), Math.round(pt.y - box.y)])
  return xy.length >= 4 ? { label, xy, from } : undefined
}

/** An example's points. */
export function pointsOfExample(example: PenExample): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i + 1 < example.xy.length; i += 2) out.push({ x: example.xy[i]!, y: example.xy[i + 1]!, p: 128 })
  return out
}

/**
 * A profile with the recorder's strokes replaced by these, the undone
 * corrections kept, and the margins worked out from them all (tune).
 */
export function taughtProfile(before: PenProfile | undefined, recorded: readonly PenExample[], now: Date): PenProfile {
  const examples = [...recorded, ...(before?.examples.filter((e) => e.from === 'undo') ?? [])]
  const tunable = examples.flatMap((example): Tunable[] => {
    const points = pointsOfExample(example)
    const d = described(points)
    return d ? [{ label: example.label, d, from: example, points }] : []
  })
  const margins = tune(tunable)
  return { v: 1, updated: now.toISOString(), examples, ...(margins ? { tuned: keptMargins(margins) } : {}) }
}

/** A profile with one more stroke the person undid a correction of, as plain ink; the oldest such go past MAX_UNDONE. */
export function withUndone(before: PenProfile | undefined, points: readonly Pt[], now: Date): PenProfile {
  const example = exampleOf('none', points, 'undo')
  const examples = [...(before?.examples ?? []), ...(example ? [example] : [])]
  let undone = examples.filter((e) => e.from === 'undo').length
  // Oldest first in the list: counting down from the total drops the first ones past MAX_UNDONE.
  const kept = examples.filter((e) => !(e.from === 'undo' && undone-- > MAX_UNDONE))
  // The margins stay as they were: only Teach my pen works them out (taughtProfile).
  return { v: 1, updated: now.toISOString(), examples: kept, ...(before?.tuned ? { tuned: before.tuned } : {}) }
}
