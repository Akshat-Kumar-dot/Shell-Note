// The stroke recorder, opened with ?record=strokes: a writer draws what it
// asks, one thing at a time, on a sheet at real size, with their own pen, and
// it keeps every sample the pen sent (position, pressure, tilt, time, contact
// size), as the hardware gave it. The download becomes the ink tests' fixtures
// (packages/core/test/ink/fixtures/), so shapes, symbols, scratch-outs, palms
// and pressure are tuned on a real hand, not only on made-up strokes. "Teach my
// pen" makes the person's pen profile from it at once: from then on the pen
// follows their own symbols, shapes, lines and scratch-outs (core's learn.ts),
// and a recording downloaded earlier, or on another device, can teach it too.
// Progress is kept in the library in this browser, one ask at a time
// (progress.ts), so a session can stop and go on later.
import { Recording as RecordingFile, recordedExamples, SHAPE_LABELS, SYMBOL_LABELS, taughtProfile, type InkLabel, type PenExample } from '@shellnote/core'
import { inDesktopApp, myPenSettings, penProfile } from '@shellnote/editor'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { dropItems, keepItems, loadRecording, type Recorded, type Recording, type Sample } from './progress.js'

/**
 * One thing to draw: what it is, what to ask, how many, and how it goes on:
 * as the pen lifts (one stroke), after a short pause (a letter, which may
 * take a few strokes), or when Next is pressed.
 */
interface Ask {
  kind: string
  ask: string
  count: number
  goes: 'lift' | 'pause' | 'next'
}

const shape = (kind: string, ask: string, count = 8): Ask => ({ kind, ask, count, goes: 'lift' })
const many = (kind: string, ask: string, count: number): Ask => ({ kind, ask, count, goes: 'next' })
const glyph = (kind: string, ask: string, count: number): Ask => ({ kind, ask, count, goes: 'pause' })

/**
 * A recorded alphabet, for writing the AI's words in their own hand: each
 * letter and digit three times, as written in words, and the 25 commonest pairs
 * of letters written joined.
 */
const LOWER = 'abcdefghijklmnopqrstuvwxyz'
const PAIRS = ['th', 'he', 'in', 'er', 'an', 're', 'on', 'at', 'en', 'nd', 'ti', 'es', 'or', 'te', 'of', 'ed', 'is', 'it', 'al', 'ar', 'st', 'to', 'nt', 'ng', 'se']
const ALPHABET: readonly Ask[] = [
  ...[...LOWER].map((c) => glyph(`glyph-${c}`, `the small letter ${c}, as you write it in a word`, 3)),
  ...[...LOWER.toUpperCase()].map((c) => glyph(`glyph-${c}`, `the capital letter ${c}`, 3)),
  ...[...'0123456789'].map((c) => glyph(`glyph-${c}`, `the digit ${c}`, 3)),
  ...PAIRS.map((pair) => glyph(`pair-${pair}`, `the letters ${pair} joined, as in a word`, 2)),
]

/** Everything to draw, in order: about 500, 35 to 45 minutes, in as many sittings as you like. */
export const ASKS: readonly Ask[] = [
  shape('line', 'a straight line, any direction, then lift', 12),
  shape('line-held', 'a straight line, and hold the pen still at the end for a moment before lifting', 8),
  shape('curve', 'a smooth curve, like an S or a wave', 8),
  shape('arc', 'part of a circle, like a C on its side', 6),
  shape('circle', 'a circle, in one stroke', 12),
  shape('ellipse', 'an oval, in one stroke', 6),
  shape('triangle', 'a triangle, in one stroke', 12),
  shape('rect', 'a rectangle, in one stroke', 12),
  shape('square', 'a square, in one stroke', 8),
  shape('rhombus', 'a diamond (rhombus), in one stroke', 6),
  shape('pentagon', 'a pentagon (five sides), in one stroke', 5),
  shape('arrow', 'an arrow, shaft and head in one stroke', 10),
  shape('star', 'a five-pointed star, in one stroke', 6),
  shape('heart', 'a heart, in one stroke', 6),
  shape('cloud', 'a cloud with bumps, in one stroke', 6),
  shape('bubble', 'a speech bubble with its tail, in one stroke', 6),
  shape('paren-open', 'an opening bracket (', 8),
  shape('paren-close', 'a closing bracket )', 8),
  shape('bracket-open', 'an opening square bracket [', 8),
  shape('bracket-close', 'a closing square bracket ]', 8),
  shape('brace-open', 'an opening curly bracket {', 8),
  shape('brace-close', 'a closing curly bracket }', 8),
  shape('comma', 'a comma ,', 8),
  shape('at', 'an @ sign, in one stroke', 8),
  shape('letter-c', 'the letter c', 5),
  shape('letter-l', 'the letter l', 5),
  shape('letter-L', 'the letter L', 5),
  shape('digit-3', 'the digit 3', 5),
  shape('letter-a', 'the letter a', 5),
  shape('letter-e', 'the letter e', 5),
  shape('letter-o', 'the letter o', 5),
  ...ALPHABET,
  many('word', 'your name, as you usually write it, then press Next', 4),
  many('interval', '[a, b] as in maths, then press Next', 4),
  many('sentence', 'a short sentence, as fast as you usually write, then press Next', 3),
  many('scratch', 'a word, then scratch it out with a zigzag over it, then press Next', 8),
  many('palm', 'only on a touch screen: write a word with your hand resting on the screen, then press Next (Skip on a tablet like a Wacom)', 3),
  // Last, so a recording made before goes on here: shading goes back and forth
  // over ink as a scratch-out does, and a pen taught the person's own shading leaves it alone.
  many('shade', 'shading inside the grey shape, back and forth across its edge, as when colouring in a drawing, then press Next', 4),
  // Last again, so a recording made before goes on here: arrows as written in notes,
  // small and quick, the shaft bowing and the head lopsided, which the general rules take only some of; taught, the
  // pen takes the person's own.
  shape('arrow-small', 'a small arrow, quickly, as you write one in your notes between words (about 1 cm or less), in one stroke', 12),
]

