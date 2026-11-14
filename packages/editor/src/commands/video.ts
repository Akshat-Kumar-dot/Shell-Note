// The video beside the note and the panels' full view, as commands (app
// control, step 3c): each does what its button did, and the buttons call them.
// The marks beside the lines (⏱ and ▶) are what is inside the note: note
// control reaches them, as an op line does now. Adding a video file, recording
// the note and cropping stay the person's: a file picked, a screen chosen, a
// box dragged.
import { idTaken, newId, type Clip, type Media, type Op } from '@shellnote/core'
import { putInside, setFull, setInside, setSideOpen, workspace as layout } from '../layout/state.js'
import { showSideTab, videoTab } from '../layout/sideTab.js'
import { dock, float, type PanelId, type Rect } from '../layout/tree.js'
import type { EditorStore } from '../store.js'
import { hardPart, moveVideo, playVideo, seekVideo, setTimesShown, timesShown, videoClock, videoCovered, videoShown, type VideoClock } from '../video/state.js'
import { clipPlace, timeText } from '../video/VideoMarks.js'
import { youTubeId } from '../video/youtube.js'
import type { By, Commands, WorkspacePlace } from './run.js'

export const NOT_YOUTUBE = 'That is not a YouTube link. Paste a link like youtube.com/watch?v=… or youtu.be/…'
/** Where the video floats the first time. */
export const FLOAT_AT: Rect = { x: 40, y: 80, w: 480, h: 312 }
const READ_ONLY = 'This note is read-only here: it is being edited in another window.'
const NONE_SHOWN = 'No video is shown: show one first (video.show).'
/** How long the agent waits for a video's player, and for it to start playing. */
const PLAYER_MS = 15_000
const START_MS = 1500

/** A video's name, as the Video menu lists it. */
export const videoName = (item: Media): string => (item.kind === 'youtube' ? (item.title ?? `YouTube ${item.video}`) : (item.name ?? 'Video file'))

const origin = (by: By): 'terminal' | 'toolbar' => (by === 'agent' ? 'terminal' : 'toolbar')

function editable(workspace: WorkspacePlace): void {
  if (!workspace.editing()) throw new Error(READ_ONLY)
}

/** One of the note's videos, by its id or its exact name; left out, the first. */
function videoOf(store: EditorStore, written: unknown): Media {
  const media = store.doc.media ?? []
  if (media.length === 0) throw new Error('This note has no video: add one first (video.add).')
  if (written === undefined) return media[0]!
  const text = String(written)
  const byId = media.find((item) => item.id === text)
  if (byId) return byId
  const named = media.filter((item) => videoName(item).trim().toLowerCase() === text.trim().toLowerCase())
  if (named.length === 1) return named[0]!
  const all = media.map((item) => `"${videoName(item)}" (${item.id})`).join(', ')
  throw new Error(named.length > 1 ? `${named.length} videos are called "${text}": name one by its id: ${all}.` : `No video "${text}" in this note. Its videos: ${all}.`)
}

/** The shown video's player: for a click, the one ready (its button waits for it); for the agent, once it is ready. */
function playerOf(by: By): VideoClock | Promise<VideoClock> {
  const media = videoShown.value
  if (media === undefined) throw new Error(NONE_SHOWN)
  const ready = videoClock.value
  if (ready?.media === media) return ready
  if (by === 'person') throw new Error('shellnote: the video is not ready')
  return new Promise((resolve, reject) => {
    const heard = (): void => {
      const clock = videoClock.value
      if (clock?.media !== media) return
      stop()
      clearTimeout(timer)
      resolve(clock)
    }
    const stop = videoClock.subscribe(heard)
    const timer = setTimeout(() => {
      stop()
      reject(new Error('The video player did not get ready: YouTube may be out of reach.'))
    }, PLAYER_MS)
  })
}

const at = (clock: VideoClock): string => timeText(Math.round(clock.time() * 10))

/** Whether the video starts within a moment: a browser may hold a video's sound until the person clicks the page. */
function started(clock: VideoClock): Promise<boolean> {
  return new Promise((resolve) => {
    const since = Date.now()
    const look = (): void => {
      if (clock.playing()) resolve(true)
      else if (Date.now() - since > START_MS) resolve(false)
      else setTimeout(look, 100)
    }
    look()
  })
}

