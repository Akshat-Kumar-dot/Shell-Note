// The tab row: the Library first, then a tab for each open note, the one on screen with its title to rename in
// place; a plus for a new note; and at its end whatever the note on screen puts there (its own menu). Only the note
// on screen is live: a press on another tab keeps this one and opens that one, as opening a note always did. The
// tabs are each person's own, kept in their browser.
import type { NoteKind } from '@shellnote/core'
import { commands } from '@shellnote/editor'
import { House, PanelLeft, Plus, X } from 'lucide-react'
import { useEffect, useSyncExternalStore } from 'react'
import { KIND_ICON } from '../library/kinds.js'
import { closeTab, noteScreen, openNotes, openTab, showTree, tabsEnd, treeShown } from './state.js'

const ICON = { size: 15, strokeWidth: 1.75, 'aria-hidden': true } as const

/** A note's kind, as its tab shows it: a text note, a sketch, or a mixed note (one of no kind, too). */
function KindIcon({ kind = 'mixed' }: { kind?: NoteKind | undefined }) {
  const Icon = KIND_ICON[kind]
  return <Icon {...ICON} />
}

/** The row's end, told to whichever screen puts its own menu there. */
const endPlace = (element: HTMLElement | null): void => {
  if (tabsEnd.value !== element) tabsEnd.set(element)
}

export function Tabs({ library }: { library: boolean }) {
  const open = useSyncExternalStore(openNotes.subscribe, openNotes.snapshot)
  const now = useSyncExternalStore(noteScreen.subscribe, noteScreen.snapshot)
  const tree = useSyncExternalStore(treeShown.subscribe, treeShown.snapshot)

  // The note on screen has its tab, under the title and with the kind it has now.
  useEffect(() => {
    if (now?.id !== undefined) openTab(now.id, now.title, now.kind)
  }, [now?.id, now?.title, now?.kind])

  /** A tab closed: the one on screen is kept first, then the next one shows, or the library. */
  const close = (id: string): void => {
    const next = closeTab(id)
    if (id !== now?.id) return
    if (next === undefined) commands.press('note.close')
    else commands.press('note.open', { note: next })
  }
  const rename = (title: string): void => void commands.do('note.rename', { name: title })
  // A sample note is on screen with no place in the library: it has a tab while it shows, and none after.
  const shown = now !== undefined && now.id === undefined ? [...open, { id: '', title: now.title, kind: now.kind }] : open
  const current = now === undefined ? undefined : (now.id ?? '')

  return (
    <header className="sh-tabs" data-tauri-drag-region="deep">
      {tree ? null : (
        <button type="button" className="sh-b sh-tabs-tree" aria-label="Show the library" title="Show the library column: your folders and notes" onClick={() => showTree(true)}>
          <PanelLeft {...ICON} />
        </button>
      )}
      <div className="sh-tablist" role="tablist" aria-label="Open notes">
        <button type="button" role="tab" className="sh-tab" aria-selected={library} title="Library: your folders and notes" data-command="library.open" onClick={() => commands.press('library.open', now?.folder ? { folder: now.folder } : {})}>
          <House {...ICON} />
          <span>Library</span>
        </button>
        {shown.map((one) =>
          one.id === current ? (
            <div key={one.id} role="tab" className="sh-tab" aria-selected aria-label={one.title || 'Untitled'} data-command="note.open">
              <KindIcon kind={now!.kind} />
              <input
                className="sh-tab-title"
                aria-label="Title"
                data-command="note.rename"
                spellCheck={false}
                value={now!.title}
                readOnly={now!.mode !== 'edit'}
                onChange={(event) => rename(event.target.value)}
                onBlur={(event) => {
                  if (event.target.value.trim() === '') rename('Untitled')
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
              />
              <button type="button" className="sh-tab-x" aria-label="Close this note" title="Close: the note is kept" data-command="note.close" onClick={() => close(one.id)}>
                <X size={13} aria-hidden />
              </button>
            </div>
          ) : (
            <div key={one.id} className="sh-tab" data-tab={one.id}>
              <button type="button" role="tab" className="sh-tab-open" aria-selected={false} title={one.title || 'Untitled'} data-command="note.open" onClick={() => commands.press('note.open', { note: one.id })}>
                <KindIcon kind={one.kind} />
                <span>{one.title || 'Untitled'}</span>
              </button>
              <button type="button" className="sh-tab-x" aria-label={`Close the tab of ${one.title || 'Untitled'}`} title="Close this tab" onClick={() => close(one.id)}>
                <X size={13} aria-hidden />
              </button>
            </div>
          ),
        )}
      </div>
      <button type="button" className="sh-b sh-tabs-new" aria-label="New tab" title="A new note, in a new tab" data-command="note.new" onClick={() => commands.press('note.new', now?.folder ? { into: now.folder } : {})}>
        <Plus size={16} strokeWidth={1.75} aria-hidden />
      </button>
      <span className="sh-grow" data-tauri-drag-region />
      <div className="sh-tabs-end" ref={endPlace} />
    </header>
  )
}
