// Choosing blocks as objects rather than words: a click on a block placed on
// the page, Shift+click to add one or take it away, and the Select tool's box,
// which also takes pieces of text (region.ts). Delete then removes them all at
// once, as one undo step. In core's terms (select/selection.ts) a frame is
// never chosen itself: its blocks are.
import { removalOps, type Id } from '@shellnote/core'
import type { EditorStore } from './store.js'

// The rule for removing chosen blocks and words lives in core, so an AI delete leaves the note as Delete does.
export { removalOps }

/** Remove the blocks chosen as objects and the words a Select box holds, as one undo step, and choose nothing. Words being typed are never removed this way. */
export function removeChosen(store: EditorStore): void {
  if (store.selectionKind !== 'objects') return
  const ops = removalOps(store.doc, store.selection.blocks, store.selection.words)
  if (ops.length === 0) return
  try {
    store.apply(ops, { origin: 'selection' })
  } catch (error) {
    console.warn('shellnote: what was chosen could not be removed', error)
    return
  }
  store.select({ blocks: [] }, 'objects')
}

/** Add a block to the chosen ones, or take it away when it is already chosen (Shift+click). A selection made by typing starts afresh. */
export function toggleChosen(store: EditorStore, id: Id): void {
  const blocks = store.selectionKind === 'objects' ? store.selection.blocks : []
  store.select({ blocks: blocks.includes(id) ? blocks.filter((other) => other !== id) : [...blocks, id] }, 'objects')
}

/** A rectangle on the screen, in CSS pixels. */
export interface ScreenRect {
  left: number
  top: number
  right: number
  bottom: number
}
