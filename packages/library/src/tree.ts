// The library's rules, as plain functions over its entries, with no storage:
// names for new items, where a folder sits, what a folder holds, what may move
// where, sorting, searching and Recently deleted. The storage and the home
// page both use them, and unit tests check them (test/tree.test.ts).
import type { Doc } from '@shellnote/core'
import { KEPT_DAYS, type FileState, type FolderEntry, type ItemRef, type Library, type NoteEntry } from './store.js'

const DAY = 24 * 60 * 60 * 1000

/** "Untitled", then "Untitled 2", "Untitled 3": the first name not taken. Names are compared ignoring case. */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((name) => name.trim().toLocaleLowerCase()))
  if (!used.has(base.toLocaleLowerCase())) return base
  for (let n = 2; ; n++) if (!used.has(`${base} ${n}`.toLocaleLowerCase())) return `${base} ${n}`
}

const folderOf = (library: Library, id: string | null): FolderEntry | undefined => (id === null ? undefined : library.folders.find((f) => f.id === id))

/** The folders from the top level down to this one, this one last. Empty for the top level. */
export function folderPath(library: Library, id: string | null): FolderEntry[] {
  const path: FolderEntry[] = []
  const seen = new Set<string>()
  for (let folder = folderOf(library, id); folder && !seen.has(folder.id); folder = folderOf(library, folder.parent)) {
    seen.add(folder.id)
    path.unshift(folder)
  }
  return path
}

/** True when `folder` is `ancestor` itself or somewhere inside it. */
export function isWithin(library: Library, folder: string | null, ancestor: string): boolean {
  return folderPath(library, folder).some((f) => f.id === ancestor)
}

/** Out of sight: in Recently deleted, or inside a folder that is. */
export function hidden(library: Library, entry: NoteEntry | FolderEntry): boolean {
  if (entry.deleted !== undefined) return true
  const parent = 'folder' in entry ? entry.folder : entry.parent
  return folderPath(library, parent).some((f) => f.deleted !== undefined)
}

/** What a folder (null: the top level) shows: its folders and notes in sight. */
export function contents(library: Library, folder: string | null): { folders: FolderEntry[]; notes: NoteEntry[] } {
  return {
    folders: library.folders.filter((f) => f.parent === folder && !hidden(library, f)),
    notes: library.notes.filter((n) => n.folder === folder && !hidden(library, n)),
  }
}

/** How many folders and notes a folder shows. */
export function counts(library: Library, folder: string): { folders: number; notes: number } {
  const { folders, notes } = contents(library, folder)
  return { folders: folders.length, notes: notes.length }
}

/** True when the folder exists and is in sight; the top level always is. */
export function isOpenFolder(library: Library, folder: string | null): boolean {
  if (folder === null) return true
  const entry = folderOf(library, folder)
  return entry !== undefined && !hidden(library, entry)
}

/** Whether an item may move into a folder: it must be in sight, and a folder never into itself or one of its own folders. */
export function canMove(library: Library, item: ItemRef, to: string | null): boolean {
  if (!isOpenFolder(library, to)) return false
  if (item.kind === 'note') return library.notes.some((n) => n.id === item.id)
  return library.folders.some((f) => f.id === item.id) && (to === null || !isWithin(library, to, item.id))
}

export type SortKey = 'edited' | 'created'
export type SortOrder = 'newest' | 'oldest'

/** Newest or oldest first by a date, then by name; never changes the list given. */
export function sorted<T extends NoteEntry | FolderEntry>(entries: readonly T[], key: SortKey, order: SortOrder): T[] {
  const name = (entry: T): string => ('title' in entry ? entry.title : entry.name)
  return [...entries].sort((a, b) => (order === 'newest' ? b[key] - a[key] : a[key] - b[key]) || name(a).localeCompare(name(b)))
}

/** Text for matching: lower case, without accents, so "resume" finds "Résumé". */
const fold = (text: string): string => text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()

/** Notes and folders in sight whose names hold the words searched for, anywhere in the library. */
export function search(library: Library, text: string): { folders: FolderEntry[]; notes: NoteEntry[] } {
  const words = fold(text).split(/\s+/u).filter(Boolean)
  const matches = (name: string): boolean => words.length > 0 && words.every((word) => fold(name).includes(word))
  return {
    folders: library.folders.filter((f) => !hidden(library, f) && matches(f.name)),
    notes: library.notes.filter((n) => !hidden(library, n) && matches(n.title)),
  }
}

/** What Recently deleted shows: the items deleted themselves, not those only inside a deleted folder. */
export function deletedItems(library: Library): { folders: FolderEntry[]; notes: NoteEntry[] } {
  return { folders: library.folders.filter((f) => f.deleted !== undefined), notes: library.notes.filter((n) => n.deleted !== undefined) }
}

/** The days left before a deleted item goes for good; 0 when its time is up. */
export function daysLeft(deleted: number, now: number): number {
  return Math.max(0, Math.ceil((deleted + KEPT_DAYS * DAY - now) / DAY))
}

/** The deleted items whose time in Recently deleted is up. */
export function expired(library: Library, now: number): ItemRef[] {
  const { folders, notes } = deletedItems(library)
  const old = (deleted: number | undefined): boolean => deleted !== undefined && now - deleted > KEPT_DAYS * DAY
  return [...folders.filter((f) => old(f.deleted)).map((f): ItemRef => ({ kind: 'folder', id: f.id })), ...notes.filter((n) => old(n.deleted)).map((n): ItemRef => ({ kind: 'note', id: n.id }))]
}

/** Everything a folder holds, at any depth, with the folder itself: what deleting it for good removes. */
export function inside(library: Library, folder: string): { folders: string[]; notes: string[] } {
  const folders = library.folders.filter((f) => isWithin(library, f.id, folder)).map((f) => f.id)
  const notes = library.notes.filter((n) => n.folder !== null && isWithin(library, n.folder, folder)).map((n) => n.id)
  return { folders, notes }
}

/** Picture hashes that only these notes use, among all the library's notes: the bytes that may go with them. */
export function onlyUsedBy(library: Library, gone: ReadonlySet<string>, hashes: Iterable<string>): string[] {
  const kept = new Set(library.notes.filter((n) => !gone.has(n.id)).flatMap((n) => n.assets))
  return [...new Set(hashes)].filter((hash) => !kept.has(hash))
}

/** A note with nothing in it: the title it was given ("Untitled", "Untitled 2", …) and empty frames. */
export function blank(doc: Doc): boolean {
  return /^Untitled( \d+)?$/u.test(doc.title) && Object.values(doc.block).every((block) => block.type === 'frame' && block.kids.length === 0)
}

/** True when a note has changes that are not in its file, or, with no file, anything in it at all. */
export function unsaved(doc: Doc, file: Pick<FileState, 'rev'> | undefined): boolean {
  return file ? doc.rev !== file.rev : !blank(doc)
}

/** A note's entry from its document, keeping where it is (folder, dates, deleted) from the entry it had. */
export function entryFor(doc: Doc, file: FileState | undefined, now: number, before?: NoteEntry, folder: string | null = null): NoteEntry {
  return {
    id: doc.id,
    title: doc.title,
    folder: before ? before.folder : folder,
    created: before?.created ?? now,
    edited: now,
    pages: doc.pages.length,
    assets: Object.keys(doc.asset),
    unsaved: unsaved(doc, file),
    ...(file ? { file: { name: file.name, savedAt: file.savedAt } } : {}),
    ...(before?.deleted !== undefined ? { deleted: before.deleted } : {}),
  }
}
