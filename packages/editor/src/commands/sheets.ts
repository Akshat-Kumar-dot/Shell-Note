// A note's kind, how its pages are shown and their size, as commands: each does what its line in the note's menu
// does, and the menu calls them. Each is one change of the note, which Undo takes back.
import { resizeOps, sheetOf, sheetSize, type Doc, type Sheet, type Turn, sized, sizedPage } from '@shellnote/core'
import type { EditorStore } from '../store.js'
import type { Commands } from './run.js'
import { chooseTool } from './tools.js'

/** The command's words for the sizes, and the sizes' own names. */
const SHEET_NAMES: Record<string, Sheet> = { a4: 'A4', a5: 'A5', a6: 'A6', letter: 'Letter' }

/** The note's pages as its first page has them: its sheet (none for a size of its own) and which way up. */
export function pagesOf(doc: Doc): { sheet: Sheet | undefined; turn: Turn } {
  const first = sizedPage(doc.page[doc.pages[0]!])
  return first ? sheetOf(first) : { sheet: 'A4', turn: 'upright' }
}

/** A line for the agent's view of the app: the note's kind, its pages and how they are shown. */
export function pagesLine(store: EditorStore | undefined): string | undefined {
  if (!store) return undefined
  const doc = store.doc
  const { sheet, turn } = pagesOf(doc)
  return `a ${doc.kind ?? 'mixed'} note, ${doc.pages.length} ${doc.pages.length === 1 ? 'page' : 'pages'} ${sheet ?? 'of their own size'} ${turn}, ${doc.view === 'seamless' ? 'seamless' : 'shown as pages'}`
}

export function defineSheets(commands: Commands): void {
  commands.define('note.kind', ['note'], ({ type }, { note }) => {
    const doc = note.store.doc
    if ((doc.kind ?? 'mixed') !== type) note.store.apply([{ op: 'update', id: doc.id, set: { kind: type } }], { origin: 'toolbar' })
    // The kind's own tools come first: the pen for a sketch, typing for a text note; a mixed note keeps the one in hand.
    if (type === 'sketch') chooseTool(note.store, 'pen')
    else if (type === 'text') chooseTool(note.store, 'type')
    return `a ${String(type)} note`
  })
  commands.define('note.seamless', ['note'], ({ on }, { note }) => {
    const doc = note.store.doc
    const seamless = on !== false
    // Pages is what a note without a view is shown as, so it is written as none.
    if ((doc.view === 'seamless') !== seamless) note.store.apply([{ op: 'update', id: doc.id, set: { view: seamless ? 'seamless' : null } }], { origin: 'toolbar' })
    return seamless ? 'seamless: one sheet, no page breaks' : 'pages, one below another'
  })
  commands.define('page.size', ['note'], ({ sheet, turn }, { note }) => {
    if (sheet === undefined && turn === undefined) throw new Error('Give a size (a4, a5, a6 or letter), or a way up (upright or across).')
    const doc = note.store.doc
    const first = sized(doc.page[doc.pages[0]!]!)
    const now = sheetOf(first)
    const named = sheet === undefined ? now.sheet : SHEET_NAMES[sheet as string]
    const way = (turn as Turn | undefined) ?? now.turn
    // A size of its own keeps its size, turned when asked.
    const size = named ? sheetSize(named, way) : way === now.turn ? { w: first.w, h: first.h } : { w: first.h, h: first.w }
    const ops = resizeOps(doc, size)
    if (ops.length > 0) note.store.apply(ops, { origin: 'toolbar' })
    return `pages ${named ?? 'of their own size'}, ${way}`
  })
}
