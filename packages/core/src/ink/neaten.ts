// Tidy handwriting (tidied on its own after each word, switchable, plus a Tidy button).
// After each word only small fixes, each judged against the writing's own letter size, never a size
// fitted to one person:
//
// - a tail where the pen landed or lifted, turning sharply back (Apple's "end-of-letter tails"): cut off;
// - an end running a little past a stroke written before it, or its own line (an overshoot, as a B's bowl through
//   its stem, an o closing over itself): cut at the crossing. A stroke written after does not count, so a t's stem
//   keeps its top above the bar.
//
// A gap is never closed: an o left a little open and an i written up from the line and back down look the same
// without reading them, and closing the i made it an a.
//
// No point moves: a fix only takes points off an end (at most 0.8 mm of line), adding one where it cuts. Strokes stay
// the same in number and order. Lines and words are found from the order written (rowsOf). A finished line has each
// letter moved onto its word's baseline, each word moved up or down, whole, onto the baseline of the line's first
// word, and the words evenly spaced (a test drawing, 17 October 2026), the baseline being
// where the letters sit: for f, g, j, p, y and a written z, where the bowl closes, not the tail below. A slope comes
// level and a word written high or low comes onto the line; an exponent written against its letter keeps its offset.
// Tidying twice changes nothing: each fix leaves nothing for itself to find, and a word is tidied until
// nothing changes.
import { dist, MM, pathLength, respace, type Box, type Pt } from './geometry.js'

/** A tail is cut when it is at most this long: the share of the letter size, and at most this much. */
const TAIL = { share: 0.15, most: 0.6 * MM }
/** It turns back from the way the stroke was going by at least this angle. */
const TAIL_TURN = (100 * Math.PI) / 180
/** An overshoot is cut when the part past the crossing is at most this long, and at most this share of its stroke. */
const OVERSHOOT = { share: 0.15, most: 0.8 * MM, ofStroke: 0.15 }
/** Closer than this, an end already touches. */
const TOUCHING = 3
/**
 * A word is moved onto its line only when this share of the letter size away,
 * or more. Every word of a row comes onto it, however high or low it was
 * written (recorded "Kumar", "are", "is" and "can", 17 October 2026): the row
 * is what the person wrote in one go (rowsOf), so a word in it is on its line.
 * An exponent written against its letter is in that letter's word, and stays by
 * LETTER_MOST. (Word sizes say nothing of an exponent: in test writing a word's
 * band is 0.44 to 1.75 of the word before it's, its height 0.25 to 2.4.)
 */
const LEVEL_LEAST = 0.05
/** A letter more than this share of the letter size off its word's baseline is written so (a p's stem to its tail): it stays. */
const LETTER_MOST = 0.5
/** A letter's bottom: where the pen, going down, turns back up by at least this share of the letter size. */
const BOTTOM_TURN = 0.15
/** A stroke flatter than this share of the letter size (a bar, a dash) has no bottom: it sits on or over a letter. */
const BOTTOM_FLAT = 0.35
/** Bottoms within this share of the letter size of each other sit on one line. */
const BOTTOM_GROUP = 0.35
/**
 * A step is a bottom too: the pen, going down, runs across at least
 * STEP_ACROSS of the letter size within STEP_FLAT of one height, then on
 * down, as a written z at its waist on the line before its loop.
 */
const STEP_ACROSS = 0.15
const STEP_FLAT = 0.06
/**...and only after the pen has come down at least this share of the letter size to it: a z's waist ends its diagonal; a 7's bar, where it starts, is its top (a recorded 7, 17 October 2026). */
const STEP_DROP = 0.5
/** Words are farther apart than this many letter sizes; letters within a word, closer. */
export const WORD_GAP = 0.9
/** The gaps chosen tighter or wider than the line's usual gap (spacingShifts). */
const TIGHTER = 0.7
const WIDER = 1.4
/** A gap narrower than this many letter sizes, and well under the line's others, may be inside a word (spacingShifts). */
const INSIDE = 1.3

/** The line a finished line's words are put on (levelShifts), and the gap they are spaced to (spacingShifts). */
export type LineAnchor = 'first' | 'most' | 'last'
export type WordGapChoice = 'usual' | 'first' | 'tighter' | 'wider' | 'written'

/**
 * Each tidy rule, to be tried one by one (: "add buttons so that people in developer mode can
 * connect it"); all on, as built.
 */
export interface TidyRules {
  /** Tails and overshoots cut, as the pen lifts and in a line. */
  ends: boolean
  /** Each separate letter onto its word's line (lc1). */
  letters: boolean
  /** Each word onto the line (la1). */
  level: boolean
  /** The gaps between words evened (lc1). */
  gaps: boolean
  /** A line kept off the page's right margin. */
  margin: boolean
  /** Dots and bars kept with their word. */
  marks: boolean
  /** Where a word sits: each letter counted once, so joins and dots do not outvote it; else every bottom counts. */
  once: boolean
  /** A true tie (a 5's corner and bowl) settled by the line the other words sit on; else the higher. */
  ties: boolean
  /** A word of one glyph on its base, its lowest point (digits). */
  base: boolean
  /** A written z's waist counted only after a drop, so a 7's bar is not one. */
  waist: boolean
  /** The line being written levelled after the pen rests. */
  rest: boolean
}
export const ALL_TIDY_RULES: TidyRules = { ends: true, letters: true, level: true, gaps: true, margin: true, marks: true, once: true, ties: true, base: true, waist: true, rest: true }
/** The rules finding where a word sits (baselineOf). */
export type BaselineRules = Pick<TidyRules, 'once' | 'ties' | 'waist'>

