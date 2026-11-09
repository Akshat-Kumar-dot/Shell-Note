// The AI in the editor. A small ✨ button beside what is
// chosen (a Select box, blocks chosen as objects, or words typed over), in
// the page's right margin so it never covers text, or Ctrl+K, opens the
// prompt box there. Edit changes the note in one undo step,
// then a toast says which model did it and what it used, with Undo. Ask
// answers in the side panel and never changes the note. While the model
// works there is a spinner and Stop, which changes nothing. A picture pasted
// into the box is placed in the Select box, with no model at all. A request
// can be spoken (the browser's own speech recognition, while the microphone
// is pressed), and a model that can see pictures can be sent one with it.
import { instantPreview, logLine, MARGIN, NO_VISION, type Instant, type LogEntry, type Model, type Selection, type StepProgress } from '@shellnote/core'
import { ArrowUp, ImagePlus, LoaderCircle, Mic, Settings2, Sparkles, Square, X, Zap } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { pictureFiles, PICTURE_TYPES } from '../assets.js'
import { commands } from '../commands/index.js'
import { checkDiagram, prepareDiagrams } from '../diagram.js'
import { inWindowsApp } from '../host.js'
import { addPictures, pictureSpot, type PictureSpot } from '../pictures.js'
import type { EditorStore } from '../store.js'
import { aiAsk, aiEdit, fileData, isLatest, undoEdit, CHANGED_SINCE, type Undo } from './run.js'

/** What the app gives the AI: the model, the settings, the edit log and the side panel. */
export interface AiHost {
  /** The model to use now, or why there is none, in words. */
  model: () => Model | string
  /** Opens Settings, at the AI part. */
  openSettings: () => void
  /** Every request, for the edit log: its entry, and what undoes it when it changed the note. */
  logged: (entry: LogEntry, undo?: Undo) => void
  /** An Ask's answer, for the side panel. */
  answered: (answer: AskAnswer) => void
  /** The edit log's latest entries, oldest first, for requests that refer back ("the same for this one"). */
  recent: () => readonly LogEntry[]
 /** True when the model the settings name is a paid one (OpenRouter): the agent asks the person before using it. */
  paid?: () => boolean
}

/** An answer from Ask, as the side panel shows it. */
export interface AskAnswer {
  question: string
  answer: string
  /** What was selected when it was asked: where Insert answer puts it. */
  selection: Selection
  /** The model that answered, without its server's label. */
  model: string
}

type Mode = 'edit' | 'ask'
type Note = { tone: 'info' | 'error'; text: string }
/** How a request ended: `ok` when it was done, and what the box said. */
type Ended = { ok: boolean; said: string }
type Toast = { text: string; tone?: 'error'; undo?: Undo }
/**
 * Where what is chosen is drawn; the line down the middle of its page's right
 * margin, where the ✨ button goes; and the part of the desk in view, below
 * the format bar, which the button and the box keep to.
 */
type Spot = { left: number; top: number; bottom: number; gutter: number; ceiling: number; floor: number }

const GAP = 6
const BOX_WIDTH = 440
/** How long the toast after an edit stays. */
const TOAST_MS = 8000

/** A model's name without its server's label: "qwen2.5-1.5b-instruct" for "lmstudio:qwen2.5-1.5b-instruct". */
export const modelName = (name: string): string => name.replace(/^[^:/]+:/u, '')

/**
 * What the prompt box says while the model works: what it does, then how far
 * it has got, as the reply streams in (the performance pass, 12 October
 * 2026: up to 14 s went by with nothing to show, most of it thinking).
 */
export function workingText(mode: 'edit' | 'ask', progress: StepProgress | null): string {
  if (!progress) return mode === 'edit' ? 'Working on it…' : 'Thinking…'
  if (progress.written === 0) return `Thinking… ${progress.thinking} tokens`
  return mode === 'edit' ? `Writing… ${progress.written} tokens` : 'Answering…'
}

