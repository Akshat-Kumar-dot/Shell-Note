// One AI request from the editor: an edit, a question, or
// an answer put into the note. A request reads the note and the selection as
// they are when it is sent. An edit comes back as core's operations and is
// applied as one undo step, unless a block it touches changed while the model
// worked, by typing say: then nothing changes, and the person is told.
import {
  answerOps,
  idTaken,
  MAX_WHY,
  newId,
  parseInline,
  plainText,
  runAsk,
  runEdit,
  ValidationError,
  type AskOutcome,
  type Doc,
  type EditOutcome,
  type EditRequest,
  type Id,
  type LogEntry,
  type Model,
  type Op,
  type Selection,
  type StepProgress,
  type WordRange,
} from '@shellnote/core'
import type { EditorStore } from '../store.js'

/** What a person is told when the note changed where an edit was going. */
export const STALE = 'The note changed where the AI was working, so nothing was changed. Ask again.'
/** What a person is told when an edit cannot be undone from the log any more. */
export const CHANGED_SINCE = 'Those blocks have changed since, so this edit cannot be undone from here. Undo (Ctrl+Z) still steps back through every change.'

export interface EditOptions {
  instruction: string
  model: Model
  /** A larger model that writes content. */
  writer?: Model
  /** The person's Stop. */
  signal?: AbortSignal
  /** Let tier 0 answer without a model. Default true; replaying the benchmark turns it off, as the benchmark does. */
  tier0?: boolean
  /** Recent AI edits as short lines, for "the same for this one". */
  recent?: readonly string[]
  /** Checks that need the browser, such as Mermaid parsing a diagram. */
  checks?: EditRequest['checks']
  /** A picture sent with the request, as a data URL: the model reads it; it is not put in the note. */
  attachment?: string
  /** Told as the content is written, for the person waiting: the edit is the same. */
  progress?: (progress: StepProgress) => void
  /** The person took the ⚡ suggestion the prompt box showed: a likely reading runs with no model. */
  acceptSuggestion?: boolean
}

/** What undoes an applied edit, kept in the edit log. */
export interface Undo {
  inverse: Op[]
  /**
   * The note's rev just after the edit, and the layout it set off (a frame's
   * height): its blocks are as it left them while none has changed since.
   */
  rev: number
}

/**
 * Whether an edit is still the latest undo step. The editor may join the
 * layout an edit sets off to its step, so the step's undo ends with the
 * edit's own, the very same operations.
 */
export function isLatest(store: EditorStore, undo: Undo): boolean {
  const step = store.history.done.at(-1)
  if (!step || step.undo.length < undo.inverse.length) return false
  const tail = step.undo.slice(step.undo.length - undo.inverse.length)
  return undo.inverse.length > 0 && tail.every((op, i) => op === undo.inverse[i])
}

/** An AI edit, as the editor reports it. */
export interface AiEdit {
  outcome: EditOutcome
  /** The entry for the edit log: the outcome's, or a failure when the note changed meanwhile. */
  entry: LogEntry
  /** Set when the edit was applied: what undoes it. */
  undo?: Undo
  /** What the person is told when nothing changed. */
  message?: string
}

/** A picture's bytes as a data URL, for a request that reads it. */
async function pictureData(store: EditorStore, asset: string): Promise<string | undefined> {
  const blob = store.assets.blob(asset)
  return blob ? fileData(blob) : undefined
}

/** Said after every failure: what a person can do next. */
const NEXT = 'Nothing was changed. Try saying it another way, or a larger model (Settings, under AI).'

/**
 * A failure in words for the person. The teaching error behind it is
 * written for the model, with its code, aliases and block ids; it stays in
 * the AI log.
 */
export function forPerson(error: string): string {
  const [code = '', ...rest] = error.split(': ')
  const hint = rest.join(': ')
  if (code === 'scope') return `The model tried to change something outside what you chose. ${NEXT}`
  if (code === 'content') {
    if (/HTML/u.test(hint)) return `The model wrote HTML tags, which a note does not hold. ${NEXT}`
    if (/Mermaid|diagram/iu.test(hint)) return `The model wrote a diagram that cannot be drawn. ${NEXT}`
    if (/table/iu.test(hint)) return `The model wrote a table that cannot be read. ${NEXT}`
    return `The model wrote something the note cannot hold. ${NEXT}`
  }
  if (code === 'bad_value' && /is words, not a block/u.test(hint)) {
    return 'Size, font, alignment and the kind of line apply to whole paragraphs, not to some of their words. Choose the whole paragraph, then ask again. Nothing was changed.'
  }
  if (code === 'too_many') return `The model tried to make several changes at once. Ask for one change at a time. Nothing was changed.`
  if (code === 'no_change') return 'Nothing to change: the note already looks like that.'
  return `The model's answer did not fit what you chose. ${NEXT}`
}

