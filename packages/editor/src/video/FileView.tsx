// A video file of the person's own, kept with the note: played whole with the browser's controls, or the
// part they cropped it to (their own files only: YouTube's player is never changed), in its own shape, with
// a seek bar of ours. Cropping shows the whole video and a box moved, or sized by its corners; Done keeps it as one
// undo step.
import type { Id, Media } from '@shellnote/core'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react'
import { commands } from '../commands/index.js'
import { inDesktopApp } from '../host.js'
import type { EditorStore } from '../store.js'
import { videoClock } from './state.js'

type FileMedia = Extract<Media, { kind: 'file' }>
/** In thousandths of the video's width and height, as the note keeps it. */
type Crop = NonNullable<FileMedia['crop']>

const WHOLE: Crop = { x: 0, y: 0, w: 1000, h: 1000 }
/** The smallest crop, a twentieth of the video each way. */
const LEAST = 50
/** The seek bar under a cropped video, in CSS pixels (theme.css). */
const SEEK_BAR = 32
/** While cropping, the video sits this far in from the panel's sides, so the box's corner grips show whole. */
const CROP_ROOM = 12
type Grip = 'move' | 'nw' | 'ne' | 'sw' | 'se'
const CORNERS: Exclude<Grip, 'move'>[] = ['nw', 'ne', 'sw', 'se']

/** The note's videos with `media`'s crop set, or taken off. */
function withCrop(doc: { media?: Media[] | undefined }, media: Id, crop: Crop | undefined): Media[] {
  return (doc.media ?? []).map((m) => {
    if (m.id !== media || m.kind !== 'file') return m
    const kept: FileMedia = { id: m.id, kind: 'file', asset: m.asset }
    if (m.name !== undefined) kept.name = m.name
    if (crop && (crop.x !== 0 || crop.y !== 0 || crop.w !== 1000 || crop.h !== 1000)) kept.crop = crop
    return kept
  })
}

/** The size of a box of shape `ratio` (width over height) fitted inside `room`, as `object-fit: contain` would. */
function fit(room: { w: number; h: number }, ratio: number): { w: number; h: number } {
  const w = Math.min(room.w, room.h * ratio)
  return { w, h: w / ratio }
}

/** Minutes and seconds. */
const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