/** The writing's size and middle: the narrowest band holding half its line (about its letters' x-height), and where its middle is. */
export interface InkBand {
  size: number
  middle: number
}

/** The band of some strokes, from their points spaced evenly along each line, so a slow stroke weighs no more than a quick one. */
export function bandOf(strokes: readonly (readonly Pt[])[]): InkBand | undefined {
  const ys: number[] = []
  for (const stroke of strokes) if (stroke.length > 0) ys.push(...heightsOf(stroke))
  ys.sort((a, b) => a - b)
  return bandOfHeights(ys)
}

/**
 * A band kept up to date as strokes are added: the heights of their points,
 * spaced evenly along each line as bandOf does, counted in steps of 0.1 mm,
 * so adding a stroke and reading the band cost the stroke's points and the
 * height written over, not every point again (rowsOf, once a stroke lifts).
 */
class Heights {
  private readonly counts = new Map<number, number>()
  private total = 0

  /** A stroke's heights, its points spaced evenly along its line (heightsOf). */
  add(ys: readonly number[]): void {
    for (const y of ys) {
      const step = Math.floor(y / 10)
      this.counts.set(step, (this.counts.get(step) ?? 0) + 1)
      this.total++
    }
  }

  /** The narrowest band holding half the points, as bandOf finds it. */
  band(): InkBand | undefined {
    if (this.total < 2) return undefined
    const steps = [...this.counts.keys()].sort((a, b) => a - b)
    const half = Math.max(1, Math.floor(this.total / 2))
    let best: [number, number] | undefined
    let held = 0
    let from = 0
    // A window over the sorted heights: widened downward a step at a time, its top brought down while it still holds
    // half. The narrowest such window is kept.
    for (let to = 0; to < steps.length; to++) {
      held += this.counts.get(steps[to]!)!
      while (held - this.counts.get(steps[from]!)! >= half) held -= this.counts.get(steps[from++]!)!
      if (held >= half && (!best || steps[to]! - steps[from]! < best[1] - best[0])) best = [steps[from]!, steps[to]!]
    }
    if (!best) return undefined
    const top = best[0] * 10
    const bottom = (best[1] + 1) * 10
    return { size: Math.max(0.5 * MM, bottom - top), middle: (top + bottom) / 2 }
  }
}

/** A stroke's heights, its points spaced evenly along its line, as bandOf counts them. */
const heightsOf = (stroke: readonly Pt[]): number[] => (stroke.length > 1 ? respace(stroke, 10) : stroke).map((pt) => pt.y)

/** The narrowest band holding half of some sorted heights, as bandOf. */
function bandOfHeights(ys: readonly number[]): InkBand | undefined {
  if (ys.length < 2) return undefined
  const half = Math.max(1, Math.floor(ys.length / 2))
  let best = 0
  for (let i = 1; i + half < ys.length; i++) if (ys[i + half]! - ys[i]! < ys[best + half]! - ys[best]!) best = i
  const top = ys[best]!
  const bottom = ys[Math.min(ys.length - 1, best + half)]!
  return { size: Math.max(0.5 * MM, bottom - top), middle: (top + bottom) / 2 }
}

/**
 * What tidying does to one stroke: the points kept (from `from` to `to`,
 * as they were), and a point added before or after, to close a gap. The
 * pencil's tilt follows the same way (tidiedTilt).
 */
export interface StrokeTidy {
  from: number
  to: number
  before?: Pt
  after?: Pt
}

/** The stroke as tidied. */
export function tidied(points: readonly Pt[], tidy: StrokeTidy): Pt[] {
  return [...(tidy.before ? [tidy.before] : []), ...points.slice(tidy.from, tidy.to + 1), ...(tidy.after ? [tidy.after] : [])]
}

/** A pencil's tilt at each point, as tidied: an added point takes its neighbour's. */
export function tidiedTilt(tilt: readonly number[], tidy: StrokeTidy): number[] {
  const kept = tilt.slice(tidy.from, tidy.to + 1)
  return [...(tidy.before ? [kept[0] ?? 0] : []), ...kept, ...(tidy.after ? [kept.at(-1) ?? 0] : [])]
}

const unchanged = (tidy: StrokeTidy, length: number): boolean => tidy.from === 0 && tidy.to === length - 1 && !tidy.before && !tidy.after

/** Path length from point i to point j (i ≤ j). */
function between(points: readonly Pt[], i: number, j: number): number {
  let sum = 0
  for (let k = i; k < j; k++) sum += dist(points[k]!, points[k + 1]!)
  return sum
}

/** The path length at each point of a line. */
function arcsOf(points: readonly Pt[]): number[] {
  const arcs = [0]
  for (let i = 1; i < points.length; i++) arcs.push(arcs[i - 1]! + dist(points[i - 1]!, points[i]!))
  return arcs
}

/** The point at path length `s` along a line, and the last point before it. */
function pointAt(points: readonly Pt[], arcs: readonly number[], s: number): { at: Pt; before: number } {
  // The last point at or before s, by halving.
  let lo = 0
  let hi = points.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (arcs[mid]! <= s) lo = mid
    else hi = mid
  }
  const i = lo
  const a = points[i]!
  const b = points[Math.min(points.length - 1, i + 1)]!
  const span = arcs[Math.min(points.length - 1, i + 1)]! - arcs[i]!
  const t = span > 0 ? Math.max(0, Math.min(1, (s - arcs[i]!) / span)) : 0
  return { at: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p: a.p + (b.p - a.p) * t }, before: i }
}

