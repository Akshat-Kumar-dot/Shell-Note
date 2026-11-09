// The choices log, kept in this browser (note control, step 5;): each shape a recipe or the shape rules chose, by the
// content's features only, and its undo. The person's own, on this device: never in a note, never sent. A learned
// chooser reads it later; until then it only grows, up to its last 2,000 entries.
import { setChoiceLog, type ChoiceEntry } from '@shellnote/editor'

const KEY = 'shellnote:choices'
const MOST = 2000

/** The entries kept, oldest first; none when the browser keeps nothing (a private window). */
export function choicesKept(): ChoiceEntry[] {
  try {
    const kept: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(kept) ? (kept as ChoiceEntry[]) : []
  } catch {
    return []
  }
}

/** Keep the editor's choices in this browser, from now on. */
export function keepChoices(): () => void {
  return setChoiceLog((entry) => {
    try {
      localStorage.setItem(KEY, JSON.stringify([...choicesKept(), entry].slice(-MOST)))
    } catch {
      // Storage full or blocked: the log is a help for later, never needed now.
    }
  })
}
