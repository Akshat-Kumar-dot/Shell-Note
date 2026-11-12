// What a note's file is called.

/** The file name extension of a note. */
export const EXTENSION = '.shellnote'

/** A file name from the note's title: control characters become spaces, and characters no system allows, dashes. */
export function fileName(title: string): string {
  const visible = Array.from(title, (ch) => (ch < ' ' ? ' ' : ch)).join('')
  const safe = visible
    .replace(/[\\/:*?"<>|]+/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 100)
  return `${safe === '' || safe === '.' || safe === '..' ? 'Untitled' : safe}${EXTENSION}`
}