/**
 * A tail at the end of a stroke: in its last `limit` of line, the place the
 * stroke got furthest to, the way it was going over the two limits before,
 * then turning back by TAIL_TURN or more. Measured along the line, not
 * point by point, since a stroke as kept has few points where it is
 * straight. Where to cut: the last point kept, and the place itself, on
 * the line as drawn, as the new end. The stroke must run straight before
 * the tail (a curl turns all along) and be long enough that the tail is
 * plainly a small part of it: a dot or a comma is left alone.
 */
function tailAtEnd(points: readonly Pt[], limit: number): { keep: number; at?: Pt } | undefined {
  const n = points.length
  if (n < 2) return undefined
  const arcs = arcsOf(points)
  const total = arcs[n - 1]!
  if (total < 5 * limit) return undefined
  const p0 = pointAt(points, arcs, total - 3 * limit).at
  const p1 = pointAt(points, arcs, total - limit).at
  const ux = p1.x - p0.x
  const uy = p1.y - p0.y
  const u = Math.hypot(ux, uy)
  // From p0 to p1 is 2 * limit of line: a chord much shorter than that means it curves there.
  if (u === 0 || 2 * limit > 1.1 * u) return undefined
  const along = (pt: Pt): number => ((pt.x - p1.x) * ux + (pt.y - p1.y) * uy) / u
  // The furthest place along, in the last limit: the drawn points there, and places between them every eighth of it.
  let best = total - limit
  let most = 0
  const consider = (s: number): void => {
    const far = along(pointAt(points, arcs, s).at)
    if (far > most) {
      most = far
      best = s
    }
  }
  for (let s = total - limit; s < total; s += limit / 8) consider(s)
  for (let k = 0; k < n; k++) if (arcs[k]! >= total - limit) consider(arcs[k]!)
  if (total - best < 1) return undefined
  const { at, before } = pointAt(points, arcs, best)
  const end = points[n - 1]!
  const tail = dist(at, end)
  if (tail < 0.15 * limit) return undefined
  const turn = Math.acos(Math.max(-1, Math.min(1, (ux * (end.x - at.x) + uy * (end.y - at.y)) / (u * tail))))
  if (turn < TAIL_TURN) return undefined
  if (dist(points[before]!, at) < 1) return { keep: before }
  return { keep: before, at: { x: Math.round(at.x), y: Math.round(at.y), p: at.p } }
}

/** Where segments a–b and c–d cross: the share of the way along a–b, or undefined. */
function crossing(a: Pt, b: Pt, c: Pt, d: Pt): number | undefined {
  const rx = b.x - a.x
  const ry = b.y - a.y
  const sx = d.x - c.x
  const sy = d.y - c.y
  const den = rx * sy - ry * sx
  if (den === 0) return undefined
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : undefined
}

/**
 * An overshoot at the end of a stroke: the crossing nearest the end with a
 * stroke written before it, or with this stroke's own line further back,
 * and the part past it short. Where to cut: the index of the last point kept and the
 * crossing point, which becomes the end.
 */
function overshootAtEnd(points: readonly Pt[], earlier: readonly (readonly Pt[])[], limit: number): { keep: number; at: Pt } | undefined {
  const n = points.length
  if (n < 3) return undefined
  const most = Math.min(limit, OVERSHOOT.ofStroke * pathLength(points))
  let walked = 0
  // Back from the end, so the first crossing found is the one nearest the end; on one segment, the largest share is.
  for (let i = n - 2; i >= 0 && walked <= most; i--) {
    const a = points[i]!
    const b = points[i + 1]!
    let best: number | undefined
    const test = (line: readonly Pt[], upTo: number): void => {
      for (let k = 0; k + 1 < upTo; k++) {
        const t = crossing(a, b, line[k]!, line[k + 1]!)
        if (t !== undefined && t > 0 && (best === undefined || t > best)) best = t
      }
    }
    for (const other of earlier) test(other, other.length)
    // Its own line, from well before the end part: a loop closing over itself.
    let back = i
    let gone = 0
    while (back > 0 && gone < 2 * limit) gone += dist(points[back]!, points[--back]!)
    test(points, back)
    if (best !== undefined) {
      const at = { x: Math.round(a.x + (b.x - a.x) * best), y: Math.round(a.y + (b.y - a.y) * best), p: a.p + (b.p - a.p) * best }
      const past = dist(at, b) + between(points, i + 1, n - 1)
      return past <= most && past > TOUCHING ? { keep: i, at } : undefined
    }
    walked += dist(a, b)
  }
  return undefined
}

const reversed = (points: readonly Pt[]): Pt[] => [...points].reverse()

/** One round of fixes on one stroke, the other strokes of its word as they are (`earlier`, written before it): its end, then its start, unless held (`hold`). */
function fixStroke(points: readonly Pt[], earlier: readonly (readonly Pt[])[], size: number, hold: { start: boolean; end: boolean }): StrokeTidy {
  const n = points.length
  const tidy: StrokeTidy = { from: 0, to: n - 1 }
  if (hold.start && hold.end) return tidy
  const tail = Math.min(TAIL.share * size, TAIL.most)
  const over = Math.min(OVERSHOOT.share * size, OVERSHOOT.most)
  // The end.
  const endTail = hold.end ? undefined : tailAtEnd(points, tail)
  if (hold.end) {
    // Held as drawn.
  } else if (endTail) {
    tidy.to = endTail.keep
    if (endTail.at) tidy.after = endTail.at
  }
  else {
    const shoot = overshootAtEnd(points, earlier, over)
    if (shoot) {
      tidy.to = shoot.keep
      tidy.after = shoot.at
    }
  }
  // The start, the same way round.
  // The reversed line's indexes count from the far end: `n - 1 - keep` gives this line's.
  const back = reversed(points)
  const startTail = hold.start ? undefined : tailAtEnd(back, tail)
  if (hold.start) {
    // Held as drawn.
  } else if (startTail) {
    tidy.from = n - 1 - startTail.keep
    if (startTail.at) tidy.before = startTail.at
  }
  else {
    const shoot = overshootAtEnd(back, earlier, over)
    if (shoot) {
      tidy.from = n - 1 - shoot.keep
      tidy.before = shoot.at
    }
  }
  // Too little left to be a stroke: leave it.
  if (tidy.to - tidy.from < 1) return { from: 0, to: n - 1 }
  return tidy
}

