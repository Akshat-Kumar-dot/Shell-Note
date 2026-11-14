// The note's rows of tools: one at a time, the row of what is in hand (words, or the pen), or both, one under the
// other. Each person's own, kept in their browser.
import { Shared } from '../video/state.js'

const KEY = 'shellnote:tools-both'

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/** Both rows shown at once. */
export const bothRows = new Shared<boolean>(read())

export function showBothRows(both: boolean): void {
  try {
    localStorage.setItem(KEY, both ? '1' : '0')
  } catch {
    // Storage is off: it lasts until the page closes.
  }
  bothRows.set(both)
}
