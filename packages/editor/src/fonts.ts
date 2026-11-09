// Which library fonts this person added to the font menu. A setting of the
// app, not of a note: it is kept in this browser, and a note only stores the
// font a block uses.
import { libraryFont } from '@shellnote/core'

const MY_FONTS_KEY = 'shellnote:my-fonts'

/** The library fonts in the font menu, in the order they were added; empty when storage is off. */
export function myFonts(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(MY_FONTS_KEY) ?? '[]')
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string' && libraryFont(id) !== undefined) : []
  } catch {
    return []
  }
}

/** Keep the library fonts in the font menu. Returns them. */
export function saveMyFonts(ids: readonly string[]): string[] {
  const kept = ids.filter((id, i) => libraryFont(id) !== undefined && ids.indexOf(id) === i)
  try {
    localStorage.setItem(MY_FONTS_KEY, JSON.stringify(kept))
  } catch {
    // Storage is off, as in a private window: the menu lasts until the page closes.
  }
  return kept
}

/** The CSS font family for a library font: the font, then the style it resembles. */
export function fontFamily(id: string): string | undefined {
  const font = libraryFont(id)
  return font && `'${font.name}', var(--nw-${font.like})`
}