/** Play or pause; the agent hears whether it really plays. */
function playOrPause(play: boolean, by: By): string | Promise<string> {
  const go = (clock: VideoClock): string | Promise<string> => {
    if (videoCovered.value) throw new Error('The video waits, paused, while something of the app covers it (nothing is shown over YouTube’s player): close that first.')
    playVideo(play)
    if (!play) return `video paused at ${at(clock)}`
    if (by === 'person') return 'video playing'
    return started(clock).then((yes) => (yes ? `video playing, at ${at(clock)}` : 'asked the video to play, and it has not started: the browser may let a video play only after the person clicks the page'))
  }
  const clock = playerOf(by)
  return clock instanceof Promise ? clock.then(go) : go(clock)
}

/** A hard part, at the second press: from the first to now, put beside the writing done at its end. */
function markPart(store: EditorStore, by: By): string {
  const media = videoShown.value
  const clock = videoClock.value
  if (media === undefined || clock?.media !== media) throw new Error(media === undefined ? NONE_SHOWN : 'The video is not ready yet: try again in a moment.')
  const now = clock.time()
  const begun = hardPart.value?.media === media ? hardPart.value.from : undefined
  if (begun === undefined) {
    hardPart.set({ media, from: now })
    return `hard part begun at ${timeText(Math.round(now * 10))}: video.mark again at its end`
  }
  hardPart.set(undefined)
  const from = Math.round(Math.min(begun, now) * 10)
  // Marked at one moment (under a second apart): the five seconds after it.
  const end = Math.round(Math.max(begun, now) * 10)
  const to = end - from < 10 ? from + 50 : end
  const place = clipPlace(store.doc, media, to)
  if (!place) throw new Error('Nothing is written beside this video yet, so the hard part has no line to go beside.')
  const clip: Clip = { id: newId((id) => idTaken(store.doc, id)), media, from, to, ...place }
  store.apply([{ op: 'update', id: store.doc.id, set: { clips: [...(store.doc.clips ?? []), clip] } }], { origin: origin(by) })
  return `hard part ${timeText(from)} to ${timeText(to)} marked beside the writing`
}

const PANE_WORDS: Record<PanelId, string> = { notes: 'the notes', video: 'the video', side: 'the side panel', program: 'the program' }

