// Light, dark, or as the system has it. Only the
// app's own surfaces change; the paper always stays white. The choice is this
// browser's convenience, kept in localStorage, and the app works without it.
export type Appearance = 'system' | 'light' | 'dark'

const KEY = 'shellnote:appearance'
const heard = new Set<() => void>()
let current: Appearance | undefined

/** Hear each change of appearance (Settings shows the one chosen, whoever chose it). */
export function onAppearance(listener: () => void): () => void {
  heard.add(listener)
  return () => heard.delete(listener)
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
  if (remember) {
    try {
      localStorage.setItem(KEY, appearance)
    } catch {
      // Not kept, as in a private window: it still applies until the page closes.
    }
  }
  current = appearance
  for (const listener of [...heard]) listener()
}

/** The appearance shown now. */
export const appearanceNow = (): Appearance => current ?? savedAppearance()
