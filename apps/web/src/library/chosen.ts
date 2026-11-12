// The library the app uses: the app's own storage, or, in the desktop app,
// a folder the person chose (Settings; folder/library.ts), which a cloud
// service may copy between their devices. Which one is decided once, as the
// app starts; changing it starts the app's page again. Every screen and
// command holds this one object, and never learns where the notes are.
import type { Doc, PenProfile } from '@shellnote/core'
import { inDesktopApp } from '@shellnote/editor/host'
import type { FileState } from '../storage/cache.js'
import { DesktopFiles, libraryFolder } from './folder/desktopFiles.js'
import { FolderLibrary } from '@shellnote/library'
import { BrowserLibrary } from './indexeddb.js'
import type { Exchanged, ExchangedNote, FolderEntry, ItemRef, Library, LibraryStore, NoteEntry, OpenedNote, OutsideChange, SavingNote } from '@shellnote/library'

/** One piece of work on the folder at a time, across every window of the app. */
function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  return typeof navigator !== 'undefined' && navigator.locks ? (navigator.locks.request('shellnote-library', work) as Promise<T>) : work()
}

/** A word every window can read and set: one that changed this device's copies leaves a new one. */
const WORD = 'shellnote:library-word'
const word = {
  read: (): string | null => {
    try {
      return localStorage.getItem(WORD)
    } catch {
      return null
    }
  },
  write: (value: string): void => {
    try {
      localStorage.setItem(WORD, value)
    } catch {
      // Storage switched off: one window still works.
    }
  },
}

/** A library in the folder chosen on this computer. */
export function folderLibrary(): FolderLibrary {
  return new FolderLibrary({ shared: new DesktopFiles('shared'), local: new DesktopFiles('own'), lock: oneAtATime, mark: word })
}

export class ChosenLibrary implements LibraryStore {
  /** The app's own storage: always there, in use or not. */
  readonly app = new BrowserLibrary()
  #store: LibraryStore = this.app
  #folder: FolderLibrary | undefined
  #place: string | undefined

  /** Decide where the library is, once, before anything is read. */
  async start(): Promise<void> {
    if (!inDesktopApp() || this.#folder) return
    const place = await libraryFolder().catch(() => undefined)
    if (place === undefined) return
    this.#folder = folderLibrary()
    this.#store = this.#folder
    this.#place = place
    this.#folder.start()
  }

  /** The folder the library is kept in; undefined while the app keeps it itself. */
  place(): string | undefined {
    return this.#place
  }

  /** What stands in the way of the folder now, in words a person can read. */
  problem(): string | undefined {
    return this.#folder?.problem()
  }

  list(): Promise<Library> {
    return this.#store.list()
  }
  open(id: string): Promise<OpenedNote> {
    return this.#store.open(id)
  }
  save(note: SavingNote): Promise<NoteEntry> {
    return this.#store.save(note)
  }
  newNote(folder: string | null, from?: { doc: Doc; assets: Map<string, Blob>; file?: FileState | undefined }): Promise<NoteEntry> {
    return this.#store.newNote(folder, from)
  }
  newFolder(parent: string | null): Promise<FolderEntry> {
    return this.#store.newFolder(parent)
  }
  rename(item: ItemRef, name: string): Promise<void> {
    return this.#store.rename(item, name)
  }
  move(item: ItemRef, to: string | null): Promise<void> {
    return this.#store.move(item, to)
  }
  delete(item: ItemRef): Promise<void> {
    return this.#store.delete(item)
  }
  restore(item: ItemRef): Promise<void> {
    return this.#store.restore(item)
  }
  deleteForever(item: ItemRef): Promise<void> {
    return this.#store.deleteForever(item)
  }
  emptyBin(): Promise<void> {
    return this.#store.emptyBin()
  }
  purgeExpired(now: number): Promise<number> {
    return this.#store.purgeExpired(now)
  }
  preview(id: string): Promise<Blob | undefined> {
    return this.#store.preview(id)
  }
  setPreview(id: string, picture: Blob): Promise<void> {
    return this.#store.setPreview(id, picture)
  }
  penProfile(): Promise<PenProfile | undefined> {
    return this.#store.penProfile()
  }
  setPenProfile(profile: PenProfile | undefined): Promise<void> {
    return this.#store.setPenProfile(profile)
  }
  /** Keep an open note; where other devices write too, with what arrived for it handed back. */
  async exchange(note: ExchangedNote): Promise<Exchanged> {
    return this.#store.exchange ? this.#store.exchange(note) : { entry: await this.#store.save(note) }
  }
  watch(listener: (change: OutsideChange) => void): () => void {
    return this.#store.watch?.(listener) ?? (() => undefined)
  }
}

/** The library, for the screens and the app's commands alike. */
export const library = new ChosenLibrary()
