// The side panel's AI (the person's and ad, 18 October 2026), as a chat in the style of the person's notes RAG app (the
// same day): each question with its answer under it, a dotted thinking orb while the AI works, and a composer with +
// for a picture, the box, and send; under it, what to do (ask, a table, a flowchart, a summary of the transcript) and,
// for a thing made, where it goes (into the note, or the scratch pad). The picture: from one's own video file, one
// click takes the frame showing; from YouTube, the person's own screenshot pasted in, since an app may not capture
// YouTube's player (its policies, III.E.1). A thing made goes into what is chosen in the note, or the empty part of the
// page in view, as one undo step, in the AI log. Later: RAG, finding in one's notes.
import { logLine, NO_VISION, parsePipeTable, type Id, type Model } from '@shellnote/core'
import { ArrowUp, Film, ImagePlus, Plus, Square, X } from 'lucide-react'
import { ThinkingOrb, type OrbState } from 'thinking-orbs'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ClipboardEvent } from 'react'
import { PICTURE_TYPES } from '../../assets.js'
import { commands, type ChatMake, type ChatPlace } from '../../commands/index.js'
import { checkDiagram, prepareDiagrams } from '../../diagram.js'
import { useDismiss } from '../../dismiss.js'
import type { AiHost } from '../../ai/AiLayer.js'
import { aiAsk, aiEdit, fileData, isLatest, undoEdit, CHANGED_SINCE, type Undo } from '../../ai/run.js'
import { placeMenu } from '../../popover.js'
import { programWords } from '../../program/moment.js'
import type { EditorStore } from '../../store.js'
import { Shared, videoClock, videoShown } from '../../video/state.js'
import { addMade, emptyPartInView, putMade, type Made } from './made.js'

/** Where a thing made goes: straight into the note, or onto the scratch pad first. Each person's own. */
type Put = 'note' | 'pad'
const PUT_KEY = 'shellnote:ai-put'
function readPut(): Put {
  try {
    return localStorage.getItem(PUT_KEY) === 'pad' ? 'pad' : 'note'
  } catch {
    return 'note'
  }
}

/** What the send does. */
type Mode = 'ask' | 'table' | 'diagram' | 'summary'
const MODES: [Mode, string][] = [
  ['ask', 'Ask'],
  ['table', 'Table'],
  ['diagram', 'Flowchart'],
  ['summary', 'Summarise'],
]

/** A table, a diagram or a summary as the model wrote it, made fit for the scratch pad; or why it is not. */
async function madeFrom(kind: Made['kind'], answer: string): Promise<string> {
  if (kind === 'table') {
    const lines = answer.split('\n').map((line) => line.trim())
    const first = lines.findIndex((line) => line.startsWith('|'))
    const table = first < 0 ? '' : lines.slice(first, lines.findIndex((line, i) => i > first && !line.startsWith('|')) >>> 0).join('\n')
    if (!parsePipeTable(table)) throw new Error('The model did not write a table. Try again, or a larger model.')
    return table
  }
  if (kind === 'diagram') {
    const src = (/```(?:mermaid)?[ \t]*\n([\s\S]*?)\n```/u.exec(answer)?.[1] ?? answer).trim()
    const wrong = await checkDiagram(src)
    if (wrong) throw new Error(`The model's flowchart could not be drawn: ${wrong}`)
    return `\`\`\`mermaid\n${src}\n\`\`\``
  }
  return answer.trim()
}

/** The most of the transcript sent to be summarised, in characters: the part around where the video is. */
const SUMMARY_MOST = 6000

/** The frame a video file of one's own is showing, its crop kept, as a picture. */
function frameOf(video: HTMLVideoElement, crop: { x: number; y: number; w: number; h: number } | undefined): string | undefined {
  if (video.videoWidth === 0) return undefined
  const part = crop ?? { x: 0, y: 0, w: 1000, h: 1000 }
  const [sx, sy, sw, sh] = [(part.x * video.videoWidth) / 1000, (part.y * video.videoHeight) / 1000, (part.w * video.videoWidth) / 1000, (part.h * video.videoHeight) / 1000]
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(sw)
  canvas.height = Math.round(sh)
  canvas.getContext('2d')?.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.9)
}

