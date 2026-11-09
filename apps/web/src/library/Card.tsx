// One card on the home page: a folder, or a note with a picture of its first
// page. A click or Enter opens it; its ⋯ button, a right-click, a long press
// (touch or pen) or the menu key opens its menu; F2 renames it in place. The
// parent moves the focus between cards with the arrow keys.
import { Ellipsis, FileText, Folder } from 'lucide-react'
import { tabWord } from '@shellnote/editor'
import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import type { FolderEntry, NoteEntry } from './store.js'

export type CardItem = { kind: 'note'; entry: NoteEntry } | { kind: 'folder'; entry: FolderEntry }

export const nameOf = (item: CardItem): string => (item.kind === 'note' ? item.entry.title : item.entry.name)

/** How long a press must last to open the menu, as a right-click would. */
const LONG_PRESS = 550

export interface CardProps {
  item: CardItem
  /** One line under the name: when it was edited, what a folder holds, where a search result is. */
  meta: string
  thumbnail?: string
  /** The card the arrow keys are on: the one Tab reaches. */
  active: boolean
  renaming: boolean
  /** True when another tab is editing this note. */
  elsewhere?: boolean
  /** The command a click calls (app control): note.open or library.open; none in Recently deleted, where a click opens the menu. */
  command?: string
  onOpen: () => void
  onMenu: (x: number, y: number) => void
  onRename: (name: string | null) => void
  onKey: (event: KeyboardEvent<HTMLButtonElement>) => void
  onFocus: () => void
}

export function Card({ item, meta, thumbnail, active, renaming, elsewhere, command, onOpen, onMenu, onRename, onKey, onFocus }: CardProps) {
  const name = nameOf(item)
  const open = useRef<HTMLButtonElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number; fired: boolean } | undefined>(undefined)

  useEffect(() => {
    if (!renaming) return
    field.current?.focus()
    field.current?.select()
  }, [renaming])

  const startPress = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse') return
    const { clientX: x, clientY: y } = event
    press.current = {
      x,
      y,
      fired: false,
      timer: setTimeout(() => {
        if (!press.current) return
        press.current.fired = true
        onMenu(x, y)
      }, LONG_PRESS),
    }
  }
  const movePress = (event: PointerEvent): void => {
    const now = press.current
    if (now && Math.hypot(event.clientX - now.x, event.clientY - now.y) > 8) {
      clearTimeout(now.timer)
      press.current = undefined
    }
  }
  const endPress = (): void => {
    if (press.current) clearTimeout(press.current.timer)
  }

  const unsaved = item.kind === 'note' && item.entry.unsaved
  const description = `${item.kind === 'note' ? 'Note' : 'Folder'}: ${name}. ${meta}${unsaved ? '. Not saved to a file' : ''}${elsewhere ? `. Open in another ${tabWord()}` : ''}`

  return (
    <div role="listitem" className="card" data-kind={item.kind} data-id={item.entry.id}>
      <button
        ref={open}
        type="button"
        className="card-open"
        data-command={command}
        tabIndex={active ? 0 : -1}
        aria-label={description}
        onFocus={onFocus}
        onClick={() => {
          // A long press opened the menu: the click that ends it opens nothing.
          if (press.current?.fired) {
            press.current = undefined
            return
          }
          onOpen()
        }}
        onKeyDown={(event) => {
          if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
            event.preventDefault()
            const rect = event.currentTarget.getBoundingClientRect()
            onMenu(rect.left + rect.width / 2, rect.top + rect.height / 2)
          } else onKey(event)
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          onMenu(event.clientX, event.clientY)
        }}
        onPointerDown={startPress}
        onPointerMove={movePress}
        onPointerUp={endPress}
        onPointerCancel={endPress}
      >
        <span className="card-art" aria-hidden>
          {item.kind === 'folder' ? (
            <span className="card-folder">
              <Folder size={44} strokeWidth={1.5} />
            </span>
          ) : thumbnail ? (
            <img className="card-thumb" src={thumbnail} alt="" draggable={false} />
          ) : (
            <span className="card-thumb card-thumb-empty">
              <FileText size={28} strokeWidth={1.25} />
            </span>
          )}
        </span>
      </button>
      <div className="card-text">
        {renaming ? (
          <input
            ref={field}
            className="card-rename"
            aria-label={`New name for ${name}`}
            defaultValue={name}
            spellCheck={false}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onRename(event.currentTarget.value)
              else if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                onRename(null)
              }
            }}
            onBlur={(event) => onRename(event.currentTarget.value)}
          />
        ) : (
          <span className="card-name" title={name}>
            {name}
          </span>
        )}
        <span className="card-meta">
          {unsaved ? <span className="card-dot" title="Not saved to a .shellnote file yet" /> : null}
          <span>{meta}</span>
          {elsewhere ? <span className="card-badge">Open in another {tabWord()}</span> : null}
        </span>
      </div>
      <button
        type="button"
        className="card-more icon-button"
        tabIndex={-1}
        aria-label={`Actions for ${name}`}
        title="Actions"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          onMenu(rect.left, rect.bottom + 4)
        }}
      >
        <Ellipsis size={18} aria-hidden />
      </button>
    </div>
  )
}
