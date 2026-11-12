// Where the server's notes come from. The tools ask a NoteHost for
// everything and never learn where notes are kept: a library's folder today
// (folderHost.ts). Another place, such as the app itself while it runs, would
// be another NoteHost, and no tool would change.
import type { Applied, Doc, Id, Op } from '@shellnote/core'
import type { LogItem } from './keeper.js'

export interface NoteSummary {
  id: string
  title: string
  /** The folder it is in, as the names from the top down: "Work/Plans". "" for the top level. */
  folder: string
  pages: number
  /** When it was last changed, in milliseconds since 1970. */
  edited: number
}

/** The notes and folders in sight: nothing in Recently deleted. */
export interface Listing {
  notes: NoteSummary[]
  /** Every folder, as the names from the top down. */
  folders: string[]
}

/** A note after a change: as it is now, what changed in it, and what would undo the change. */
export interface Changed {
  doc: Doc
  changed: Id[]
  inverse: Op[]
}

export type NoteProblem = 'unknown_note' | 'deleted_note' | 'unreachable'

/** A note that cannot be reached, with words that say what to do about it. */
export class NoteError extends Error {
  constructor(
    readonly code: NoteProblem,
    message: string,
  ) {
    super(message)
    this.name = 'NoteError'
  }
}

/**
 * Each call stands alone: it looks at where the notes are kept first, so what
 * it answers is what is there now, and nothing is remembered for the next.
 */
export interface NoteHost {
  list(): Promise<Listing>
  /** A note as it is now. Its `rev` is what a change names. */
  read(id: string): Promise<Doc>
  /**
   * Change a note. `make` is given the note as it is now and answers the
   * change (core's apply); when it throws, nothing changes. The change is
   * kept before this answers.
   */
  change(id: string, make: (doc: Doc) => Applied): Promise<Changed>
  /**
   * Where a host keeps a log the person can read: note what was asked of a
   * note and what came of it. A log that cannot be written never undoes the
   * edit it tells of.
   */
  record?(id: string, item: LogItem): Promise<void>
}
