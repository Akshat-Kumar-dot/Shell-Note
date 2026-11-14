// Which of the note's videos is shown (where its panel is, the workspace keeps: layout/state.ts), and its clock: the
// time the pen reads and a tap seeks.
import type { Id } from '@shellnote/core'

/** A value shared by the panel, the pen and the bar, with listeners. */
export class Shared<T> {
  readonly #listeners = new Set<() => void>()
  constructor(public value: T) {}
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }
  snapshot = (): T => this.value
  set(value: T): void {
    this.value = value
    for (const listener of [...this.#listeners]) listener()
  }
}

/** YouTube's player is never smaller than 200 by 200 pixels (its terms); the workspace keeps the panel at least so. */
export const MIN_VIDEO = 200

/** The note's video shown in the panel; none, the panel closed. */
export const videoShown = new Shared<Id | undefined>(undefined)

/** The shown video's clock, once its player is ready: what the pen reads, what a tap seeks. */
export interface VideoClock {
  media: Id
  /** Where the video is, in seconds. */
  time(): number
  seek(seconds: number): void
  playing(): boolean
  play(): void
  pause(): void
  /** How long the video is, in seconds, once the player knows. */
  duration?(): number
}
export const videoClock = new Shared<VideoClock | undefined>(undefined)

/**
 * Where the shown video is, for a stroke written beside it (`vt`): its id and the time in tenths of a second.
 * None when no video is shown, or it has not been started yet.
 */
export function videoTime(): { m: Id; t: number } | undefined {
  const clock = videoClock.value
  if (!clock) return undefined
  const seconds = clock.time()
  if (!Number.isFinite(seconds) || (seconds <= 0 && !clock.playing())) return undefined
  return { m: clock.media, t: Math.max(0, Math.round(seconds * 10)) }
}

/** Whether the ⏱ beside lines show: each person's own, kept in their browser. */
const TIMES_KEY = 'shellnote:video-times'
function readTimesShown(): boolean {
  try {
    return localStorage.getItem(TIMES_KEY) !== 'off'
  } catch {
    return true
  }
}
export const timesShown = new Shared(readTimesShown())
export function setTimesShown(shown: boolean): void {
  try {
    localStorage.setItem(TIMES_KEY, shown ? 'on' : 'off')
  } catch {
    // Storage is off: it lasts until the page closes.
  }
  timesShown.set(shown)
}

/** A YouTube player stepped aside, paused and hidden, while something of ours is over it (stepAside.ts). */
export const videoCovered = new Shared(false)

/** A seek asked for before the video's player was ready (a ⏱ tapped with the panel closed): done once it is, played or not. */
let waiting: { media: Id; seconds: number; play: boolean } | undefined
videoClock.subscribe(() => {
  const clock = videoClock.value
  if (!clock || waiting?.media !== clock.media) return
  const { seconds, play } = waiting
  waiting = undefined
  clock.seek(seconds)
  if (play && !videoCovered.value) clock.play()
})

/** A part played to its end (a ▶ mark): the video pauses there. */
let until: { media: Id; seconds: number } | undefined
let watching = 0
/** How late past a part's end the video may be found and still be paused there; further on, it was moved on purpose. */
const PAST_END = 1.5

function watchTheEnd(): void {
  window.clearInterval(watching)
  if (!until) return
  watching = window.setInterval(() => {
    const clock = videoClock.value
    if (!until) {
      window.clearInterval(watching)
      return
    }
    if (clock?.media !== until.media || waiting) return
    const now = clock.time()
    if (now >= until.seconds - 0.05 && now <= until.seconds + PAST_END) {
      clock.pause()
      until = undefined
      window.clearInterval(watching)
    }
  }, 200)
}

/**
 * Show `media` in the panel and play it from `seconds` (a ⏱ beside a line); with `to`, only to there (a ▶
 * mark), where it pauses.
 */
export function seekVideo(media: Id, seconds: number, to?: number): void {
  until = to === undefined ? undefined : { media, seconds: to }
  watchTheEnd()
  videoShown.set(media)
  const clock = videoClock.value
  if (clock?.media !== media) {
    waiting = { media, seconds, play: true }
    return
  }
  clock.seek(seconds)
  if (!videoCovered.value) clock.play()
}

/** Show `media` in the panel at `seconds`, not played (video.seek of another of the note's videos). */
export function moveVideo(media: Id, seconds: number): void {
  videoShown.set(media)
  const clock = videoClock.value
  if (clock?.media !== media) {
    waiting = { media, seconds, play: false }
    return
  }
  clock.seek(seconds)
}

/** What is done before a video plays: the panel it is kept in opened, so it is never played unseen (layout/beside.ts). */
export const playHook: { before: () => void } = { before: () => undefined }

/** Play or pause the shown video (video.play, video.pause); stepped aside, it waits. False when no player is ready. */
export function playVideo(play: boolean): boolean {
  const clock = videoClock.value
  if (!clock) return false
  if (videoCovered.value) return true
  // Played on by hand, a part's end no longer stops it.
  until = undefined
  if (play) playHook.before()
  if (play) clock.play()
  else clock.pause()
  return true
}

/** Pause or play the shown video (the pause key, Ctrl+Shift+Space). */
export function toggleVideo(): boolean {
  const clock = videoClock.value
  return clock ? playVideo(!clock.playing()) : false
}

/** A hard part being marked (video.mark, the panel's flag): where in which video it began, in seconds. */
export const hardPart = new Shared<{ media: Id; from: number } | undefined>(undefined)
