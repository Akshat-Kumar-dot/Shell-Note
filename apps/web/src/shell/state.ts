// What the shell round every screen knows of the screen inside it: the note on screen, the notes open in tabs, and
// the places a screen may put something of its own into the shell.
import { inDesktopApp, Shared } from '@shellnote/editor'

/** The note on screen: being edited here or shown read-only; its place in the library (none for a sample) and its title as it is now. */
export interface NoteNow {
  mode: 'edit' | 'read'
  id: string | undefined
  folder: string | null
  title: string
}

/** The note on screen; none on the library's screens, or while a note is still opening. */
export const noteScreen = new Shared<NoteNow | undefined>(undefined)

/** The rail's Search was pressed: the library's search box, on whichever screen has one, takes the caret and sets this back. */
export const findWanted = new Shared(false)

/** The end of the tab row, where the note on screen puts its own menu. */
export const tabsEnd = new Shared<HTMLElement | null>(null)

/**
 * Where the tab row goes while a note is on screen: the top of the note's own column, so the panel beside the note
 * (the AI, or Beside) runs the window's whole height, its head level with the tabs, as the design has it. Elsewhere,
 * over the whole screen.
 */
export const tabsPlace = new Shared<HTMLElement | null>(null)

/** A place's ref: told once, when it is drawn, and again (empty) when it goes. */
export const tabsAt = (element: HTMLElement | null): void => {
  if (tabsPlace.value !== element) tabsPlace.set(element)
}

// ----- the notes open in tabs: each person's own, kept in their browser -----

/** A note open in a tab, with its title as last seen. */
export interface OpenNote {
  id: string
  title: string
}

const OPEN = 'shellnote:open-notes'
const SHOWN = 'shellnote:shown-note'

function readOpen(): OpenNote[] {
  try {
    const saved = JSON.parse(localStorage.getItem(OPEN) ?? '[]') as unknown
    if (!Array.isArray(saved)) return []
    return saved.filter((one): one is OpenNote => typeof one === 'object' && one !== null && typeof (one as OpenNote).id === 'string' && typeof (one as OpenNote).title === 'string')
  } catch {
    return []
  }
}

export const openNotes = new Shared<OpenNote[]>(readOpen())

function keepOpen(next: OpenNote[]): void {
  try {
    localStorage.setItem(OPEN, JSON.stringify(next))
  } catch {
    // Storage is off: the tabs last until the page closes.
  }
  openNotes.set(next)
}

/** A note shown: it has its tab, with the title it has now. */
export function openTab(id: string, title: string): void {
  const now = openNotes.value
  const at = now.findIndex((one) => one.id === id)
  if (at < 0) keepOpen([...now, { id, title }])
  else if (now[at]!.title !== title) keepOpen(now.map((one) => (one.id === id ? { id, title } : one)))
}

/** A tab closed. Gives the note to show in its place, the one after it or else the one before; none, the library. */
export function closeTab(id: string): string | undefined {
  const now = openNotes.value
  const at = now.findIndex((one) => one.id === id)
  if (at < 0) return undefined
  keepOpen(now.filter((one) => one.id !== id))
  return (now[at + 1] ?? now[at - 1])?.id
}

/** The tabs of notes no longer in the library go, and the others take the titles the library has. */
export function tabsFollow(titles: ReadonlyMap<string, string>, onScreen?: string): void {
  const now = openNotes.value
  // The note on screen keeps its tab and the title it has now: the library may not have heard of either yet.
  const next = now.filter((one) => one.id === onScreen || titles.has(one.id)).map((one) => (one.id === onScreen ? one : { id: one.id, title: titles.get(one.id)! }))
  if (next.length !== now.length || next.some((one, i) => one.title !== now[i]!.title)) keepOpen(next)
}

/** The screen last shown, a note's id or none for the library: where the desktop app, which has no address to type, starts again. */
export function rememberShown(note: string | undefined): void {
  try {
    if (note === undefined) localStorage.removeItem(SHOWN)
    else localStorage.setItem(SHOWN, note)
  } catch {
    // Storage is off: the app starts at the library.
  }
}

/** The note the app was last on, when it starts with no address of its own to go by. */
export function shownLast(): string | undefined {
  if (!inDesktopApp()) return undefined
  try {
    const id = localStorage.getItem(SHOWN)
    return id !== null && openNotes.value.some((one) => one.id === id) ? id : undefined
  } catch {
    return undefined
  }
}

// ----- the tree, the library's column: shown or hidden, on the left or the right; each person's own -----

const TREE_SHOWN = 'shellnote:library-side'
const TREE_AT = 'shellnote:library-side-at'
/** Narrower than this, the tree starts hidden: the note needs the room. */
const ROOMY = 1100

function saved(key: string): unknown {
  try {
    const value = localStorage.getItem(key)
    return value === null ? undefined : JSON.parse(value)
  } catch {
    return undefined
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage is off: it lasts until the page closes.
  }
}

const shownAtStart = saved(TREE_SHOWN)
export const treeShown = new Shared<boolean>(typeof shownAtStart === 'boolean' ? shownAtStart : typeof window !== 'undefined' && window.innerWidth >= ROOMY)
export const treeAt = new Shared<'left' | 'right'>(saved(TREE_AT) === 'right' ? 'right' : 'left')

export function showTree(shown: boolean): void {
  save(TREE_SHOWN, shown)
  treeShown.set(shown)
}

export function moveTree(at: 'left' | 'right'): void {
  save(TREE_AT, at)
  treeAt.set(at)
}
