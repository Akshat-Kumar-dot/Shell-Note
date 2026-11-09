// ShellNote's own minimise, maximise and close, in the desktop app on Windows, which has no Windows title bar. At the window's top right on
// every screen; each top bar keeps room for them (app.css, html[data-own-titlebar], set in main.tsx before anything is drawn) and drags the
// window by its empty parts (data-tauri-drag-region). Windows' snap layouts come from a window of the app's own over the maximise button
// (src-tauri/src/titlebar.rs), which tells this one when the pointer is over it.
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useRef, useState } from 'react'

/** Windows' own icons for these buttons (Segoe Fluent Icons on Windows 11, Segoe MDL2 Assets on Windows 10). */
const MINIMISE = ''
const MAXIMISE = ''
const RESTORE = ''
const CLOSE = ''

/** The maximise button's box in the screen's pixels from the page's top left; none in full screen or when not drawn. */
function snapArea(button: HTMLElement | null): { x: number; y: number; width: number; height: number } | null {
  const box = button?.getBoundingClientRect()
  return box && box.width > 0 && !document.fullscreenElement ? { x: box.x * devicePixelRatio, y: box.y * devicePixelRatio, width: box.width * devicePixelRatio, height: box.height * devicePixelRatio } : null
}

export function WindowControls() {
  const [maximised, setMaximised] = useState(false)
  const [snap, setSnap] = useState<'hover' | 'press' | 'leave'>('leave')
  const maximise = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const window_ = getCurrentWindow()
    let live = true
    const follow = (): void => {
      window_.isMaximized().then((now) => live && setMaximised(now), () => undefined)
    }
    // The snap window lies over the maximise button: the button's box, in the screen's pixels, whenever it may move.
    const place = (): void => {
      invoke('titlebar_snap', { area: snapArea(maximise.current) }).catch(() => undefined)
    }
    follow()
    place()
    // A page that is not the app's own (the tests' server) may not ask these: nothing is followed then.
    const resized = window_.onResized(() => {
      follow()
      place()
    }).catch(() => undefined)
    const told = listen<'hover' | 'leave' | 'press'>('titlebar', (event) => setSnap(event.payload)).catch(() => undefined)
    const scale = matchMedia(`(resolution: ${devicePixelRatio}dppx)`)
    scale.addEventListener('change', place)
    document.addEventListener('fullscreenchange', place)
    return () => {
      live = false
      void resized.then((stop) => stop?.())
      void told.then((stop) => stop?.())
      scale.removeEventListener('change', place)
      document.removeEventListener('fullscreenchange', place)
    }
  }, [])

  return (
    <div className="window-controls" role="group" aria-label="Window">
      <button type="button" aria-label="Minimise" title="Minimise" onClick={() => void getCurrentWindow().minimize().catch(() => undefined)}>
        {MINIMISE}
      </button>
      <button ref={maximise} type="button" aria-label={maximised ? 'Restore' : 'Maximise'} title={maximised ? 'Restore down' : 'Maximise'} data-snap={snap} onClick={() => void getCurrentWindow().toggleMaximize().catch(() => undefined)}>
        {maximised ? RESTORE : MAXIMISE}
      </button>
      <button type="button" className="window-close" aria-label="Close window" title="Close" onClick={() => void getCurrentWindow().close().catch(() => undefined)}>
        {CLOSE}
      </button>
    </div>
  )
}