export function FileView({ store, media, cropping, onCropped, onProblem }: { store: EditorStore; media: FileMedia; cropping: boolean; onCropped: () => void; onProblem: (message: string) => void }) {
  const urls = useSyncExternalStore(store.assets.subscribe, store.assets.snapshot)
  const url = urls[media.asset]
  const element = useRef<HTMLVideoElement>(null)
  const room = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number }>()
  const [space, setSpace] = useState({ w: 0, h: 0 })
  const [draft, setDraft] = useState<Crop>(media.crop ?? WHOLE)
  const [time, setTime] = useState({ at: 0, of: 0 })

  // The clock the pen reads and the bar plays.
  useEffect(() => {
    const video = element.current
    if (!video) return
    videoClock.set({
      media: media.id,
      time: () => video.currentTime,
      seek: (seconds) => {
        video.currentTime = seconds
      },
      playing: () => !video.paused,
      play: () => {
        void video.play().catch(() => undefined)
      },
      pause: () => video.pause(),
      duration: () => video.duration,
    })
    return () => {
      if (videoClock.value?.media === media.id) videoClock.set(undefined)
    }
  }, [media.id, url])

  // The room the video has, to fit the cropped part in its own shape.
  useLayoutEffect(() => {
    const host = room.current
    if (!host) return
    const measure = (): void => setSpace({ w: host.clientWidth, h: host.clientHeight })
    measure()
    const watcher = new ResizeObserver(measure)
    watcher.observe(host)
    return () => watcher.disconnect()
  }, [url])

  // Cropping starts from the crop kept, or the whole video.
  useEffect(() => {
    if (cropping) setDraft(media.crop ?? WHOLE)
  }, [cropping, media.crop])

  if (!url) return <p className="nw-video-problem">This video’s file is still loading, or is missing from the note.</p>

  const crop = cropping ? WHOLE : (media.crop ?? WHOLE)
  const cropped = !cropping && media.crop !== undefined
  // The part shown, in its own shape: the video's shape until its size is known.
  const ratio = size ? (crop.w * size.w) / (crop.h * size.h) : 16 / 9
  const inset = cropping ? 2 * CROP_ROOM : 0
  const frame = fit({ w: Math.max(0, space.w - inset), h: Math.max(0, space.h - inset - (cropped ? SEEK_BAR : 0)) }, ratio)
  const placed = { width: `${100000 / crop.w}%`, height: `${100000 / crop.h}%`, left: `${(-crop.x * 100) / crop.w}%`, top: `${(-crop.y * 100) / crop.h}%` }

  /** A drag of the crop box, or one of its corners, in thousandths of the video. */
  const grab = (event: ReactPointerEvent, grip: Grip): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const start = { x: event.clientX, y: event.clientY, crop: draft }
    const per = { x: 1000 / Math.max(1, frame.w), y: 1000 / Math.max(1, frame.h) }
    const move = (e: PointerEvent): void => {
      const dx = Math.round((e.clientX - start.x) * per.x)
      const dy = Math.round((e.clientY - start.y) * per.y)
      const c = start.crop
      if (grip === 'move') {
        setDraft({ ...c, x: Math.max(0, Math.min(1000 - c.w, c.x + dx)), y: Math.max(0, Math.min(1000 - c.h, c.y + dy)) })
        return
      }
      let [left, top, right, bottom] = [c.x, c.y, c.x + c.w, c.y + c.h]
      if (grip === 'nw' || grip === 'sw') left = Math.max(0, Math.min(right - LEAST, left + dx))
      else right = Math.min(1000, Math.max(left + LEAST, right + dx))
      if (grip === 'nw' || grip === 'ne') top = Math.max(0, Math.min(bottom - LEAST, top + dy))
      else bottom = Math.min(1000, Math.max(top + LEAST, bottom + dy))
      setDraft({ x: left, y: top, w: right - left, h: bottom - top })
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const keep = (next: Crop | undefined): void => {
    store.apply([{ op: 'update', id: store.doc.id, set: { media: withCrop(store.doc, media.id, next) } }], { origin: 'toolbar' })
    onCropped()
  }

  return (
    <div className="nw-video-file" ref={room} data-cropped={cropped ? '' : undefined}>
      <div className="nw-video-frame" style={{ width: frame.w, height: frame.h }}>
        <video
          ref={element}
          src={url}
          controls={!cropped && !cropping}
          playsInline
          style={cropped ? placed : undefined}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget
            if (video.videoWidth > 0 && video.videoHeight > 0) setSize({ w: video.videoWidth, h: video.videoHeight })
            setTime({ at: video.currentTime, of: video.duration })
          }}
          onTimeUpdate={(event) => setTime({ at: event.currentTarget.currentTime, of: event.currentTarget.duration })}
          onError={() => onProblem(`This video file could not be played. ${inDesktopApp() ? 'The app' : 'Edge'} plays MP4 (H.264) and WebM.`)}
        />
        {cropping ? (
          <div
            className="nw-crop-box"
            role="group"
            aria-label="The part of the video to keep"
            style={{ left: `${draft.x / 10}%`, top: `${draft.y / 10}%`, width: `${draft.w / 10}%`, height: `${draft.h / 10}%` }}
            onPointerDown={(event) => grab(event, 'move')}
          >
            {CORNERS.map((corner) => (
              <span key={corner} className="nw-crop-grip" data-corner={corner} onPointerDown={(event) => grab(event, corner)} aria-hidden />
            ))}
          </div>
        ) : null}
      </div>
      {cropped && Number.isFinite(time.of) && time.of > 0 ? (
        <div className="nw-video-seek">
          <input type="range" aria-label="Where in the video" min={0} max={time.of} step={0.1} value={time.at} data-command="video.seek" onChange={(event) => commands.tap('video.seek', { seconds: Number(event.target.value) })} />
          <span>
            {clock(time.at)} / {clock(time.of)}
          </span>
        </div>
      ) : null}
      {cropping ? (
        <div className="nw-crop-bar">
          <button type="button" className="nw-video-add" onClick={() => keep(draft)}>
            Done
          </button>
          <button type="button" className="nw-video-add" onClick={() => keep(undefined)}>
            Whole video
          </button>
          <button type="button" className="nw-video-add" onClick={onCropped}>
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  )
}