/**
 * A fix found on a stroke already tidied, put together with what was done
 * to it before, in terms of the stroke as drawn: points dropped at an end
 * are the added point first, then the stroke's own.
 */
function compose(was: StrokeTidy, fix: StrokeTidy, length: number): StrokeTidy {
  const dropStart = fix.from
  const dropEnd = length - 1 - fix.to
  const from = was.from + Math.max(0, dropStart - (was.before ? 1 : 0))
  const to = was.to - Math.max(0, dropEnd - (was.after ? 1 : 0))
  const before = fix.before ?? (dropStart === 0 ? was.before : undefined)
  const after = fix.after ?? (dropEnd === 0 ? was.after : undefined)
  return { from, to: Math.max(from, to), ...(before ? { before } : {}), ...(after ? { after } : {}) }
}

/**
 * A word tidied: for each stroke, what to keep and add, the same
 * strokes in the same order. Rounds of fixes run until nothing changes, so a
 * word tidied again is left as it is. `size`: the letter size of the line it
 * is on, when known; else the word's own.
 */
export function tidyWord(strokes: readonly (readonly Pt[])[], size = bandOf(strokes)?.size): StrokeTidy[] {
  const result: StrokeTidy[] = strokes.map((s) => ({ from: 0, to: s.length - 1 }))
  if (size === undefined) return result
  const held = strokes.map(() => ({ start: false, end: false }))
  let now: Pt[][] = strokes.map((s) => [...s])
  for (let round = 0; round < 4; round++) {
    let changed = false
    now = now.map((points, i) => {
      // `now` is still last round's inside this map: a stroke is judged against the earlier ones as found
      const next = settle(strokes[i]!, result[i]!, points, now.slice(0, i), size, held[i]!)
      if (!next) return points
      changed = true
      result[i] = next
      return tidied(strokes[i]!, next)
    })
    if (!changed) break
  }
  return result
}

/**
 * One stroke tidied as the pen lifts: its own fixes, the strokes
 * written before it in its word as they are, until nothing changes.
 */
export function tidyStroke(points: readonly Pt[], earlier: readonly (readonly Pt[])[], size: number): StrokeTidy {
  let result: StrokeTidy = { from: 0, to: points.length - 1 }
  const held = { start: false, end: false }
  let now: Pt[] = [...points]
  for (let round = 0; round < 4; round++) {
    const next = settle(points, result, now, earlier, size, held)
    if (!next) break
    result = next
    now = tidied(points, result)
  }
  return result
}

/**
 * One round of fixes on a stroke (`now`, as tidied so far, `was` from the
 * stroke as drawn), put together with what was done before; undefined when
 * nothing more changes. Two fixes on one end (a tail, then an overshoot
 * behind it, as on a t's bar) would cut more than one may: that end is held
 * as drawn. The same happens whenever it is tidied, so a second tidy still
 * changes nothing.
 */
function settle(drawn: readonly Pt[], was: StrokeTidy, now: readonly Pt[], earlier: readonly (readonly Pt[])[], size: number, held: { start: boolean; end: boolean }): StrokeTidy | undefined {
  const fix = fixStroke(now, earlier, size, held)
  if (unchanged(fix, now.length)) return undefined
  const most = Math.max(Math.min(TAIL.share * size, TAIL.most), Math.min(OVERSHOOT.share * size, OVERSHOOT.most))
  let next = compose(was, fix, now.length)
  if (between(drawn, 0, next.from) > most) {
    held.start = true
    next = { from: 0, to: next.to, ...(next.after ? { after: next.after } : {}) }
  }
  if (between(drawn, next.to, drawn.length - 1) > most) {
    held.end = true
    next = { from: next.from, to: drawn.length - 1, ...(next.before ? { before: next.before } : {}) }
  }
  return { from: next.from, to: next.to, ...(next.before ? { before: next.before } : {}), ...(next.after ? { after: next.after } : {}) }
}

/** Whether tidying changes this stroke. */
export const changes = (tidy: StrokeTidy, length: number): boolean => !unchanged(tidy, length)

/**
 * Where some writing sits: its baseline. The bottoms of its letters are found
 * (where the pen, going down, turns back up; where it runs across and then on
 * down, as a written z at its waist; or where a stroke ends going down),
 * grouped by height, and the biggest group taken, the higher on a tie: the
 * tails of f, g, j, p, y and a written z hang below the rest, so those letters
 * sit where their bowl closes or their tail begins (the project's rule and
 * pictures, 17 October 2026), a z or a p on its own too. Undefined when nothing
 * goes down and up, as a dash.
 */
