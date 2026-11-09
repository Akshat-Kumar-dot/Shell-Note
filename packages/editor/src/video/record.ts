// Recording the note as it is written: ShellNote records its own desk, the
// pages and the pen, as a video file kept in the note. The browser's Element Capture records that one element and
// nothing drawn over it, so a YouTube video beside or over the note is never in it (YouTube's policies forbid helping
// to store its videos); no sound is recorded, so neither is YouTube's. Element Capture is in Chrome and Edge from 132,
// on computers, and works only on the tab the person shares, which must be this one.
import { MAX_VIDEO_BYTES } from '../assets.js'
import { inDesktopApp } from '../host.js'
import { Shared } from './state.js'

interface RestrictionTargetApi {
  fromElement(element: Element): Promise<unknown>
}
declare global {
  interface Window {
    RestrictionTarget?: RestrictionTargetApi
  }
}
type Restrictable = MediaStreamTrack & { restrictTo?: (target: unknown) => Promise<void> }

/** Whether this browser can record the note alone; the reason it cannot, when not. */
export function recordingSupport(): { ok: true } | { ok: false; why: string } {
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) return { ok: false, why: `${inDesktopApp() ? 'The app' : 'This browser'} cannot record the screen.` }
  if (!window.RestrictionTarget?.fromElement) return { ok: false, why: 'Recording only the note needs Edge or Chrome 132 or later, on a computer.' }
  return { ok: true }
}

/** A recording under way: when it began, and how to end it. */
export interface Recording {
  started: number
  stop(): void
}
/** The recording under way, if any: one at a time. */
export const recording = new Shared<Recording | undefined>(undefined)

/** Some room under the largest video a note takes, for the last piece the recorder hands over. */
const ROOM = 8 * 1024 * 1024

/**
 * Record `desk` until stopped, by `stop`, by the browser's own Stop sharing, or near the largest video a note takes;
 * then `done` gets the video. Rejects, with a reason a person can read, when the person does not share this tab.
 */
export async function recordNote(desk: HTMLElement, done: (video: File) => void): Promise<void> {
  const support = recordingSupport()
  if (!support.ok) throw new Error(support.why)
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude' } as DisplayMediaStreamOptions)
  } catch {
    throw new Error('Recording did not start: the screen was not shared.')
  }
  const track = stream.getVideoTracks()[0] as Restrictable | undefined
  const end = (): void => stream.getTracks().forEach((t) => t.stop())
  // Element Capture needs its element to be a stacking context of its own.
  desk.dataset.recording = ''
  try {
    if (!track?.restrictTo) throw new Error('no restrictTo')
    await track.restrictTo(await window.RestrictionTarget!.fromElement(desk))
  } catch {
    end()
    delete desk.dataset.recording
    throw new Error('Choose this tab when the browser asks what to share: only the note is recorded.')
  }
  const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? 'video/webm'
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 2_500_000 })
  const parts: Blob[] = []
  let size = 0
  const started = Date.now()
  recorder.ondataavailable = (event) => {
    if (event.data.size === 0) return
    parts.push(event.data)
    size += event.data.size
    if (size > MAX_VIDEO_BYTES - ROOM && recorder.state === 'recording') recorder.stop()
  }
  recorder.onstop = () => {
    end()
    delete desk.dataset.recording
    recording.set(undefined)
    const when = new Date(started)
    const name = `Recording ${when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}.webm`
    done(new File(parts, name.replace(/[/\\:]/g, '.'), { type: 'video/webm' }))
  }
  const stop = (): void => {
    if (recorder.state === 'recording') recorder.stop()
  }
  // The browser's own Stop sharing ends it too.
  track!.addEventListener('ended', stop)
  recorder.start(1000)
  recording.set({ started, stop })
}
