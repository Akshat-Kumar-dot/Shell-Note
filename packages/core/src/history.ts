// Undo and redo: two stacks of steps. apply() builds each
// inverse at the moment of the change, so a step stores only operations, and
// text changes are splices: a step costs the size of the change.
import { apply, type ApplyOptions } from './apply.js'
import type { Doc, Id } from './schema/doc.js'
import type { Op } from './schema/ops.js'

/** One undoable step: usually one transaction, or a run of typing merged together. */
export interface Step {
  /** Operations that redo the step. */
  redo: Op[]
  /** Operations that undo it. */
  undo: Op[]
  /** Steps that share a key and arrive close together merge into one, such as typing in one block. */
  key?: string
  /** When the step was last extended, in milliseconds. */
  at: number
}

export interface History {
  /** Steps that can be undone, oldest first. */
  readonly done: readonly Step[]
  /** Steps that can be redone, oldest first. */
  readonly undone: readonly Step[]
}

/** How many steps history keeps. The edit log is the record that persists. */
export const HISTORY_LIMIT = 500
/** Typing pauses shorter than this stay in the same step. */
export const MERGE_WINDOW_MS = 1000

export function emptyHistory(): History {
  return { done: [], undone: [] }
}

export interface RecordOptions {
  /** Merge with the previous step if it has this key and ended under `mergeWindowMs` ago. */
  key?: string
  /**
   * Join the previous step, whatever its key and age: for a change that
   * follows from it, such as the editor pushing text that no longer fits
   * onto the next page. Undo then takes back both at once.
   */
  join?: boolean
  /** Time of the change in milliseconds. Defaults to now. */
  at?: number
  limit?: number
  mergeWindowMs?: number
}

/** Record a transaction that was just applied. A new change clears the redo stack. */
export function record(history: History, ops: Op[], inverse: Op[], options: RecordOptions = {}): History {
  if (ops.length === 0) return history
  const { key } = options
  const at = options.at ?? Date.now()
  const last = history.done.at(-1)
  let done: Step[]
  if (options.join && last) {
    // The previous step keeps its key, so typing can carry on into it.
    done = [...history.done.slice(0, -1), { ...last, redo: [...last.redo, ...ops], undo: [...inverse, ...last.undo], at }]
  } else if (key !== undefined && last?.key === key && at - last.at < (options.mergeWindowMs ?? MERGE_WINDOW_MS)) {
    // Undo the newest change first: its inverse goes in front.
    done = [...history.done.slice(0, -1), { redo: [...last.redo, ...ops], undo: [...inverse, ...last.undo], key, at }]
  } else {
    done = [...history.done, key === undefined ? { redo: ops, undo: inverse, at } : { redo: ops, undo: inverse, key, at }]
  }
  return { done: done.slice(-(options.limit ?? HISTORY_LIMIT)), undone: [] }
}

export interface Moved {
  doc: Doc
  history: History
  changed: Id[]
}

/** Undo the latest step, or return null when there is nothing to undo. */
export function undo(history: History, doc: Doc, options?: ApplyOptions): Moved | null {
  const step = history.done.at(-1)
  if (!step) return null
  const result = apply(doc, step.undo, options)
  return {
    doc: result.doc,
    changed: result.changed,
    // The fresh inverse is exactly what redoes this step from the document as it is now.
    history: { done: history.done.slice(0, -1), undone: [...history.undone, { redo: result.inverse, undo: step.undo, at: step.at }] },
  }
}

/** Redo the latest undone step, or return null when there is nothing to redo. */
export function redo(history: History, doc: Doc, options?: ApplyOptions): Moved | null {
  const step = history.undone.at(-1)
  if (!step) return null
  const result = apply(doc, step.redo, options)
  return {
    doc: result.doc,
    changed: result.changed,
    // No key: typing after a redo starts a new step instead of merging into this one.
    history: { done: [...history.done, { redo: step.redo, undo: result.inverse, at: step.at }], undone: history.undone.slice(0, -1) },
  }
}