export function baselineOf(strokes: readonly (readonly Pt[])[], size: number, near?: number, rules: BaselineRules = ALL_TIDY_RULES): number | undefined {
  const turn = BOTTOM_TURN * size
  // Each bottom with its stroke, and how much of a letter the stroke is: a whole one from a letter's size up, a dot or
  // an accent less (its height against the letter size).
  const bottoms: { y: number; stroke: number; weight: number }[] = []
  for (const [index, stroke] of strokes.entries()) {
    if (stroke.length < 2) continue
    const points = respace(stroke, Math.max(10, size / 20))
    const ys = points.map((pt) => pt.y)
    const xs = points.map((pt) => pt.x)
    const lowest = Math.max(...ys)
    if (lowest - Math.min(...ys) < turn) continue
    // A mark sits over its letter or on it, not on the line: an i's dot, an accent (small), a dot drawn as a dash, a
    // t's bar (flat). A recorded dash of a dot, 0.3 mm high, tied with its i and, the higher, was taken for where the
    // word sat: the i went 4.5 mm under the line (17 October 2026).
    const height = lowest - Math.min(...ys)
    if (Math.max(height, Math.max(...xs) - Math.min(...xs)) < MARK.small * size || height < BOTTOM_FLAT * size) continue
    // Going down (y growing) to `low`, or up to `high`; at first, not yet known. A turn on the way is a bottom; the
    // stroke's start or end is one only near its lowest point (an l's foot, an entry stroke rising from the line), not
    // an o closing at its side or a bowl begun halfway up.
    let going: 'down' | 'up' | 'unknown' = 'unknown'
    let low = ys[0]!
    let high = ys[0]!
    // A step: the height where the pen began to run across, and how far across it has run within STEP_FLAT of it; a
    // step left going down waits to be a bottom until the pen is a turn below it (a z's loop dives far, while a P's
    // bowl, coming back across to the stem, goes no further down).
    let stepAt = ys[0]!
    let across = 0
    let step: number | undefined
    for (let k = 0; k < ys.length; k++) {
      const y = ys[k]!
      if (k > 0) {
        if (Math.abs(y - stepAt) <= STEP_FLAT * size) across += Math.abs(xs[k]! - xs[k - 1]!)
        else {
          if (y > stepAt && going === 'down' && across >= STEP_ACROSS * size && (!rules.waist || stepAt - high >= STEP_DROP * size)) step = stepAt
          stepAt = y
          across = 0
        }
        if (step !== undefined && y >= step + turn) {
          bottoms.push({ y: step, stroke: index, weight: Math.min(1, height / size) })
          step = undefined
        }
      }
      if (going !== 'up') {
        low = Math.max(low, y)
        if (low - y >= turn) {
          if (going === 'down' || low >= lowest - turn) bottoms.push({ y: low, stroke: index, weight: Math.min(1, height / size) })
          going = 'up'
          high = y
          step = undefined
        } else if (going === 'unknown' && y - high >= turn) going = 'down'
        high = Math.min(high, y)
      } else {
        high = Math.min(high, y)
        if (y - high >= turn) {
          going = 'down'
          low = y
        }
      }
    }
    // Ending on the way down, as an l or a k's leg does: its end is a bottom too, near the stroke's lowest point.
    if (going !== 'up' && low - Math.min(...ys) >= turn && low >= lowest - turn) bottoms.push({ y: low, stroke: index, weight: Math.min(1, height / size) })
  }
  if (bottoms.length === 0) return undefined
  bottoms.sort((a, b) => a.y - b.y)
  // Groups of bottoms on one line, each with its middle, how many letters sit there (each stroke once, as much of a
  // letter as it is) and how many bottoms.
  const groups: { at: number; letters: number; count: number }[] = []
  let group = [bottoms[0]!]
  const close = (): void => {
    const strokesIn = new Map<number, number>()
    for (const b of group) strokesIn.set(b.stroke, b.weight)
    const letters = rules.once ? [...strokesIn.values()].reduce((sum, w) => sum + w, 0) : group.length
    groups.push({ at: group[group.length >> 1]!.y, letters, count: group.length })
  }
  for (let i = 1; i < bottoms.length; i++) {
    if (bottoms[i]!.y - bottoms[i - 1]!.y > BOTTOM_GROUP * size) {
      close()
      group = []
    }
    group.push(bottoms[i]!)
  }
  close()
  // The group most letters sit on, each counted once: a join between written letters, turning up over the line, is the
  // same stroke again (recorded "ello", 17 October 2026), and a dot is not a whole letter (a recorded i, its dot a
  // little circle). Then the one with most bottoms (a word in one stroke); then the higher, as the tails of f, g, j, p,
  // y and a written z hang below the line.
  let best = groups[0]!
  for (const g of groups) {
    if (g.letters > best.letters + 1e-6 || (Math.abs(g.letters - best.letters) <= 1e-6 && g.count > best.count)) best = g
  }
  // A true tie, as many letters and bottoms (a 5's corner and its bowl, a y's join and its tail, alike as shapes): with
  // the line the rest of its words sit on (`near`), the one nearest it (a recorded 5, put on its corner, 17 October
  // 2026). Without, the higher.
  if (near !== undefined && rules.ties) {
    const tied = groups.filter((g) => Math.abs(g.letters - best.letters) <= 1e-6 && g.count === best.count)
    if (tied.length > 1) return tied.reduce((a, b) => (Math.abs(b.at - near) < Math.abs(a.at - near) ? b : a)).at
  }
  return best.at
}

/**
 * Each letter of a word moved up or down, whole, onto the word's baseline
 *: a stroke with a baseline of its own (baselineOf) comes onto
 * the word's, unless already within LEVEL_LEAST of it, or a step of more
 * than LETTER_MOST from the letter before it (a p's stem down to its tail,
 * a letter written so); a stroke with none (an i's dot, a t's bar, an
 * accent) moves with the letter under it. In whole units.
 */
