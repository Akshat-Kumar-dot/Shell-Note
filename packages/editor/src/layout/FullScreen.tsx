// Full screen: the browser's own full screen, its bars and the taskbar gone, the workspace as the person laid it out,
// the video and the side panel with it (the person: "in the full screen the yt video also disappears" was wrong). One
// panel alone is the panel bar's full view. Esc, or the same button, brings the browser back.
import { Expand, Shrink } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { commands } from '../commands/index.js'

const onChange = (listener: () => void): (() => void) => {
  document.addEventListener('fullscreenchange', listener)
  return () => document.removeEventListener('fullscreenchange', listener)
}
const isFull = (): boolean => document.fullscreenElement !== null

export function FullScreenButton() {
  const on = useSyncExternalStore(onChange, isFull)
  const toggle = (): void => {
    // A browser that says no to full screen changes nothing, as before: no alert.
    void Promise.resolve(commands.do('screen.fullscreen', { on: !on })).catch(() => undefined)
  }
  return (
    <button type="button" className="nw-full-screen" aria-label={on ? 'Leave full screen' : 'Full screen'} aria-pressed={on} title={on ? 'Leave full screen (Esc)' : 'Full screen'} data-command="screen.fullscreen" onClick={toggle}>
      {on ? <Shrink size={18} aria-hidden /> : <Expand size={18} aria-hidden />}
    </button>
  )
}
