// The program panel's state (stage 2 of other programs inside ShellNote, 25 October 2026): whether the panel is open,
// and which program it holds. Never in a note: a window belongs to this computer, now (a note opened elsewhere would
// name a window that is not there).
import { Shared } from '../video/state.js'
import type { ProgramWindow } from './host.js'

/** The program panel open: choosing a window, or holding one. */
export const programShown = new Shared(false)

/**
 * The program on the panel: held (seen and used on it), covered (hidden while something of ShellNote is over it),
 * moved off (the person dragged it off by its own title bar: let go, with "Put back" offered), or closed.
 */
export interface Held {
  id: number
  title: string
  program: string
  state: 'held' | 'covered' | 'moved-off' | 'closed'
}
export const programHeld = new Shared<Held | undefined>(undefined)

/** A program shown by its picture, left where it is: view only, until brought here or let be. */
export const programElsewhere = new Shared<ProgramWindow | undefined>(undefined)
