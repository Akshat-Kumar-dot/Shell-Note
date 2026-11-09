// What only the desktop app does. The same pages run in a browser tab and in
// the app; nothing here runs in a tab.
//
// Closing the window: a tab gives the page a last moment as it goes (the
// note is kept when the page is hidden), but an app's window can go at once.
// So the app hides its window, tells the page (shellnote:closing), and closes
// once the page says its note is kept, or after two seconds (src-tauri/lib.rs).
//
// Speaking a request: WebView2 has the browser's speech recognition but not the
// online service Edge sends the voice to, so it hears, then fails with
// "network". On Windows the app puts Windows' own recognizer in its place
// (src-tauri/speech.rs), behind the same interface, so the AI box is the same.
//
// Other programs on a panel (stage 2, 25 October 2026, Windows first): the program panel's host, by the
// app's commands (src-tauri/apps.rs) and its event "apps", given to the editor only in the app on Windows.
import { Channel, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { Place } from '@shellnote/core'
import { inDesktopApp, inWindowsApp, PROGRAM_ICON, programHost, type ProgramFrame, type ProgramHost, type ProgramTold, type ProgramWindow } from '@shellnote/editor'

/**
 * A program's live picture (stage 3; src-tauri/src/picture.rs): WebView2 shares two buffers a window with the page
 * once, and then a short message names the one just filled. Read where they lie, never copied on the way.
 */
const pictureBuffers = new Map<number, ArrayBuffer[]>()
/**
 * Each window's picture asked for and stopped one after another, in the order the panel asks: a stop overtaken by the
 * start after it (a program's picture brought onto the panel: the one stopped, the other started) left nothing
 * running while the program was held (2 November 2026).
 */
const pictureTurns = new Map<number, Promise<unknown>>()
function inTurn<T>(id: number, call: () => Promise<T>): Promise<T> {
  const next = (pictureTurns.get(id) ?? Promise.resolve()).then(call, call)
  pictureTurns.set(id, next.catch(() => undefined))
  return next
}
const frameListeners = new Set<(frame: ProgramFrame) => void>()
interface PictureMessage {
  shellnotePicture?: number
  buffer?: number
  width?: number
  height?: number
  problem?: string
  closed?: boolean
}
const webview = (window as unknown as { chrome?: { webview?: { addEventListener(type: string, listener: (event: never) => void): void } } }).chrome?.webview
webview?.addEventListener('sharedbufferreceived', (event: { additionalData?: PictureMessage; getBuffer(): ArrayBuffer }) => {
  const told = event.additionalData
  if (told?.shellnotePicture === undefined || told.buffer === undefined) return
  const two = pictureBuffers.get(told.shellnotePicture) ?? []
  two[told.buffer] = event.getBuffer()
  pictureBuffers.set(told.shellnotePicture, two)
})
webview?.addEventListener('message', (event: { data?: PictureMessage }) => {
  const told = event.data
  const id = told?.shellnotePicture
  if (told === undefined || id === undefined) return
  let frame: ProgramFrame | undefined
  if (told.closed) frame = { id, closed: true }
  else if (told.problem !== undefined) frame = { id, problem: told.problem }
  else {
    const buffer = told.buffer === undefined ? undefined : pictureBuffers.get(id)?.[told.buffer]
    const { width = 0, height = 0 } = told
    if (!buffer || width * height * 4 > buffer.byteLength) return
    frame = { id, width, height, rgba: new Uint8ClampedArray(buffer, 0, width * height * 4) }
  }
  for (const listener of frameListeners) listener(frame)
})

const windowsHost: ProgramHost = {
  list: () => invoke<ProgramWindow[]>('apps_list'),
  hold: (id, area, border, again) => invoke('apps_hold', { id, area, border, again: again ?? false }),
  place: (id, area) => invoke('apps_place', { id, area }),
  letGo: (id, restore) => invoke('apps_let_go', { id, restore: restore ?? true }),
  cover: (id, covered) => invoke('apps_cover', { id, covered }),
  picture: (id, width, height, seen) => inTurn(id, () => invoke<void>('apps_picture', { id, width: Math.round(width), height: Math.round(height), seen })),
  stopPicture: (id) =>
    inTurn(id, () =>
      invoke<void>('apps_picture_stop', { id }).finally(() => {
        pictureBuffers.delete(id)
      }),
    ),
  onFrame: (listener) => {
    frameListeners.add(listener)
    return () => void frameListeners.delete(listener)
  },
  // The pixels come as bytes, not words (src-tauri/src/apps.rs, apps_icon); none when the program has no icon.
  placeOf: (id) => invoke<Place | null>('apps_place_of', { id }),
  goTo: (id, place, front) => invoke<boolean>('apps_go_to', { id, place, front }),
  mayKeepPicture: (id) => invoke<boolean>('apps_may_keep_picture', { id }),
  wordsOf: (id) => invoke<string | null>('apps_words_of', { id }),
  readPicture: (width, height, rgba) => invoke<string | null>('apps_read_picture', rgba, { headers: { 'x-width': String(width), 'x-height': String(height) } }),
  icon: (id) => invoke<ArrayBuffer>('apps_icon', { id }).then((bytes) => (bytes.byteLength === PROGRAM_ICON * PROGRAM_ICON * 4 ? new Uint8Array(bytes) : undefined)),
  onTold: (listener) => {
    const stop = listen<ProgramTold>('apps', (event) => listener(event.payload))
    return () => void stop.then((unlisten) => unlisten())
  },
}

const keepers = new Set<() => Promise<unknown>>()

/** Run `keep` before the app's window closes. Returns the function that stops it. */
export function keepWhenClosing(keep: () => Promise<unknown>): () => void {
  keepers.add(keep)
  return () => {
    keepers.delete(keep)
  }
}

/** What Windows' recognizer says, as speech.rs sends it. */
type Heard = { kind: 'start' } | { kind: 'result'; text: string; last: boolean } | { kind: 'error'; error: string } | { kind: 'end' }

/** The browser's speech recognition, as the AI box uses it, done by Windows' recognizer. */
export class WindowsRecognition {
  lang = 'en-US'
  interimResults = false
  continuous = false
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  #ended = false

  start(): void {
    const events = new Channel<Heard>((heard) => {
      if (this.#ended) return
      if (heard.kind === 'result' && (heard.last || this.interimResults)) this.onresult?.({ results: [[{ transcript: heard.text }]] })
      else if (heard.kind === 'error') this.onerror?.({ error: heard.error })
      else if (heard.kind === 'end') this.#end()
    })
    invoke('listen', { lang: this.lang, events }).catch(() => {
      this.onerror?.({ error: 'service-not-allowed' })
      this.#end()
    })
  }

  /** Stop listening; what was heard so far is the request. */
  stop(): void {
    invoke('stop_listening', { keep: true }).catch(() => undefined)
  }

  /** Stop listening and drop what was heard. */
  abort(): void {
    invoke('stop_listening', { keep: false }).catch(() => undefined)
  }

  #end(): void {
    if (this.#ended) return
    this.#ended = true
    this.onend?.()
  }
}

/** Whether `value` is the web view's own (a stand-in a test puts there is left alone). */
const isNative = (value: unknown): boolean => typeof value === 'function' && Function.prototype.toString.call(value).includes('[native code]')

if (inDesktopApp()) {
  window.addEventListener('shellnote:closing', () => {
    void Promise.allSettled([...keepers].map((keep) => keep())).finally(() => {
      invoke('ready_to_close').catch(() => undefined)
    })
  })
  // F11, as in a browser: full screen, and back. The page's own full screen, as its button asks, which the window follows.
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'F11' || event.defaultPrevented || event.repeat) return
    event.preventDefault()
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else void document.documentElement.requestFullscreen().catch(() => undefined)
  })
  if (inWindowsApp()) {
    programHost.set(windowsHost)
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }
    if ((w.SpeechRecognition === undefined || isNative(w.SpeechRecognition)) && (w.webkitSpeechRecognition === undefined || isNative(w.webkitSpeechRecognition))) {
      w.SpeechRecognition = WindowsRecognition
      w.webkitSpeechRecognition = WindowsRecognition
    }
  }
}
