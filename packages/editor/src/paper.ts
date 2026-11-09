// The paper a page is drawn on: blank, lines, squares (maths paper) or dots,
// the four kinds the document already has. The toolbar's
// Paper button changes it for the page in view or for every page, as one
// undo step.
import type { Doc, Id, Op, Page } from '@shellnote/core'

export type Paper = Page['bg']

/** The papers in the order the menu shows them, with their names. */
export const PAPERS: readonly [Paper, string][] = [
  ['blank', 'Blank'],
  ['ruled', 'Lines'],
  ['grid', 'Squares'],
  ['dots', 'Dots'],
]

/** The operations that put these pages on a paper; none for pages on it already. */
export function paperOps(doc: Doc, pages: readonly Id[], paper: Paper): Op[] {
  return pages.flatMap((id): Op[] => (doc.page[id] && doc.page[id].bg !== paper ? [{ op: 'update', id, set: { bg: paper } }] : []))
}