export function letterShifts(strokes: readonly (readonly Pt[])[], size: number, rules: BaselineRules = ALL_TIDY_RULES): number[] {
  const shifts = strokes.map(() => 0)
  if (strokes.length < 2) return shifts
  const base = baselineOf(strokes, size, undefined, rules)
  if (base === undefined) return shifts
  const own = strokes.map((s) => baselineOf([s], size, undefined, rules))
  const boxes = strokes.map(boxOfPoints)
  // Left to right, each letter judged against the letter before it as written, as a line's words are: a step within
  // LETTER_MOST is the word drifting (a slope, two words written close), and the letter comes onto the word's
  // baseline; a bigger one is a letter written so (a p's stem down to its tail), which stays.
  let before: number | undefined
  for (const i of own.map((_, k) => k).sort((a, b) => boxes[a]!.x - boxes[b]!.x)) {
    const b = own[i]
    if (b === undefined) continue
    if (Math.abs(b - (before ?? base)) > LETTER_MOST * size) continue
    before = b
    const shift = base - b
    if (Math.abs(shift) >= LEVEL_LEAST * size) shifts[i] = Math.round(shift)
  }
  // A dot, a bar or an accent goes with the letter under it: the nearest across whose width (and a little either side,
  // as an upright stem has none) takes in its middle.
  own.forEach((b, i) => {
    if (b !== undefined) return
    const middle = boxes[i]!.x + boxes[i]!.w / 2
    let best = -1
    let nearest = Infinity
    own.forEach((other, j) => {
      if (other === undefined) return
      const box = boxes[j]!
      if (middle < box.x - 0.3 * size || middle > box.x + box.w + 0.3 * size) return
      const off = Math.abs(middle - (box.x + box.w / 2))
      if (off < nearest) {
        nearest = off
        best = j
      }
    })
    if (best >= 0) shifts[i] = shifts[best]!
  })
  return shifts
}

/**
 * Words on a line evenly spaced (a test drawing: every gap the
 * same): left to right, each gap made the line's middle gap (the median, and
 * never narrower than words are apart, WORD_GAP), the first word staying; a gap
 * under 0.6 of it is left, as it may be inside a word (an i and its s written
 * apart), and so are words just touching. Words lying over each other, the
 * narrower more than half under the other, are moved apart: rowsOf found them
 * to be two, one written over or under the other (recorded "can" over "i"), and
 * on one line they would cover each other. With `right`, the line ends no
 * further right than that, or than it was written: the gap is narrowed until
 * the line fits (a test line spaced to 4 mm from the page's edge), and left as
 * written if it cannot. `gap`: the usual gap; the line's first gap between
 * words; TIGHTER or WIDER than usual; or the gaps as written, only words over
 * each other moved apart. How far across to move each word, in whole units, in
 * the order given.
 */
export function spacingShifts(words: readonly { x0: number; x1: number }[], size: number, right?: number, gap: WordGapChoice = 'usual'): number[] {
  const none = words.map(() => 0)
  if (words.length < 3) return none
  const order = words.map((_, i) => i).sort((a, b) => words[a]!.x0 - words[b]!.x0)
  const gaps = order.slice(1).map((i, k) => words[i]!.x0 - words[order[k]!]!.x1)
  const apart = gaps.filter((g) => g > 0).sort((a, b) => a - b)
  const usual = Math.max(WORD_GAP * size, apart[apart.length >> 1] ?? 0)
  const least = 0.5 * WORD_GAP * size
  // The first gap between words: not one inside a word (see below).
  const first = gaps.find((g) => g >= 0.6 * usual)
  // `written` needs a gap too: it is what words lying over each other are moved apart to.
  const chosen = { usual, first: Math.max(least, first ?? usual), tighter: Math.max(least, TIGHTER * usual), wider: WIDER * usual, written: usual }[gap]
  const shiftsFor = (target: number): number[] => {
    const shifts = words.map(() => 0)
    // Each gap's change carries on to every word after it.
    let moved = 0
    order.slice(1).forEach((i, k) => {
      const g = gaps[k]!
      // A gap well under the others (under 0.6 of them) and barely over a word's (INSIDE letter sizes) may be inside a
      // word, its letters written apart (an i and an s): widened, it would split the word, so it is left. Wider, it is
      // a gap between words, however far apart the others are (test digits, 17 October 2026).
      const narrower = Math.min(words[i]!.x1 - words[i]!.x0, words[order[k]!]!.x1 - words[order[k]!]!.x0)
      const stacked = g < 0 && -g > 0.5 * narrower
      const inside = g < 0.6 * usual && g < INSIDE * size
      if (stacked || (gap !== 'written' && g >= 0 && !inside)) moved += target - g
      shifts[i] = Math.round(moved)
    })
    return shifts
  }
  const shifts = shiftsFor(chosen)
  if (right === undefined) return shifts
  const end = (s: readonly number[]): number => Math.max(...words.map((w, i) => w.x1 + s[i]!))
  const most = Math.max(right, end(none))
  if (end(shifts) <= most) return shifts
  // Narrower gaps until the line fits, down to half a word's gap; past that, the line is left as written.
  let low = least
  if (end(shiftsFor(low)) > most) return none
  let high = chosen
  for (let step = 0; step < 24 && high - low > 1; step++) {
    const middle = (low + high) / 2
    if (end(shiftsFor(middle)) <= most) low = middle
    else high = middle
  }
  return shiftsFor(low)
}

/**
 * A word as levelling sees it: where it starts and ends across, its baseline
 * (baselineOf; none for a dot or a dash, which sit on nothing), and the
 * line's letter size.
 */
export interface LevelWord {
  x: number
  x1?: number
  baseline?: number
  size: number
}

/**
 * How far to move each word of a finished line up or down (a test
 * drawing, 17 October 2026): onto the baseline of the line's first word, the one
 * furthest left (or, as the person chooses, the line most of its words sit on, or its
 * last word's), so a slope comes level and a word written high or low comes onto the
 * line. Nothing for a word already within LEVEL_LEAST. A word with no baseline (an i's
 * dot set apart, a dash) moves as the word nearest it across: put on the line by its
 * own bottom, a dot fell onto the line. In whole units, in the order given.
 */
