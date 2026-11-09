// Palm rejection, iPad-style. The system does much already: iPadOS stops finger
// events while the Pencil is down, and Windows ignores touch while a pen is
// near. On top of that, these rules, cheapest first. Plain logic, fed the
// pointer events' type, size and time, so it is tested with recorded sequences
// rather than by hand only.
import type { PenSettings } from '@shellnote/core'

/** What the rules need to know of a touch. Sizes are CSS pixels; time is milliseconds. */
export interface Contact {
  width: number
  height: number
  timeStamp: number
}

/** A palm lands just before and just after writing: touches this soon after the pen lifts or leaves are ignored. */
export const AFTER_PEN = 300
/** A contact wider than this, in CSS pixels (about 11 mm), is a palm, not a fingertip. */
export const PALM_SIZE = 40
/** A finger stroke the pen follows this soon after it began was a palm: it is taken back. */
export const LATE_CANCEL = 150

export class PalmRules {
  /** A pen has been seen since the page opened: in the automatic mode, fingers stop drawing. */
  penSeen = false
  #penDown = false
  #penLastAt = -Infinity

  constructor(public mode: PenSettings['penOnly']) {}

  /**
   * The pen touched, moved or hovered, lifted, or left, at a time. A pen
   * hovering still sends nothing, and some never say they left, so nearness
   * counts only from the pen's last event.
   */
  pen(state: 'down' | 'move' | 'up' | 'leave', timeStamp: number): void {
    this.penSeen = true
    this.#penLastAt = timeStamp
    if (state === 'down') this.#penDown = true
    if (state === 'up' || state === 'leave') this.#penDown = false
  }

  /** Whether the pen is down, or was down or near a moment ago: every touch then is the hand that holds it. */
  penBusy(timeStamp: number): boolean {
    return this.#penDown || timeStamp - this.#penLastAt < AFTER_PEN
  }

  /** A touch to ignore altogether, neither drawing nor scrolling: a big contact, or any touch while the pen is busy. */
  isPalm(touch: Contact): boolean {
    return this.penBusy(touch.timeStamp) || Math.max(touch.width, touch.height) > PALM_SIZE
  }

  /** Whether a finger draws, when it is no palm; otherwise it scrolls and zooms. */
  fingerDraws(touch: Contact): boolean {
    if (this.isPalm(touch)) return false
    if (this.mode === 'always') return false
    if (this.mode === 'auto' && this.penSeen) return false
    return true
  }

  /** A finger stroke begun at `began` is taken back when the pen comes down at `penAt` soon after (Android's late cancel). */
  static lateCancel(began: number, penAt: number): boolean {
    return penAt >= began && penAt - began <= LATE_CANCEL
  }
}
