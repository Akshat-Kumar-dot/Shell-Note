// The side panel's timer: a stopwatch, or a countdown for a stretch of study
// (5, 25 or 50 minutes, or any), with a soft beep at its end. It runs on while the panel is closed, kept by the time
// it started, in the person's browser.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { commands } from '../../commands/index.js'
import { clock, goneNow, timer } from './timer.js'

const PRESETS = [5, 25, 50]

export function TimerTab() {
  const t = useSyncExternalStore(timer.subscribe, timer.snapshot)
  const [now, setNow] = useState(Date.now())
  const [minutes, setMinutes] = useState(String(Math.round(t.length / 60)))
  // A length set elsewhere (the agent's timer.countdown) shows in the box too.
  useEffect(() => setMinutes(String(Math.round(t.length / 60))), [t.length])
  useEffect(() => {
    if (t.since === undefined) return
    const every = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(every)
  }, [t.since])
  const running = t.since !== undefined
  const gone = goneNow(t, running ? now : 0)
  const shown = t.mode === 'countdown' ? t.length - gone : gone
  const done = t.mode === 'countdown' && !running && gone >= t.length

  const start = (): void => commands.tap('timer.start')
  const pause = (): void => commands.tap('timer.pause')
  const reset = (): void => commands.tap('timer.stop')
  const setLength = (mins: number): void => {
    if (!(mins > 0)) return
    setMinutes(String(mins))
    commands.tap('timer.countdown', { minutes: mins })
  }

  return (
    <div className="nw-timer">
      <div className="nw-timer-modes" role="radiogroup" aria-label="Timer">
        {(['countdown', 'stopwatch'] as const).map((mode) => (
          <button key={mode} type="button" role="radio" aria-checked={t.mode === mode} className="nw-side-tab" data-command={`timer.${mode}`} onClick={() => commands.tap(`timer.${mode}`)}>
            {mode === 'countdown' ? 'Countdown' : 'Stopwatch'}
          </button>
        ))}
      </div>
      <output className="nw-timer-time" data-done={done ? '' : undefined} aria-live={done ? 'assertive' : 'off'} aria-label={done ? 'Time is up' : 'Time'}>
        {done ? 'Time is up' : clock(shown)}
      </output>
      {t.mode === 'countdown' ? (
        <div className="nw-timer-presets">
          {PRESETS.map((mins) => (
            <button key={mins} type="button" className="nw-video-add" aria-pressed={t.length === mins * 60} data-command="timer.countdown" onClick={() => setLength(mins)}>
              {mins} min
            </button>
          ))}
          <label className="nw-timer-own">
            <input type="number" min={1} max={600} value={minutes} aria-label="Minutes" data-command="timer.countdown" onChange={(event) => setMinutes(event.target.value)} onBlur={() => setLength(Number(minutes))} onKeyDown={(event) => event.key === 'Enter' && setLength(Number(minutes))} /> min
          </label>
        </div>
      ) : null}
      <div className="nw-timer-buttons">
        {running ? (
          <button type="button" className="nw-video-add" data-command="timer.pause" onClick={pause}>
            Pause
          </button>
        ) : (
          <button type="button" className="nw-video-add" data-command="timer.start" onClick={start}>
            {done || gone === 0 ? 'Start' : 'Go on'}
          </button>
        )}
        <button type="button" className="nw-video-add" disabled={gone === 0 && !running} data-command="timer.stop" onClick={reset}>
          Reset
        </button>
      </div>
    </div>
  )
}
