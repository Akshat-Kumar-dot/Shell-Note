// The stroke being written, cut into the stretches the live layer draws
// (render.ts), exactly as the stroke will be kept and drawn when the pen lifts
// (core's finish, then strokeWidths and stretchesOf), so lifting changes
// nothing. A stroke is kept in chunks of KEEP_CHUNK points (the pen review's
// R1, 16 October 2026): a chunk the pen has moved past is final, so it is kept
// and cut into stretches once, and each pen move works out only the stroke's
// end, from a copy. Before, every move worked out the whole stroke again: 5 ms
// a move by 3,000 points, behind a 240 Hz pen.
import { KEEP_CHUNK, keptIndexes, pointWidth, sizeOf, type Stroke, type TimedPt } from '@shellnote/core'
import { Stretches, type Stretch } from './render.js'

export class LiveLine {
  readonly #look: Pick<Stroke, 'tool' | 'width'>
  /** Where the final part ends, in the stroke's points: a multiple of KEEP_CHUNK, its point included in `#settled`. */
  #upTo = 0
  readonly #settled: Stretches

  constructor(look: Pick<Stroke, 'tool' | 'width'>) {
    this.#look = look
    this.#settled = new Stretches(sizeOf(look))
  }

  /**
   * The stretches to draw: `points`, with their (a pencil's) `tilts`, as far
   * as the pen has written them, which only grow; then `end`, the line's end
   * as lifting now would leave it, at `tilt`.
   */
  stretches(points: readonly TimedPt[], tilts: readonly number[], end: readonly TimedPt[], tilt: number): Stretch[] {
    while (this.#upTo + KEEP_CHUNK < points.length) {
      const kept = keptIndexes(points, this.#upTo, this.#upTo + KEEP_CHUNK)
      for (const i of this.#upTo === 0 ? kept : kept.slice(1)) this.#add(this.#settled, points[i]!, tilts[i] ?? tilt)
      this.#upTo += KEEP_CHUNK
    }
    const tail = [...points.slice(this.#upTo), ...end]
    const out = this.#settled.copy()
    const kept = keptIndexes(tail)
    for (const k of this.#upTo === 0 ? kept : kept.slice(1)) this.#add(out, tail[k]!, tilts[this.#upTo + k] ?? tilt)
    return out.done()
  }

  /** A kept point, as the page draws it: in whole units, as wide as its pressure and tilt, as kept, make it. */
  #add(stretches: Stretches, pt: TimedPt, tilt: number): void {
    stretches.add({ x: Math.round(pt.x), y: Math.round(pt.y) }, pointWidth(this.#look, Math.max(0, Math.min(255, Math.round(pt.p))), tilt))
  }
}