/** The dotted thinking orb, with a line saying what it waits for: the line is what screen readers get. */
function Orb({ state, label }: { state: OrbState; label: string }) {
  return (
    <span className="nw-orb" role="status">
      <ThinkingOrb state={state} size={20} theme="auto" aria-hidden="true" />
      <span>{label}</span>
    </span>
  )
}

const NO_TURNS: Turn[] = []

/** The chat's modes as the commands name them: a flowchart is a diagram here. */
const MODE_OF: Record<ChatMake, Mode> = { ask: 'ask', table: 'table', flowchart: 'diagram', summary: 'summary' }
const MAKE_OF: Record<Mode, ChatMake> = { ask: 'ask', table: 'table', diagram: 'flowchart', summary: 'summary' }

/** One question and what came of it. */
interface Turn {
  id: number
  mode: Mode
  question: string
  picture?: string | undefined
  working: boolean
  answer?: string
  note?: { tone: 'info' | 'error'; text: string; undo?: Undo; pad?: boolean; settings?: boolean }
}

/** An answer's paragraphs and list items, as plain words. */
function Answer({ text }: { text: string }) {
  return (
    <div className="nw-turn-a">
      {text.split(/\n\s*\n/u).map((chunk, i) => {
        const lines = chunk.split('\n').filter((line) => line.trim() !== '')
        return lines.length > 0 && lines.every((line) => /^\s*(?:[-*•]|\d{1,3}[.)])\s+/u.test(line)) ? (
          <ul key={i}>
            {lines.map((line, j) => (
              <li key={j}>{line.replace(/^\s*(?:[-*•]|\d{1,3}[.)])\s+/u, '')}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{chunk}</p>
        )
      })}
    </div>
  )
}

let turns = 0

/**
 * The chat, kept while the tab is shut: the side panel draws only the tab open, and an answer may come while another
 * is (Open the scratch pad, or the transcript looked at). The question being typed and its picture are kept too. One
 * note's at a time; another note starts a new chat.
 */
interface Talk {
  doc: Id | undefined
  turns: Turn[]
  mode: Mode
  draft: string
  picture?: string | undefined
  working?: AbortController | undefined
}
const talk = new Shared<Talk>({ doc: undefined, turns: [], mode: 'ask', draft: '' })

export function AiTab({ store, host }: { store: EditorStore; host: AiHost | undefined }) {
  // The note's videos alone: a key typed changes nothing here.
  const list = useSyncExternalStore(store.subscribe, () => store.doc.media)
  // The programs written beside: their words kept, for Summarise, and for Ask when asked for.
  const sources = useSyncExternalStore(store.subscribe, () => store.doc.programs)
  const shown = useSyncExternalStore(videoShown.subscribe, videoShown.snapshot)
  const media = shown === undefined ? undefined : list?.find((m) => m.id === shown)
  const [put, setPut] = useState<Put>(readPut)
  const docId = store.doc.id
  const kept = useSyncExternalStore(talk.subscribe, talk.snapshot)
  const ours = kept.doc === docId
  const chat = ours ? kept.turns : NO_TURNS
  const mode = ours ? kept.mode : 'ask'
  const working = ours ? kept.working : undefined
  const text = ours ? kept.draft : ''
  const picture = ours ? kept.picture : undefined
  const keep = (change: (now: Talk) => Partial<Talk>): void => {
    const now = talk.value.doc === docId ? talk.value : { doc: docId, turns: [], mode: 'ask' as const, draft: '' }
    talk.set({ ...now, ...change(now) })
  }
  const setText = (to: string): void => keep(() => ({ draft: to }))
  const setPicture = (to: string | undefined): void => keep(() => ({ picture: to }))
  const setChat = (change: (now: Turn[]) => Turn[]): void => keep((now) => ({ turns: change(now.turns) }))
  const setMode = (to: Mode): void => keep(() => ({ mode: to }))
  const setWorking = (to: AbortController | undefined): void => keep(() => ({ working: to }))
  const [adding, setAdding] = useState(false)
  const [withWords, setWithWords] = useState(false)
  const files = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const plus = useRef<HTMLSpanElement>(null)
  const closeAdding = useCallback(() => setAdding(false), [])
  useDismiss(adding, plus, closeAdding)
  // A block, not an arrow's value: scrollIntoView now returns a promise, which React would take for a clean-up.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'nearest' })
  }, [chat])
  // A question kept while another tab was open gets its height back.
  useEffect(() => {
    const field = box.current
    if (!field?.value) return
    field.style.height = 'auto'
    field.style.height = `${Math.min(160, field.scrollHeight)}px`
  }, [])

  // The chat at the commands' disposal while its tab shows (app control): its buttons and the agent reach it alike.
  const own = useRef<(Omit<ChatPlace, 'line'> & { line: () => string }) | undefined>(undefined)
  const hosted = host !== undefined
  useEffect(() => {
    if (!hosted) return undefined
    const call = <K extends keyof ChatPlace>(key: K): ChatPlace[K] => ((...args: unknown[]) => (own.current![key] as (...a: unknown[]) => unknown)(...args)) as ChatPlace[K]
    return commands.provide('chat', { send: call('send'), choose: call('choose'), stop: call('stop'), frame: call('frame'), clearPicture: call('clearPicture'), putAnswer: call('putAnswer'), paid: call('paid'), line: call('line') })
  }, [hosted])

  if (!host) return <p className="nw-video-note">The AI is not here: open a note to edit it.</p>

  // An answer for a note no longer open is dropped with its chat.
  const update = (id: number, change: Partial<Turn>): void => {
    if (talk.value.doc === docId) setChat((now) => now.map((turn) => (turn.id === id ? { ...turn, ...change } : turn)))
  }
  const start = (question: string, sent: Mode): number => {
    const id = ++turns
    setChat((now) => [...now, { id, mode: sent, question, picture, working: true }])
    return id
  }
  const failed = (id: number, error: unknown): void => update(id, { working: false, note: { tone: 'error', text: error instanceof Error ? error.message : String(error), settings: true } })

  const takeFrame = (): void => {
    setAdding(false)
    commands.tap('chat.frame')
  }
  const paste = (event: ClipboardEvent): void => {
    const file = [...event.clipboardData.files].find((f) => PICTURE_TYPES.includes(f.type))
    if (!file) return
    event.preventDefault()
    void fileData(file).then(setPicture)
  }

  /** The model, or why there is none, said in the chat. */
  const model = (id: number): Model | undefined => {
    const chosen = host.model()
    if (typeof chosen !== 'string') return chosen
    update(id, { working: false, note: { tone: 'error', text: chosen, settings: true } })
    return undefined
  }
  const sees = (id: number, m: Model, withPicture: boolean): boolean => {
    if (!withPicture || !picture || m.caps.vision) return true
    update(id, { working: false, note: { tone: 'info', text: NO_VISION } })
    return false
  }

  const read = sources ? programWords(store.doc, SUMMARY_MOST) : undefined

  const ask = async (question: string): Promise<number> => {
    const id = start(question, 'ask')
    const m = model(id)
    if (!m || !sees(id, m, true)) return id
    const stop = new AbortController()
    setWorking(stop)
    try {
      const asked = await aiAsk(store, { question: withWords && read ? `${question}\n\n${read}` : question, model: m, signal: stop.signal, ...(picture ? { picture } : {}) })
      host.logged(asked.log)
      if (asked.stopped) update(id, { working: false, note: { tone: 'info', text: 'Stopped.' } })
      else if (asked.answer.trim() === '') update(id, { working: false, note: { tone: 'error', text: 'The model gave no answer. Try again, or a larger model (Settings, under AI).', settings: true } })
      else update(id, { working: false, answer: asked.answer })
    } catch (error) {
      failed(id, error)
    } finally {
      setWorking(undefined)
    }
    return id
  }

  /** A thing made onto the scratch pad: asked for as text, checked, and kept there until put into the note. */
  const makeOnPad = async (sent: Mode, kind: Made['kind'], about: string, question: string, withPicture: boolean): Promise<number> => {
    const id = start(about, sent)
    const m = model(id)
    if (!m || !sees(id, m, withPicture)) return id
    const stop = new AbortController()
    setWorking(stop)
    try {
      if (kind === 'diagram') prepareDiagrams()
      const asked = await aiAsk(store, { question, model: m, signal: stop.signal, ...(withPicture && picture ? { picture } : {}) })
      host.logged(asked.log)
      if (asked.stopped) update(id, { working: false, note: { tone: 'info', text: 'Stopped.' } })
      else {
        addMade(store.doc.id, { kind, about, text: await madeFrom(kind, asked.answer) })
        update(id, { working: false, note: { tone: 'info', text: 'On the scratch pad.', pad: true } })
      }
    } catch (error) {
      failed(id, error)
    } finally {
      setWorking(undefined)
    }
    return id
  }

  /** A thing made into the note: into what is chosen, or the empty part of the page in view. */
  const make = async (sent: Mode, about: string, instruction: string, withPicture: boolean): Promise<number> => {
    const id = start(about, sent)
    const m = model(id)
    if (!m || !sees(id, m, withPicture)) return id
    const chosen = store.selection.blocks.length > 0 || store.selection.here !== undefined
    if (!chosen) {
      const room = emptyPartInView(store)
      if (!room) {
        update(id, { working: false, note: { tone: 'info', text: 'No room left on this page: choose where it goes in the note first (a Select box), then ask again.' } })
        return id
      }
      store.select({ blocks: [], here: room }, 'objects')
    }
    const stop = new AbortController()
    setWorking(stop)
    try {
      prepareDiagrams()
      const recent = host.recent().filter((entry) => entry.result === 'applied').slice(-3).map(logLine)
      const edit = await aiEdit(store, { instruction, model: m, signal: stop.signal, recent, checks: { mermaid: checkDiagram }, ...(withPicture && picture ? { attachment: picture } : {}) })
      let undo = edit.undo
      if (undo) {
        // The layout the edit set off joins its step.
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
        if (isLatest(store, undo)) undo = { ...undo, rev: store.doc.rev }
      }
      host.logged(edit.entry, undo)
      update(id, { working: false, note: undo ? { tone: 'info', text: 'Made, and put in the note.', undo } : { tone: edit.entry.result === 'failed' ? 'error' : 'info', text: edit.message ?? 'Nothing was changed.' } })
    } catch (error) {
      failed(id, error)
    } finally {
      setWorking(undefined)
    }
    return id
  }

  /** The transcript around where the video is, or all of it when short, as text. */
  const transcriptNow = (): string | undefined => {
    const lines = media?.transcript
    if (!lines || lines.length === 0) return undefined
    const all = lines.map((line) => line.text).join('\n')
    if (all.length <= SUMMARY_MOST) return all
    const clock = videoClock.value
    const now = clock && clock.media === media.id ? clock.time() * 10 : 0
    const at = Math.max(0, lines.findIndex((line) => line.t > now) - 1)
    let [from, to] = [at, at]
    let size = lines[at]!.text.length
    while (size < SUMMARY_MOST && (from > 0 || to < lines.length - 1)) {
      if (from > 0) size += lines[--from]!.text.length + 1
      if (to < lines.length - 1 && size < SUMMARY_MOST) size += lines[++to]!.text.length + 1
    }
    return lines
      .slice(from, to + 1)
      .map((line) => line.text)
      .join('\n')
  }
  const transcript = transcriptNow()
  const about = text.trim()
  // None on a note with no programs: the transcript and the chat are as they were.
  const toSummarise = transcript ?? read

  /** What the send button says and does, for the mode chosen. */
  const sendLabel = mode === 'ask' ? 'Ask' : mode === 'summary' ? (transcript === undefined && read !== undefined ? 'Summarise what the programs showed' : 'Summarise the transcript') : `Make a ${mode === 'table' ? 'table' : 'flowchart'}${put === 'note' ? ' into the note' : ''}`
  /** Why a request cannot go in this mode now; undefined when it can. */
  const cannot = (sent: Mode, question: string): string | undefined => {
    if (working) return 'The AI chat is working: stop it first (chat.stop), or wait for it.'
    if (sent === 'summary') return toSummarise === undefined ? 'There is no transcript to summarise: the video shown needs one first (transcript.paste).' : undefined
    if (sent === 'ask') return question === '' ? 'Nothing to ask: write the question.' : undefined
    return question === '' && picture === undefined ? `Say what the ${sent === 'table' ? 'table' : 'flowchart'} is of, or give it a picture.` : undefined
  }
  const canSend = cannot(mode, about) === undefined
  /** Send a request in a mode, a thing made going `where`; the turn it made. */
  const sendWith = (sent: Mode, where: Put, question: string): Promise<number> => {
    const of = question || 'what the picture shows'
    const asked =
      sent === 'ask'
        ? ask(question)
        : sent === 'summary'
          ? ((q: string) => (where === 'pad' ? makeOnPad('summary', 'text', 'the transcript', q, false) : make('summary', 'Summarise the transcript', q, false)))(`Summarise ${transcript === undefined ? 'what the other programs showed' : "this part of the video's transcript"} as a few short points${where === 'pad' ? ', one per line starting with "- "' : ''}:\n${toSummarise}`)
          : sent === 'table'
            ? where === 'pad'
              ? makeOnPad('table', 'table', of, `Make a table of ${of}. Answer with only a Markdown pipe table.`, true)
              : make('table', `A table of ${of}`, `Make a table of ${of}.`, true)
            : where === 'pad'
              ? makeOnPad('diagram', 'diagram', of, `Draw ${of} as a flowchart. Answer with only Mermaid flowchart code.`, true)
              : make('diagram', `A flowchart of ${of}`, `Draw ${of} as a flowchart.`, true)
    if (sent !== 'summary') setText('')
    if (box.current) box.current.style.height = ''
    return asked
  }
  /** The send button and Enter: through the commands (chat.send), as the agent sends. */
  const send = (): void => {
    if (canSend) commands.tap('chat.send')
  }
  const choosePut = (where: Put): void => {
    setPut(where)
    try {
      localStorage.setItem(PUT_KEY, where)
    } catch {
      // Storage is off: it lasts until the page closes.
    }
  }
  /** The latest answer in the chat, put into the note: into what is chosen, or the empty part of the page in view. */
  const putLatest = (): string => {
    const answered = [...chat].reverse().find((turn) => turn.answer !== undefined)
    if (!answered) throw new Error('The chat has no answer to put in yet.')
    const chosen = store.selection.blocks.length > 0 || store.selection.here !== undefined
    if (!putMade(store, answered.answer!, chosen ? undefined : emptyPartInView(store))) throw new Error('There is no room for it on the page in view: choose where it goes first (select.blocks), then try again.')
    return `the answer to "${answered.question}" put into the note, one undo step`
  }
  own.current = {
    send: async (request, make, where) => {
      const sent = make === undefined ? mode : MODE_OF[make]
      const to = where ?? put
      if (make !== undefined) setMode(sent)
      if (where !== undefined) choosePut(to)
      const question = (request ?? text).trim()
      const why = cannot(sent, question)
      if (why) throw new Error(why)
      const id = await sendWith(sent, to, question)
      const turn = talk.value.turns.find((t) => t.id === id)
      if (turn?.answer !== undefined) return `answered: ${turn.answer.trim()}`
      if (turn?.note && turn.note.tone !== 'error' && (turn.note.undo !== undefined || turn.note.pad === true)) return `${turn.note.text}${turn.note.undo ? ' One undo step (ai.undo takes it back).' : ' (pad.put puts it into the note.)'}`
      throw new Error(turn?.note?.text ?? 'Nothing came back.')
    },
    choose: (make, where) => {
      if (make !== undefined) setMode(MODE_OF[make])
      if (where !== undefined) choosePut(where)
      const next = make === undefined ? mode : MODE_OF[make]
      const to = where ?? put
      return next === 'ask' ? 'next, the chat answers' : `next, the chat makes ${next === 'summary' ? 'a summary of the transcript' : `a ${MAKE_OF[next]}`}, into ${to === 'pad' ? 'the scratch pad' : 'the note'}`
    },
    stop: () => {
      if (!working) return 'the AI chat is not working'
      working.abort()
      return 'stopped: nothing changed'
    },
    frame: () => {
      const video = document.querySelector<HTMLVideoElement>('.nw-video-file video')
      const frame = video && media?.kind === 'file' ? frameOf(video, media.crop) : undefined
      if (!frame) throw new Error(media?.kind === 'youtube' ? "A frame of YouTube's player cannot be taken (its policies): the person can paste their own screenshot." : 'No video file of your own is shown: video.show one first.')
      setPicture(frame)
      return 'the frame showing will go with the next request'
    },
    clearPicture: () => {
      if (picture === undefined) return 'no picture was waiting'
      setPicture(undefined)
      return 'picture taken away'
    },
    putAnswer: putLatest,
    paid: () => host.paid?.() ?? false,
    line: () => `AI chat: ${chat.length} ${chat.length === 1 ? 'turn' : 'turns'} · next: ${MAKE_OF[mode]}${mode === 'ask' ? '' : `, into ${put === 'pad' ? 'the scratch pad' : 'the note'}`}${working ? ' · working' : ''}${picture ? ' · a picture waiting' : ''}`,
  }
  const placeholder = mode === 'ask' ? 'Ask about the video, a picture, or the note…' : mode === 'summary' ? (transcript ? 'Press send to summarise the transcript' : read ? 'Press send to summarise what the programs showed' : 'Paste the transcript first (the Transcript tab)') : `What the ${mode === 'table' ? 'table' : 'flowchart'} is of…`

  return (
    <div className="nw-chat" onPaste={paste}>
      <div className="nw-chat-scroll">
        {chat.length === 0 ? (
          <div className="nw-chat-hero">
            <h2>What would you like to know?</h2>
            <p>{media?.kind === 'youtube' ? 'About the video: paste a screenshot of it (Win+Shift+S, then Ctrl+V here), or just ask.' : media?.kind === 'file' ? 'About the video: + takes the frame showing, or just ask.' : 'Ask, or make a table, a flowchart or a summary into the note.'}</p>
          </div>
        ) : (
          chat.map((turn) => (
            <article className="nw-turn" key={turn.id}>
              <h3 className="nw-turn-q">{turn.question}</h3>
              {turn.picture ? <img className="nw-turn-pic" src={turn.picture} alt="" /> : null}
              {turn.working ? <Orb state={turn.mode === 'ask' ? 'composing' : 'weaving'} label={turn.mode === 'ask' ? 'Thinking…' : 'Making it…'} /> : null}
              {turn.answer ? <Answer text={turn.answer} /> : null}
              {turn.answer ? (
                <button type="button" className="nw-chat-small" data-command="chat.putAnswer" onClick={() => putMade(store, turn.answer!, store.selection.blocks.length > 0 || store.selection.here !== undefined ? undefined : emptyPartInView(store))}>
                  Put into the note
                </button>
              ) : null}
              {turn.note ? (
                <p className={turn.note.tone === 'error' ? 'nw-turn-note nw-turn-err' : 'nw-turn-note'} role={turn.note.tone === 'error' ? 'alert' : 'status'}>
                  {turn.note.text}{' '}
                  {turn.note.undo ? (
                    <button type="button" className="nw-chat-small" data-command="ai.undo" onClick={() => update(turn.id, { note: undoEdit(store, turn.note!.undo!) ? { tone: 'info', text: 'Undone.' } : { tone: 'error', text: CHANGED_SINCE } })}>
                      Undo
                    </button>
                  ) : null}
                  {turn.note.pad ? (
                    <button
                      type="button"
                      className="nw-chat-small"
                      data-command="output.made"
                      onClick={() => commands.tap('output.made')}
                    >
                      Open the scratch pad
                    </button>
                  ) : null}
                  {turn.note.settings ? (
                    <button type="button" className="nw-chat-small" data-command="settings.open" onClick={host.openSettings}>
                      Settings
                    </button>
                  ) : null}
                </p>
              ) : null}
            </article>
          ))
        )}
        <div ref={bottom} />
      </div>

      <div className="nw-chat-foot">
        {picture ? (
          <div className="nw-chat-chip">
            <img src={picture} alt="The picture sent with the question" />
            <span>Picture</span>
            <button type="button" aria-label="Take the picture away" data-command="chat.clearPicture" onClick={() => commands.tap('chat.clearPicture')}>
              <X size={13} aria-hidden />
            </button>
          </div>
        ) : null}
        <div className="nw-chat-composer">
          <span className="nw-chat-plus" ref={plus}>
            <button type="button" className="nw-chat-icon" aria-label="Add a picture" aria-haspopup="menu" aria-expanded={adding} title="A picture for the AI" onClick={() => setAdding(!adding)}>
              <Plus size={18} aria-hidden />
            </button>
            {adding ? (
              <div ref={placeMenu} className="nw-popover nw-chat-menu" role="menu" aria-label="A picture for the AI">
                {media?.kind === 'file' ? (
                  <button type="button" role="menuitem" className="nw-bar-place" data-command="chat.frame" onClick={takeFrame}>
                    <Film size={14} aria-hidden /> Take this frame
                  </button>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  className="nw-bar-place"
                  onClick={() => {
                    setAdding(false)
                    files.current?.click()
                  }}
                >
                  <ImagePlus size={14} aria-hidden /> A picture file
                </button>
                <p className="nw-video-note">Or paste one here: Ctrl+V.</p>
              </div>
            ) : null}
          </span>
          <input
            ref={files}
            type="file"
            accept={PICTURE_TYPES.join(',')}
            hidden
            aria-label="Picture file for the AI"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void fileData(file).then(setPicture)
            }}
          />
          <textarea
            ref={box}
            data-command="chat.send"
            rows={1}
            aria-label="Ask the AI, or say what to make"
            placeholder={placeholder}
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              event.target.style.height = 'auto'
              event.target.style.height = `${Math.min(160, event.target.scrollHeight)}px`
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                send()
              }
            }}
          />
          {working ? (
            <button type="button" className="nw-chat-send" aria-label="Stop" title="Stop" data-command="chat.stop" onClick={() => commands.tap('chat.stop')}>
              <Square size={13} aria-hidden fill="currentColor" />
            </button>
          ) : (
            <button type="button" className="nw-chat-send" aria-label={sendLabel} title={sendLabel} disabled={!canSend} data-command="chat.send" onClick={send}>
              <ArrowUp size={18} aria-hidden />
            </button>
          )}
        </div>
        <div className="nw-chat-pills" role="radiogroup" aria-label="What to do">
          {MODES.map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={mode === value} data-command="chat.choose" onClick={() => commands.tap('chat.choose', { make: MAKE_OF[value] })}>
              {label}
            </button>
          ))}
        </div>
        {mode === 'ask' && read ? (
          <label className="nw-video-switch">
            <input type="checkbox" checked={withWords} onChange={(event) => setWithWords(event.target.checked)} /> Use what the programs showed
          </label>
        ) : null}
        {mode !== 'ask' ? (
          <div className="nw-chat-pills nw-chat-pills-small" role="radiogroup" aria-label="Where what is made goes">
            {(['note', 'pad'] as const).map((where) => (
              <button key={where} type="button" role="radio" aria-checked={put === where} data-command="chat.choose" onClick={() => commands.tap('chat.choose', { put: where })}>
                {where === 'note' ? 'Into the note' : 'On the scratch pad'}
              </button>
            ))}
          </div>
        ) : null}
        <p className="nw-chat-later">Later: finding in your notes to answer (RAG).</p>
      </div>
    </div>
  )
}
