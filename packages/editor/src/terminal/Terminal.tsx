// The terminal: one
// place, on every screen, where the person and the model write lines and
// ShellNote runs them. Ctrl+Shift+P opens and closes it. Enter runs what is
// typed (commands, op lines, or plain words, which the finder reads); Ctrl+Enter
// sends it to the model as a request, whose blocks of lines appear and run one
// by one, each with what it printed. What cannot be undone asks here first.
import { stepsOf, type Embedder, type Meaning, type Model } from '@shellnote/core'
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { beginNoteRequest } from '../commands/content.js'
import { commands } from '../commands/index.js'
import { Shared } from '../video/state.js'
import { agentRun, MAX_TURNS } from './agent.js'
import { changedSince, noteNow, prepareMeaning, runLines, withReport, type Ask, type Output } from './run.js'

/** One entry of the terminal: a line typed, the model's reply, a line's output, or a note from the terminal. */
export interface Entry {
  who: 'you' | 'model' | 'out' | 'note'
  text: string
  ok?: boolean
}

/** What the terminal shows, kept while it is closed and across screens; the last 400 entries. */
const history = new Shared<Entry[]>([])
const opened = new Shared(false)

/** Whether the terminal is open: a button elsewhere shows it, and follows Ctrl+Shift+P. */
export const terminalOpen: Pick<Shared<boolean>, 'subscribe' | 'snapshot'> = opened

/** Open or close the terminal, as Ctrl+Shift+P does. */
export function openTerminal(open = true): void {
  opened.set(open)
}

const add = (more: readonly Entry[]): void => history.set([...history.value, ...more].slice(-400))
const outEntries = (outputs: readonly Output[], withLine: boolean): Entry[] =>
  outputs.map((output) => ({ who: 'out', ok: output.ok, text: `${withLine ? `${output.line}\n` : ''}${output.ok ? '✓' : '✗'} ${output.text}` }))

const PREFIX: Record<Entry['who'], string> = { you: '› ', model: '', out: '', note: '' }