export function levelShifts(words: readonly LevelWord[], on: LineAnchor = 'first'): number[] {
  const shifts = words.map(() => 0)
  const sitting = words.map((_, i) => i).filter((i) => words[i]!.baseline !== undefined)
  if (words.length < 2 || sitting.length === 0) return shifts
  const sizes = words.map((w) => w.size).sort((a, b) => a - b)
  const size = sizes[sizes.length >> 1]!
  sitting.sort((a, b) => words[a]!.x - words[b]!.x)
  const bases = sitting.map((i) => words[i]!.baseline!).sort((a, b) => a - b)
  const anchor = on === 'first' ? words[sitting[0]!]!.baseline! : on === 'last' ? words[sitting.at(-1)!]!.baseline! : bases[bases.length >> 1]!
  for (const i of sitting) {
    const shift = anchor - words[i]!.baseline!
    shifts[i] = Math.abs(shift) < LEVEL_LEAST * size ? 0 : Math.round(shift)
  }
  const apart = (a: LevelWord, b: LevelWord): number => Math.max(0, a.x - (b.x1 ?? b.x), b.x - (a.x1 ?? a.x))
  words.forEach((word, i) => {
    if (word.baseline !== undefined) return
    const nearest = sitting.reduce((best, j) => (apart(word, words[j]!) < apart(word, words[best]!) ? j : best))
    shifts[i] = shifts[nearest]!
  })
  return shifts
}

/**
 * A mark (an i's dot, a t's bar, an accent), in shares of the strokes' usual
 * height: TINY or smaller; FLAT or flatter and at most WIDE long; or DOT or
 * smaller and over the letter written just before it (above its top, across it
 * within ACROSS). Size alone cannot tell: in test writing a dot drawn as a
 * little circle is 0.26 of the usual height, a short i 0.35 and a small c 0.39.
 */
const MARK = { tiny: 0.15, flat: 0.25, wide: 2.5, dot: 0.45, across: 0.3, small: 0.5 }
/**
 * A row ends where the pen goes on clear of it, in letter sizes from its
 * middle: its top BELOW under it, or its bottom DEEP under it (a tall first
 * letter of lines written close), or its bottom ABOVE over it, starting
 * BACK letters left of the row's end or within MARGIN of its start; or FAR
 * off (FAR_BELOW under, FAR_ABOVE over) wherever it starts. A long tail
 * reaches DEEP too, but where the pen is, not back to the left.
 */
const ROW = { below: 1.5, deep: 2.5, above: 4, back: 3, margin: 2, farBelow: 6, farAbove: 8 }
/** A stroke going back over a word, sharing less than this share of the shorter one's height, is another word written over or under it. */
const OVER = 0.5

/**
 * Strokes in the order written, grouped into rows and words, as indexes (pick
 * lf1, 17 October 2026; as Microsoft's ink parser and Silverbrook's line
 * extraction do, both patents expired). Where a stroke sits is not enough: a
 * word written high, or small, sat on a line of its own and was never levelled
 * with its line (recorded "is" and "can").
 *
 * - **Marks** (an i's dot, a t's bar, an accent) are set aside, then put on
 *   the word of the letter written just before them, when they are over or
 *   beside it (as an i's dot is), else of the letter nearest them.
 * - **A row** goes on while the pen stays with it; a new one starts where the
 *   pen goes clear below or above it and back to the left (a new line), or
 *   far off. A row picked up again later, level with it and beside it, is
 *   joined to it.
 * - **A word**, once the row is whole and its letter size known, is the one
 *   a stroke reaches across to within WORD_GAP letter sizes, in the order
 *   written, latest first, unless the stroke goes back over it
 *   at another height, sharing under half the height of the shorter (an i
 *   written under a raised word). Words lying over each other, across and
 *   up and down, are joined (a letter written before the one beside it).
 *
 * The letter size is each row's own band, and for the marks, the middle of
 * the strokes' own bands, so it suits small writing and large alike.
 */
