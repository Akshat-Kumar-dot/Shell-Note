// What a person selected, resolved by code before any model is called
//.
import type { Id } from '../schema/doc.js'

/** Words inside one text block: [start, end) in plain-text positions (see markdown/range.ts). */
export interface WordRange {
  block: Id
  start: number
  end: number
}

export interface Selection {
  /** Selected blocks. Frames are not selected themselves; their children are. */
  blocks: Id[]
  /** Words selected inside one text block, as a person drags across them. */
  range?: WordRange
  /**
   * The words a Select box holds, in reading order: only
   * the words inside it, so a box over the corner of a paragraph holds a
   * piece of each line it covers. The AI may change only these words and the
   * selected blocks, and add only at `here`.
   */
  words?: WordRange[]
  /** A place marked by dragging a rectangle. The editor resolves it into one of these. */
  here?: Here
}

/** A place to insert: inside a frame at an index, or an area of a page. */
export type Here = { parent: Id; at: number } | { page: Id; x: number; y: number; w: number; h: number }
