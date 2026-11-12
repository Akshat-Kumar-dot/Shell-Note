// Notes from a library kept in a folder: the folder the person chose in
// ShellNote. The server is one more device on it, as another of the person's
// computers would be: its own count of changes, its own copy of each note
// outside the folder, and the same rules for bringing a note together with
// its file (packages/library). So a change made here reaches the app, open or
// not, as any device's does, merged with what the person wrote meanwhile.
import type { Applied, Doc } from '@shellnote/core'
import { FolderLibrary } from '@shellnote/library'
import { MARK } from '@shellnote/library/layout'
import { folderPath, hidden } from '@shellnote/library/tree'
import { NoteError, type Changed, type Listing, type NoteHost } from './host.js'
import { Keeper, type LogItem } from './keeper.js'
import { NodeFiles } from './nodeFiles.js'

/** Runs one piece of work at a time, across every program that keeps this library through the same place. */
export type Lock = <T>(work: () => Promise<T>) => Promise<T>

const UNREACHABLE = "The library's folder cannot be reached just now. Nothing was changed; try again when it is back."

export class FolderHost implements NoteHost {
  #queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly library: FolderLibrary,
    private readonly lock: Lock = (work) => work(),
    /** Keeps each note's log, and a note as it was before it is changed here. */
    private readonly keeper?: Keeper,
  ) {}

  /** One piece of work at a time, here and in every other server on this place. */
  #alone<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(() => this.lock(work))
    this.#queue = next.catch(() => undefined)
    return next
  }

  /** One call at a time, and the folder looked at first: what is read is what is there. */
  #run<T>(work: () => Promise<T>): Promise<T> {
    return this.#alone(async () => {
      await this.library.sync()
      if (this.library.problem() !== undefined) throw new NoteError('unreachable', UNREACHABLE)
      return work()
    })
  }

  list(): Promise<Listing> {
    return this.#run(async () => {
      const library = await this.library.list()
      const place = (folder: string | null): string => folderPath(library, folder).map((each) => each.name).join('/')
      const notes = library.notes
        .filter((note) => !hidden(library, note))
        .map((note) => ({ id: note.id, title: note.title, folder: place(note.folder), pages: note.pages, edited: note.edited }))
        .sort((a, b) => a.folder.localeCompare(b.folder) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
      const folders = library.folders.filter((folder) => !hidden(library, folder)).map((folder) => place(folder.id))
      return { notes, folders: folders.sort((a, b) => a.localeCompare(b)) }
    })
  }

  /** A note in sight, or the reason it cannot be had. */
  async #note(id: string): Promise<Doc> {
    const library = await this.library.list()
    const entry = library.notes.find((note) => note.id === id)
    if (!entry) throw new NoteError('unknown_note', `There is no note ${JSON.stringify(id.slice(0, 80))}. Use an id that list_notes gives.`)
    if (hidden(library, entry)) throw new NoteError('deleted_note', 'That note is in Recently deleted. A person can bring it back in ShellNote.')
    return this.library.read(id)
  }

  read(id: string): Promise<Doc> {
    return this.#run(() => this.#note(id))
  }

  change(id: string, make: (doc: Doc) => Applied): Promise<Changed> {
    return this.#run(async () => {
      const before = await this.#note(id)
      const applied = make(before)
      if (applied.changed.length === 0) return { doc: before, changed: [], inverse: [] }
      // The note as it was is kept first: when that cannot be done, the note is not changed.
      await this.keeper?.copy(id, before)
      // Kept as a screen keeps an open note: with `since`, so anything that arrived meanwhile is merged, never written over.
      await this.library.exchange({ doc: applied.doc, since: before, blob: () => undefined })
      return { doc: await this.library.read(id), changed: applied.changed, inverse: applied.inverse }
    })
  }

  async record(id: string, item: LogItem): Promise<void> {
    if (this.keeper) await this.#alone(() => this.keeper!.log(id, item))
  }
}

/**
 * The host over a real folder. The folder must be a ShellNote library
 * already: the server never makes one, so it can only ever work where the
 * person chose to keep their notes. `own` is the server's own place for its
 * copies, made when it is not there.
 */
export async function openFolderHost(folder: string, own: string): Promise<FolderHost> {
  const shared = await NodeFiles.open(folder, 'shared')
  if (!(await shared.info(MARK))) {
    throw new Error('That folder is not a ShellNote library. Choose it in ShellNote first: Settings, "Where your notes are kept", "Keep them in a folder…".')
  }
  const local = await NodeFiles.open(own, 'own')
  return new FolderHost(new FolderLibrary({ shared, local, mark: local.word }), (work) => local.lock(work), new Keeper(local))
}
