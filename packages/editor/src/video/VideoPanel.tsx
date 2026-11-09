// The video panel beside a note: a YouTube video in YouTube's own player, or a
// video file of the person's own. One of the workspace's panels: docked beside, above or below the notes
// (the five buttons, or dragged by its bar), or floating over them and sized from any edge or corner; Ctrl+Shift+Space
// pauses it while the pen writes.
import type { Id, Media } from '@shellnote/core'
import { Crop, Flag, Maximize2, Minimize2, PanelBottom, PanelLeft, PanelRight, PanelTop, Pause, Play, PictureInPicture2, X } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react'
import { commands } from '../commands/index.js'
import { useFullView, usePanel, type Where } from '../layout/DockArea.js'
import { PANEL_LEAST } from '../layout/tree.js'
import type { EditorStore } from '../store.js'
import { hardPart, toggleVideo, videoClock, videoCovered } from './state.js'
import { FileView } from './FileView.js'
import { timeText } from './VideoMarks.js'
import { useStepAside } from './stepAside.js'
import { BUFFERING, mustTapToStart, PLAYING, youTubePlayer, type YouTubePlayer } from './youtube.js'

const PLACES: [Where, string, typeof PanelLeft][] = [
  ['left', 'Video on the left', PanelLeft],
  ['right', 'Video on the right', PanelRight],
  ['top', 'Video above', PanelTop],
  ['bottom', 'Video below', PanelBottom],
  ['float', 'Video floating over the note', PictureInPicture2],
]
/** Floating, the panel is sized from any of its four edges or four corners. */
type Grip = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const GRIPS: Grip[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

export function VideoPanel({ store, media }: { store: EditorStore; media: Media }) {
  const panel = usePanel()
  const full = useFullView()
  const clock = useSyncExternalStore(videoClock.subscribe, videoClock.snapshot)
  const body = useRef<HTMLDivElement>(null)
  useStepAside(body, media.kind === 'youtube' ? media.id : undefined)
  const covered = useSyncExternalStore(videoCovered.subscribe, videoCovered.snapshot) && media.kind === 'youtube'
  const [problem, setProblem] = useState<string>()
  // A YouTube video on an iPad that only a tap on its own button can start: where it will start, in seconds.
  const [tapFrom, setTapFrom] = useState<number>()
  const [cropping, setCropping] = useState(false)
  /** A hard part being marked: where it began, in seconds. */
  const marking = useSyncExternalStore(hardPart.subscribe, hardPart.snapshot)
  const markFrom = marking?.media === media.id ? marking.from : undefined
  const [, tick] = useState(0)
  // The pause key, while the pen writes.
  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (event.ctrlKey && event.shiftKey && event.code === 'Space' && toggleVideo()) event.preventDefault()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  // The play button follows the player.
  useEffect(() => {
    const every = window.setInterval(() => tick((n) => n + 1), 500)
    return () => window.clearInterval(every)
  }, [])
  // Out of sight while another panel is in full view: the video does not play on unseen (YouTube's policies, III.I.9).
  const hidden = panel?.hidden ?? false
  useEffect(() => {
    if (hidden && videoClock.value?.media === media.id) videoClock.value.pause()
  }, [hidden, media.id])

  const floating = panel?.floating ?? false

  /** A hard part (a ▶ mark): the first press marks its start, the second its end; put beside the writing (video.mark). */
  const mark = (): void => commands.tap('video.mark')

  /** One of the five places: beside the notes, above or below them, or floating where it last floated (video.place, video.float). */
  const place = (where: Where): void => (where === 'float' ? commands.tap('video.float') : commands.tap('video.place', { place: where }))

  /** Floating: one of its edges or corners dragged, each side it holds following the pointer, inside the workspace. */
  const size = (event: ReactPointerEvent, grip: Grip): void => {
    const from = panel?.rect
    if (!panel || !from || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const area = panel.area()
    const least = PANEL_LEAST.video
    const start = { x: event.clientX, y: event.clientY }
    let last = from
    const move = (e: PointerEvent): void => {
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      let [left, top, right, bottom] = [from.x, from.y, from.x + from.w, from.y + from.h]
      if (grip.includes('w')) left = Math.max(0, Math.min(right - least.w, left + dx))
      if (grip.includes('e')) right = Math.min(area.w, Math.max(left + least.w, right + dx))
      if (grip.includes('n')) top = Math.max(0, Math.min(bottom - least.h, top + dy))
      if (grip.includes('s')) bottom = Math.min(area.h, Math.max(top + least.h, bottom + dy))
      last = { x: Math.round(left), y: Math.round(top), w: Math.round(right - left), h: Math.round(bottom - top) }
      panel.setFloat(last, false)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      panel.setFloat(last, true)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const title = media.kind === 'youtube' ? (media.title ?? 'YouTube video') : (media.name ?? 'Video')
  const playing = clock?.media === media.id && clock.playing()
  return (
    <section className="nw-video" data-floating={floating ? '' : undefined} aria-label="Video">
      <header className="nw-video-bar" onPointerDown={panel?.grab} title="Drag to move the video">
        <span className="nw-video-title" title={title}>
          {title}
        </span>
        <button type="button" className="nw-ibtn" aria-label={playing ? 'Pause the video' : 'Play the video'} title={`${playing ? 'Pause' : 'Play'} (Ctrl+Shift+Space)`} disabled={clock?.media !== media.id || covered} data-command={playing ? 'video.pause' : 'video.play'} onClick={() => commands.tap(playing ? 'video.pause' : 'video.play')}>
          {playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
        </button>
        <button
          type="button"
          className="nw-ibtn"
          aria-label={markFrom === undefined ? 'Mark a hard part' : `End the hard part begun at ${timeText(markFrom * 10)}`}
          aria-pressed={markFrom !== undefined}
          title={markFrom === undefined ? 'Mark a hard part: press at its start, and again at its end' : 'Press at the end of the hard part'}
          disabled={clock?.media !== media.id}
          data-command="video.mark"
          onClick={mark}
        >
          <Flag size={16} aria-hidden />
        </button>
        {media.kind === 'file' ? (
          <button type="button" className="nw-ibtn" aria-label="Crop the video" aria-pressed={cropping} title="Crop: keep part of the picture" onClick={() => setCropping(!cropping)}>
            <Crop size={16} aria-hidden />
          </button>
        ) : null}
        <span className="nw-video-places" role="radiogroup" aria-label="Where the video sits">
          {PLACES.map(([where, label, Icon]) => (
            <button key={where} type="button" role="radio" className="nw-ibtn" aria-checked={panel?.where === where} aria-label={label} title={label} data-command={where === 'float' ? 'video.float' : 'video.place'} onClick={() => place(where)}>
              <Icon size={16} aria-hidden />
            </button>
          ))}
        </span>
        {full ? (
          <button type="button" className="nw-ibtn" aria-label={full.full ? 'Leave full view' : 'Full view: the video alone'} aria-pressed={full.full} title={full.full ? 'Leave full view (Esc)' : 'Full view'} data-command="panel.full" onClick={full.toggle}>
            {full.full ? <Minimize2 size={16} aria-hidden /> : <Maximize2 size={16} aria-hidden />}
          </button>
        ) : null}
        <button type="button" className="nw-ibtn" aria-label="Close the video" title="Close the video" data-command="video.hide" onClick={() => commands.tap('video.hide')}>
          <X size={16} aria-hidden />
        </button>
      </header>
      {tapFrom !== undefined && !problem ? (
        <p className="nw-video-tap" role="status">
          Tap ▶ on the video to start it{tapFrom > 0 ? ` from ${timeText(tapFrom * 10)}` : ''}. On this device YouTube starts only from its own button, the first time.
        </p>
      ) : null}
      <div className="nw-video-body" ref={body} data-covered={covered ? '' : undefined}>
        {covered ? <p className="nw-video-aside">Paused while this is covered: nothing is shown over YouTube’s player.</p> : null}
        {problem ? (
          <p className="nw-video-problem" role="alert">
            {problem}
          </p>
        ) : media.kind === 'youtube' ? (
          <YouTubeView media={media.id} video={media.video} onProblem={setProblem} onTapFrom={setTapFrom} />
        ) : (
          <FileView store={store} media={media} cropping={cropping} onCropped={() => setCropping(false)} onProblem={setProblem} />
        )}
      </div>
      {floating ? GRIPS.map((grip) => <div key={grip} className="nw-video-grip" data-grip={grip} onPointerDown={(event) => size(event, grip)} aria-hidden />) : null}
    </section>
  )
}

/**
 * YouTube's own player, nothing over it. Where only a tap on its own button can start it (mustTapToStart), a ⏱ before then
 * sets where that tap will start it, and says so; once it has played, it obeys like any other (a test iPad, 6 November
 * 2026: a ⏱ did not play).
 */
function YouTubeView({ media, video, onProblem, onTapFrom }: { media: Id; video: string; onProblem: (message: string) => void; onTapFrom: (seconds: number | undefined) => void }) {
  const holder = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = holder.current
    if (!host) return
    const inner = document.createElement('div')
    host.append(inner)
    let player: YouTubePlayer | undefined
    let gone = false
    let started = !mustTapToStart()
    let from = 0
    youTubePlayer(
      inner,
      video,
      (ready) => {
        if (gone) return
        player = ready
        videoClock.set({
          media,
          time: () => ready.getCurrentTime(),
          seek: (seconds) => {
            if (started) return ready.seekTo(seconds, true)
            from = seconds
            ready.cueVideoById({ videoId: video, startSeconds: seconds })
            onTapFrom(seconds)
          },
          playing: () => {
            const state = ready.getPlayerState()
            return state === PLAYING || state === BUFFERING
          },
          play: () => {
            if (started) ready.playVideo()
            else onTapFrom(from)
          },
          pause: () => ready.pauseVideo(),
        })
      },
      onProblem,
      (state) => {
        if (state !== PLAYING) return
        started = true
        onTapFrom(undefined)
      },
    )
      .then((made) => {
        if (gone) made.destroy()
        else player = made
      })
      .catch((error: unknown) => onProblem(error instanceof Error ? error.message : 'YouTube could not be reached.'))
    return () => {
      gone = true
      player?.destroy()
      host.replaceChildren()
      if (videoClock.value?.media === media) videoClock.set(undefined)
      onTapFrom(undefined)
    }
  }, [media, video, onProblem, onTapFrom])
  return <div className="nw-video-player" ref={holder} />
}
