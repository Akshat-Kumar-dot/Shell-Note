// The Video button on the app's bar: a YouTube link pasted, or a
// video file of the person's own added to the note (their own screen recording, say), or the note itself recorded as
// it is written; the note's videos listed, each shown in the panel or taken out of the note.
import { idTaken, newId, type Media, type Op } from '@shellnote/core'
import { Circle, Clapperboard, Square, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react'
import { VIDEO_TYPES } from '../assets.js'
import { commands, NOT_YOUTUBE } from '../commands/index.js'
import { useDismiss } from '../dismiss.js'
import { placeMenu } from '../popover.js'
import type { EditorStore } from '../store.js'
import { recording, recordingSupport, recordNote } from './record.js'
import { timesShown, videoShown } from './state.js'
import { timeText } from './VideoMarks.js'
import { youTubeId } from './youtube.js'

const keepFocus = (event: MouseEvent): void => event.preventDefault()

/** A size in bytes, as a person reads it. */
function sizeText(bytes: number): string {
  return bytes >= 2 ** 20 ? `${(bytes / 2 ** 20).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function VideoButton({ store }: { store: EditorStore }) {
  // The note's videos alone: a key typed does not draw the button again.
  const list = useSyncExternalStore(store.subscribe, () => store.doc.media)
  const shown = useSyncExternalStore(videoShown.subscribe, videoShown.snapshot)
  const times = useSyncExternalStore(timesShown.subscribe, timesShown.snapshot)
  const [open, setOpen] = useState(false)
  const [link, setLink] = useState('')
  const [problem, setProblem] = useState<string>()
  const [busy, setBusy] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, root, close)
  const media = list ?? []
  const fresh = (): string => newId((candidate) => idTaken(store.doc, candidate))

  /** A YouTube link (video.add): an empty box or another link says so here, as before. */
  const addLink = (): void => {
    if (!youTubeId(link)) {
      setProblem(NOT_YOUTUBE)
      return
    }
    try {
      commands.do('video.add', { link })
    } catch (error) {
      setProblem(error instanceof Error ? error.message : NOT_YOUTUBE)
      return
    }
    setLink('')
    setProblem(undefined)
    setOpen(false)
  }

  /** A video file into the note; shown in the panel unless it is a recording just made, which leaves the panel be. */
  const addFile = async (file: File, show = true): Promise<void> => {
    setBusy(true)
    try {
      const added = await store.assets.addVideo(file)
      const id = fresh()
      const ops: Op[] = []
      if (!store.doc.asset[added.hash]) ops.push({ op: 'asset', hash: added.hash, meta: added.meta })
      ops.push({ op: 'update', id: store.doc.id, set: { media: [...(store.doc.media ?? []), { id, kind: 'file', asset: added.hash, name: file.name }] } })
      store.apply(ops, { origin: 'toolbar' })
      if (show) videoShown.set(id)
      setProblem(undefined)
      setOpen(false)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'This video could not be added.')
    } finally {
      setBusy(false)
    }
  }

  // Recording the note as it is written.
  const now = useSyncExternalStore(recording.subscribe, recording.snapshot)
  const [, tick] = useState(0)
  useEffect(() => {
    if (!now) return
    const every = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(every)
  }, [now])
  // Leaving the note stops a recording of it, and keeps what was recorded.
  useEffect(() => () => recording.value?.stop(), [])
  const support = recordingSupport()
  const record = async (): Promise<void> => {
    const desk = document.querySelector<HTMLElement>('.nw-desk')
    if (!desk) return
    setOpen(false)
    try {
      await recordNote(desk, (video) => void addFile(video, false))
      setProblem(undefined)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Recording did not start.')
      setOpen(true)
    }
  }

  /** Out of the note, with its marks; a file's bytes too, when nothing else uses them. One undo step (video.remove). */
  const remove = (item: Media): void => commands.tap('video.remove', { video: item.id })

  return (
    <span className="nw-popover-anchor" ref={root}>
      {now ? (
        <button type="button" className="nw-recording" aria-label={`Stop recording (${timeText(Math.round((Date.now() - now.started) / 100))})`} title="Stop recording: the video is kept in the note" onClick={() => now.stop()}>
          <Square size={11} aria-hidden fill="currentColor" />
          {timeText(Math.round((Date.now() - now.started) / 100))}
        </button>
      ) : null}
      <button type="button" className="icon-button" aria-label="Video" aria-expanded={open} title="A video beside the note: a YouTube link, or a video file of your own" onMouseDown={keepFocus} onClick={() => setOpen(!open)}>
        <Clapperboard size={18} aria-hidden />
      </button>
      {open ? (
        <div ref={placeMenu} className="nw-popover nw-video-menu" role="dialog" aria-label="Videos">
          <form
            className="nw-video-link"
            onSubmit={(event) => {
              event.preventDefault()
              addLink()
            }}
          >
            <input aria-label="YouTube link" data-command="video.add" placeholder="Paste a YouTube link" value={link} onChange={(event) => setLink(event.target.value)} />
            <button type="submit" className="nw-video-add" data-command="video.add">
              Add
            </button>
          </form>
          <button type="button" className="nw-video-add" disabled={busy} onClick={() => picker.current?.click()}>
            {busy ? 'Adding…' : 'Add a video file (MP4, WebM)'}
          </button>
          <input
            ref={picker}
            type="file"
            accept={VIDEO_TYPES.join(',')}
            aria-label="Video file"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void addFile(file)
            }}
          />
          <button type="button" className="nw-video-add" disabled={!support.ok || now !== undefined} title={support.ok ? 'Records the note, pages and pen, as you write: no sound, and never a video beside it' : support.why} onClick={() => void record()}>
            <Circle size={11} aria-hidden fill="currentColor" className="nw-record-dot" /> Record this note as you write
          </button>
          {!support.ok ? <p className="nw-video-note">{support.why}</p> : null}
          <label className="nw-video-switch">
            <input type="checkbox" checked={times} data-command="video.times" onChange={(event) => commands.tap('video.times', { on: event.target.checked })} /> Show when each line was written (⏱)
          </label>
          {problem ? (
            <p className="nw-video-problem" role="alert">
              {problem}
            </p>
          ) : null}
          {media.length > 0 ? (
            <ul className="nw-video-list" aria-label="This note's videos">
              {media.map((item) => {
                const name = item.kind === 'youtube' ? (item.title ?? `YouTube ${item.video}`) : (item.name ?? 'Video file')
                const bytes = item.kind === 'file' ? store.doc.asset[item.asset]?.bytes : undefined
                return (
                  <li key={item.id}>
                    <button type="button" className="nw-video-pick" aria-pressed={shown === item.id} data-command={shown === item.id ? 'video.hide' : 'video.show'} onClick={() => {
                        if (shown === item.id) commands.tap('video.hide')
                        else commands.tap('video.show', { video: item.id })
                        setOpen(false)
                      }} title={shown === item.id ? 'Close it' : 'Show it beside the note'}>
                      {name}
                      {bytes !== undefined ? <em> · {sizeText(bytes)}</em> : null}
                    </button>
                    <button type="button" className="nw-ibtn" aria-label={`Take ${name} out of the note`} title="Take it out of the note (Undo brings it back)" data-command="video.remove" onClick={() => remove(item)}>
                      <Trash2 size={15} aria-hidden />
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </span>
  )
}
