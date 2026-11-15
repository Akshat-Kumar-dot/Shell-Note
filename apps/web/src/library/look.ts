// How the library shows its folders and notes, as cards or as a list: each person's own, on this device. The library's
// own switch and Customise in Settings both set it (library.look).
import { Shared } from '@shellnote/editor'

export type LibraryLook = 'cards' | 'list'

const KEY = 'shellnote:libraryLook'

function read(): LibraryLook {
  try {
    return localStorage.getItem(KEY) === 'list' ? 'list' : 'cards'
  } catch {
    return 'cards'
  }
}

export const libraryLook = new Shared<LibraryLook>(read())

export function setLibraryLook(look: LibraryLook): void {
  try {
    if (look === 'cards') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, look)
  } catch {
    // Kept for this visit only.
  }
  libraryLook.set(look)
}
