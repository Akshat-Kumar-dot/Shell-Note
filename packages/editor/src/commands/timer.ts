// The study timer as commands (app control, step 3c): each does what its button
// in the side panel's Timer tab did, and the buttons call them. The timer runs
// on whether the tab is open or not, so the commands need nothing on screen.
import { clock, goneNow, keep, timer, watch, type Timer } from '../layout/side/timer.js'
import type { Commands } from './run.js'

const lengthWords = (t: Timer): string => `${clock(t.length)}`

/** Whether a countdown has run to its end. */
const ended = (t: Timer, now: number): boolean => t.mode === 'countdown' && t.since === undefined && goneNow(t, now) >= t.length

export function defineTimer(commands: Commands): void {
  commands.define('timer.start', [], ({ minutes }) => {
    const t = timer.value
    const now = Date.now()
    if (typeof minutes === 'number') {
      keep({ mode: 'countdown', length: Math.round(minutes * 60), since: now, gone: 0 })
      watch()
      return `countdown of ${lengthWords(timer.value)} started`
    }
    if (t.since !== undefined) return `the timer is running already: ${timerLine()}`
    const fresh = ended(t, now) || t.gone === 0
    keep({ ...t, since: now, gone: ended(t, now) ? 0 : t.gone })
    watch()
    return fresh ? `${t.mode === 'countdown' ? `countdown of ${lengthWords(t)}` : 'stopwatch'} started` : `timer going on from ${clock(t.gone)}`
  })
  commands.define('timer.pause', [], () => {
    const t = timer.value
    if (t.since === undefined) return 'the timer is not running'
    keep({ ...t, since: undefined, gone: goneNow(t, Date.now()) })
    return `timer paused: ${timerLine()}`
  })
  commands.define('timer.stop', [], () => {
    keep({ ...timer.value, since: undefined, gone: 0 })
    return 'timer stopped and set back to zero'
  })
  commands.define('timer.countdown', [], ({ minutes }) => {
    const t = timer.value
    keep({ ...t, mode: 'countdown', length: typeof minutes === 'number' ? Math.round(minutes * 60) : t.length, since: undefined, gone: 0 })
    return `countdown of ${lengthWords(timer.value)}, ready: timer.start starts it`
  })
  commands.define('timer.stopwatch', [], () => {
    keep({ ...timer.value, mode: 'stopwatch', since: undefined, gone: 0 })
    return 'stopwatch, ready: timer.start starts it'
  })
}

/** The timer's line of the app-state map. */
export function timerLine(now = Date.now()): string {
  const t = timer.value
  const gone = goneNow(t, now)
  if (t.mode === 'stopwatch') return `timer: stopwatch at ${clock(gone)}, ${t.since !== undefined ? 'running' : gone > 0 ? 'paused' : 'not started'}`
  if (ended(t, now)) return `timer: countdown of ${lengthWords(t)}, time is up`
  return `timer: countdown of ${lengthWords(t)}, ${clock(t.length - gone)} left, ${t.since !== undefined ? 'running' : gone > 0 ? 'paused' : 'not started'}`
}
