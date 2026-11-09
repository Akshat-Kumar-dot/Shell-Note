// Other programs inside ShellNote (stage 2, 25 October 2026): what the system does for
// the program panel, given to the editor by the app (apps/web/src/desktop.ts, through Tauri, in the app on Windows
// only). The editor touches no Tauri itself: platform behaviour is passed in. None given, there is no
// program panel and no button for it: the browser, and the app elsewhere than on Windows.
import type { Place } from '@shellnote/core'
import { Shared } from '../video/state.js'

/** A window the person could put on the panel, as the system lists it. */
export interface ProgramWindow {
  /** What the other calls take. */
  id: number
  title: string
  /** The program's file, "POWERPNT.EXE". */
  program: string
  /** Why it cannot be put on the panel: run as administrator, Windows would not say who runs it, or already held. */
  left_out: 'administrator' | 'unknown' | 'held' | 'checking' | null
}

/** A box of the page in the screen's pixels from the page's top left: an element's box times `devicePixelRatio`. */
export interface ProgramArea {
  x: number
  y: number
  width: number
  height: number
}

/** What the system tells of a held program. */
export type ProgramTold =
  | { kind: 'moved'; id: number; x: number; y: number; width: number; height: number; minimised: boolean }
  | { kind: 'title'; id: number; title: string }
  | { kind: 'closed'; id: number }

export interface ProgramHost {
  list(): Promise<ProgramWindow[]>
  /**
   * Hold the window on `area`, framed with square corners and `border` (0xRRGGBB). Its own place, size and state are
   * kept first, to be given back; `again` (Put back, after a drag off): the first ones kept.
   */
  hold(id: number, area: ProgramArea, border: number, again?: boolean): Promise<void>
  place(id: number, area: ProgramArea): Promise<void>
  /**
   * Let it go, given back its own place, size and state from before the panel; `restore`
   * false, it stays where it is (the person dragged it off:).
   */
  letGo(id: number, restore?: boolean): Promise<void>
  /** Hidden while something of ShellNote is over the panel, and back. */
  cover(id: number, covered: boolean): Promise<void>
  /** Listen to what the system tells; returns the function that stops listening. */
  onTold(listener: (told: ProgramTold) => void): () => void
  /**
   * The window's icon, as the taskbar shows it: `PROGRAM_ICON` by `PROGRAM_ICON` RGBA
   * pixels, row by row; none when the program has none. A host without it: a plain window mark in the list.
   */
  icon?(id: number): Promise<Uint8Array | undefined>
  /**
   * Start, or change, the live picture of window `id` (stage 3, without cropping, xq1): at most
   * `width` by `height` screen pixels, the panel's box; `seen`, up to 30 frames a second, else 2, so a last picture is
   * there should something of ShellNote cover a window on the panel. A host without it: no pictures.
   */
  picture?(id: number, width: number, height: number, seen: boolean): Promise<void>
  stopPicture?(id: number): Promise<void>
  /** Listen to the pictures' frames; returns the function that stops listening. */
  onFrame?(listener: (frame: ProgramFrame) => void): () => void
  /** Where window `id` is now (stage 4): its slide, page, address, or file; none when it has none to give. */
  placeOf?(id: number): Promise<Place | null>
  /**
   * Back to a place, on the person's own tap on a line's mark, and only then (the project's rule: no command
   * controls another program). `front`: the window is brought in front, not being seen. False when it cannot go
   * back.
   */
  goTo?(id: number, place: Place, front: boolean): Promise<boolean>
  /** Whether a small picture of window `id` may be kept with a line now: never while it shows a password box. */
  mayKeepPicture?(id: number): Promise<boolean>
  /** The words of window `id`'s place now, from the program itself; none when it has none to give. */
  wordsOf?(id: number): Promise<string | null>
  /** What a picture shows, read by the system on this computer: `rgba` as a frame gives them. None when it reads none. */
  readPicture?(width: number, height: number, rgba: Uint8Array): Promise<string | null>
}

/** A frame of a window's live picture: its pixels, red, green, blue and alpha, row by row; or why none comes now. */
export type ProgramFrame =
  | { id: number; width: number; height: number; rgba: Uint8ClampedArray<ArrayBuffer> }
  | { id: number; problem: string }
  | { id: number; closed: true }

/** How many pixels across a program's icon comes, and down. */
export const PROGRAM_ICON = 32

/** The host the app gave, or none. */
export const programHost = new Shared<ProgramHost | undefined>(undefined)

/** The words for why a window cannot be put on the panel. */
export function leftOutWords(why: ProgramWindow['left_out']): string | undefined {
  if (why === 'administrator') return 'Run as administrator: ShellNote cannot move it'
  if (why === 'unknown') return 'Windows will not say which program this is'
  if (why === 'held') return 'Already on a panel'
  if (why === 'checking') return 'Checking whether it is a private window'
  return undefined
}

/**
 * Whether a window is offered at all: never a private browser window (the research's rule, section 3.9). Edge says
 * "InPrivate" in its title; Chrome's Incognito does not say so in its title, an open question of this stage.
 */
export function offered(window: ProgramWindow): boolean {
  return !/\bInPrivate\b/u.test(window.title)
}
