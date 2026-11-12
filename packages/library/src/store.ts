// The library behind one storage interface: the
// home page and the note screen ask it for everything, and never learn where
// notes are kept. The browser keeps them in IndexedDB (the app's
// indexeddb.ts). A folder of .shellnote files is kept through the same
// interface (library.ts), so the library's folders are folders on disk.
import type { Doc, PenProfile } from '@shellnote/core'

declare global {
  // The browser's handle to a file a person picked. Only the app's own screens use one; it is named here so that
  // this package also reads where there is no browser, and there it is nothing.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface FileSystemFileHandle {}
}

/** The file the note was last saved to or opened from. */
export interface FileState {
  name: string
  /** The note's rev in the file: changes since are not in it yet. */
  rev: number
  /** When the file was written. */
  savedAt: number
  /** Lets Save write to the same file again without asking (Chrome and Edge). */
  handle?: FileSystemFileHandle
}

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

/** A note being kept by the screen it is open on, which may hold changes from elsewhere it has not seen. */
export interface ExchangedNote extends SavingNote {
  /** The note as this screen and the library last agreed on it: as opened, or as last kept or handed back. */
  since: Doc
}

/** What keeping an open note gives back. */
export interface Exchanged {
  entry: NoteEntry
  /** The note with changes from elsewhere merged in, when there are any the screen has not seen: it shows this, and counts from it. */
  merged?: { doc: Doc; assets: Map<string, Blob> }
}

/** What changed in the library from outside the app: on another device, or in the folder itself. */
export interface OutsideChange {
  /** Notes whose content changed. */
  notes: ReadonlySet<string>
  /** True when notes or folders came, went, moved or were renamed. */
  library: boolean
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
  /**
   * Only where other devices change the library too (a synced folder): keep
   * an open note as `save` does, merged with what arrived for it from
   * elsewhere, and hand that back for the screen to show.
   */
  exchange?(note: ExchangedNote): Promise<Exchanged>
  /** Only there too: hear when the library changed from outside. Returns the function that stops listening. */
  watch?(listener: (change: OutsideChange) => void): () => void
  /** The folder the library is kept in, as a person reads it, when it is kept in one: each note is then a file already. */
  place?(): string | undefined
}
