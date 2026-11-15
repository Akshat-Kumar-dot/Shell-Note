// How the person has set the app round their notes, on this device only (a phone and a laptop want their own): the
// look, flat, islands or dock, and the buttons of the bar for typing in their order, the others waiting under the
// bar's More, one click away. Where each bar and panel sits is the workspace's (state.ts); the library's column and
// the library's look are the app's.
import { TYPING_BUTTONS, TYPING_START, type TypingButton } from '@shellnote/core'
import { Shared } from '../video/state.js'

/** The app's look: one row of tools under the tabs and thin lines; rounded panels with the tools floating; or no rail, the tools at the bottom. */
export type AppLook = 'flat' | 'islands' | 'dock'
export const APP_LOOKS: readonly AppLook[] = ['flat', 'islands', 'dock']

const LOOK_KEY = 'shellnote:look'
const BAR_KEY = 'shellnote:typing-bar'

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
    if (value === undefined) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage is off: it lasts until the page closes.
  }
}

const KNOWN: ReadonlySet<unknown> = new Set(TYPING_BUTTONS)

/** A bar as kept: its known buttons, each once, in order; anything else read is left out. */
function barFrom(value: unknown): TypingButton[] | undefined {
  if (!Array.isArray(value)) return undefined
  return [...new Set(value.filter((one): one is TypingButton => KNOWN.has(one)))]
}

const lookAtStart = saved(LOOK_KEY)
export const appLook = new Shared<AppLook>(APP_LOOKS.includes(lookAtStart as AppLook) ? (lookAtStart as AppLook) : 'flat')

export function setAppLook(look: AppLook): void {
  save(LOOK_KEY, look === 'flat' ? undefined : look)
  appLook.set(look)
}

/** The buttons in the bar for typing, in their order. */
export const typingBar = new Shared<readonly TypingButton[]>(barFrom(saved(BAR_KEY)) ?? TYPING_START)

export function setTypingBar(next: readonly TypingButton[]): void {
  const bar = barFrom(next) ?? [...TYPING_START]
  const same = bar.length === TYPING_START.length && bar.every((one, i) => one === TYPING_START[i])
  save(BAR_KEY, same ? undefined : bar)
  typingBar.set(bar)
}

/** The buttons waiting under More: those not in the bar, in the order they are offered. */
export const underMore = (bar: readonly TypingButton[]): TypingButton[] => TYPING_BUTTONS.filter((one) => !bar.includes(one))

/**
 * A button put in the bar (at a place counted from 1, or at its end) or taken out to More. Gives the bar it makes;
 * a button put where it already is changes nothing.
 */
export function putButton(button: TypingButton, on: boolean, position?: number): readonly TypingButton[] {
  const without = typingBar.value.filter((one) => one !== button)
  if (!on) {
    setTypingBar(without)
    return typingBar.value
  }
  const at = position === undefined ? without.length : Math.max(0, Math.min(without.length, Math.round(position) - 1))
  setTypingBar([...without.slice(0, at), button, ...without.slice(at)])
  return typingBar.value
}

/** What else goes back to its place with the panels and the bars (layout.reset): the app's own, such as the library's column. */
export const placesReset = new Set<() => void>()

/** The look, or the bar for typing, as they start. */
export function resetCustom(part: 'look' | 'tools'): void {
  if (part === 'look') setAppLook('flat')
  else setTypingBar(TYPING_START)
}