/** "Undo · model · 1,234 / 56 tokens · $0.0012": what an edit used. */
export function usedLine(entry: LogEntry): string {
  if (entry.tier === 0) return 'done without a model, 0 tokens'
  const tokens = `${entry.tokensIn.toLocaleString('en')} / ${entry.tokensOut.toLocaleString('en')} tokens`
  return [modelName(entry.model), tokens, ...(entry.cost === undefined ? [] : [`$${entry.cost.toFixed(4)}`])].join(' · ')
}

/**
 * Where what is chosen is drawn on the screen: the Select box, the chosen
 * blocks, or the words typed over; and the page it is on.
 */
function chosenRect(store: EditorStore, desk: Element): { rect: DOMRect; sheet: HTMLElement | null } | undefined {
  const { selection } = store
  if (store.selectionKind === 'objects') {
    if (selection.here && 'page' in selection.here) {
      const box = desk.querySelector('.nw-region')
      return box ? { rect: box.getBoundingClientRect(), sheet: box.closest<HTMLElement>('.nw-page') } : undefined
    }
    const ids = [...selection.blocks, ...(selection.words ?? []).map((piece) => piece.block)]
    const drawn = ids.flatMap((id) => {
      const element = desk.querySelector(`[data-id="${CSS.escape(id)}"]`)
      return element ? [element] : []
    })
    if (drawn.length === 0) return undefined
    const rects = drawn.map((element) => element.getBoundingClientRect())
    const left = Math.min(...rects.map((r) => r.left))
    const top = Math.min(...rects.map((r) => r.top))
    const rect = new DOMRect(left, top, Math.max(...rects.map((r) => r.right)) - left, Math.max(...rects.map((r) => r.bottom)) - top)
    return { rect, sheet: drawn[0]!.closest<HTMLElement>('.nw-page') }
  }
  // Words typed over, while the text has the browser's selection.
  const dom = document.getSelection()
  if (!dom || dom.rangeCount === 0 || dom.isCollapsed || !desk.contains(dom.anchorNode)) return undefined
  const node = dom.anchorNode
  return { rect: dom.getRangeAt(0).getBoundingClientRect(), sheet: (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>('.nw-page') ?? null }
}

/** The part of the desk in view: below the format bar floating over its top, and above its foot. */
function deskView(desk: Element): { ceiling: number; floor: number } {
  const view = desk.getBoundingClientRect()
  const bar = document.querySelector('.nw-formatbar')?.getBoundingClientRect()
  return { ceiling: Math.max(view.top, bar ? bar.bottom : view.top) + GAP, floor: view.bottom - GAP }
}

/** Whether something is chosen that a request can act on, in a way the ✨ button shows for. */
function hasChoice(store: EditorStore): boolean {
  const { selection } = store
  if (store.selectionKind === 'objects') return selection.blocks.length > 0 || (selection.words?.length ?? 0) > 0 || selection.here !== undefined
  return selection.range !== undefined && selection.range.start < selection.range.end
}

/** Where pasted pictures go: into the Select box, fitted to it; else where the Picture button puts them. */
function boxSpot(store: EditorStore): PictureSpot {
  const here = store.selection.here
  if (here && 'page' in here && store.doc.page[here.page]) return { page: here.page, x: here.x + here.w / 2, y: here.y + here.h / 2, fit: { w: here.w, h: here.h } }
  return pictureSpot(store)
}

/** After the layout has settled: the next two frames, or 150 ms at most in a hidden tab. */
function settled(): Promise<void> {
  return new Promise((done) => {
    const timer = setTimeout(done, 150)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        clearTimeout(timer)
        done()
      }),
    )
  })
}

/** The browser's speech recognition, as Edge and Chrome have it. */
interface Recognition {
  lang: string
  interimResults: boolean
  continuous: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}