/** Why an edit changed nothing, in words for the person. */
function messageFor(outcome: EditOutcome): string {
  if (outcome.stopped) return 'Stopped. Nothing was changed.'
  // A model's reason stops at the reply's limit, often mid-word: it says so, rather than end on half a word.
  if (outcome.declined !== undefined) return outcome.declined.length >= MAX_WHY && !/[.!?…]$/u.test(outcome.declined) ? `${outcome.declined.trimEnd()}…` : outcome.declined
  if (outcome.error !== undefined) return forPerson(outcome.error)
  return 'Nothing to change: the note already looks like that.'
}

const textOf = (doc: Doc, id: Id): string | undefined => {
  const block = doc.block[id]
  return block?.type === 'text' ? plainText(parseInline(block.md)) : undefined
}

/**
 * The blocks and the Select box stay chosen after an edit, so another request
 * can follow; chosen words only while their block's text is as it was, since
 * a rewrite moves them. A selection made by typing is the text's own to keep.
 */
function keepChosen(store: EditorStore, before: Doc): void {
  if (store.selectionKind !== 'objects') return
  const { doc, selection } = store
  const same = (piece: WordRange): boolean => textOf(doc, piece.block) !== undefined && textOf(doc, piece.block) === textOf(before, piece.block)
  const words = selection.words?.filter(same)
  const next: Selection = {
    blocks: selection.blocks.filter((id) => doc.block[id] !== undefined),
    ...(selection.range && same(selection.range) ? { range: selection.range } : {}),
    ...(words && words.length > 0 ? { words } : {}),
    ...(selection.here ? { here: selection.here } : {}),
  }
  store.select(next, 'objects')
}

/** Run an edit on what is selected, and apply it as one undo step. */
export async function aiEdit(store: EditorStore, options: EditOptions): Promise<AiEdit> {
  const base = store.doc
  const outcome = await runEdit({
    doc: base,
    selection: store.selection,
    instruction: options.instruction,
    model: options.model,
    ...(options.writer ? { writer: options.writer } : {}),
    ...(options.tier0 === false ? { tier0: false } : {}),
    ...(options.acceptSuggestion ? { acceptSuggestion: true } : {}),
    ...(options.recent ? { recent: options.recent } : {}),
    ...(options.checks ? { checks: options.checks } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.attachment === undefined ? {} : { attachment: options.attachment }),
    ...(options.progress ? { progress: options.progress } : {}),
    picture: (asset) => pictureData(store, asset),
    source: 'app',
  })
  if (outcome.log.result !== 'applied' || outcome.applied.length === 0) return { outcome, entry: outcome.log, message: messageFor(outcome) }
  try {
    const applied = store.apply(outcome.applied, { origin: 'ai', baseRev: base.rev })
    keepChosen(store, base)
    return { outcome, entry: outcome.log, undo: { inverse: applied.inverse, rev: store.doc.rev } }
  } catch (error) {
    if (!(error instanceof ValidationError) || error.code !== 'stale') throw error
    return { outcome, entry: { ...outcome.log, result: 'failed', error: STALE }, message: STALE }
  }
}

/**
 * Undo an AI edit: Undo itself while it is the latest change, so Redo brings
 * it back; else its own undo, as a new step, while its blocks are as it left
 * them. False when they have changed since.
 */
export function undoEdit(store: EditorStore, undo: Undo): boolean {
  if (isLatest(store, undo)) return store.undo()
  try {
    store.apply(undo.inverse, { origin: 'ai', baseRev: undo.rev })
    return true
  } catch (error) {
    if (error instanceof ValidationError && error.code === 'stale') return false
    throw error
  }
}

/**
 * Ask about what is selected. The note never changes. A model that can see
 * pictures also gets one: the picture attached in the prompt box, as a data
 * URL, or else the first picture chosen in the note.
 */
export async function aiAsk(store: EditorStore, options: { question: string; model: Model; signal?: AbortSignal; picture?: string; progress?: (progress: StepProgress) => void }): Promise<AskOutcome> {
  const chosen = store.selection.blocks.map((id) => store.doc.block[id]).find((block) => block?.type === 'image')
  const picture = !options.model.caps.vision ? undefined : (options.picture ?? (chosen?.type === 'image' ? await pictureData(store, chosen.asset) : undefined))
  return runAsk({
    doc: store.doc,
    selection: store.selection,
    question: options.question,
    model: options.model,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(picture === undefined ? {} : { picture }),
    ...(options.progress ? { progress: options.progress } : {}),
    source: 'app',
  })
}

/** A picture file as a data URL, to go with a question. */
export async function fileData(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${file.type};base64,${btoa(binary)}`
}

/**
 * Put an answer into the note, as one ordinary undo step with no model call:
 * into the Select box or after the selection it was asked about. False when
 * there is nowhere to put it any more.
 */
export function insertAnswer(store: EditorStore, answer: string, selection: Selection): boolean {
  const doc = store.doc
  const made = new Set<Id>()
  const fresh = (): Id => {
    const id = newId((candidate) => idTaken(doc, candidate) || made.has(candidate))
    made.add(id)
    return id
  }
  const ops = answerOps(doc, selection, answer, fresh)
  if (ops.length === 0) return false
  try {
    store.apply(ops, { origin: 'ai' })
    return true
  } catch (error) {
    console.warn('shellnote: the answer could not be put in', error)
    return false
  }
}