/** CSS pixels to 0.01 mm: CSS fixes 96 pixels to the inch. */
const UNITS_PER_PX = 2540 / 96
const SHEET = { w: 160, h: 100 }

const fresh = (): Recording => ({ v: 1, device: { userAgent: navigator.userAgent, dpr: window.devicePixelRatio }, started: new Date().toISOString(), items: [] })

/** What to say when an ask could not be kept: it is still on this page, and in a download. */
const NOT_KEPT = `${inDesktopApp() ? 'The app' : 'This browser'} could not keep the last ask. It is still here: press Download to keep everything recorded so far.`

/** Where the recording is: the ask, and which of its count. */
function position(items: readonly Recorded[]): { index: number; of: number } | undefined {
  let done = items.length
  for (let index = 0; index < ASKS.length; index++) {
    if (done < ASKS[index]!.count) return { index, of: done }
    done -= ASKS[index]!.count
  }
  return undefined
}

const total = ASKS.reduce((sum, ask) => sum + ask.count, 0)

/**
 * The scratch-out ask, and where its drawings start among the asks. They can be
 * drawn again: the were made while the Wacom came as a mouse, unlike their
 * zigzags with the pen.
 */
const SCRATCH = ASKS.findIndex((ask) => ask.kind === 'scratch')
const SCRATCH_FROM = ASKS.slice(0, SCRATCH).reduce((sum, ask) => sum + ask.count, 0)

/** The pen learns a thing from two examples, and acts on what it learned once it knows twenty strokes of plain writing (learn.ts). */
const ENOUGH = 2
const ENOUGH_WRITING = 20

/** What the pen learned from a recording, in a sentence. */
function learnedFrom(examples: readonly PenExample[]): string {
  const count = (label: InkLabel): number => examples.filter((e) => e.label === label).length
  const known = (labels: readonly InkLabel[]): number => labels.filter((label) => count(label) >= ENOUGH).length
  const symbols = known(Object.keys(SYMBOL_LABELS) as InkLabel[])
  const shapes = known(SHAPE_LABELS)
  const writing = count('none')
  const scratch = count('scratch') >= ENOUGH ? ', your scratch-outs' : ''
  const shading = count('shade') >= ENOUGH ? ', your shading, which deletes nothing' : ''
  if (writing < ENOUGH_WRITING) return `Not yet: the pen needs some of your letters and words too (${writing} strokes so far, ${ENOUGH_WRITING} at least), to know what to leave alone.`
  return `Your pen now goes by your own strokes: ${symbols} of 8 symbols, ${shapes} of 13 shapes${scratch}${shading}, and ${writing} strokes of your writing, which it leaves alone.`
}

