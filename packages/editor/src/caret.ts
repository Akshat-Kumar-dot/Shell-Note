// With the Type tool, a click on bare paper puts the caret on the nearest line
// of text, as Word does: beside a line, at its
// start or end; above the text, at its start; below it, at its end. The Free
// cursor still makes a new frame where it clicks.
import type { Doc, Id } from '@shellnote/core'
import type { Editor } from '@tiptap/core'
import { GapCursor } from '@tiptap/pm/gapcursor'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Selection, TextSelection } from '@tiptap/pm/state'
import { frameEditors } from './frame/active.js'

/** The frame on a page nearest a point on the screen, with its editor and where it is drawn. */
function nearestFrame(doc: Doc, pageId: Id, sheet: Element, x: number, y: number): { editor: Editor; rect: DOMRect } | undefined {
  let best: { editor: Editor; rect: DOMRect; distance: number } | undefined
  for (const id of doc.page[pageId]?.free ?? []) {
    if (doc.block[id]?.type !== 'frame') continue
    const editor = frameEditors.get(id)
    const element = sheet.querySelector(`.nw-frame[data-id="${CSS.escape(id)}"]`)
    if (!editor || editor.isDestroyed || !element) continue
    const rect = element.getBoundingClientRect()
    const distance = Math.hypot(Math.max(rect.left - x, 0, x - rect.right), Math.max(rect.top - y, 0, y - rect.bottom))
    if (!best || distance < best.distance) best = { editor, rect, distance }
  }
  return best
}

/**
 * The caret at the start or the end of a frame's text: in its first or last
 * line, or, next to a table, picture or formula there, in the gap beside it,
 * where typing starts a new line. Every other kind of block in a frame is
 * closed to the caret, so that gap is always a valid place.
 */
function edge(doc: PMNode, end: boolean): Selection {
  const node = end ? doc.lastChild : doc.firstChild
  if (node?.type.name === 'textBlock') return end ? TextSelection.create(doc, doc.content.size - 1) : TextSelection.create(doc, 1)
  return node ? new GapCursor(doc.resolve(end ? doc.content.size : 0)) : end ? Selection.atEnd(doc) : Selection.atStart(doc)
}

/**
 * Put the caret in the text nearest a point on a page. True when the page has
 * text to put it in; then the frame's editor has the focus.
 */
export function caretNear(doc: Doc, pageId: Id, sheet: Element, x: number, y: number): boolean {
  const found = nearestFrame(doc, pageId, sheet, x, y)
  if (!found) return false
  const { editor, rect } = found
  const state = editor.state
  let selection: Selection
  if (y < rect.top) selection = edge(state.doc, false)
  else if (y > rect.bottom) selection = edge(state.doc, true)
  else {
    // Level with a line: its start when left of the text, its end when right of it.
    const at = editor.view.posAtCoords({ left: Math.min(Math.max(x, rect.left + 1), rect.right - 1), top: y })
    selection = at ? Selection.near(state.doc.resolve(at.pos)) : edge(state.doc, true)
  }
  editor.view.dispatch(state.tr.setSelection(selection).scrollIntoView())
  editor.view.focus()
  return true
}
