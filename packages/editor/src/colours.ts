// Colours on the page. A named colour (red, blue…) is drawn by the theme, so
// it can follow dark mode; a person's own colour code (#rrggbb) is drawn as
// it is. Both are written as data-color, so a copied note keeps them.
import { Color, type AnyColor } from '@shellnote/core'

const CODE = /^#[0-9a-f]{6}$/

/** A colour code, as a person picks one: # and six hex digits. */
export function isColourCode(value: string): boolean {
  return CODE.test(value)
}

/** A colour read from pasted HTML or a colour field: a named colour or a code, in lowercase; anything else is dropped. */
export function colourOf(value: string | null | undefined): AnyColor | null {
  const lower = value?.trim().toLowerCase()
  if (lower === undefined) return null
  if ((Color.options as readonly string[]).includes(lower)) return lower as AnyColor
  const code = /^#?([0-9a-f]{6})$/.exec(lower)?.[1]
  return code === undefined ? null : (`#${code}` as AnyColor)
}

/** The attributes that draw a colour: data-color, and for a code the colour itself. */
export function colourAttributes(color: string | null | undefined): Record<string, string> {
  if (!color) return {}
  return isColourCode(color) ? { 'data-color': color, style: `color: ${color}` } : { 'data-color': color }
}

/** The same for React. */
export function colourProps(color: string | undefined): { 'data-color'?: string; style?: { color: string } } {
  if (!color) return {}
  return isColourCode(color) ? { 'data-color': color, style: { color } } : { 'data-color': color }
}

const RECENT_KEY = 'shellnote:recent-colours'
const RECENT_MAX = 8

/** The colour codes this person used last, newest first. Kept in this browser only; empty when storage is off. */
export function recentColours(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(saved) ? saved.filter((item): item is string => typeof item === 'string' && isColourCode(item)).slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

/** Put a colour code first among the recent ones. */
export function rememberColour(code: string): string[] {
  const next = [code, ...recentColours().filter((item) => item !== code)].slice(0, RECENT_MAX)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // Storage is off, as in a private window: the list lasts until the page closes.
  }
  return next
}