export function Recorder() {
  // Read from the library as the page opens; until then, nothing to draw on.
  const [recording, setRecording] = useState<Recording>()
  const [taught, setTaught] = useState<string>()
  const [problem, setProblem] = useState<string>()
  const [strokes, setStrokes] = useState<Recorded['strokes']>([])
  const canvas = useRef<HTMLCanvasElement>(null)
  const items = recording?.items ?? []
  const ready = recording !== undefined
  // Drawing the scratch-outs again: which of them is next, each replacing the one drawn before.
  const [again, setAgain] = useState<number>()
  const at = again !== undefined ? { index: SCRATCH, of: again - SCRATCH_FROM } : recording ? position(items) : undefined
  const ask = at ? ASKS[at.index] : undefined
  const scratchDone = items.length >= SCRATCH_FROM + ASKS[SCRATCH]!.count
  const next = useRef<() => void>(() => undefined)

  useEffect(() => {
    let live = true
    loadRecording(fresh).then(
      (kept) => live && setRecording(kept),
      () => {
        // The library cannot be read: record on this page all the same, and say that Download keeps it.
        if (!live) return
        setRecording(fresh())
        setProblem(NOT_KEPT)
      },
    )
    return () => {
      live = false
    }
  }, [])

  /** Change the asks drawn: the page at once, the library one write after another, and a word if it fails. */
  const change = (next: Recorded[], write: Promise<void>): void => {
    setRecording((now) => now && { ...now, items: next })
    write.then(
      () => setProblem((now) => (now === NOT_KEPT ? undefined : now)),
      () => setProblem(NOT_KEPT),
    )
  }
  const clear = (): void => {
    const c = canvas.current
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height)
    setStrokes([])
  }
  /** Keep what was drawn as this ask's next one, and go on. */
  next.current = () => {
    if (!ask) return
    const item = { kind: ask.kind, strokes }
    if (again !== undefined) {
      change(items.map((old, index) => (index === again ? item : old)), keepItems(again, [item]))
      const last = again + 1 >= SCRATCH_FROM + ask.count
      setAgain(last ? undefined : again + 1)
      if (last) setTaught('Scratch-outs drawn again. Press Teach my pen to use them.')
    } else change([...items, item], keepItems(items.length, [item]))
    clear()
  }
  const skip = (): void => {
    if (again !== undefined) {
      // Stop drawing them again: the ones not yet drawn again stay as they were.
      setAgain(undefined)
      clear()
      return
    }
    if (!ask || !at) return
    // The rest of this ask, kept as empty, so the count moves on to the next ask.
    const empty = Array.from({ length: ask.count - at.of }, (): Recorded => ({ kind: ask.kind, strokes: [] }))
    change([...items, ...empty], keepItems(items.length, empty))
    clear()
  }
  const back = (): void => {
    if (items.length === 0) return
    change(items.slice(0, -1), dropItems(items.length - 1))
    clear()
  }
  /** Make the pen profile from a recording: this one, or a file. The strokes undone corrections taught are kept. */
  const teach = (from: unknown): void => {
    const file = RecordingFile.safeParse(from)
    if (!file.success) {
      setTaught('That file is not a stroke recording.')
      return
    }
    const examples = recordedExamples(file.data, myPenSettings().smoothing)
    penProfile.set(taughtProfile(penProfile.value, examples, new Date()))
    setTaught(learnedFrom(examples))
  }
  const teachFromFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    file
      .text()
      .then((text) => teach(JSON.parse(text)))
      .catch(() => setTaught('That file could not be read as a stroke recording.'))
  }

  // The pen on the sheet: every sample, drawn as it comes, simply.
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const rect = c.getBoundingClientRect()
    c.width = Math.round(rect.width * dpr)
    c.height = Math.round(rect.height * dpr)
    const ctx = c.getContext('2d')!
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    let current: { id: number; type: string; samples: Sample[] } | undefined
    let soon = 0
    const sample = (e: PointerEvent): Sample => {
      const r = c.getBoundingClientRect()
      return [Math.round((e.clientX - r.left) * UNITS_PER_PX), Math.round((e.clientY - r.top) * UNITS_PER_PX), Math.round(e.pressure * 1000) / 1000, e.tiltX, e.tiltY, Math.round(e.timeStamp * 10) / 10, Math.round(e.width), Math.round(e.height)]
    }
    const draw = (a: Sample, b: Sample): void => {
      const scale = dpr / UNITS_PER_PX
      ctx.strokeStyle = '#1d1d22'
      ctx.lineWidth = Math.max(1, (0.5 + (b[2] || 0.5)) * 1.6 * dpr)
      ctx.beginPath()
      ctx.moveTo(a[0] * scale, a[1] * scale)
      ctx.lineTo(b[0] * scale, b[1] * scale)
      ctx.stroke()
    }
    const down = (e: PointerEvent): void => {
      e.preventDefault()
      window.clearTimeout(soon)
      try {
        c.setPointerCapture(e.pointerId)
      } catch {
        // A pointer the browser no longer knows: its events still come while it is over the sheet.
      }
      // A second contact at once (a palm, a finger) is kept as a stroke of its own.
      if (current && current.id !== e.pointerId) setStrokes((all) => [...all, { type: current!.type, samples: current!.samples }])
      current = { id: e.pointerId, type: e.pointerType, samples: [sample(e)] }
    }
    const move = (e: PointerEvent): void => {
      if (!current || current.id !== e.pointerId) return
      const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
      for (const s of coalesced.length > 0 ? coalesced : [e]) {
        const pt = sample(s)
        const before = current.samples.at(-1)!
        if (pt[5] <= before[5]) continue
        current.samples.push(pt)
        draw(before, pt)
      }
    }
    const up = (e: PointerEvent): void => {
      if (!current || current.id !== e.pointerId) return
      current.samples.push(sample(e))
      const done = { type: current.type, samples: current.samples }
      current = undefined
      setStrokes((all) => [...all, done])
      // One-stroke asks go on by themselves a moment after the pen lifts; letters after a short pause, as they may take more strokes.
      if (ask && ask.goes !== 'next' && e.type === 'pointerup') soon = window.setTimeout(() => next.current(), ask.goes === 'lift' ? 450 : 1100)
    }
    c.addEventListener('pointerdown', down)
    c.addEventListener('pointermove', move)
    c.addEventListener('pointerup', up)
    c.addEventListener('pointercancel', up)
    return () => {
      window.clearTimeout(soon)
      c.removeEventListener('pointerdown', down)
      c.removeEventListener('pointermove', move)
      c.removeEventListener('pointerup', up)
      c.removeEventListener('pointercancel', up)
    }
  }, [ask, ready])

  const download = (): void => {
    if (!recording) return
    const blob = new Blob([JSON.stringify(recording)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `shellnote-strokes-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  if (!recording) return <main className="recorder"><p>Opening the recorder…</p></main>
  const kept = items.filter((item) => item.strokes.length > 0).length
  return (
    <main className="recorder">
      <header>
        <a className="recorder-back" href={location.pathname}>
          ← Back to notes
        </a>
        <h1>Stroke recorder</h1>
        <p>
          {at && ask ? (
            <>
              <strong>Draw {ask.ask}</strong> · {at.of + 1} of {ask.count} · {again !== undefined ? 'again, with your pen as you usually scratch out' : `${items.length} of ${total} in all`}
            </>
          ) : (
            <strong>All done. Press Teach my pen.</strong>
          )}
        </p>
      </header>
      <div className="recorder-paper" style={{ width: `${SHEET.w}mm`, height: `${SHEET.h}mm` }}>
        <canvas ref={canvas} className="recorder-sheet" style={{ width: `${SHEET.w}mm`, height: `${SHEET.h}mm` }} aria-label="Draw here" />
        {ask?.kind === 'shade' ? (
          // The shape to shade, drawn by the recorder, so every stroke of this ask is shading.
          <svg className="recorder-guide" viewBox={`0 0 ${SHEET.w} ${SHEET.h}`} aria-label="The shape to shade">
            {at!.of % 2 === 0 ? <circle cx={SHEET.w / 2} cy={SHEET.h / 2} r={28} /> : <rect x={SHEET.w / 2 - 35} y={SHEET.h / 2 - 25} width={70} height={50} />}
          </svg>
        ) : null}
      </div>
      <div className="recorder-buttons">
        <button type="button" onClick={() => next.current()} disabled={!ask || strokes.length === 0}>
          Next
        </button>
        <button type="button" onClick={clear} disabled={strokes.length === 0}>
          Clear and redo
        </button>
        <button type="button" onClick={skip} disabled={!ask}>
          {again !== undefined ? 'Stop drawing again' : 'Skip these'}
        </button>
        <button type="button" onClick={back} disabled={items.length === 0 || again !== undefined}>
          Back one
        </button>
        <button
          type="button"
          onClick={() => {
            clear()
            setAgain(SCRATCH_FROM)
          }}
          disabled={!scratchDone || again !== undefined}
        >
          Record scratch-outs again
        </button>
        <button type="button" onClick={download} disabled={kept === 0}>
          Download ({kept} kept)
        </button>
        <button type="button" className="recorder-teach" onClick={() => teach(recording)} disabled={kept === 0}>
          Teach my pen
        </button>
        <label className="recorder-file">
          Teach from a file
          <input type="file" accept=".json,application/json" onChange={teachFromFile} />
        </label>
      </div>
      {taught && (
        <p className="recorder-taught" role="status">
          {taught}
        </p>
      )}
      {problem && (
        <p className="recorder-taught" role="alert">
          {problem}
        </p>
      )}
      <p className="recorder-note">
        Use your pen as you normally write. Shapes and symbols go on by themselves when you lift, letters after a short pause; for words, press Next. Press Teach my pen whenever you like, and again after recording more: the pen learns
        your hand from what is recorded so far, and keeps it with your notes. If scratching out takes too much scribbling, press Record scratch-outs again and scratch out as you usually do. If your small arrows stay as drawn, record the small arrows, the last ask, and press Teach my pen. Nothing leaves this computer. With a Wacom, turn on “Use Windows Ink” in its settings so the pen’s pressure comes through, and each stroke arrives whole.
      </p>
    </main>
  )
}