export function rowsOf(strokes: readonly (readonly Pt[])[]): number[][][] {
  const boxes = strokes.map(boxOfPoints)
  const heights = strokes.map(heightsOf)
  const own = strokes.flatMap((stroke, i) => {
    const band = stroke.length > 1 ? bandOfHeights([...heights[i]!].sort((a, b) => a - b)) : undefined
    return band ? [band.size] : []
  })
  own.sort((a, b) => a - b)
  const size0 = own[own.length >> 1] ?? 3 * MM
  // The strokes' usual height, for marks: dots and bars against the letters they go with.
  const tall = boxes.map((b) => b.h).sort((a, b) => a - b)
  const usual = Math.max(tall[tall.length >> 1] ?? size0, size0)
  const marks = boxes.map((b, i) => {
    if (strokes[i]!.length === 0) return false
    const big = Math.max(b.w, b.h)
    if (big < MARK.tiny * usual || (b.h < MARK.flat * usual && b.w <= MARK.wide * usual)) return true
    if (big >= MARK.dot * usual || i === 0) return false
    const before = boxes[i - 1]!
    const cx = b.x + b.w / 2
    return b.y + b.h <= before.y + MARK.across * usual && cx >= before.x - MARK.across * usual && cx <= before.x + before.w + MARK.across * usual
  })
  const isMark = (i: number): boolean => marks[i]!
  type Word = { indexes: number[]; box: Box }
  type Row = { indexes: number[]; box: Box; band: InkBand; heights: Heights; words: Word[] }
  const rows: Row[] = []
  const sizeOf = (row: Row): number => Math.max(row.band.size, 0.5 * size0)
  // How much two boxes share, up and down, of the shorter one's height.
  const sharedHeight = (a: Box, b: Box): number => (Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)) / Math.max(1, Math.min(a.h, b.h))

  const join = (row: Row, i: number): void => {
    row.indexes.push(i)
    row.box = union(row.box, boxes[i]!)
    row.heights.add(heights[i]!)
    row.band = row.heights.band() ?? row.band
  }

  strokes.forEach((stroke, i) => {
    const box = boxes[i]!
    if (isMark(i)) return
    // Only the row being written is looked at; one picked up again later is joined to its own after this pass.
    const row = rows.at(-1)
    if (row) {
      // A row of a stroke or two says little of its letters' size: no less than 0.4 of its height.
      const size = Math.max(sizeOf(row), row.indexes.length < 3 ? 0.4 * row.box.h : 0)
      const { middle } = row.band
      const below = box.y > middle + ROW.below * size || box.y + box.h > middle + ROW.deep * size
      const above = box.y + box.h < middle - ROW.above * size
      const back = box.x < row.box.x + row.box.w - ROW.back * size || box.x <= row.box.x + ROW.margin * size
      const far = box.y > middle + ROW.farBelow * size || box.y + box.h < middle - ROW.farAbove * size
      if (!far && !((below || above) && back)) {
        join(row, i)
        return
      }
    }
    const counted = new Heights()
    counted.add(heights[i]!)
    rows.push({ indexes: [i], box, band: counted.band() ?? { size: size0, middle: box.y + box.h / 2 }, heights: counted, words: [] })
  })

  // A row picked up again later: level with an earlier one and beside it, it is that row's.
  for (let j = rows.length - 1; j > 0; j--) {
    const later = rows[j]!
    const earlier = rows.slice(0, j).find((row) => {
      const size = sizeOf(row)
      const beside = later.box.x >= row.box.x + row.box.w - size || later.box.x + later.box.w <= row.box.x + size
      return beside && Math.abs(later.band.middle - row.band.middle) <= size
    })
    if (!earlier) continue
    earlier.indexes.push(...later.indexes)
    earlier.box = union(earlier.box, later.box)
    for (const k of later.indexes) earlier.heights.add(heights[k]!)
    earlier.band = earlier.heights.band() ?? earlier.band
    rows.splice(j, 1)
  }

  // The words of each whole row, at its letter size; then words lying over each other are one (a letter written before
  // the one beside it).
  for (const row of rows) {
    const size = sizeOf(row)
    const gap = WORD_GAP * size
    for (const i of row.indexes) {
      const box = boxes[i]!
      const word = [...row.words].reverse().find((w) => {
        if (box.x > w.box.x + w.box.w + gap || box.x + box.w < w.box.x - gap) return false
        return box.x >= w.box.x + w.box.w - 0.2 * size || sharedHeight(box, w.box) >= OVER
      })
      if (word) {
        word.indexes.push(i)
        word.box = union(word.box, box)
      } else row.words.push({ indexes: [i], box })
    }
    for (let a = 0; a < row.words.length; a++) {
      for (let b = a + 1; b < row.words.length; b++) {
        const p = row.words[a]!
        const q = row.words[b]!
        const across = Math.min(p.box.x + p.box.w, q.box.x + q.box.w) - Math.max(p.box.x, q.box.x)
        if (across <= 0.5 * Math.min(p.box.w, q.box.w) || sharedHeight(p.box, q.box) < OVER) continue
        p.indexes.push(...q.indexes)
        p.box = union(p.box, q.box)
        row.words.splice(b, 1)
        // `p` has grown: every later word is looked at again.
        b = a
      }
    }
  }

  // The marks: onto the word of the letter written just before, when over or beside it (an i's dot, written after its
  // stem, may be as near the next letter); else of the letter nearest them, across, and up or down at half the weight.
  const wordOf = new Map<number, Word>()
  for (const row of rows) for (const w of row.words) for (const k of w.indexes) wordOf.set(k, w)
  const sizeAt = new Map<Word, number>()
  for (const row of rows) for (const w of row.words) sizeAt.set(w, sizeOf(row))
  const away = (mark: Box, k: number): number => {
    const b = boxes[k]!
    const cx = mark.x + mark.w / 2
    const cy = mark.y + mark.h / 2
    const size = sizeAt.get(wordOf.get(k)!)!
    return Math.max(0, b.x - cx, cx - (b.x + b.w)) / size + Math.max(0, b.y - cy, cy - (b.y + b.h)) / (2 * size)
  }
  strokes.forEach((_, i) => {
    const box = boxes[i]!
    if (!isMark(i)) return
    let before = i - 1
    while (before >= 0 && !wordOf.has(before)) before--
    let best: Word | undefined = before >= 0 && away(box, before) <= 1 ? wordOf.get(before) : undefined
    let nearest = Infinity
    if (!best) {
      for (const [k, w] of wordOf) {
        const d = away(box, k)
        if (d < nearest) {
          nearest = d
          best = w
        }
      }
    }
    if (best) best.indexes.push(i)
    else rows.push({ indexes: [i], box, band: { size: size0, middle: box.y + box.h / 2 }, heights: new Heights(), words: [{ indexes: [i], box }] })
  })
  return rows.map((row) => row.words.map((w) => [...w.indexes].sort((a, b) => a - b)))
}

function boxOfPoints(points: readonly Pt[]): Box {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const pt of points) {
    minX = Math.min(minX, pt.x)
    minY = Math.min(minY, pt.y)
    maxX = Math.max(maxX, pt.x)
    maxY = Math.max(maxY, pt.y)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}
