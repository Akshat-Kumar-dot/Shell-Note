// The side panel's timer, its clock: kept by when it started, in the person's
// browser, and loaded with the editor, so a countdown ends with its beep even before the side panel is first opened.
import { Shared } from '../../video/state.js'

export interface Timer {
  mode: 'stopwatch' | 'countdown'
  /** The countdown's length, in seconds. */
  length: number
  /** Running since (ms since 1970), with what had gone by before; or stopped, with what had gone by. */
  since?: number | undefined
  gone: number
}

const KEY = 'shellnote:timer'

function read(): Timer {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Timer> | null
    if (saved && (saved.mode === 'stopwatch' || saved.mode === 'countdown') && typeof saved.length === 'number' && typeof saved.gone === 'number') {
      return { mode: saved.mode, length: saved.length, gone: saved.gone, since: typeof saved.since === 'number' ? saved.since : undefined }
    }
  } catch {
    // Storage is off: a fresh timer.
  }
  return { mode: 'countdown', length: 25 * 60, gone: 0 }
}

export const timer = new Shared<Timer>(read())
export function keep(next: Timer): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Storage is off: it lasts until the page closes.
  }
  timer.set(next)
}

/** Seconds gone by on the timer now. */
export const goneNow = (t: Timer, now: number): number => t.gone + (t.since === undefined ? 0 : (now - t.since) / 1000)

export const clock = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds))
  const [h, m, r] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
  const two = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(r)}` : `${two(m)}:${two(r)}`
}

/** A soft beep, made by the browser: no sound file. */
function beep(): void {
  try {
    const audio = new AudioContext()
    for (const at of [0, 0.35, 0.7]) {
      const tone = audio.createOscillator()
      const gain = audio.createGain()
      tone.frequency.value = 880
      gain.gain.setValueAtTime(0.0001, audio.currentTime + at)
      gain.gain.exponentialRampToValueAtTime(0.2, audio.currentTime + at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + at + 0.25)
      tone.connect(gain).connect(audio.destination)
      tone.start(audio.currentTime + at)
      tone.stop(audio.currentTime + at + 0.3)
    }
    window.setTimeout(() => void audio.close(), 1500)
  } catch {
    // No sound here: the timer shows it is done.
  }
}

// A countdown ends once, beeping, even with the panel closed.
let watching = 0
export function watch(): void {
  window.clearInterval(watching)
  const t = timer.value
  if (t.mode !== 'countdown' || t.since === undefined) return
  watching = window.setInterval(() => {
    const now = timer.value
    if (now.mode !== 'countdown' || now.since === undefined) return window.clearInterval(watching)
    if (goneNow(now, Date.now()) >= now.length) {
      window.clearInterval(watching)
      keep({ ...now, since: undefined, gone: now.length })
      beep()
    }
  }, 250)
}
if (typeof window !== 'undefined') watch()

