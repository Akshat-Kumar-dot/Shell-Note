// How the app looks: light, dark, or as the system has it; its own colour
// (graphite, which is no colour, or one of six); and, in the dark, whether the
// paper is white or dark, its ink in colours that read on it (the editor's
// theme.css). Printing is always on white. All are this browser's convenience,
// kept in localStorage, and the app works without them.
export type Appearance = 'system' | 'light' | 'dark'

/** The app's own colour, on its buttons and what is chosen (the editor's theme.css maps each to its shades). */
export const ACCENTS = ['graphite', 'blue', 'teal', 'green', 'amber', 'rose', 'red'] as const
export type Accent = (typeof ACCENTS)[number]

const KEY = 'shellnote:appearance'
const ACCENT_KEY = 'shellnote:accent'
const PAPER_KEY = 'shellnote:paper'
const heard = new Set<() => void>()
let current: Appearance | undefined
let accent: Accent | undefined
let paper: boolean | undefined

/** Hear each change of appearance or colour (Settings shows the one chosen, whoever chose it). */
export function onAppearance(listener: () => void): () => void {
  heard.add(listener)
  return () => heard.delete(listener)
}

/** Keep a choice in this browser; not kept, as in a private window, it still applies until the page closes. */
function remembered(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Nothing to do: the choice shows, and is asked again next time.
  }
}

/** The appearance chosen in this browser, or the system's. */
export function savedAppearance(): Appearance {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

/** Show the app in an appearance, and remember it. */
export function applyAppearance(appearance: Appearance, remember = true): void {
  const root = document.documentElement
  if (appearance === 'system') delete root.dataset.theme
  else root.dataset.theme = appearance
  if (remember) remembered(KEY, appearance)
  current = appearance
  for (const listener of [...heard]) listener()
}

/** The appearance shown now. */
export const appearanceNow = (): Appearance => current ?? savedAppearance()

/** The colour chosen in this browser, or graphite. */
export function savedAccent(): Accent {
  try {
    const value = localStorage.getItem(ACCENT_KEY)
    return ACCENTS.find((name) => name === value) ?? 'graphite'
  } catch {
    return 'graphite'
  }
}

/** Show the app in a colour, and remember it. Graphite is the sheet's own values, so it sets nothing. */
export function applyAccent(next: Accent, remember = true): void {
  const root = document.documentElement
  if (next === 'graphite') delete root.dataset.accent
  else root.dataset.accent = next
  if (remember) remembered(ACCENT_KEY, next)
  accent = next
  for (const listener of [...heard]) listener()
}

/** The colour shown now. */
export const accentNow = (): Accent => accent ?? savedAccent()

/** Whether the paper is dark in the dark theme, as chosen in this browser; white unless chosen. */
export function savedDarkPaper(): boolean {
  try {
    return localStorage.getItem(PAPER_KEY) === 'dark'
  } catch {
    return false
  }
}

/** Show the paper dark in the dark theme, or white, and remember it. */
export function applyDarkPaper(dark: boolean, remember = true): void {
  const root = document.documentElement
  if (dark) root.dataset.paper = 'dark'
  else delete root.dataset.paper
  if (remember) remembered(PAPER_KEY, dark ? 'dark' : 'white')
  paper = dark
  for (const listener of [...heard]) listener()
}

/** Whether the paper is dark in the dark theme now. */
export const darkPaperNow = (): boolean => paper ?? savedDarkPaper()
