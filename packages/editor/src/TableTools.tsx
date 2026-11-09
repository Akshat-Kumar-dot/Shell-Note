// The table's own buttons, shown in the bar while the caret is in a table or
// the table is chosen whole, as Word's table tools: insert a row above or
// below, a column left or right; delete a row, a column or the table; switch
// the header row; and the table's look: a grid, lines between rows only,
// banded rows, or a header row (file format version 2).
import type { TableBlock, TableLook } from '@shellnote/core'
import { BetweenHorizontalEnd, BetweenHorizontalStart, BetweenVerticalEnd, BetweenVerticalStart, ChevronDown, PanelTop, Table2, Trash2, type LucideIcon } from 'lucide-react'
import { useCallback, useRef, useState, type MouseEvent } from 'react'
import { useDismiss } from './dismiss.js'
import { activeEditor, frameEditors } from './frame/active.js'
import type { EditorStore } from './store.js'
import { TABLE_ACTIONS, tableAction, type TableAction } from './tables.js'
import { placeMenu } from './popover.js'

/** A press on a button must not move the focus out of the cell. */
const keepFocus = (event: MouseEvent): void => event.preventDefault()

const label = (action: TableAction): string => TABLE_ACTIONS.find((item) => item.action === action)!.label
const INSERTS: [TableAction, LucideIcon][] = [
  ['above', BetweenHorizontalStart],
  ['below', BetweenHorizontalEnd],
  ['left', BetweenVerticalStart],
  ['right', BetweenVerticalEnd],
]
const DELETES: TableAction[] = ['deleteRow', 'deleteColumn', 'deleteTable']

/** The looks, as the menu names them; a grid is a table with no look of its own. */
export const LOOKS: readonly [look: TableLook | 'grid', name: string][] = [
  ['grid', 'Grid'],
  ['lines', 'Lines between rows'],
  ['banded', 'Banded rows'],
  ['header', 'Header row'],
]

/** A small table in a look, as the menu shows it. */
function Sample({ look }: { look: TableLook | 'grid' }) {
  return (
    <span className="nw-grid nw-look-sample" data-look={look} aria-hidden>
      <table>
        <tbody>
          {[0, 1, 2].map((row) => (
            <tr key={row}>
              {[0, 1, 2].map((cell) => (
                <td key={cell} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </span>
  )
}

export function TableTools({ store, table }: { store: EditorStore; table: TableBlock }) {
  const [open, setOpen] = useState<'delete' | 'look' | undefined>()
  const menus = useRef<HTMLSpanElement>(null)
  const close = useCallback(() => setOpen(undefined), [])
  useDismiss(open !== undefined, menus, close)
  // The editor of the frame the table is in: chosen whole, the table may not be where the caret last was.
  const act = (action: TableAction): void => {
    const editor = frameEditors.get(table.parent) ?? activeEditor.get()
    if (editor) tableAction(editor, store, action, table.id)
  }
  const look = (value: TableLook | 'grid'): void => {
    setOpen(undefined)
    const now = store.doc.block[table.id]
    if (now?.type !== 'table' || (now.look ?? 'grid') === value) return
    try {
      store.apply([{ op: 'update', id: table.id, set: { look: value === 'grid' ? null : value } }], { origin: 'tables' })
    } catch (error) {
      console.warn('shellnote: the table kept its look', error)
    }
  }

  return (
    <span className="nw-group nw-table-tools" role="group" aria-label="Table" ref={menus}>
      {INSERTS.map(([action, Icon]) => (
        <button key={action} type="button" className="nw-ibtn" aria-label={label(action)} title={label(action)} onMouseDown={keepFocus} onClick={() => act(action)}>
          <Icon size={18} aria-hidden />
        </button>
      ))}
      <span className="nw-menu-anchor">
        <button type="button" className="nw-ibtn" aria-label="Delete" aria-expanded={open === 'delete'} title="Delete a row, a column or the table" onMouseDown={keepFocus} onClick={() => setOpen(open === 'delete' ? undefined : 'delete')}>
          <Trash2 size={18} aria-hidden />
          <ChevronDown size={12} aria-hidden />
        </button>
        {open === 'delete' ? (
          <span ref={placeMenu} className="nw-dropdown" role="menu" aria-label="Delete">
            {DELETES.map((action) => (
              <button
                key={action}
                type="button"
                role="menuitem"
                onMouseDown={keepFocus}
                onClick={() => {
                  setOpen(undefined)
                  act(action)
                }}
              >
                {label(action)}
              </button>
            ))}
          </span>
        ) : null}
      </span>
      <button type="button" className="nw-ibtn" aria-label="Header row" aria-pressed={table.head === true} title="The first row is a header" onMouseDown={keepFocus} onClick={() => act('header')}>
        <PanelTop size={18} aria-hidden />
      </button>
      <span className="nw-menu-anchor">
        <button type="button" className="nw-ibtn" aria-label="Table style" aria-expanded={open === 'look'} title="Table style" onMouseDown={keepFocus} onClick={() => setOpen(open === 'look' ? undefined : 'look')}>
          <Table2 size={18} aria-hidden />
          <ChevronDown size={12} aria-hidden />
        </button>
        {open === 'look' ? (
          <span ref={placeMenu} className="nw-dropdown nw-look-menu" role="menu" aria-label="Table style">
            {LOOKS.map(([value, name]) => (
              <button key={value} type="button" role="menuitemradio" aria-checked={(table.look ?? 'grid') === value} onMouseDown={keepFocus} onClick={() => look(value)}>
                <Sample look={value} />
                {name}
              </button>
            ))}
          </span>
        ) : null}
      </span>
    </span>
  )
}
