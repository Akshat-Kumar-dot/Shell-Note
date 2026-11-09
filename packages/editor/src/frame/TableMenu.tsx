// The menu a right-click opens in a table, as in Word: insert and delete rows
// and columns, delete the table, and switch the header row. It is drawn over
// the whole window, outside the zoomed page, so it sits at the pointer.
import type { Editor } from '@tiptap/core'
import { useEffect, useLayoutEffect, useRef, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { keepOnScreen } from '../popover.js'
import type { EditorStore } from '../store.js'
import { TABLE_ACTIONS, tableAction } from '../tables.js'

/** A press on the menu must not move the focus out of the cell. */
const keepFocus = (event: MouseEvent): void => event.preventDefault()

export function TableMenu({ editor, store, x, y, onClose }: { editor: Editor; store: EditorStore; x: number; y: number; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null)

  // Low on the page or near its edge, a menu at the pointer would run off the screen.
  useLayoutEffect(() => {
    if (menu.current) keepOnScreen(menu.current)
  }, [x, y])

  // A press anywhere else, Escape, or scrolling closes it.
  useEffect(() => {
    const away = (event: PointerEvent): void => {
      if (!menu.current?.contains(event.target as Node)) onClose()
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', escape)
    window.addEventListener('wheel', onClose, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', escape)
      window.removeEventListener('wheel', onClose)
    }
  }, [onClose])

  return createPortal(
    <div ref={menu} className="nw-table-menu" role="menu" aria-label="Table" style={{ left: x, top: y }}>
      {TABLE_ACTIONS.map(({ action, label }) => (
        <button
          key={action}
          type="button"
          role="menuitem"
          data-action={action}
          onMouseDown={keepFocus}
          onClick={() => {
            onClose()
            tableAction(editor, store, action)
          }}
        >
          {label}
        </button>
      ))}
    </div>,
    document.body,
  )
}
