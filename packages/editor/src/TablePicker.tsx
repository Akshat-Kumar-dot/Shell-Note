// Choosing a new table's size, as in Word: move over the grid to pick its
// columns and rows, then click. Nothing on it takes the focus, so the table
// goes in at the caret.
import { Table2 } from 'lucide-react'
import { useCallback, useRef, useState, type MouseEvent } from 'react'
import { useDismiss } from './dismiss.js'
import { PICK_COLUMNS, PICK_ROWS } from './tables.js'
import { placeMenu } from './popover.js'


/** A press on the grid must not move the focus out of the text. */
const keepFocus = (event: MouseEvent): void => event.preventDefault()

export function TablePicker({ disabled, onPick }: { disabled: boolean; onPick: (rows: number, columns: number) => void }) {
  const [open, setOpen] = useState(false)
  const [size, setSize] = useState({ rows: 0, columns: 0 })
  // Near the window's right edge, the grid opens leftwards so it stays on screen.
  const root = useRef<HTMLSpanElement>(null)
  const close = useCallback(() => setOpen(false), [])
  // A press anywhere else, or Escape, closes the grid.
  useDismiss(open, root, close)

  const cells = []
  for (let rows = 1; rows <= PICK_ROWS; rows++) {
    for (let columns = 1; columns <= PICK_COLUMNS; columns++) {
      cells.push(
        <button
          key={`${rows}-${columns}`}
          type="button"
          className="nw-pick-cell"
          aria-label={`${columns} by ${rows} table`}
          data-on={rows <= size.rows && columns <= size.columns ? '' : undefined}
          onMouseDown={keepFocus}
          onMouseEnter={() => setSize({ rows, columns })}
          onFocus={() => setSize({ rows, columns })}
          onClick={() => {
            setOpen(false)
            onPick(rows, columns)
          }}
        />,
      )
    }
  }

  return (
    <span className="nw-table-picker" ref={root}>
      <button
        type="button"
        className="nw-ibtn"
        aria-label="Table"
        aria-expanded={open}
        title="Insert a table at the caret"
        disabled={disabled}
        onMouseDown={keepFocus}
        onClick={() => {
          setSize({ rows: 0, columns: 0 })
          setOpen(!open)
        }}
      >
        <Table2 size={18} aria-hidden />
      </button>
      {open ? (
        <div ref={placeMenu} className="nw-table-grid" role="group" aria-label="Table size">
          <div className="nw-table-size">{size.rows > 0 ? `${size.columns} × ${size.rows} table` : 'Insert a table'}</div>
          <div className="nw-pick-cells" style={{ gridTemplateColumns: `repeat(${PICK_COLUMNS}, 18px)` }} onMouseLeave={() => setSize({ rows: 0, columns: 0 })}>
            {cells}
          </div>
        </div>
      ) : null}
    </span>
  )
}