export function Terminal({ model, meaning, page }: { model: () => Model | string; meaning?: () => Embedder | Meaning | undefined; page?: () => 'overall' | 'small' }) {
  const open = useSyncExternalStore(opened.subscribe, opened.snapshot)
  const entries = useSyncExternalStore(history.subscribe, history.snapshot)
  const [text, setText] = useState('')
  const [working, setWorking] = useState<AbortController | null>(null)
  const [question, setQuestion] = useState<{ text: string; answer: (yes: boolean) => void } | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const log = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        event.stopPropagation()
        opened.set(!opened.value)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  useEffect(() => {
    if (open) input.current?.focus()
    // The finder's table embedded ahead, while the person types.
    if (!open) return
    prepareMeaning(meaning?.())
    // The model warmed as the terminal opens, as the AI box warms it: LM Studio loads one it unloaded while the
    // request is typed, so the request need not wait for it (never throws).
    const chosen = model()
    if (typeof chosen !== 'string') void chosen.prepare?.()
  }, [open, meaning, model])

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight })
  }, [entries, question])

  /** Asks the person here, for what cannot be undone. */
  const ask: Ask = (asked) => new Promise((resolve) => setQuestion({ text: asked, answer: (yes) => (setQuestion(null), resolve(yes)) }))

  // Lines typed while others still run wait their turn: one at a time, in order, each shown as it starts.
  const queue = useRef<Promise<void>>(Promise.resolve())
  const typed = useRef(0)

  /** Enter: the lines typed go on the queue at once, so the box is free to type the next while they run. */
  const runTyped = (): void => {
    // A line of the note's text takes the words under it, up to end; the lines sent at once are one request,
    // one step of Undo.
    const steps = stepsOf(text.split('\n'))
    if (steps.length === 0 || working) return
    const shown = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
    setText('')
    typed.current++
    queue.current = queue.current
      .then(async () => {
        add(shown.map((line) => ({ who: 'you', text: line })))
        const before = noteNow(commands)
        beginNoteRequest()
        const ran = await runLines(steps, { commands, ask, meaning: meaning?.() })
        // What they changed in the note, as the model is told (note control, step 1).
        add(outEntries(withReport(ran, await changedSince(commands, before)), false))
      })
      .catch((error: unknown) => add([{ who: 'note', text: `The lines could not run: ${error instanceof Error ? error.message : String(error)}` }]))
      .finally(() => {
        typed.current--
        input.current?.focus()
      })
  }

  /**
   * Ctrl+Enter: the request goes to the agent's loop (agent.ts), which adds each reply and what its lines printed as
   * they come. `working` holds its AbortController, for Stop. One thing at a time: not while typed lines still run.
   */
  const askModel = async (): Promise<void> => {
    const request = text.trim()
    if (request === '' || working) return
    if (typed.current > 0) {
      add([{ who: 'note', text: 'The lines typed are still running: ask the model once they are done.' }])
      return
    }
    const chosen = model()
    if (typeof chosen === 'string') {
      add([{ who: 'note', text: chosen }])
      return
    }
    setText('')
    add([{ who: 'you', text: `ask the model: ${request}` }])
    const controller = new AbortController()
    setWorking(controller)
    try {
      const end = await agentRun(request, {
        model: chosen,
        meaning: meaning?.(),
        page: page?.() ?? 'overall',
        commands,
        ask,
        signal: controller.signal,
        onReply: (reply) => add([{ who: 'model', text: reply.trim() }]),
        onOutput: (outputs) => add(outEntries(outputs, true)),
      })
      const said = {
        done: 'The model is done.',
        stopped: 'Stopped.',
        turns: `Stopped after ${MAX_TURNS} replies: ask again to go on.`,
        repeated: 'Stopped: the model repeated itself and nothing changed.',
        code: 'Done by the app alone, with no call to the model: it knows this request word for word.',
      }
      add([{ who: 'note', text: said[end] }])
    } catch (error) {
      add([{ who: 'note', text: controller.signal.aborted ? 'Stopped.' : `The model could not be reached: ${error instanceof Error ? error.message : String(error)}` }])
    } finally {
      setWorking(null)
      input.current?.focus()
    }
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    // The terminal's keys stay in the terminal: the note does not hear them.
    event.stopPropagation()
    if (event.key === 'Escape') {
      opened.set(false)
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (event.ctrlKey) void askModel()
      else runTyped()
    }
  }

  if (!open) return null
  return (
    <div className="nw-terminal" role="dialog" aria-label="Terminal">
      <div className="nw-terminal-head">
        <span className="nw-terminal-title">Terminal</span>
        <span className="nw-terminal-hint">Enter runs · Shift+Enter a new line · Ctrl+Enter asks the model · Esc closes</span>
        <button type="button" className="nw-terminal-close" aria-label="Close the terminal" onClick={() => opened.set(false)}>
          ×
        </button>
      </div>
      <div className="nw-terminal-log" ref={log} role="log" aria-label="Terminal output">
        {entries.length === 0 ? <p className="nw-terminal-empty">Type a command, such as pen.set kind=pencil colour=blue, or plain words, such as use a blue pencil. Ctrl+Enter gives a request to the model, which writes the lines itself.</p> : null}
        {entries.map((entry, i) => (
          <pre key={i} className={`nw-terminal-entry nw-terminal-${entry.who}`} data-ok={entry.ok === undefined ? undefined : String(entry.ok)}>
            {PREFIX[entry.who]}
            {entry.text}
          </pre>
        ))}
        {question ? (
          <div className="nw-terminal-ask" role="alertdialog" aria-label="Allow it?">
            <p>{question.text}</p>
            <button type="button" className="button primary" onClick={() => question.answer(true)}>
              Allow
            </button>
            <button type="button" className="button" onClick={() => question.answer(false)}>
              Don't allow
            </button>
          </div>
        ) : null}
      </div>
      <div className="nw-terminal-input">
        <textarea ref={input} aria-label="Terminal line" rows={1} value={text} placeholder="pen.set kind=pencil  ·  use a blue pencil  ·  Ctrl+Enter: ask the model" spellCheck={false} onChange={(event) => setText(event.target.value)} onKeyDown={onKeyDown} />
        {working ? (
          <button type="button" className="button" onClick={() => working.abort()}>
            Stop
          </button>
        ) : (
          <>
            <button type="button" className="button" onClick={runTyped}>
              Run
            </button>
            <button type="button" className="button" onClick={() => void askModel()}>
              Ask the model
            </button>
          </>
        )}
      </div>
    </div>
  )
}
