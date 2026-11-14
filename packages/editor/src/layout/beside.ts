// The video and a program kept inside the Beside panel. Each stays one of the workspace's panels, drawn in the same
// flat list as the others (DockArea.tsx), so it is never made again as it moves in or out and a playing video plays
// on: the Beside panel keeps a place for it under its own head, and the workspace draws it over that place. While
// Beside is closed or shows another part, it is out of sight, kept, and a video is paused (YouTube's policies).
import { playHook, Shared, videoShown } from '../video/state.js'
import { showSideTab, sideTab, videoTab, VIDEO_TABS } from './sideTab.js'
import { workspace, type Inside } from './state.js'
import type { Rect } from './tree.js'

/** The place Beside keeps for what it holds, from the panel's own top left; none while it keeps none. */
export const besideSlot = new Shared<(Rect & { for: Inside }) | undefined>(undefined)

/** Beside open on the video's part, where a video kept inside it is seen: when one is shown, or asked to play. */
export function revealVideo(): void {
  const now = workspace.value
  if (!now.beside.video || (now.side && VIDEO_TABS.includes(sideTab.value))) return
  showSideTab(videoTab())
}

videoShown.subscribe(() => {
  if (videoShown.value !== undefined) revealVideo()
})
playHook.before = revealVideo
