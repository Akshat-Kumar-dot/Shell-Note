// The library in the browser's IndexedDB (storage version 2, db.ts). Each
// action is one transaction over the stores it touches, so it happens whole
// or not at all, and an error leaves everything as it was. Pictures' bytes are
// shared by all notes, by hash, and go only when no note uses them any more.
import { apply, createDoc, newId, parseDoc, PenProfile, type Doc } from '@shellnote/core'
import { loadWorkingCopy, type FileState } from '../storage/cache.js'
import { get, keys, result, transact, type StoreName } from '../storage/db.js'
import { migrateOldNote, type MigrationIO, type MigrationResult } from './migrate.js'
import type { FolderEntry, ItemRef, Library, LibraryStore, NoteEntry, OpenedNote, SavingNote } from '@shellnote/library'
import { canMove, contents, deletedItems, entryFor, expired, inside, isOpenFolder, onlyUsedBy, uniqueName } from '@shellnote/library/tree'

/** A note as kept in `docs`: the document, and the file it belongs to. */
interface DocRecord {
  doc: unknown
  file?: FileState
}

/** The mark in `meta` that the version 1 note was moved into the library. */
const MOVED = 'moved-version-1-note'
/** The person's pen profile, in `meta`. */
const PEN_PROFILE = 'pen-profile'

/** Only a real file handle can be kept; the browser asks again before writing to it after a reload. */
function keptFile(file: FileState): FileState {
  const real = typeof FileSystemFileHandle !== 'undefined' && file.handle instanceof FileSystemFileHandle
  return { name: file.name, rev: file.rev, savedAt: file.savedAt, ...(real ? { handle: file.handle } : {}) }
}

const record = (doc: Doc, file: FileState | undefined): DocRecord => ({ doc, ...(file ? { file: keptFile(file) } : {}) })

/** Every entry, read in the same transaction as the change that follows. */
async function read(store: (name: StoreName) => IDBObjectStore): Promise<Library> {
  const notes = (await result(store('notes').getAll())) as NoteEntry[]
  const folders = (await result(store('folders').getAll())) as FolderEntry[]
  return { notes, folders }
}

/** A document's id, made new when the library has a note with it already (the same file opened twice), so the two stay apart. */
function ownId(doc: Doc, library: Library): Doc {
  if (!library.notes.some((n) => n.id === doc.id)) return doc
  const taken = new Set([...library.notes.map((n) => n.id), ...Object.keys(doc.block), ...doc.pages])
  return { ...doc, id: newId((id) => taken.has(id)) }
}

/** Remove notes and folders for good, with their notes' pictures that no other note uses. */
function removeForGood(store: (name: StoreName) => IDBObjectStore, library: Library, notes: ReadonlySet<string>, folders: ReadonlySet<string>): void {
  const gone = library.notes.filter((n) => notes.has(n.id))
  for (const hash of onlyUsedBy(library, notes, gone.flatMap((n) => n.assets))) store('assets').delete(hash)
  for (const id of notes) {
    store('notes').delete(id)
    store('docs').delete(id)
    store('previews').delete(id)
    store('logs').delete(id)
  }
  for (const id of folders) store('folders').delete(id)
}

/** The items given, with everything their folders hold. */
function withInsides(library: Library, items: readonly ItemRef[]): { notes: Set<string>; folders: Set<string> } {
  const notes = new Set<string>()
  const folders = new Set<string>()
  for (const item of items) {
    if (item.kind === 'note') notes.add(item.id)
    else {
      const held = inside(library, item.id)
      held.folders.forEach((id) => folders.add(id))
      held.notes.forEach((id) => notes.add(id))
    }
  }
  return { notes, folders }
}

/** An entry without its mark of being deleted. */
function undeleted<T extends { deleted?: number }>(entry: T): T {
  const copy = { ...entry }
  delete copy.deleted
  return copy
}

const ALL: readonly StoreName[] = ['notes', 'docs', 'previews', 'folders', 'assets', 'logs']

export class BrowserLibrary implements LibraryStore {
  async list(): Promise<Library> {
    return transact(['notes', 'folders'], read)
  }

  async open(id: string): Promise<OpenedNote> {
    const kept = await get<DocRecord>('docs', id)
    const entry = await get<NoteEntry>('notes', id)
    if (!kept || !entry) throw new Error('This note is not in the library any more.')
    const doc = parseDoc(kept.doc)
    const assets = new Map<string, Blob>()
    for (const hash of Object.keys(doc.asset)) {
      const bytes = await get<Blob>('assets', hash)
      if (bytes) assets.set(hash, bytes)
    }
    return { entry, doc, assets, ...(kept.file ? { file: kept.file } : {}) }
  }

