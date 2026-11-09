// Which tab of the side panel is open: shared, kept in the person's browser, and loaded with
// the editor, so an AI answer can open Output before the side panel's own code has loaded.
import { Shared } from '../video/state.js'
import { setSideOpen } from './state.js'

export type SideTab = 'description' | 'transcript' | 'web' | 'timer' | 'output' | 'ai'
export const SIDE_TABS: readonly SideTab[] = ['description', 'transcript', 'web', 'timer', 'output', 'ai']
const TAB_KEY = 'shellnote:side-tab'

function readTab(): SideTab {
  try {
    const saved = localStorage.getItem(TAB_KEY)
    return SIDE_TABS.includes(saved as SideTab) ? (saved as SideTab) : 'description'
  } catch {
    return 'description'
  }
}

/** The tab open, shared: an AI answer opens Output, wherever it was asked. */
export const sideTab = new Shared<SideTab>(readTab())

/** Open a tab of the side panel (and the panel), as an AI answer or the AI log button does. */
export function showSideTab(tab: SideTab, open = true): void {
  try {
    localStorage.setItem(TAB_KEY, tab)
  } catch {
    // Storage is off: it lasts until the page closes.
  }
  sideTab.set(tab)
  if (open) setSideOpen(true)
}

