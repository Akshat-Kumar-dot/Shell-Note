// Smooth ink that is never late.
//
// While the pen moves: first the 1€ filter (Casiez, Roussel and Vogel, CHI
// 2012), a low-pass filter whose cutoff rises with speed, against the sensor's
// jitter; then the pen tip as a weight on a spring (StrokeModel, below), which
// gives handwriting its smooth curves. The 1€ filter smooths a slow pen,
// where jitter shows and lag does not, a lot, and a fast one hardly at all.
// The editor draws on from the smoothed line to the pen's tip, and a frame of
// prediction past it, so the line under the pen is never behind it.
//
// When the pen lifts: points that add nothing go (simplify), so a stroke is
// small to keep and quick to draw, and it stays exactly where it was drawn.
import { simplifyIndexes, type Pt } from './geometry.js'

/** A timed point, as the pen gives them: t in milliseconds. */
export interface TimedPt extends Pt {
  t: number
}

/** The settings of one smoothing level: the cutoff at rest (Hz) and how fast it rises with speed. 0 is off. */
export const SMOOTHING: readonly ({ minCutoff: number; beta: number } | undefined)[] = [
  undefined,
  { minCutoff: 3, beta: 0.02 },
  { minCutoff: 1.5, beta: 0.01 },
  { minCutoff: 0.8, beta: 0.006 },
]

const alpha = (cutoff: number, dt: number): number => {
  const tau = 1 / (2 * Math.PI * cutoff)
  return 1 / (1 + tau / dt)
}

/** The 1€ filter for one value. */
export class OneEuro {
  #x: number | undefined
  #dx = 0
  #t = 0

  constructor(
    readonly minCutoff: number,
    readonly beta: number,
    readonly dCutoff = 1,
  ) {}

