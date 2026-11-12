// The working copy of storage version 1: the one open note, kept in this
// browser's IndexedDB. Since version 2 the library keeps every note
// (library/indexeddb.ts); this note is read once, to move it into the library,
// and its store is kept until a later version. A browser may still clear what
// it keeps (Safari, after seven days of use without a visit to the app), so
// the file the person saves is the copy that lasts, and the app says so.
import { parseDoc, type Doc } from '@shellnote/core'
import type { FileState } from '@shellnote/library'
import { get } from './db.js'

export type { FileState }

interface Kept {
  doc: unknown
  file?: FileState
}

export interface WorkingCopy {
  doc: Doc
  /** Pictures' bytes by hash, as kept. */
  assets: Map<string, Blob>
  file?: FileState
}

/** The note kept in this browser, checked and brought up to date; undefined when there is none. */
export async function loadWorkingCopy(): Promise<WorkingCopy | undefined> {
  const kept = await get<Kept>('note', 'current')
  if (!kept) return undefined
  const doc = parseDoc(kept.doc)
  const assets = new Map<string, Blob>()
  for (const hash of Object.keys(doc.asset)) {
    const blob = await get<Blob>('assets', hash)
    if (blob) assets.set(hash, blob)
  }
  return { doc, assets, ...(kept.file ? { file: kept.file } : {}) }
}

/** Ask the browser not to clear what it keeps. Resolves to whether it agreed; some browsers decide by themselves. */
export async function askToKeep(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) || ((await navigator.storage?.persist?.()) ?? false)
  } catch {
    return false
  }
}
