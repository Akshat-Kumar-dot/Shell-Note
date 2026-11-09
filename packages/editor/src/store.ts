// The open document, its pictures' bytes, its undo history, and who is
// listening. Every change goes through core's apply, whether
// it comes from typing, the toolbar, undo, or later an AI edit, and each
// listener hears which blocks changed and who made the change, so the frame
// being typed in does not redraw what it already shows.
import { apply, emptyHistory, record, redo, undo, type Applied, type Doc, type History, type Id, type Op, type Selection } from '@shellnote/core'
import { AssetStore } from './assets.js'

export interface Change {
  doc: Doc
  /** Blocks, pages and the document id that changed. */
  changed: ReadonlySet<Id>
  /** Who made the change, such as the frame typed in; undefined for undo, redo and outside edits. */
  origin: string | undefined
  /** True for a new change, recorded in the history; false for undo and redo. */
  recorded: boolean
}

export interface StoreApplyOptions {
  origin?: string
  /** Changes with the same key in quick succession form one undo step, such as typing in one block. */
  key?: string
  /** Join the previous undo step: for a change that follows from it, such as text pushed onto the next page. */
  join?: boolean
  /**
   * For an AI edit: the rev of the note it was prepared from. When a block it
   * touches has changed since, as by typing while the model worked, it is
   * refused as `stale` and nothing changes.
   */
  baseRev?: number
}

/** Where a frame's editor puts the caret when it next takes the focus: in a block at an offset, or else at the end. */
export interface FocusRequest {
  frame: Id
  block?: Id
  offset?: number
}

const NOTHING: Selection = { blocks: [] }

/**
 * How a selection was made: by typing and moving the caret in text, or by
 * choosing blocks as objects (a click on a block on the page, Shift+click, the
 * Select tool's box). Delete removes blocks only when they were chosen as objects.
 */
export type SelectionKind = 'text' | 'objects'

/**
 * The tool in use, chosen in the bar: Type, the usual one; Select, a box that
 * takes only what is inside it; Free cursor, a click on
 * empty paper to start typing there; and the ink tools (phase 3): Pen,
 * Highlighter and Eraser (ink/PenLayer.tsx).
 */
export type Tool = 'type' | 'select' | 'free' | 'pen' | 'highlighter' | 'eraser'

/** The tools that put ink on the page or take it off. */
export const INK_TOOLS: readonly Tool[] = ['pen', 'highlighter', 'eraser']
export const isInkTool = (tool: Tool): boolean => INK_TOOLS.includes(tool)

export class EditorStore {
  #doc: Doc
  #history: History = emptyHistory()
  #selection: Selection = NOTHING
  #kind: SelectionKind = 'text'
  #tool: Tool = 'type'
  readonly #listeners = new Set<(change: Change) => void>()
  readonly #selectionListeners = new Set<() => void>()
  readonly #toolListeners = new Set<() => void>()
  /** The bytes of the note's pictures. */
  readonly assets: AssetStore
  /** The page most on screen, kept up to date by the page view: where a picture goes when nothing is selected. */
  pageInView: Id | undefined
  /**
   * A frame whose editor takes the focus as soon as it is drawn: one just
   * made by typing on bare paper, or one that text with the caret in it was
   * pushed into.
   */
  focusRequest: FocusRequest | undefined

  constructor(doc: Doc, assets: AssetStore = new AssetStore()) {
    this.#doc = doc
    this.assets = assets
  }

  get doc(): Doc {
    return this.#doc
  }

  get history(): History {
    return this.#history
  }

  get canUndo(): boolean {
    return this.#history.done.length > 0
  }

  get canRedo(): boolean {
    return this.#history.undone.length > 0
  }

  /** What the person has selected, in core's terms: blocks, and words inside one block. */
  get selection(): Selection {
    return this.#selection
  }

  /** The tool in use. */
  get tool(): Tool {
    return this.#tool
  }

  setTool(tool: Tool): void {
    if (tool === this.#tool) return
    this.#tool = tool
    for (const listener of [...this.#toolListeners]) listener()
  }

  /** Listen for the tool changing. Returns the function that stops listening. */
  subscribeTool = (listener: () => void): (() => void) => {
    this.#toolListeners.add(listener)
    return () => this.#toolListeners.delete(listener)
  }

  /** The tool now, for React's useSyncExternalStore. */
  toolSnapshot = (): Tool => this.#tool

  /** How the selection was made. */
  get selectionKind(): SelectionKind {
    return this.#kind
  }

  /** Set by the frame being typed in whenever its selection moves, or with kind 'objects' when blocks are chosen as objects. */
  select(selection: Selection, kind: SelectionKind = 'text'): void {
    if (kind === this.#kind && JSON.stringify(selection) === JSON.stringify(this.#selection)) return
    this.#selection = selection
    this.#kind = kind
    for (const listener of [...this.#selectionListeners]) listener()
  }

  /** Listen for selection changes. Returns the function that stops listening. */
  subscribeSelection = (listener: () => void): (() => void) => {
    this.#selectionListeners.add(listener)
    return () => this.#selectionListeners.delete(listener)
  }

  /** The selection now, for React's useSyncExternalStore. */
  selectionSnapshot = (): Selection => this.#selection

  /**
   * Apply one transaction as one undoable step, and return what it did, with
   * the operations that undo it. Throws a ValidationError and changes nothing
   * when it is invalid.
   */
  apply(ops: Op[], options: StoreApplyOptions = {}): Applied {
    if (ops.length === 0) return { doc: this.#doc, inverse: [], changed: [] }
    const result = apply(this.#doc, ops, options.baseRev === undefined ? {} : { baseRev: options.baseRev })
    this.#doc = result.doc
    this.#history = record(this.#history, ops, result.inverse, {
      ...(options.key === undefined ? {} : { key: options.key }),
      ...(options.join ? { join: true } : {}),
    })
    this.#emit(result.changed, options.origin, true)
    return result
  }

  undo(): boolean {
    const moved = undo(this.#history, this.#doc)
    if (!moved) return false
    this.#doc = moved.doc
    this.#history = moved.history
    this.#emit(moved.changed, undefined, false)
    return true
  }

  redo(): boolean {
    const moved = redo(this.#history, this.#doc)
    if (!moved) return false
    this.#doc = moved.doc
    this.#history = moved.history
    this.#emit(moved.changed, undefined, false)
    return true
  }

  /** Listen for changes. Returns the function that stops listening. */
  subscribe = (listener: (change: Change) => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** The document now, for React's useSyncExternalStore. */
  snapshot = (): Doc => this.#doc

  #emit(changed: readonly Id[], origin: string | undefined, recorded: boolean): void {
    const change: Change = { doc: this.#doc, changed: new Set(changed), origin, recorded }
    for (const listener of [...this.#listeners]) listener(change)
  }
}
