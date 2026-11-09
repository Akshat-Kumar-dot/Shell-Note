// Tables. A table sits in a frame's text: inserted at the caret with a size
// picked on a grid, as in Word, or pasted as a Markdown pipe table, the form a
// model writes one in. Rows, columns and the header row are then changed from
// the bar or a right-click menu, through the editor, which hands each change
// to core. Behind it all, a table stays rows of cells.
import { idTaken, newId, type Block, type Doc, type Id, type Op, type PipeTable } from '@shellnote/core'
import type { Editor } from '@tiptap/core'
import type { Command } from '@tiptap/pm/state'
import { addColumnAfter, addColumnBefore, addRowAfter, addRowBefore, deleteColumn, deleteRow, isInTable, selectedRect, tableNodeTypes } from '@tiptap/pm/tables'
import type { EditorStore } from './store.js'

/** The largest table the grid offers: 10 columns by 8 rows, as in Word. */
export const PICK_COLUMNS = 10
export const PICK_ROWS = 8

/** A new, empty table of rows by columns. Plain, as a new table in Word; the header row is a tick away. */
export function newTable(rows: number, columns: number): PipeTable {
  return { rows: Array.from({ length: rows }, () => Array<string>(columns).fill('')), head: false }
}

/** The operation that adds a table to a frame at an index. */
export function tableOp(doc: Doc, frame: Id, at: number, table: PipeTable): Extract<Op, { op: 'add' }> {
  const id = newId((candidate) => idTaken(doc, candidate))
  return { op: 'add', block: { id, r: 0, type: 'table', parent: frame, rows: table.rows, ...(table.head ? { head: true } : {}) } as Block, at }
}

/** Add a table to a frame at an index, as one undo step. Resolves to its id, or undefined when it does not fit. */
export function addTable(store: EditorStore, frame: Id, at: number, table: PipeTable): Id | undefined {
  const target = store.doc.block[frame]
  if (target?.type !== 'frame') return undefined
  const op = tableOp(store.doc, frame, Math.min(at, target.kids.length), table)
  try {
    store.apply([op], { origin: 'tables' })
  } catch (error) {
    console.warn('shellnote: the table was not added', error)
    return undefined
  }
  return op.block.id
}

/**
 * Make the first row of the table at the caret a header, or a plain row
 * again. Core's head is always the first row, wherever the caret is.
 */
export const toggleHeaderRow: Command = (state, dispatch) => {
  if (!isInTable(state)) return false
  const rect = selectedRect(state)
  const types = tableNodeTypes(state.schema)
  const first = rect.map.cellsInRect({ left: 0, top: 0, right: rect.map.width, bottom: 1 })
  const cells = first.map((pos) => rect.table.nodeAt(pos)!)
  const head = cells.every((cell) => cell.type === types.header_cell)
  if (dispatch) {
    const tr = state.tr
    first.forEach((pos, i) => tr.setNodeMarkup(rect.tableStart + pos, head ? types.cell : types.header_cell, cells[i]!.attrs))
    dispatch(tr)
  }
  return true
}

/** The id of the table the caret is in, if it is in one. */
export function tableAt(editor: Editor): Id | undefined {
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (node.type.name === 'tableBlock') return (node.attrs.id as Id | null) ?? undefined
  }
  return undefined
}

/** What can be done to the table at the caret, as Word words it: for the bar and the right-click menu alike. */
export type TableAction = 'above' | 'below' | 'left' | 'right' | 'deleteRow' | 'deleteColumn' | 'deleteTable' | 'header'

export const TABLE_ACTIONS: readonly { action: TableAction; label: string }[] = [
  { action: 'above', label: 'Insert row above' },
  { action: 'below', label: 'Insert row below' },
  { action: 'left', label: 'Insert column left' },
  { action: 'right', label: 'Insert column right' },
  { action: 'deleteRow', label: 'Delete row' },
  { action: 'deleteColumn', label: 'Delete column' },
  { action: 'deleteTable', label: 'Delete table' },
  { action: 'header', label: 'Header row' },
]

const COMMANDS: Record<Exclude<TableAction, 'deleteTable'>, Command> = {
  above: addRowBefore,
  below: addRowAfter,
  left: addColumnBefore,
  right: addColumnAfter,
  deleteRow,
  deleteColumn,
  header: toggleHeaderRow,
}

/**
 * Do something to the table at the caret, or to the table `id` when it is
 * chosen whole: the caret goes into its first cell first. Rows and columns
 * change in the editor, which hands the change to core like typing; a whole
 * table goes through core directly. The last row or column cannot be
 * deleted: delete the table instead.
 */
export function tableAction(editor: Editor, store: EditorStore, action: TableAction, id?: Id): void {
  if (action === 'deleteTable') {
    const table = id ?? tableAt(editor)
    if (table === undefined) return
    try {
      store.apply([{ op: 'remove', id: table }], { origin: 'tables' })
    } catch (error) {
      console.warn('shellnote: the table was not deleted', error)
    }
    return
  }
  if (id !== undefined && tableAt(editor) !== id) enterTable(editor, id)
  COMMANDS[action](editor.state, editor.view.dispatch, editor.view)
  editor.commands.focus()
}

/** Put the caret in a table's first cell, in the frame editor that shows the table. */
export function enterTable(editor: Editor, id: Id): void {
  let at: number | undefined
  editor.state.doc.forEach((node, pos) => {
    if (node.attrs.id === id) at = pos
  })
  // Past the starts of the table block, the grid, the first row and the first cell.
  if (at !== undefined) editor.chain().setTextSelection(at + 4).focus().run()
}