  async save({ doc, blob, file }: SavingNote): Promise<NoteEntry> {
    const now = Date.now()
    return transact(['notes', 'docs', 'assets'], async (store) => {
      const before = (await result(store('notes').get(doc.id))) as NoteEntry | undefined
      const entry = entryFor(doc, file, now, before)
      for (const hash of entry.assets) {
        if ((await result(store('assets').count(hash))) > 0) continue
        const bytes = blob(hash)
        if (bytes) store('assets').put(bytes, hash)
      }
      store('docs').put(record(doc, file), doc.id)
      store('notes').put(entry, doc.id)
      // Pictures this note no longer shows go, unless another note uses them.
      const dropped = (before?.assets ?? []).filter((hash) => !entry.assets.includes(hash))
      if (dropped.length > 0) {
        const notes = (await result(store('notes').getAll())) as NoteEntry[]
        for (const hash of onlyUsedBy({ notes, folders: [] }, new Set([doc.id]), dropped)) store('assets').delete(hash)
      }
      return entry
    })
  }

  async newNote(folder: string | null, from?: { doc: Doc; assets: Map<string, Blob>; file?: FileState | undefined }): Promise<NoteEntry> {
    const now = Date.now()
    return transact(['notes', 'docs', 'assets', 'folders'], async (store) => {
      const library = await read(store)
      const where = isOpenFolder(library, folder) ? folder : null
      const doc = from ? ownId(from.doc, library) : createDoc({ title: uniqueName('Untitled', contents(library, where).notes.map((n) => n.title)) })
      const entry = entryFor(doc, from?.file, now, undefined, where)
      for (const [hash, bytes] of from?.assets ?? []) store('assets').put(bytes, hash)
      store('docs').put(record(doc, from?.file), doc.id)
      store('notes').put(entry, doc.id)
      return entry
    })
  }

  async newFolder(parent: string | null): Promise<FolderEntry> {
    const now = Date.now()
    return transact(['notes', 'folders'], async (store) => {
      const library = await read(store)
      const where = isOpenFolder(library, parent) ? parent : null
      const entry: FolderEntry = {
        id: newId((id) => library.folders.some((f) => f.id === id)),
        name: uniqueName('Untitled folder', contents(library, where).folders.map((f) => f.name)),
        parent: where,
        created: now,
        edited: now,
      }
      store('folders').put(entry, entry.id)
      return entry
    })
  }

  async rename(item: ItemRef, name: string): Promise<void> {
    const wanted = name.trim()
    if (wanted === '') throw new Error('A name cannot be empty.')
    const now = Date.now()
    if (item.kind === 'folder') {
      await transact(['folders'], async (store) => {
        const folder = (await result(store('folders').get(item.id))) as FolderEntry | undefined
        if (!folder) throw new Error('That folder is not in the library any more.')
        if (folder.name !== wanted) store('folders').put({ ...folder, name: wanted, edited: now }, item.id)
      })
      return
    }
    // A note's title is part of the note, so it changes through core's apply, like any edit.
    await transact(['notes', 'docs'], async (store) => {
      const kept = (await result(store('docs').get(item.id))) as DocRecord | undefined
      const entry = (await result(store('notes').get(item.id))) as NoteEntry | undefined
      if (!kept || !entry) throw new Error('That note is not in the library any more.')
      const doc = parseDoc(kept.doc)
      if (doc.title === wanted) return
      const next = apply(doc, [{ op: 'update', id: doc.id, set: { title: wanted } }]).doc
      store('docs').put(record(next, kept.file), item.id)
      store('notes').put(entryFor(next, kept.file, now, entry), item.id)
    })
  }

  async move(item: ItemRef, to: string | null): Promise<void> {
    await transact(['notes', 'folders'], async (store) => {
      const library = await read(store)
      if (!canMove(library, item, to)) {
        throw new Error(item.kind === 'folder' && to !== null ? 'A folder cannot go into itself or into one of its own folders.' : 'That place is not in the library any more.')
      }
      if (item.kind === 'note') {
        const note = library.notes.find((n) => n.id === item.id)!
        store('notes').put({ ...note, folder: to }, item.id)
      } else {
        const folder = library.folders.find((f) => f.id === item.id)!
        store('folders').put({ ...folder, parent: to }, item.id)
      }
    })
  }

