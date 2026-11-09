// The library behind one storage interface: the
// home page and the note screen ask it for everything, and never learn where
// notes are kept. The browser keeps them in IndexedDB (indexeddb.ts). Later,
// the Windows and phone apps keep real folders of .shellnote files through
// the same interface, so the library's folders become folders on disk.
import type { Doc, PenProfile } from '@shellnote/core'
import type { FileState } from '../storage/cache.js'

/** A folder in the library. `parent` is null at the top level. */
export interface FolderEntry {
  id: string
  name: string
  parent: string | null
  created: number
  edited: number
  /** When it went to Recently deleted; absent while it is in the library. */
  deleted?: number
}

/** A note's small entry, all the home page reads: never the note itself. */
export interface NoteEntry {
  id: string
  title: string
  folder: string | null
  created: number
  edited: number
  pages: number
  /** The pictures it uses, by hash: a picture's bytes are let go only when no note uses them. */
  assets: string[]
  /** True when it has changes that are not in a .shellnote file. */
  unsaved: boolean
  /** The file it was last saved to or opened from. */
  file?: { name: string; savedAt: number }
  /** When it went to Recently deleted; absent while it is in the library. */
  deleted?: number
}

/** Everything in the library, as small entries. */
export interface Library {
  notes: NoteEntry[]
  folders: FolderEntry[]
}

/** A note or a folder. */
export type ItemRef = { kind: 'note' | 'folder'; id: string }

/** A note as it is opened: the document, its pictures' bytes, and the file it belongs to. */
export interface OpenedNote {
  entry: NoteEntry
  doc: Doc
  assets: Map<string, Blob>
  file?: FileState
}

/** What saving a note needs: the document, a way to get a picture's bytes, and the file it belongs to. */
export interface SavingNote {
  doc: Doc
  blob: (hash: string) => Blob | undefined
  file?: FileState | undefined
}

/** How long a deleted item stays in Recently deleted. */
export const KEPT_DAYS = 30

/**
 * Where the library is kept. Each action is all or nothing: when one fails,
 * it throws an Error whose message a person can read, and nothing changed.
 */
export interface LibraryStore {
  /** Every note's and folder's entry, Recently deleted included. */
  list(): Promise<Library>
  /** A note, with its pictures. */
  open(id: string): Promise<OpenedNote>
  /** Keep a note as it is now. Its folder, and whether it is deleted, stay as the library has them. */
  save(note: SavingNote): Promise<NoteEntry>
  /** A new note in a folder: an empty one called "Untitled", "Untitled 2" and so on, or a document given, such as an opened file. */
  newNote(folder: string | null, from?: { doc: Doc; assets: Map<string, Blob>; file?: FileState | undefined }): Promise<NoteEntry>
  /** A new folder called "Untitled folder", "Untitled folder 2" and so on. */
  newFolder(parent: string | null): Promise<FolderEntry>
  /** A note's title (an edit through core's apply) or a folder's name. */
  rename(item: ItemRef, name: string): Promise<void>
  /** Into another folder, or to the top level. A folder cannot go into itself or one of its own folders. */
  move(item: ItemRef, to: string | null): Promise<void>
  /** To Recently deleted, with what a folder holds. */
  delete(item: ItemRef): Promise<void>
  /** Back from Recently deleted: to its folder, or to the top level when its folder is gone. */
  restore(item: ItemRef): Promise<void>
  /** Gone for good, with what a folder holds; pictures no other note uses go too. */
  deleteForever(item: ItemRef): Promise<void>
  /** Everything in Recently deleted, gone for good. */
  emptyBin(): Promise<void>
  /** Items deleted more than KEPT_DAYS days ago, gone for good. Returns how many went. */
  purgeExpired(now: number): Promise<number>
  /** A note's thumbnail: a small picture of its first page. */
  preview(id: string): Promise<Blob | undefined>
  setPreview(id: string, picture: Blob): Promise<void>
  /**
   * The person's pen profile (core's schema/profile.ts): the strokes the pen
   * learns their hand from. Kept with the library, not in any note, so the
   * desktop and phone apps will keep it as a file in the library's folder.
   * Undefined when they have none, or it cannot be read.
   */
  penProfile(): Promise<PenProfile | undefined>
  /** Keep the pen profile, or forget it (undefined). */
  setPenProfile(profile: PenProfile | undefined): Promise<void>
}
