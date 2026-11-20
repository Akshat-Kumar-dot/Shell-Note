// The board on the screen, for what acts on its view from outside it: a command showing the whole board, a step added
// in the middle of the view, the row of tools showing what a chosen link can do. One board is drawn at a time.
import type { Id } from '@shellnote/core'
import { Shared } from '../video/state.js'

export interface BoardScreen {
  /** Show the whole board; the zoom it is shown at. */
  fit(): number
  /** The board point in the middle of the view. */
  middle(): { x: number; y: number }
  /** Bring a block of the board to the middle of the view, at the zoom it is. */
  show(id: Id): void
}

let shown: BoardScreen | undefined

/** The board drawn now; none while no board is on the screen. */
export const boardScreen = (): BoardScreen | undefined => shown

/** The board view says it is on the screen, or gone (undefined). */
export function onScreen(screen: BoardScreen | undefined): void {
  shown = screen
}

/** The link chosen on the board, by the step it leaves and the step it leads to; none while no link is. */
export const chosenLink = new Shared<{ from: Id; to: Id } | undefined>(undefined)