export function defineVideo(commands: Commands): void {
  commands.define('video.add', ['note', 'workspace'], ({ link }, { note: { store }, workspace }, by) => {
    editable(workspace)
    const video = youTubeId(String(link))
    if (!video) throw new Error(NOT_YOUTUBE)
    const id = newId((candidate) => idTaken(store.doc, candidate))
    store.apply([{ op: 'update', id: store.doc.id, set: { media: [...(store.doc.media ?? []), { id, kind: 'youtube', video }] } }], { origin: origin(by) })
    videoShown.set(id)
    return `video "YouTube ${video}" (${id}) added and shown`
  })
  commands.define('video.show', ['note', 'workspace'], ({ video }, { note: { store } }) => {
    const item = videoOf(store, video)
    videoShown.set(item.id)
    return `video "${videoName(item)}" (${item.id}) shown`
  })
  commands.define('video.hide', ['workspace'], () => {
    videoShown.set(undefined)
    return 'video panel closed'
  })
  commands.define('video.play', ['workspace'], (_, __, by) => playOrPause(true, by))
  commands.define('video.pause', ['workspace'], (_, __, by) => playOrPause(false, by))
  commands.define('video.seek', ['note', 'workspace'], ({ seconds, video }, { note: { store } }, by) => {
    const time = seconds as number
    if (video !== undefined) {
      const item = videoOf(store, video)
      if (item.id !== videoShown.value) {
        moveVideo(item.id, time)
        return `video "${videoName(item)}" shown, at ${timeText(Math.round(time * 10))}`
      }
    }
    const seek = (clock: VideoClock): string => {
      clock.seek(time)
      return `video at ${timeText(Math.round(time * 10))}`
    }
    const clock = playerOf(by)
    return clock instanceof Promise ? clock.then(seek) : seek(clock)
  })
  commands.define('video.playFrom', ['note', 'workspace'], ({ seconds, video }, { note: { store } }) => {
    const item = video === undefined ? (store.doc.media ?? []).find((m) => m.id === videoShown.value) : videoOf(store, video)
    if (!item) throw new Error(NONE_SHOWN)
    seekVideo(item.id, seconds as number)
    return `video "${videoName(item)}" playing from ${timeText(Math.round((seconds as number) * 10))}`
  })
  commands.define('video.mark', ['note', 'workspace'], (_, { note: { store }, workspace }, by) => {
    // A mark is kept in the note: read-only here, as video.add and video.remove say.
    editable(workspace)
    return markPart(store, by)
  })
  // Taken out of the Beside panel into a panel of its own, docked or floating; and put back inside it.
  commands.define('video.place', ['workspace'], ({ place }) => {
    setInside('video', false, (now) => dock(now, 'video', 'notes', place as 'left' | 'right' | 'top' | 'bottom'))
    return `video panel docked at the ${String(place)}`
  })
  commands.define('video.float', ['workspace'], () => {
    setInside('video', false, (now) => float(now, 'video', now.floating.video ?? FLOAT_AT))
    return 'video panel floating over the note'
  })
  commands.define('video.inside', ['workspace'], () => {
    putInside('video')
    showSideTab(videoTab())
    return videoShown.value === undefined ? 'the video goes inside the Beside panel; none is shown now' : 'video inside the Beside panel, above its description and transcript'
  })
  commands.define('video.times', [], ({ on }) => {
    setTimesShown(on === true)
    return `times beside the lines ${on === true ? 'shown' : 'hidden'}`
  })
  commands.define('video.remove', ['note', 'workspace'], ({ video }, { note: { store }, workspace }, by) => {
    editable(workspace)
    const item = videoOf(store, video)
    const left = (store.doc.media ?? []).filter((m) => m.id !== item.id)
    const set: Record<string, unknown> = { media: left }
    if (store.doc.clips) set.clips = store.doc.clips.filter((c) => c.media !== item.id)
    const ops: Op[] = [{ op: 'update', id: store.doc.id, set }]
    if (item.kind === 'file') {
      const stillUsed = left.some((m) => m.kind === 'file' && m.asset === item.asset) || Object.values(store.doc.block).some((b) => b.type === 'image' && b.asset === item.asset)
      if (!stillUsed) ops.push({ op: 'asset', hash: item.asset, meta: null })
    }
    store.apply(ops, { origin: origin(by) })
    if (videoShown.value === item.id) videoShown.set(undefined)
    return `video "${videoName(item)}" taken out of the note; edit.undo brings it back`
  })
  commands.define('panel.full', ['workspace'], ({ pane, on }) => {
    if (on === false) {
      setFull(undefined)
      return 'full view left'
    }
    const id = (pane ?? 'notes') as PanelId
    if (id === 'video' && videoShown.value === undefined) throw new Error(NONE_SHOWN)
    if (id === 'side' && !layout.value.side) setSideOpen(true)
    setFull(id)
    return `full view: ${PANE_WORDS[id]} alone`
  })
}

/** The videos' line of the app-state map, when the note has any. */
export function videoLine(store: EditorStore | undefined): string | undefined {
  const media = store?.doc.media ?? []
  if (media.length === 0) return undefined
  const shown = media.find((item) => item.id === videoShown.value)
  const clock = videoClock.value
  const now = shown && clock?.media === shown.id ? `, ${clock.playing() ? 'playing' : 'paused'} at ${at(clock)}` : ''
  const marking = hardPart.value && hardPart.value.media === shown?.id ? `, a hard part begun at ${timeText(Math.round(hardPart.value.from * 10))}` : ''
  return `videos: ${media.map((item) => `"${videoName(item)}" (${item.id})`).join(', ')} · ${shown ? `shown: "${videoName(shown)}"${now}${marking}` : 'none shown'} · times beside the lines ${timesShown.value ? 'on' : 'off'}`
}
