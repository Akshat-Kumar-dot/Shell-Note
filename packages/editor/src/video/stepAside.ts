// YouTube's terms: nothing of ours in front of any part of its player (Required Minimum Functionality, "Overlays and
// frames"), and nothing played from a player that is not seen (Developer Policies III.I.9); both read on 17 October
// 2026. So when a menu, a dialog or the side panel opens over the player, the player steps aside: it pauses and hides
// until that closes, then plays on if it was playing.
import type { Id } from '@shellnote/core'
import { useEffect, type RefObject } from 'react'
import { workspace } from '../layout/state.js'
import { videoClock, videoCovered } from './state.js'

/** What of ours can open over the note area. */
export const OVER = [
  '.nw-popover',
  '[role="dialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '.dialog-backdrop',
  '.nw-dropdown',
  '.nw-table-grid',
  '.nw-table-menu',
  '.nw-ai-button',
  '.nw-ai-box',
  '.nw-ai-toast',
  '.nw-side',
  // Another panel floating, a bar floating, or a panel being dragged and where it would go.
  '.nw-dock-panel[data-floating]',
  '.nw-bar[data-at="float"]',
  '.nw-dock-ghost',
  '.nw-dock-drop',
].join(', ')

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return a.width > 0 && a.height > 0 && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

/**
 * Watch for anything of ours over `element` (inside its panel, `panel`, a selector), at most once a frame: `changed`
 * is called with true when something comes over it, false when nothing is any more. Returns the function that stops
 * watching. The video's player steps aside so (YouTube's terms); a program's window is hidden so, since it is above
 * the page and would hide what opened (stage 2's airspace swap).
 */
export function watchCovered(element: () => HTMLElement | null, panel: string, changed: (over: boolean) => void): () => void {
  let frame = 0
  let was: boolean | undefined
  const check = (): void => {
    frame = 0
    const own = element()
    if (!own) return
    const box = own.getBoundingClientRect()
    const holder = own.closest(panel)
    // Its own panel, and what holds it, are not over it.
    const over = [...document.querySelectorAll(OVER)].some((other) => !holder?.contains(other) && !other.contains(own) && overlaps(other.getBoundingClientRect(), box))
    if (over === was) return
    was = over
    changed(over)
  }
  const later = (): void => {
    frame ||= requestAnimationFrame(check)
  }
  // Only what opens, closes or moves among those: a stroke drawn or a letter typed costs a test of a node or two.
  const ours = (node: Node): boolean => node instanceof Element && (node.matches(OVER) || node.querySelector(OVER) !== null)
  const watcher = new MutationObserver((records) => {
    const moved = records.some((record) => (record.type === 'attributes' ? record.target instanceof Element && record.target.matches(OVER) : [...record.addedNodes, ...record.removedNodes].some(ours)))
    if (moved) later()
  })
  watcher.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'hidden', 'data-floating', 'data-at'] })
  window.addEventListener('resize', later)
  const unlisten = workspace.subscribe(later)
  later()
  return () => {
    watcher.disconnect()
    window.removeEventListener('resize', later)
    unlisten()
    cancelAnimationFrame(frame)
  }
}

/** Watch for anything of ours over `player` (a YouTube video's, `media`); none, nothing is watched. */
export function useStepAside(player: RefObject<HTMLElement | null>, media: Id | undefined): void {
  useEffect(() => {
    if (media === undefined) return
    let resume = false
    const stop = watchCovered(
      () => player.current,
      '.nw-video',
      (over) => {
        if (over === videoCovered.value) return
        const clock = videoClock.value?.media === media ? videoClock.value : undefined
        if (over) {
          resume = clock?.playing() ?? false
          clock?.pause()
          videoCovered.set(true)
        } else {
          videoCovered.set(false)
          if (resume) clock?.play()
          resume = false
        }
      },
    )
    return () => {
      stop()
      videoCovered.set(false)
    }
  }, [player, media])
}
