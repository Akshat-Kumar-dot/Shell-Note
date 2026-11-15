// One note or folder on the library's screen: a card with its picture, or a line of the list. A click or Enter opens
// it; its ⋯ button, a right-click, a long press (touch or pen) or the menu key opens its menu; F2 renames it in place.
// The parent moves the focus between them with the arrow keys.
import { Ellipsis, Folder } from 'lucide-react'
import { tabWord } from '@shellnote/editor'
import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import type { FolderEntry, NoteEntry } from '@shellnote/library'
import { KIND_ICON, KIND_WORD, kindOf } from './kinds.js'

/** A note or a folder; a note a search found by the words inside it, not its title, is marked so. */
export type CardItem = { kind: 'note'; entry: NoteEntry; words?: boolean } | { kind: 'folder'; entry: FolderEntry }

/** How the library shows its notes and folders: as cards with their pictures, or as the lines of a list. */
export type Look = 'cards' | 'list'

export const nameOf = (item: CardItem): string => (item.kind === 'note' ? item.entry.title : item.entry.name)

/** How long a press must last to open the menu, as a right-click would. */
const LONG_PRESS = 550

export interface CardProps {
  item: CardItem
  look: Look
  /** The line under a card's name, and what is said after its name: when a note was edited, what a folder holds, where a search's result is. */
  meta: string
  /** A line of the list: what its middle says (a note's first words), and its end (when). */
  middle?: string
  end?: string
  /** Its picture: a note's first page or its cover, a folder's cover. */
  picture?: string
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

export function Card({ item, look, meta, middle, end, picture, active, renaming, elsewhere, command, onOpen, onMenu, onRename, onKey, onFocus }: CardProps) {
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

  const kind = item.kind === 'note' ? kindOf(item.entry) : undefined
  const Icon = kind ? KIND_ICON[kind] : Folder
  const row = look === 'list'
  const covered = item.entry.cover !== undefined && item.entry.cover !== false
  const unsaved = item.kind === 'note' && item.entry.unsaved
  const description = `${item.kind === 'note' ? 'Note' : 'Folder'}: ${name}. ${meta}${unsaved ? '. Not saved to a file' : ''}${elsewhere ? `. Open in another ${tabWord()}` : ''}`
  const last = row ? (end ?? meta) : meta

  return (
    <div role="listitem" className="card" data-kind={item.kind} data-note={kind} data-covered={covered ? '' : undefined} data-id={item.entry.id}>
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
        <span className="card-pic" aria-hidden>
          {picture ? (
            <img className="card-thumb" src={picture} alt="" draggable={false} />
          ) : item.kind === 'folder' ? (
            <span className="card-folder">
              <Folder size={row ? 18 : 30} strokeWidth={1.5} />
            </span>
          ) : (
            <span className="card-paper" />
          )}
        </span>
      </button>
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
          {row ? null : <Icon size={15} aria-hidden />}
          <span className="card-title">{name}</span>
        </span>
      )}
      {row ? (
        <>
          <span className="card-snip">{middle}</span>
          <span className="card-kind">
            <Icon size={15} aria-hidden />
            {kind ? KIND_WORD[kind] : 'Folder'}
          </span>
        </>
      ) : null}
      <span className="card-meta">
        {unsaved ? <span className="card-dot" title="Not saved to a .shellnote file yet" /> : null}
        {last !== '' ? <span className="card-when">{last}</span> : null}
        {elsewhere ? <span className="card-badge">Open in another {tabWord()}</span> : null}
      </span>
      <button
        type="button"
        className="card-more sh-b"
        tabIndex={-1}
        aria-label={`Actions for ${name}`}
        title="Actions"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          onMenu(rect.left, rect.bottom + 4)
        }}
      >
        <Ellipsis size={17} aria-hidden />
      </button>
    </div>
  )
}
