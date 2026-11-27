// How the person has set the app round their notes, on this device only (a phone and a laptop want their own): the
// look, flat, islands or dock; the buttons of the three rows of tools in their order, the bar for typing's, the pen's
// row's and a board's, the others waiting under each row's More, one click away; and whether a board shows the points
// where links join. Where each bar and panel sits is the workspace's (state.ts); the library's column and the library's
// look are the app's.
import { BOARD_BUTTONS, BOARD_KEPT, BOARD_START, PEN_BUTTONS, PEN_KEPT, PEN_START, TYPING_BUTTONS, TYPING_START, type BoardButton, type PenButton, type TypingButton } from '@shellnote/core'
import { Shared } from '../video/state.js'

/** The app's look: one row of tools under the tabs and thin lines; rounded panels with the tools floating; or no rail, the tools at the bottom. */
export type AppLook = 'flat' | 'islands' | 'dock'
export const APP_LOOKS: readonly AppLook[] = ['flat', 'islands', 'dock']

const LOOK_KEY = 'shellnote:look'
const BAR_KEY = 'shellnote:typing-bar'
const PEN_KEY = 'shellnote:pen-row'
const BOARD_KEY = 'shellnote:board-row'
const POINTS_KEY = 'shellnote:board-points'

/** The rows of tools: the bar for typing, the pen's row, and a board's row. */
export type ToolRow = 'typing' | 'pen' | 'board'

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
const KNOWN_PEN: ReadonlySet<unknown> = new Set(PEN_BUTTONS)
const KNOWN_BOARD: ReadonlySet<unknown> = new Set(BOARD_BUTTONS)

/** A bar as kept: its known buttons, each once, in order; anything else read is left out. */
function barFrom(value: unknown): TypingButton[] | undefined {
  if (!Array.isArray(value)) return undefined
  return [...new Set(value.filter((one): one is TypingButton => KNOWN.has(one)))]
}

/** The pen's row as kept: its known buttons, each once, in order; the pen and Type in it whatever was read. */
function penFrom(value: unknown): PenButton[] | undefined {
  if (!Array.isArray(value)) return undefined
  const row = [...new Set(value.filter((one): one is PenButton => KNOWN_PEN.has(one)))]
  for (const kept of PEN_KEPT) if (!row.includes(kept)) row.splice(Math.min(row.length, PEN_START.indexOf(kept)), 0, kept)
  return row
}

/** A board's row as kept: its known buttons, each once, in order; Select in it whatever was read. */
function boardFrom(value: unknown): BoardButton[] | undefined {
  if (!Array.isArray(value)) return undefined
  const row = [...new Set(value.filter((one): one is BoardButton => KNOWN_BOARD.has(one)))]
  for (const kept of BOARD_KEPT) if (!row.includes(kept)) row.splice(Math.min(row.length, BOARD_START.indexOf(kept)), 0, kept)
  return row
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

/** The buttons in the pen's row, in their order. */
export const penRow = new Shared<readonly PenButton[]>(penFrom(saved(PEN_KEY)) ?? PEN_START)

export function setPenRow(next: readonly PenButton[]): void {
  const row = penFrom(next) ?? [...PEN_START]
  const same = row.length === PEN_START.length && row.every((one, i) => one === PEN_START[i])
  save(PEN_KEY, same ? undefined : row)
  penRow.set(row)
}

/** The pen's row's buttons waiting under its More, in the order they are offered. */
export const underPenMore = (row: readonly PenButton[]): PenButton[] => PEN_BUTTONS.filter((one) => !row.includes(one))

/** The buttons in a board's row, in their order. */
export const boardRow = new Shared<readonly BoardButton[]>(boardFrom(saved(BOARD_KEY)) ?? BOARD_START)

export function setBoardRow(next: readonly BoardButton[]): void {
  const row = boardFrom(next) ?? [...BOARD_START]
  const same = row.length === BOARD_START.length && row.every((one, i) => one === BOARD_START[i])
  save(BOARD_KEY, same ? undefined : row)
  boardRow.set(row)
}

/** A board's row's buttons waiting under its More, in the order they are offered. */
export const underBoardMore = (row: readonly BoardButton[]): BoardButton[] => BOARD_BUTTONS.filter((one) => !row.includes(one))

/** Whether a board shows the points where links join (Customise, Advanced): on as it starts. */
export const boardPoints = new Shared<boolean>(saved(POINTS_KEY) !== false)

export function setBoardPoints(on: boolean): void {
  save(POINTS_KEY, on ? undefined : false)
  boardPoints.set(on)
}

/** A row's buttons in order: one put in (at a place counted from 1, or at its end), or taken out. */
function placed<T extends string>(now: readonly T[], button: T, on: boolean, position: number | undefined): T[] {
  const without = now.filter((one) => one !== button)
  if (!on) return without
  const at = position === undefined ? without.length : Math.max(0, Math.min(without.length, Math.round(position) - 1))
  return [...without.slice(0, at), button, ...without.slice(at)]
}

/**
 * A button put in a row of tools (at a place counted from 1, or at its end) or taken out to its More. Gives the row it
 * makes; a button put where it already is changes nothing. The pen and Type never leave the pen's row, nor Select a
 * board's.
 */
export function putButton(button: TypingButton | PenButton | BoardButton, on: boolean, position?: number, row: ToolRow = 'typing'): readonly string[] {
  if (row === 'board') {
    const which = button as BoardButton
    if (!KNOWN_BOARD.has(which)) throw new Error(`A board's row has no ${which} button: it has ${BOARD_BUTTONS.join(', ')}.`)
    if (!on && BOARD_KEPT.includes(which)) throw new Error("Select always stays in a board's row: a board opens with it. It can be moved along it.")
    setBoardRow(placed(boardRow.value, which, on, position))
    return boardRow.value
  }
  if (row === 'pen') {
    const which = button as PenButton
    if (!KNOWN_PEN.has(which)) throw new Error(`The pen's row has no ${which} button: it has ${PEN_BUTTONS.join(', ')}.`)
    if (!on && PEN_KEPT.includes(which)) throw new Error(which === 'pen' ? "The pen always stays in the pen's row: it is how the row starts. It can be moved along it." : "Type always stays in the pen's row: it is the way back to the row for words. It can be moved along it.")
    setPenRow(placed(penRow.value, which, on, position))
    return penRow.value
  }
  const which = button as TypingButton
  if (!KNOWN.has(which)) throw new Error(`The bar for typing has no ${which} button: it has ${TYPING_BUTTONS.join(', ')}. The pen's row's are tools=pen.`)
  setTypingBar(placed(typingBar.value, which, on, position))
  return typingBar.value
}

/** What else goes back to its place with the panels and the bars (layout.reset): the app's own, such as the library's column. */
export const placesReset = new Set<() => void>()

/** The look, or a row of tools, as they start: a board's with its points shown. */
export function resetCustom(part: 'look' | 'tools' | 'pen' | 'board'): void {
  if (part === 'look') setAppLook('flat')
  else if (part === 'pen') setPenRow(PEN_START)
  else if (part === 'board') {
    setBoardRow(BOARD_START)
    setBoardPoints(true)
  } else setTypingBar(TYPING_START)
}
