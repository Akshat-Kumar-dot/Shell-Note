// The choices log (note control, step 5; the design 6 of 19 October 2026): each shape a recipe or the shape rules
// chose, with the content's features only (never its words), and its correction when that request is undone, for a
// learned chooser later, as the pen learns from undo. Kept on the device by the app that gives the sink (the web app:
// the browser's own storage); never in the note, never sent anywhere.
import type { Features } from '@shellnote/core'
import type { EditorStore } from '../store.js'

/** One entry: a shape chosen, or (undone) that choice taken back. */
export interface ChoiceEntry {
  at: number
  /** The choice's own id, which its undo carries too. */
  id: string
  shape: string
  by: 'rules' | 'recipe'
  features: Features
  undone?: true
}

let sink: ((entry: ChoiceEntry) => void) | undefined

/** Where entries go, set by the app; returns the function that stops it. */
export function setChoiceLog(next: (entry: ChoiceEntry) => void): () => void {
  sink = next
  return () => {
    if (sink === next) sink = undefined
  }
}

/** The choices of each store not yet undone, newest last, with the blocks they made; and its listener. */
const pending = new WeakMap<EditorStore, { list: { entry: ChoiceEntry; made: string[] }[] }>()
/** How many choices of a note are watched for an undo: older ones are no longer one Undo away. */
const WATCHED = 20

/** A choice made by a request of the agent's: logged now, and again as undone if every block it made goes by an Undo. */
export function logChoice(store: EditorStore, choice: Omit<ChoiceEntry, 'at' | 'id'>, made: readonly string[]): void {
  if (!sink) return
  const entry: ChoiceEntry = { at: Date.now(), id: Math.random().toString(36).slice(2, 10), ...choice }
  sink(entry)
  let watched = pending.get(store)
  if (!watched) {
    const fresh = { list: [] as { entry: ChoiceEntry; made: string[] }[] }
    pending.set(store, fresh)
    watched = fresh
    store.subscribe((change) => {
      // Undo and redo are the changes not recorded as new history.
      if (change.recorded) return
      fresh.list = fresh.list.filter(({ entry: one, made: blocks }) => {
        if (blocks.length === 0 || blocks.some((id) => change.doc.block[id] !== undefined)) return true
        sink?.({ ...one, at: Date.now(), undone: true })
        return false
      })
    })
  }
  watched.list = [...watched.list, { entry, made: [...made] }].slice(-WATCHED)
}