  async delete(item: ItemRef): Promise<void> {
    const now = Date.now()
    await this.#change(item, (entry) => ({ ...entry, deleted: now }))
  }

  async restore(item: ItemRef): Promise<void> {
    await transact(['notes', 'folders'], async (store) => {
      const library = await read(store)
      // Back to its folder, or to the top level when that folder is gone or deleted itself.
      if (item.kind === 'note') {
        const note = library.notes.find((n) => n.id === item.id)
        if (!note) throw new Error('That note is not in Recently deleted any more.')
        store('notes').put({ ...undeleted(note), folder: isOpenFolder(library, note.folder) ? note.folder : null }, item.id)
      } else {
        const folder = library.folders.find((f) => f.id === item.id)
        if (!folder) throw new Error('That folder is not in Recently deleted any more.')
        store('folders').put({ ...undeleted(folder), parent: isOpenFolder(library, folder.parent) ? folder.parent : null }, item.id)
      }
    })
  }

  async deleteForever(item: ItemRef): Promise<void> {
    await transact(ALL, async (store) => {
      const library = await read(store)
      const { notes, folders } = withInsides(library, [item])
      removeForGood(store, library, notes, folders)
    })
  }

  async emptyBin(): Promise<void> {
    await transact(ALL, async (store) => {
      const library = await read(store)
      const bin = deletedItems(library)
      const items = [...bin.folders.map((f): ItemRef => ({ kind: 'folder', id: f.id })), ...bin.notes.map((n): ItemRef => ({ kind: 'note', id: n.id }))]
      const { notes, folders } = withInsides(library, items)
      removeForGood(store, library, notes, folders)
    })
  }

  async purgeExpired(now: number): Promise<number> {
    return transact(ALL, async (store) => {
      const library = await read(store)
      const items = expired(library, now)
      if (items.length === 0) return 0
      const { notes, folders } = withInsides(library, items)
      removeForGood(store, library, notes, folders)
      return items.length
    })
  }

  async preview(id: string): Promise<Blob | undefined> {
    return get<Blob>('previews', id)
  }

  async setPreview(id: string, picture: Blob): Promise<void> {
    await transact(['previews', 'notes'], async (store) => {
      // A note deleted for good meanwhile gets no thumbnail back.
      if ((await result(store('notes').count(id))) > 0) store('previews').put(picture, id)
    })
  }

  async penProfile(): Promise<PenProfile | undefined> {
    const kept = PenProfile.safeParse(await get('meta', PEN_PROFILE))
    return kept.success ? kept.data : undefined
  }

  async setPenProfile(profile: PenProfile | undefined): Promise<void> {
    await transact(['meta'], async (store) => {
      if (profile) store('meta').put(PenProfile.parse(profile), PEN_PROFILE)
      else store('meta').delete(PEN_PROFILE)
    })
  }

  /** Move the note storage version 1 kept into the library, once and safely (migrate.ts). */
  async migrate(now: number): Promise<MigrationResult> {
    const io: MigrationIO = {
      done: async () => (await get('meta', MOVED)) !== undefined,
      readOld: async () => {
        const kept = await loadWorkingCopy()
        return kept && { doc: kept.doc, assets: kept.assets, ...(kept.file ? { file: kept.file } : {}) }
      },
      write: (note, entry) =>
        transact(['notes', 'docs', 'assets'], async (store) => {
          for (const [hash, bytes] of note.assets) store('assets').put(bytes, hash)
          store('docs').put(record(note.doc, note.file), note.doc.id)
          store('notes').put(entry, note.doc.id)
        }),
      readBack: async (id) => {
        const kept = await get<DocRecord>('docs', id)
        return { doc: kept?.doc, entry: await get<NoteEntry>('notes', id), assets: new Set(await keys('assets')) }
      },
      markDone: (done) =>
        transact(['meta'], async (store) => {
          store('meta').put(done, MOVED)
        }),
    }
    return migrateOldNote(io, now)
  }

  async #change(item: ItemRef, change: <T extends NoteEntry | FolderEntry>(entry: T) => T): Promise<void> {
    await transact(['notes', 'folders'], async (store) => {
      const name = item.kind === 'note' ? 'notes' : 'folders'
      const entry = (await result(store(name).get(item.id))) as NoteEntry | FolderEntry | undefined
      if (!entry) throw new Error(`That ${item.kind} is not in the library any more.`)
      store(name).put(change(entry), item.id)
    })
  }
}