  /** The filtered value at time `t`, in milliseconds. */
  filter(value: number, t: number): number {
    if (this.#x === undefined) {
      this.#x = value
      this.#t = t
      return value
    }
    // Events can arrive with the same time stamp; count at least a quarter millisecond.
    const dt = Math.max(0.00025, (t - this.#t) / 1000)
    this.#t = t
    const dx = (value - this.#x) / dt
    this.#dx += alpha(this.dCutoff, dt) * (dx - this.#dx)
    const cutoff = this.minCutoff + this.beta * Math.abs(this.#dx)
    this.#x += alpha(cutoff, dt) * (value - this.#x)
    return this.#x
  }
}

/** Smooths a pen's points as they come, at a smoothing level from 0 (off) to 3. */
export class PointFilter {
  readonly #x: OneEuro | undefined
  readonly #y: OneEuro | undefined
  #p: number | undefined

  constructor(level: number) {
    const settings = SMOOTHING[Math.max(0, Math.min(3, Math.round(level)))]
    this.#x = settings && new OneEuro(settings.minCutoff, settings.beta)
    this.#y = settings && new OneEuro(settings.minCutoff, settings.beta)
  }

  add(pt: TimedPt): TimedPt {
    // Pressure jumps from one reading to the next would show as blobs: a light, steady blend.
    this.#p = this.#p === undefined ? pt.p : this.#p + 0.5 * (pt.p - this.#p)
    if (!this.#x || !this.#y) return { ...pt, p: this.#p }
    return { x: this.#x.filter(pt.x, pt.t), y: this.#y.filter(pt.y, pt.t), p: this.#p, t: pt.t }
  }
}

/**
 * Where the pen will be `ahead` milliseconds from its last point, from the
 * speed and turn of its last few points: drawn for one frame and thrown away,
 * as Apple's predicted touches are. Undefined with too few points.
 */
/** How far a guess past the pen may go: never further than the pen went in its last step, times the frames ahead. A guess, not a jump. */
function reach(b: TimedPt, c: TimedPt, ahead: number): number {
  return Math.hypot(c.x - b.x, c.y - b.y) * Math.max(1, ahead / Math.max(1, c.t - b.t))
}

/**
 * A guess past the pen made elsewhere (the browser's predicted events), held
 * to the rule predict keeps for its own: as far as `reach`, in the guess's
 * direction. WebView2 once guessed 9,773 px past the pen, when two samples
 * came almost at once (18 October 2026): drawn, a streak across the page that
 * lifting took back.
 */
export function heldBack(points: readonly TimedPt[], guess: { x: number; y: number }, ahead: number): { x: number; y: number } {
  const c = points.at(-1)
  const b = points.at(-2)
  if (!c || !b) return c ? { x: c.x, y: c.y } : guess
  const limit = reach(b, c, ahead)
  const far = Math.hypot(guess.x - c.x, guess.y - c.y)
  return far <= limit ? guess : { x: c.x + ((guess.x - c.x) * limit) / far, y: c.y + ((guess.y - c.y) * limit) / far }
}

export function predict(points: readonly TimedPt[], ahead: number): TimedPt | undefined {
  if (points.length < 3) return undefined
  const c = points.at(-1)!
  const b = points.at(-2)!
  const a = points.at(-3)!
  const dt1 = Math.max(1, b.t - a.t)
  const dt2 = Math.max(1, c.t - b.t)
  const vx = (c.x - b.x) / dt2
  const vy = (c.y - b.y) / dt2
  // Half of the change in speed: a curve keeps curving, a little.
  const ax = ((c.x - b.x) / dt2 - (b.x - a.x) / dt1) / ((dt1 + dt2) / 2) / 2
  const ay = ((c.y - b.y) / dt2 - (b.y - a.y) / dt1) / ((dt1 + dt2) / 2) / 2
  const limit = reach(b, c, ahead)
  let dx = vx * ahead + ax * ahead * ahead
  let dy = vy * ahead + ay * ahead * ahead
  const length = Math.hypot(dx, dy)
  if (length > limit && length > 0) {
    dx *= limit / length
    dy *= limit / length
  }
  return { x: c.x + dx, y: c.y + dy, p: c.p, t: c.t + ahead }
}

// ----- the pen tip on a spring -------------------------------------------------------------------

/**
 * How soft the spring is at each smoothing level: how fast it follows (its
 * natural frequency, Hz) and how damped it is. Level 0 has none: the line is
 * where the pen was. It trails the pen by about 2 × damping / (2π × Hz):
 * 17 ms at level 1, 25 at 2, 37 at 3, which the live layer bridges by drawing
 * straight on to the pen's tip.
 */
export const SPRINGS: readonly ({ hz: number; damping: number } | undefined)[] = [undefined, { hz: 14, damping: 0.75 }, { hz: 9, damping: 0.7 }, { hz: 6, damping: 0.7 }]

/** The model takes a step at least this often, in milliseconds (180 a second), whatever rate the pen sends at. */
const STEP = 1000 / 180

/**
 * The line as a weight on a spring, pulled along by the pen (the position
 * model of Google's Ink Stroke Modeler, Apache-2.0, written fresh here from
 * its published description): a ≈ ω²(pen − tip) − 2ζω·v, stepped at least 180
 * times a second, the pen's position between its samples taken on a straight
 * line. Jitter and wobble the hand did not mean are ironed out, curves come
 * out round, and at the lift the tip catches up and ends exactly where the
 * pen left the paper. Pressure is taken at each step as the pen gave it.
 */
export class StrokeModel {
  readonly #spring: { w2: number; drag: number } | undefined
  #tip: { x: number; y: number } | undefined
  #speed = { x: 0, y: 0 }
  #pen: TimedPt | undefined

  constructor(level: number) {
    const spring = SPRINGS[Math.max(0, Math.min(3, Math.round(level)))]
    const omega = spring ? 2 * Math.PI * spring.hz : 0
    this.#spring = spring && { w2: omega * omega, drag: 2 * spring.damping * omega }
  }

  /** One step of `h` seconds towards the pen at `to`. */
  #step(to: { x: number; y: number }, h: number): void {
    const { w2, drag } = this.#spring!
    const tip = this.#tip!
    this.#speed = { x: this.#speed.x + h * (w2 * (to.x - tip.x) - drag * this.#speed.x), y: this.#speed.y + h * (w2 * (to.y - tip.y) - drag * this.#speed.y) }
    this.#tip = { x: tip.x + h * this.#speed.x, y: tip.y + h * this.#speed.y }
  }

  /** The pen's next point; gives the line's new points, up to that moment. */
  add(pen: TimedPt): TimedPt[] {
    const before = this.#pen
    this.#pen = pen
    if (!this.#spring) return [{ ...pen }]
    if (!before || !this.#tip) {
      this.#tip = { x: pen.x, y: pen.y }
      return [{ ...pen }]
    }
    const span = Math.max(0.25, pen.t - before.t)
    const steps = Math.max(1, Math.ceil(span / STEP))
    const out: TimedPt[] = []
    for (let s = 1; s <= steps; s++) {
      const f = s / steps
      this.#step({ x: before.x + (pen.x - before.x) * f, y: before.y + (pen.y - before.y) * f }, span / steps / 1000)
      out.push({ x: this.#tip!.x, y: this.#tip!.y, p: before.p + (pen.p - before.p) * f, t: before.t + (pen.t - before.t) * f })
    }
    return out
  }

  /**
   * The line's end as it would be if the pen lifted now, the model left as
   * it is: what the live layer shows past the line while the pen is down, so
   * that lifting changes nothing (the stroke-end prediction of Google's Ink
   * Stroke Modeler).
   */
  preview(): TimedPt[] {
    const tip = this.#tip
    const speed = this.#speed
    const end = this.finish()
    this.#tip = tip
    this.#speed = speed
    return end
  }

  /**
   * The pen lifted: the tip's last steps to it, halving a step that would
   * overshoot, then the pen's last point itself, so the line ends exactly
   * where the pen did.
   */
  finish(): TimedPt[] {
    const pen = this.#pen
    if (!this.#spring || !pen || !this.#tip) return []
    const out: TimedPt[] = []
    let h = STEP / 1000
    for (let i = 0; i < 20; i++) {
      const tip: { x: number; y: number } = this.#tip
      const away = Math.hypot(pen.x - tip.x, pen.y - tip.y)
      if (away <= 1) break
      const speed = this.#speed
      this.#step(pen, h)
      const now: { x: number; y: number } = this.#tip
      if (Math.hypot(pen.x - now.x, pen.y - now.y) > away) {
        // It would go past the pen: try again with half the step.
        this.#tip = tip
        this.#speed = speed
        h /= 2
        continue
      }
      out.push({ x: now.x, y: now.y, p: pen.p, t: pen.t })
    }
    out.push({ ...pen })
    return out
  }
}

/** How far a point may be from the line through its neighbours and still go, when a stroke is kept: 0.01 mm, so the kept line is the one drawn live, even at 400 %. */
export const KEEP_TOLERANCE = 1

/**
 * How far a point's pressure may be from the blend of its neighbours' and
 * still go: 4 of 255, about 3 % of a stroke's width, so the kept stroke is as
 * wide everywhere as the one drawn live.
 */
export const KEEP_PRESSURE = 4

/**
 * A stroke is simplified in chunks of this many points, each on its own, its
 * two ends kept (the pen review's R1, 16 October 2026). A chunk the pen has
 * moved past then never changes, so the live layer works it out once and,
 * pen move after pen move, only the stroke's end: before, it simplified the
 * whole stroke on every move, 1.5 ms by 3,000 points. It keeps one point
 * more every 128, each within the same 0.01 mm.
 */
export const KEEP_CHUNK = 128

/**
 * The indexes of the points a stroke keeps, from `from` (the start of a
 * chunk) to `to`: only those that change its line or its width.
 */
export function keptIndexes(points: readonly Pt[], from = 0, to = points.length - 1): number[] {
  if (to < from) return []
  const out: number[] = [from]
  for (let start = from; start < to; start += KEEP_CHUNK) {
    const chunk = simplifyIndexes(points, start, Math.min(to, start + KEEP_CHUNK), KEEP_TOLERANCE, KEEP_PRESSURE)
    for (let k = 1; k < chunk.length; k++) out.push(chunk[k]!)
  }
  return out
}

/** A finished stroke's points, ready to keep: only those that change its line or its width. */
export function finish(points: readonly Pt[]): Pt[] {
  return keptIndexes(points).map((i) => points[i]!)
}
