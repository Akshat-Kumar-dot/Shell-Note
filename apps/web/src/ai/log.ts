// The edit log: every AI request on a note, kept in this
// browser beside the note, in the library's `logs` store, and never in its
// file, so sharing a note never shares its prompts. Deleting a note for good
// deletes its log too. A sample note's log lasts only while it is open.
import { LogEntry } from '@shellnote/core'
import type { LogItem } from '@shellnote/editor'
import { get, transact } from '../storage/db.js'

/** The most entries kept for one note: the oldest go first. */
export const KEEP = 200

/** An entry read back is used only when it is still a log entry this app knows. */
const valid = (item: unknown): item is LogItem =>
  typeof item === 'object' && item !== null && LogEntry.safeParse((item as LogItem).entry).success && (!('undo' in item) || Array.isArray((item as LogItem).undo?.inverse))

export async function loadLog(note: string): Promise<LogItem[]> {
  const kept = await get<unknown[]>('logs', note)
  return Array.isArray(kept) ? kept.filter(valid) : []
}

export async function saveLog(note: string, items: readonly LogItem[]): Promise<void> {
  await transact(['logs'], async (store) => {
    store('logs').put(items.slice(-KEEP), note)
  })
}
