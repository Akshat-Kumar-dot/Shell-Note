// How the library shows its folders and notes: its top as cards, as a list or as Home (start a note, the notes to go
// on with, the folders, then every other note), and a folder as cards or a list. Each person's own, on this device.
// The library's own switch and Customise in Settings both set it (library.look).
import { Shared } from '@shellnote/editor'

/** How the top of the library shows. */
export type LibraryLook = 'cards' | 'list' | 'home'
/** How a folder, a search's results and Recently deleted show. */
export type ListLook = Exclude<LibraryLook, 'home'>

const KEY = 'shellnote:libraryLook'
const FOLDERS_KEY = 'shellnote:folderLook'

function read<T extends string>(key: string, values: readonly T[], otherwise: T): T {
  try {
    const value = localStorage.getItem(key)
    return values.includes(value as T) ? (value as T) : otherwise
  } catch {
    return otherwise
  }
}

/** Kept on this device; the first look is kept as nothing at all. */
function keep(key: string, value: string): void {
  try {
    if (value === 'cards') localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Kept for this visit only.
  }
}

/** The top's look. */
export const libraryLook = new Shared<LibraryLook>(read(KEY, ['cards', 'list', 'home'], 'cards'))
/** The folders' look while the top shows as Home: cards or a list, as last chosen. Under cards or a list, folders show as the top does. */
export const folderLook = new Shared<ListLook>(read(FOLDERS_KEY, ['cards', 'list'], 'cards'))

/** How the library's cards and lines show, Home's own sections aside: the top's look, or under Home the folders'. */
export const listLookOf = (top: LibraryLook, folders: ListLook): ListLook => (top === 'home' ? folders : top)

/** Whether the library's screen shows a folder or Recently deleted now, rather than its top: told by that screen. */
let inFolder = false
export function showingFolder(shown: boolean): void {
  inFolder = shown
}

/** What a choice changed: the top and the folders alike, the top alone (Home), or the folders alone. */
export type LookChanged = 'all' | 'top' | 'folders'

/**
 * Show the library a way. Home is the top's own; cards or a list are the top's and the folders' alike, but chosen
 * inside a folder while the top shows as Home, the folders' alone: the top stays Home.
 */
export function setLibraryLook(look: LibraryLook): LookChanged {
  if (look === 'home') {
    keep(KEY, look)
    libraryLook.set(look)
    return 'top'
  }
  keep(FOLDERS_KEY, look)
  folderLook.set(look)
  if (inFolder && libraryLook.value === 'home') return 'folders'
  keep(KEY, look)
  libraryLook.set(look)
  return 'all'
}

/** Back as it started (layout.reset): the top and the folders as cards. */
export function resetLibraryLook(): void {
  for (const key of [KEY, FOLDERS_KEY]) keep(key, 'cards')
  libraryLook.set('cards')
  folderLook.set('cards')
}
