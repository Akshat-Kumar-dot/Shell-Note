// The rail: the app's places, down the window's left edge on every screen. The library and its search; the two halves
// of the panel beside a note (the AI, and what is watched or read beside the writing: a video's words, a web page, a
// timer); the terminal; and at its foot where the notes are kept, and Settings. Each button calls the command its
// place always had, so what a click does here, a line typed in the terminal does too.
import { AI_TABS, besideTab, commands, inDesktopApp, openTerminal, showSideTab, sideTab, terminalOpen, workspace } from '@shellnote/editor'
import type { LibraryStore } from '@shellnote/library'
import { CloudCheck, HardDrive, Library, MonitorPlay, Search, Settings, Sparkles, SquareTerminal } from 'lucide-react'
import { useSyncExternalStore, type MouseEvent } from 'react'
import { findWanted, noteScreen } from './state.js'

/** A press on the rail leaves the caret in the note where it was. */
const keepFocus = (event: MouseEvent): void => event.preventDefault()

/** The rail's icons, drawn alike. */
const ICON = { size: 18, strokeWidth: 1.75, 'aria-hidden': true } as const

export interface RailProps {
  store: LibraryStore
  /** The screen shown: the library, Recently deleted, or neither (a note, or one still opening). */
  screen: 'library' | 'bin' | 'other'
}

export function Rail({ store, screen }: RailProps) {
  const note = useSyncExternalStore(noteScreen.subscribe, noteScreen.snapshot)
  const side = useSyncExternalStore(workspace.subscribe, workspace.snapshot).side
  const tab = useSyncExternalStore(sideTab.subscribe, sideTab.snapshot)
  const terminal = useSyncExternalStore(terminalOpen.subscribe, terminalOpen.snapshot)

  // The panel beside the note is there while the note is edited here.
  const editing = note?.mode === 'edit'
  const ai = editing && side && AI_TABS.includes(tab)
  const beside = editing && side && !AI_TABS.includes(tab)
  const needsNote = editing ? '' : ' (open a note to edit first)'

  /** The caret into the library's search box: beside a note, or on the library's own screen. */
  const find = (): void => {
    findWanted.set(true)
    // Recently deleted has no search: the library's top has.
    if (screen === 'bin') commands.press('library.open')
  }

  const folder = store.place?.()
  const kept = folder !== undefined ? `Your notes are kept in the folder ${folder}` : inDesktopApp() ? 'Your notes are kept by the app, on this computer' : 'Your notes are kept in this browser'
  const Kept = folder !== undefined ? CloudCheck : HardDrive

  return (
    <nav className="rail" aria-label="Places" data-tauri-drag-region>
      <img className="rail-mark" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={26} height={26} data-tauri-drag-region />
      <button type="button" className="sh-b" aria-label="Library" aria-pressed={screen !== 'other'} title="Library: your folders and notes" data-command="library.open" onClick={() => commands.press('library.open')}>
        <Library {...ICON} />
      </button>
      <button type="button" className="sh-b rail-find" aria-label="Search" title="Search your notes and folders by name" onClick={find}>
        <Search {...ICON} />
      </button>
      <button
        type="button"
        className="sh-b"
        aria-label="AI panel"
        aria-pressed={ai}
        disabled={!editing}
        title={`AI: ask about the note, and see what it changed${needsNote}`}
        data-command={ai ? 'panel.hide' : 'panel.show'}
        onMouseDown={keepFocus}
        onClick={() => (ai ? commands.tap('panel.hide') : commands.tap('panel.show', { panel: 'ai' }))}
      >
        <Sparkles {...ICON} />
      </button>
      <button
        type="button"
        className="sh-b"
        aria-label="Beside the note"
        aria-pressed={beside}
        disabled={!editing}
        title={`Beside the note: a video's description and transcript, a web page, a timer${needsNote}`}
        data-command={beside ? 'panel.hide' : 'panel.show'}
        onMouseDown={keepFocus}
        onClick={() => {
          const to = besideTab()
          // A program's part is opened by the person alone: no command names it.
          if (beside) commands.tap('panel.hide')
          else if (to === 'program') showSideTab('program')
          else commands.tap('panel.show', { panel: to })
        }}
      >
        <MonitorPlay {...ICON} />
      </button>
      <button type="button" className="sh-b rail-terminal" aria-label="Terminal" aria-pressed={terminal} title="Terminal: type a command, or ask the model (Ctrl+Shift+P)" onClick={() => openTerminal(!terminal)}>
        <SquareTerminal {...ICON} />
      </button>
      <span className="rail-grow" data-tauri-drag-region />
      <button type="button" className="sh-b" aria-label="Where your notes are kept" title={`${kept} (opens Settings)`} data-kept={folder !== undefined ? 'folder' : 'app'} data-command="settings.open" onClick={() => commands.tap('settings.open')}>
        <Kept {...ICON} />
      </button>
      <button type="button" className="sh-b" aria-label="Settings" title="Settings" data-command="settings.open" onClick={() => commands.tap('settings.open')}>
        <Settings {...ICON} />
      </button>
    </nav>
  )
}
