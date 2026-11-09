// Opening a .shellnote file into the library, from the home page or from a
// note (Ctrl+O). The file becomes a note in the folder in view. When the
// library already has that very note, unchanged (a file saved from it and
// opened again), that note opens instead of a second copy. A note with the
// same id but other changes comes in as a copy beside it.
import { AssetStore } from '@shellnote/editor'
import type { FileState } from '../storage/cache.js'
import { pickFile, readNote } from '../storage/files.js'
import { sameDoc } from './migrate.js'
import type { LibraryStore } from './store.js'
import { hidden } from './tree.js'

export interface Imported {
  /** The note to open. */
  id: string
  /** Pictures whose bytes did not match their key: the file was damaged, and they show as grey boxes. */
  damaged: number
  /** True when the library had this note already, unchanged, and that one opens. */
  existing: boolean
}

/** Ask for a file and bring it into the library. Undefined when the person closed the file dialog. Throws with a readable message when the file is not a note. */
export async function importNote(store: LibraryStore, folder: string | null): Promise<Imported | undefined> {
  const picked = await pickFile()
  if (!picked) return undefined
  const opened = await readNote(picked.file)
  // Each picture's bytes are checked against its key on the way in.
  const assets = new AssetStore()
  let damaged = 0
  for (const [hash, bytes] of Object.entries(opened.assets)) {
    if (!(await assets.put(hash, new Blob([bytes.slice()]), opened.doc.asset[hash]!.mime, true))) damaged++
  }
  const blobs = new Map<string, Blob>()
  for (const hash of Object.keys(opened.doc.asset)) {
    const blob = assets.blob(hash)
    if (blob) blobs.set(hash, blob)
  }
  const file: FileState = { name: picked.file.name, rev: opened.doc.rev, savedAt: picked.file.lastModified, ...(picked.handle ? { handle: picked.handle } : {}) }

  const library = await store.list()
  const same = library.notes.find((n) => n.id === opened.doc.id)
  if (same && !hidden(library, same)) {
    const current = await store.open(same.id)
    if (sameDoc(current.doc, opened.doc)) {
      // The same note: it now belongs to this file.
      await store.save({ doc: current.doc, blob: (hash) => current.assets.get(hash), file })
      return { id: same.id, damaged, existing: true }
    }
  }
  const entry = await store.newNote(folder, { doc: opened.doc, assets: blobs, file })
  return { id: entry.id, damaged, existing: false }
}
