// Moving the note this browser kept before the library existed (storage version
// 1) into the library, once, without ever losing it: copy it, read the copy
// back, compare, and only then mark the move done. The old store is never
// deleted here. If anything fails, the move is not marked done, so it is tried
// again at the next start, and the old note is still where it was.
import { parseDoc, type Doc } from '@shellnote/core'
import type { FileState } from '../storage/cache.js'
import type { NoteEntry } from '@shellnote/library'
import { entryFor } from '@shellnote/library/tree'

/** The note as version 1 kept it. */
export interface OldNote {
  doc: Doc
  assets: Map<string, Blob>
  file?: FileState
}

/** What the move needs from storage; the browser's comes from indexeddb.ts, a test's from memory. */
export interface MigrationIO {
  /** True when the move was marked done before. */
  done(): Promise<boolean>
  /** The old note, checked; undefined when there was none. Throws when it is there but damaged. */
  readOld(): Promise<OldNote | undefined>
  /** Write the copy into the library, all at once: the note, its entry, and its pictures. */
  write(note: OldNote, entry: NoteEntry): Promise<void>
  /** Read the copy back. */
  readBack(id: string): Promise<{ doc: unknown; entry: NoteEntry | undefined; assets: ReadonlySet<string> }>
  /** Mark the move done, with the id of the note moved, or null when there was none. */
  markDone(record: { at: number; note: string | null }): Promise<void>
}

/** JSON with keys in a fixed order, so two equal documents read the same however their keys were stored. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === 'object' && !Array.isArray(inner) ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : inner,
  )
}

/** A document, checked, or undefined when it does not read. */
function readable(doc: unknown): Doc | undefined {
  try {
    return doc === undefined ? undefined : parseDoc(doc)
  } catch {
    return undefined
  }
}

/** True when two documents are the same, field for field. */
export function sameDoc(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b)
}

export type MigrationResult = { state: 'already' } | { state: 'nothing' } | { state: 'moved'; note: string }

/** Move the old note into the library once. Throws, leaving the old note and the "done" mark as they were, when the copy does not read back the same. */
export async function migrateOldNote(io: MigrationIO, now: number): Promise<MigrationResult> {
  if (await io.done()) return { state: 'already' }
  const old = await io.readOld()
  if (!old) {
    await io.markDone({ at: now, note: null })
    return { state: 'nothing' }
  }
  // Copied once before, but not marked done (the browser closed in between): a copy as new as the old note, or newer because it was edited since, is kept.
  const earlier = await io.readBack(old.doc.id)
  const kept = earlier.entry?.id === old.doc.id ? readable(earlier.doc) : undefined
  if (kept && kept.rev >= old.doc.rev) {
    await io.markDone({ at: now, note: old.doc.id })
    return { state: 'moved', note: old.doc.id }
  }
  await io.write(old, entryFor(old.doc, old.file, now))
  const back = await io.readBack(old.doc.id)
  let copy: Doc
  try {
    copy = parseDoc(back.doc)
  } catch {
    throw new Error('The note kept in this browser was copied into the library, but the copy could not be read back, so the note is left where it was. It will be tried again next time.')
  }
  const picturesThere = [...old.assets.keys()].every((hash) => back.assets.has(hash))
  if (!sameDoc(copy, old.doc) || back.entry?.id !== old.doc.id || !picturesThere) {
    throw new Error('The note kept in this browser did not read back the same from the library, so it is left where it was. It will be tried again next time.')
  }
  await io.markDone({ at: now, note: old.doc.id })
  return { state: 'moved', note: old.doc.id }
}
