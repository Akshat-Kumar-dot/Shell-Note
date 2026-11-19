// How a new note of each kind starts: a text note as one sheet with no page breaks, a sketch as a wide growing sheet
// of dots (A4 across), a mixed note as pages. Each is A4, and each can be changed in the note's menu. A board starts as
// one endless page of dots, and stays a board.
import { apply } from '../apply.js'
import { createDoc } from '../create.js'
import type { Doc, NoteKind } from '../schema/doc.js'
import type { Op } from '../schema/ops.js'
import { resizeOps, sheetSize } from './resize.js'

/** A new note started as a note of this kind. */
export function startAs(doc: Doc, kind: NoteKind): Doc {
  // A note never becomes a board: a new board is made as one, with the new note's id and title.
  if (kind === 'board') return { ...createDoc({ title: doc.title, board: true }), id: doc.id }
  let out = apply(doc, [{ op: 'update', id: doc.id, set: { kind, ...(kind === 'mixed' ? {} : { view: 'seamless' }) } }]).doc
  if (kind !== 'sketch') return out
  out = apply(out, resizeOps(out, sheetSize('A4', 'across'))).doc
  const dots: Op[] = out.pages.map((id) => ({ op: 'update', id, set: { bg: 'dots' } }))
  return apply(out, dots).doc
}