/** The browser's speech recognition, when it has one. */
function speech(): (new () => Recognition) | undefined {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

/** English, as the person's browser speaks it, or else American English. */
const english = (): string => (navigator.language.toLowerCase().startsWith('en') ? navigator.language : 'en-US')

/** Why listening stopped, in words for the person; empty when it was asked to stop. In the app on Windows, Windows hears it. */
function unheard(error: string): string {
  const windows = inWindowsApp()
  if (windows && error === 'not-allowed') return 'The microphone is off for desktop apps. In Windows Settings, Privacy & security, Microphone, turn on “Let desktop apps access your microphone”, then try again.'
  if (windows && error === 'service-not-allowed') return "Windows' online speech recognition is off. Turn it on in Windows Settings, Privacy & security, Speech, then try again."
  if (windows && error === 'language-not-supported') return 'Windows cannot hear English here yet. Add English in Windows Settings, Time & language, Speech, then try again.'
  if (error === 'not-allowed' || error === 'service-not-allowed') return "The microphone is blocked. Allow it for this page in the browser's site settings, then try again."
  if (error === 'no-speech') return 'Nothing was heard. Press the microphone, then speak.'
  if (error === 'audio-capture') return 'No microphone was found.'
  if (error === 'network') return `${windows ? 'Windows' : 'The browser'} could not reach its speech service. Check the connection.`
  return error === 'aborted' ? '' : `Listening stopped (${error}).`
}

/**
 * Stands in for a model that is not set up, for a request code does alone:
 * should it reach the model after all, the person is told what is missing.
 */
function missingModel(why: string): Model {
  return { name: 'none', caps: { jsonSchema: true, inlineContent: false, vision: false, opSet: 'small' }, complete: () => Promise.reject(new Error(why)) }
}

const READ_ONLY = 'This note is read-only here: it is being edited in another window, so the AI cannot change it.'

/** A fetch that never reached the server: LM Studio not running, CORS off, or no connection. */
const unreachable = (error: unknown): boolean => error instanceof TypeError && /fetch|network|load failed/iu.test(error.message)

export function AiLayer({ store, host, enabled }: { store: EditorStore; host: AiHost; enabled: boolean }) {
  useSyncExternalStore(store.subscribeSelection, store.selectionSnapshot)
  const [spot, setSpot] = useState<Spot | null>(null)
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('edit')
  const [text, setText] = useState('')
  const [working, setWorking] = useState<AbortController | null>(null)
  const workingRef = useRef(working)
  workingRef.current = working
  const [note, setNote] = useState<Note | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  // How far the model has got, shown once a frame: a reply streams up to sixty chunks a second.
  const [progress, setProgress] = useState<StepProgress | null>(null)
  const latest = useRef<{ progress: StepProgress | null; frame: number }>({ progress: null, frame: 0 })
  const report = useCallback((now: StepProgress): void => {
    latest.current.progress = now
    if (latest.current.frame) return
    latest.current.frame = requestAnimationFrame(() => {
      latest.current.frame = 0
      setProgress(latest.current.progress)
    })
  }, [])
  const last = useRef('')
  const input = useRef<HTMLTextAreaElement>(null)
  // A picture sent with the request, to a model that can see it.
  const [attached, setAttached] = useState<{ file: File; url: string } | null>(null)
  const files = useRef<HTMLInputElement>(null)
  // The request being spoken: the browser listens while this is set.
  const [listening, setListening] = useState<Recognition | null>(null)
  const listeningRef = useRef(listening)
  listeningRef.current = listening
  const hostRef = useRef(host)
  hostRef.current = host
  // What code will do with no model, said under the box as the request is typed (the ⚡ line).
  const [instant, setInstant] = useState<Pick<Instant, 'band' | 'summary'> | null>(null)
  useEffect(() => {
    const request = text.trim()
    if (!open || mode !== 'edit' || working || request === '' || (store.selection.blocks.length === 0 && store.selection.here === undefined)) {
      setInstant(null)
      return
    }
    // A moment after the last key, not on each.
    const timer = setTimeout(() => setInstant(instantPreview({ doc: store.doc, selection: store.selection, instruction: request }) ?? null), 150)
    return () => clearTimeout(timer)
  }, [text, open, mode, working, store])

  // Where the button and the box go, measured again as the note scrolls, zooms or changes.
  const measure = useCallback((): void => {
    const desk = document.querySelector('.nw-desk')
    const chosen = desk ? chosenRect(store, desk) : undefined
    if (!desk || !chosen) {
      // Words typed over lose the browser's selection to the box's own field: the box stays where it opened.
      setSpot((now) => (open ? now : null))
      return
    }
    const { rect, sheet } = chosen
    const { ceiling, floor } = deskView(desk)
    const shown = rect.bottom > ceiling && rect.top < floor
    // The middle of the page's right margin: the ✨ button never covers the text, whatever is under the choice.
    const page = sheet?.dataset.page === undefined ? undefined : store.doc.page[sheet.dataset.page]
    const paper = sheet?.getBoundingClientRect()
    const gutter = page && paper ? paper.right - (MARGIN * paper.width) / page.w / 2 : rect.right + 24
    const view = desk.getBoundingClientRect()
    setSpot((now) => {
      const next = shown
        ? { left: Math.round(Math.max(view.left + 8, rect.left)), top: Math.round(rect.top), bottom: Math.round(rect.bottom), gutter: Math.round(gutter), ceiling: Math.round(ceiling), floor: Math.round(floor) }
        : null
      // The same object when nothing moved: React then draws nothing, as this runs with every scroll.
      return now && next && Object.entries(next).every(([key, value]) => now[key as keyof Spot] === value) ? now : next
    })
  }, [store, open])
  useLayoutEffect(() => {
    let frame = 0
    // At most once a frame: scrolling, the note and the selection all ask.
    const later = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    measure()
    const stops = [store.subscribe(later), store.subscribeSelection(later)]
    window.addEventListener('scroll', later, { capture: true, passive: true })
    window.addEventListener('resize', later)
    document.addEventListener('selectionchange', later)
    const pages = document.querySelector('.nw-pages')
    const resize = new ResizeObserver(later)
    if (pages) resize.observe(pages)
    return () => {
      cancelAnimationFrame(frame)
      for (const stop of stops) stop()
      window.removeEventListener('scroll', later, { capture: true })
      window.removeEventListener('resize', later)
      document.removeEventListener('selectionchange', later)
      resize.disconnect()
    }
  }, [store, measure])

  const openBox = useCallback((): void => {
    setOpen(true)
    setNote(null)
    setToast(null)
    // A local model the server unloaded loads again while the request is typed.
    const model = hostRef.current.model()
    if (typeof model !== 'string') void model.prepare?.()
  }, [])
  const close = useCallback((): void => {
    working?.abort()
    listeningRef.current?.abort()
    setOpen(false)
    setNote(null)
  }, [working])

  // The box at the commands' disposal while the note is shown (app control): its buttons and the agent reach it alike.
  // A ref, given anew with each draw (below `send`): the commands are provided once, and reach this draw's state by it.
  const own = useRef({ enabled, isOpen: open, mode, working, progress, openBox, close, setMode, setText, send: (async () => ({ ok: false, said: '' })) as (accept?: boolean, request?: string, sent?: Mode) => Promise<Ended> })
  useEffect(
    () =>
      commands.provide('ai', {
        open: (wanted) => {
          const now = own.current
          if (!now.enabled) throw new Error(READ_ONLY)
          if (wanted !== undefined && wanted !== now.mode && now.working) throw new Error('The AI is working: stop it first (ai.stop), or wait for it.')
          if (wanted !== undefined) now.setMode(wanted)
          if (!now.isOpen) now.openBox()
          return `AI box open, to ${wanted ?? now.mode}`
        },
        close: () => {
          own.current.close()
          return 'AI box closed'
        },
        stop: () => {
          const { working: running } = own.current
          if (!running) return 'the AI is not working'
          running.abort()
          return 'stopped: nothing changed'
        },
        send: async (request, wanted) => {
          const now = own.current
          if (!now.enabled) throw new Error(READ_ONLY)
          const sent = wanted ?? now.mode
          // Shown in the box as it goes, as if typed there.
          now.setMode(sent)
          now.setText(request)
          if (!now.isOpen) now.openBox()
          const ended = await now.send(false, request, sent)
          if (!ended.ok) throw new Error(ended.said)
          return ended.said
        },
        instant: async (request) => {
          const now = own.current
          if (!now.enabled) throw new Error(READ_ONLY)
          if (!instantPreview({ doc: store.doc, selection: store.selection, instruction: request })) throw new Error('Code cannot do this with no model: send it to the AI (ai.send), or choose something first.')
          now.setMode('edit')
          now.setText(request)
          if (!now.isOpen) now.openBox()
          const ended = await now.send(true, request, 'edit')
          if (!ended.ok) throw new Error(ended.said)
          return ended.said
        },
        paid: () => hostRef.current.paid?.() ?? false,
        line: () => {
          const now = own.current
          return now.isOpen ? `AI box open, to ${now.mode}${now.working ? `, working: ${workingText(now.mode, now.progress)}` : ''}` : undefined
        },
      }),
    [],
  )

  // Ctrl+K (⌘K on a Mac) opens the box, wherever the focus is in the note.
  useEffect(() => {
    if (!enabled) return
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      openBox()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, openBox])
  // Read-only, as while another tab edits the note: no AI.
  useEffect(() => {
    if (!enabled) close()
  }, [enabled, close])
  // Leaving the note stops a request still running, so nothing lands on a note no longer shown, and stops listening.
  useEffect(
    () => () => {
      workingRef.current?.abort()
      listeningRef.current?.abort()
    },
    [],
  )

  const detach = (): void => {
    if (attached) URL.revokeObjectURL(attached.url)
    setAttached(null)
  }

  /** The microphone: listen, putting what is said after what is typed; pressed again, stop. */
  const listen = (): void => {
    if (listening) {
      listening.stop()
      return
    }
    const Speech = speech()
    if (!Speech) return
    const recognition = new Speech()
    recognition.lang = english()
    recognition.interimResults = true
    recognition.continuous = false
    const before = text.trimEnd()
    recognition.onresult = (event) => {
      let said = ''
      for (let i = 0; i < event.results.length; i++) said += event.results[i]![0]!.transcript
      setText(before === '' ? said.trim() : `${before} ${said.trim()}`)
    }
    recognition.onerror = (event) => {
      const why = unheard(event.error)
      if (why !== '') setNote({ tone: 'error', text: why })
    }
    recognition.onend = () => setListening((now) => (now === recognition ? null : now))
    setNote(null)
    setListening(recognition)
    recognition.start()
  }

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast])

  /**
   * Send a request (the box's Send and Enter; Tab or ⚡ with `accept`, the ⚡ suggestion taken, so a likely reading
   * runs with no model; ai.send and ai.instant): what is typed, or `request` in `sent` mode as given. Says how it
   * ended, as the box shows it: `ok` when it was done.
   */
  const send = async (accept = false, request = text.trim(), sent: Mode = mode): Promise<Ended> => {
    if (request === '') return { ok: false, said: 'Nothing to send: write the request.' }
    if (working) return { ok: false, said: 'The AI is working: stop it first (ai.stop), or wait for it.' }
    const tell = (tone: Note['tone'], said: string): Ended => {
      setNote({ tone, text: said })
      return { ok: false, said }
    }
    listening?.stop()
    const chosen = hostRef.current.model()
    // An instant change needs no model, so none need be set up; anything that would reach one says what is missing.
    const ready = sent === 'edit' ? instantPreview({ doc: store.doc, selection: store.selection, instruction: request }) : undefined
    const instantly = ready !== undefined && (ready.band !== 'likely' || accept)
    if (typeof chosen === 'string' && !instantly) return tell('info', chosen)
    const model = typeof chosen === 'string' ? missingModel(chosen) : chosen
    const picture = attached
    if (picture && !model.caps.vision) return tell('info', NO_VISION)
    if (sent === 'edit' && store.selection.blocks.length === 0 && store.selection.here === undefined) return tell('info', 'Choose something first: draw a Select box, click a block, or select words.')
    last.current = request
    const stop = new AbortController()
    setWorking(stop)
    setNote(null)
    setProgress(null)
    try {
      // A picture sent with the request is read by the model, and never put in the note.
      const seen = picture ? await fileData(picture.file) : undefined
      if (sent === 'ask') {
        const selection = store.selection
        const asked = await aiAsk(store, { question: request, model, signal: stop.signal, progress: report, ...(seen === undefined ? {} : { picture: seen }) })
        if (picture) detach()
        hostRef.current.logged(asked.log)
        if (asked.stopped) return tell('info', 'Stopped.')
        if (asked.answer.trim() === '') return tell('error', 'The model gave no answer. Try again, or a larger model (Settings, under AI).')
        hostRef.current.answered({ question: request, answer: asked.answer, selection, model: modelName(model.name) })
        setText('')
        setOpen(false)
        return { ok: true, said: `answered, in Output: ${asked.answer.trim()}` }
      }
      // Mermaid loads while the model works, in case it writes a diagram to check.
      prepareDiagrams()
      const recent = hostRef.current.recent().filter((entry) => entry.result === 'applied').slice(-3).map(logLine)
      const edit = await aiEdit(store, { instruction: request, model, signal: stop.signal, recent, checks: { mermaid: checkDiagram }, progress: report, ...(accept ? { acceptSuggestion: true } : {}), ...(seen === undefined ? {} : { attachment: seen }) })
      if (picture && edit.undo) detach()
      let undo = edit.undo
      if (undo) {
        // The layout the edit set off (a frame's new height) joins its step: the log's undo counts from after it.
        await settled()
        if (isLatest(store, undo)) undo = { ...undo, rev: store.doc.rev }
      }
      hostRef.current.logged(edit.entry, undo)
      if (undo) {
        setToast({ text: usedLine(edit.entry), undo })
        setText('')
        setOpen(false)
        return { ok: true, said: `changed, one undo step (ai.undo takes it back): ${usedLine(edit.entry)}` }
      }
      return tell(edit.entry.result === 'declined' || edit.entry.result === 'stopped' || edit.entry.result === 'unchanged' ? 'info' : 'error', edit.message ?? 'Nothing was changed.')
    } catch (error) {
      return tell(
        'error',
        unreachable(error)
          ? 'The model could not be reached. For LM Studio: is its server running, with CORS on? See Settings, under AI.'
          : error instanceof Error
            ? error.message
            : String(error),
      )
    } finally {
      cancelAnimationFrame(latest.current.frame)
      latest.current = { progress: null, frame: 0 }
      setProgress(null)
      setWorking(null)
    }
  }

  own.current = { enabled, isOpen: open, mode, working, progress, openBox, close, setMode, setText, send }

  /** Send what is typed (ai.send), or take the ⚡ suggestion (ai.instant): through the commands, as the agent does. */
  const sendTyped = (instantly = false): void => {
    const request = text.trim()
    if (request === '' || working) return
    if (instantly) commands.tap('ai.instant', { request })
    else commands.tap('ai.send', { request, mode })
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (working) working.abort()
      else if (listening) listening.stop()
      else close()
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendTyped()
    } else if (event.key === 'Tab' && !event.shiftKey && instant?.band === 'likely' && !working) {
      // Tab takes the ⚡ suggestion: done at once, with no model.
      event.preventDefault()
      sendTyped(true)
    } else if (event.key === 'ArrowUp' && text === '' && last.current !== '') {
      event.preventDefault()
      setText(last.current)
    }
  }

  const undo = (change: Undo): void => {
    if (undoEdit(store, change)) setToast(null)
    else setToast({ text: CHANGED_SINCE, tone: 'error' })
  }

  // The box: below what is chosen; else above it; else, for a choice taller than the view, at the
  // foot of the view. Always on the desk, below the format bar, never over the app's bar.
  const place = (height: number, width: number): CSSProperties => {
    const desk = document.querySelector('.nw-desk')
    if (!spot) {
      const view = desk ? deskView(desk) : { ceiling: 120 }
      return { left: '50%', top: view.ceiling, transform: 'translateX(-50%)' }
    }
    const below = spot.bottom + GAP
    const above = spot.top - GAP - height
    const top = below + height <= spot.floor ? below : above >= spot.ceiling ? above : Math.max(spot.ceiling, spot.floor - height)
    return { left: Math.max(8, Math.min(spot.left, window.innerWidth - width - 8)), top }
  }

  // The ✨ button: in the page's right margin, level with the foot of what is chosen, kept in view.
  const beside = (size: number): CSSProperties =>
    spot
      ? { left: Math.max(8, Math.min(Math.round(spot.gutter - size / 2), window.innerWidth - size - 8)), top: Math.max(spot.ceiling, Math.min(spot.bottom - size, spot.floor - size)) }
      : place(size, size)

  const button =
    enabled && !open && spot && hasChoice(store) ? (
      <button
        type="button"
        className="nw-ai-button"
        aria-label="AI"
        title="Ask the AI to change this, or about it (Ctrl+K)"
        style={beside(36)}
        data-command="ai.open"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => commands.tap('ai.open')}
      >
        <Sparkles size={18} aria-hidden />
      </button>
    ) : null

  // Whether the model chosen now can see pictures: then a picture can go with the request.
  const canSee = open && ((chosen) => typeof chosen !== 'string' && chosen.caps.vision)(hostRef.current.model())

  const box = open ? (
    <div className="nw-ai-box" role="dialog" aria-label="AI" style={{ ...place(170, Math.min(BOX_WIDTH, window.innerWidth - 16)), width: Math.min(BOX_WIDTH, window.innerWidth - 16) }}>
      <div className="nw-ai-head">
        <div className="nw-segmented" role="radiogroup" aria-label="Mode">
          {(['edit', 'ask'] as const).map((value) => (
            <button key={value} type="button" role="radio" aria-checked={mode === value} disabled={working !== null} data-command="ai.open" onClick={() => commands.tap('ai.open', { mode: value })}>
              {value === 'edit' ? 'Edit' : 'Ask'}
            </button>
          ))}
        </div>
        <span className="nw-ai-hint">{mode === 'edit' ? 'Changes only what is chosen' : 'Answers without changing the note'}</span>
        <button type="button" className="nw-ibtn" aria-label="AI settings" title="AI settings" data-command="settings.open" onClick={() => hostRef.current.openSettings()}>
          <Settings2 size={16} aria-hidden />
        </button>
        <button type="button" className="nw-ibtn" aria-label="Close" title="Close (Esc)" data-command="ai.close" onClick={() => commands.tap('ai.close')}>
          <X size={16} aria-hidden />
        </button>
      </div>
      <div className="nw-ai-ask">
        <textarea
          ref={input}
          data-command="ai.send"
          autoFocus
          rows={2}
          aria-label={mode === 'edit' ? 'What should change?' : 'What do you want to know?'}
          placeholder={mode === 'edit' ? 'What should change? For example: make this a table' : 'What do you want to know?'}
          value={text}
          readOnly={working !== null}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(event) => {
            const files = pictureFiles(event.clipboardData)
            if (files.length === 0) return
            event.preventDefault()
            void addPictures(store, files, boxSpot(store))
            close()
          }}
        />
        {speech() ? (
          <button
            type="button"
            className="nw-ai-tool"
            aria-label={listening ? 'Stop listening' : 'Speak'}
            aria-pressed={listening !== null}
            title={inWindowsApp() ? "Speak the request: Windows turns your voice into text, with Microsoft's online speech service, and only while this is pressed." : "Speak the request: the browser turns your voice into English text. Edge does it with Microsoft's online speech service, and only while this is pressed."}
            disabled={working !== null}
            onClick={listen}
          >
            <Mic size={17} aria-hidden />
          </button>
        ) : null}
        {canSee ? (
          <button type="button" className="nw-ai-tool" aria-label="Add a picture" title="Send a picture with the request: the model can see it" disabled={working !== null} onClick={() => files.current?.click()}>
            <ImagePlus size={17} aria-hidden />
          </button>
        ) : null}
        <input
          ref={files}
          type="file"
          accept={PICTURE_TYPES.join(',')}
          hidden
          aria-label="Picture to send"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            if (attached) URL.revokeObjectURL(attached.url)
            setAttached({ file, url: URL.createObjectURL(file) })
          }}
        />
        {working ? (
          <button type="button" className="nw-ai-send" data-stop="" aria-label="Stop" title="Stop: nothing changes (Esc)" data-command="ai.stop" onClick={() => commands.tap('ai.stop')}>
            <Square size={14} aria-hidden />
          </button>
        ) : (
          <button type="button" className="nw-ai-send" aria-label="Send" title="Send (Enter)" disabled={text.trim() === ''} data-command="ai.send" onClick={() => sendTyped()}>
            <ArrowUp size={18} aria-hidden />
          </button>
        )}
      </div>
      {instant && !working ? (
        instant.band === 'likely' ? (
          <button type="button" className="nw-ai-instant" data-band="likely" title="Do it now, with no model (Tab)" data-command="ai.instant" onClick={() => sendTyped(true)}>
            <Zap size={14} aria-hidden />
            <span>
              Did you mean: {instant.summary}? <kbd>Tab</kbd> does it at once; <kbd>Enter</kbd> asks the model.
            </span>
          </button>
        ) : (
          <p className="nw-ai-instant" data-band="instant" role="status">
            <Zap size={14} aria-hidden />
            <span>Instant, no model: {instant.summary}</span>
          </p>
        )
      ) : null}
      {attached ? (
        <div className="nw-ai-chip">
          <img src={attached.url} alt="" />
          <span>{attached.file.name}</span>
          <button type="button" className="nw-ibtn" aria-label="Remove the picture" title="Remove the picture" disabled={working !== null} onClick={detach}>
            <X size={14} aria-hidden />
          </button>
        </div>
      ) : null}
      {working ? (
        <>
          <p className="nw-ai-status" role="status">
            <LoaderCircle size={16} className="nw-spin" aria-hidden />
            {workingText(mode, progress)}
          </p>
          {mode === 'ask' && progress && progress.written > 0 ? <p className="nw-ai-partial">{progress.text}</p> : null}
        </>
      ) : listening ? (
        <p className="nw-ai-status" role="status">
          <Mic size={16} aria-hidden />
          Listening… speak now, in English.
        </p>
      ) : note ? (
        <p className="nw-ai-status" role={note.tone === 'error' ? 'alert' : 'status'} data-tone={note.tone}>
          {note.text}
        </p>
      ) : null}
    </div>
  ) : null

  const shownToast = toast ? (
    <div className="nw-ai-toast" role={toast.tone === 'error' ? 'alert' : 'status'} data-tone={toast.tone}>
      {toast.undo ? (
        <button type="button" className="nw-ai-toast-action" data-command="ai.undo" onClick={() => undo(toast.undo!)}>
          Undo
        </button>
      ) : null}
      <span>{toast.undo ? `· ${toast.text}` : toast.text}</span>
      <button type="button" className="nw-ibtn" aria-label="Dismiss" onClick={() => setToast(null)}>
        <X size={14} aria-hidden />
      </button>
    </div>
  ) : null

  return createPortal(
    <>
      {button}
      {box}
      {shownToast}
    </>,
    document.body,
  )
}
