// Which part of the panel beside the notes is open: shared, kept in the person's browser, and loaded with the editor,
// so an AI answer can open what the AI changed before the panel's own code has loaded. The AI's parts: the chat
// (`ai`) and what it changed or made (`output`). Beside's: the video's description, its transcript and the timer, the
// web page, and a program. A program's part is the person's alone: no command opens it (the commands' `panel` input
// does not name it).
import { Shared } from '../video/state.js'
import { setSideOpen } from './state.js'

export type SideTab = 'description' | 'transcript' | 'web' | 'timer' | 'output' | 'ai' | 'program'
export const SIDE_TABS: readonly SideTab[] = ['description', 'transcript', 'web', 'timer', 'output', 'ai', 'program']
/** The AI's parts; every other is Beside's. */
export const AI_TABS: readonly SideTab[] = ['ai', 'output']
/** Beside's parts that go with the video shown inside it. */
export const VIDEO_TABS: readonly SideTab[] = ['description', 'transcript', 'timer']
const TAB_KEY = 'shellnote:side-tab'

function readTab(): SideTab {
  try {
    const saved = localStorage.getItem(TAB_KEY)
    return SIDE_TABS.includes(saved as SideTab) ? (saved as SideTab) : 'description'
  } catch {
    return 'description'
  }
}

/** The part open, shared: an AI answer opens what the AI changed, wherever it was asked. */
export const sideTab = new Shared<SideTab>(readTab())

/** Open a part of the panel (and the panel), as an AI answer or the AI log button does. */
export function showSideTab(tab: SideTab, open = true): void {
  try {
    localStorage.setItem(TAB_KEY, tab)
  } catch {
    // Storage is off: it lasts until the page closes.
  }
  sideTab.set(tab)
  if (open) setSideOpen(true)
}

/** Beside's part last open, and its video part last open: where its button and a video shown bring it back to. */
let lastBeside: SideTab = AI_TABS.includes(sideTab.value) ? 'description' : sideTab.value
let lastVideo: SideTab = VIDEO_TABS.includes(sideTab.value) ? sideTab.value : 'description'
sideTab.subscribe(() => {
  const tab = sideTab.value
  if (!AI_TABS.includes(tab)) lastBeside = tab
  if (VIDEO_TABS.includes(tab)) lastVideo = tab
})
export const besideTab = (): SideTab => lastBeside
export const videoTab = (): SideTab => lastVideo
