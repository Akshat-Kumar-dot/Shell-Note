// ⏱ beside each line of writing done beside a video (recorded "go back to that time"): when the line was
// written, from and to, from its strokes' `vt`; a tap shows that video and plays it from there; × takes the times off
// the line. Dots, lines and arrows get none. A line ends where the pen rested 4 s or a new line began: written on
// again later, it shows that time too. And ▶ marks, the hard parts the person marked (the note's `clips`): a tap
// plays that part and pauses at its end; dragged, it moves; × or Delete takes it out; one undo step each.
import { editInk, pointsOf, rowsOf, type Clip, type Doc, type Id, type InkBlock, type Page, type Stroke } from '@shellnote/core'
import { useRef, useSyncExternalStore, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { mm } from '../geometry.js'
import type { EditorStore } from '../store.js'
import { seekVideo, timesShown } from './state.js'

/** When a line was written: from and to, in tenths of a second. */
export interface Run {
  from: number
  to: number
}

/** The ⏱ of one line of writing. */
export interface Mark {
  key: string
  block: Id
  /** The line's strokes, in the block. */
  indices: number[]
  media: Id
  runs: Run[]
  /** The line's left end and its middle, on the page, in the page's units. */
  x: number
  y: number
}

/** A rest this long, in tenths of a second of the video, ends a line's writing: 4 s. */
export const LINE_REST = 40

/** A video's time as a person reads it: 1:23, or 1:02:03. */
export function timeText(tenths: number): string {
  const all = Math.floor(tenths / 10)
  const [h, m, s] = [Math.floor(all / 3600), Math.floor((all % 3600) / 60), all % 60]
  const two = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`
}

/** A line of handwriting: its strokes, and its box in the block's units. */
interface Row {
  indices: number[]
  left: number
  right: number
  top: number
  bottom: number
}

// A block is never changed in place, so its lines and marks are worked out once.
const rowsKnown = new WeakMap<InkBlock, Row[]>()
const marksKnown = new WeakMap<InkBlock, Mark[]>()

export function rowsIn(block: InkBlock): Row[] {
  const kept = rowsKnown.get(block)
  if (kept) return kept
  const rows = rowsOf(block.strokes.map((stroke) => pointsOf(stroke.pts))).map((row) => {
    const indices = row.flat()
    let [left, right, top, bottom] = [Infinity, -Infinity, Infinity, -Infinity]
    for (const i of indices) {
      const pts = block.strokes[i]!.pts
      for (let k = 0; k + 1 < pts.length; k += 3) {
        left = Math.min(left, pts[k]!)
        right = Math.max(right, pts[k]!)
        top = Math.min(top, pts[k + 1]!)
        bottom = Math.max(bottom, pts[k + 1]!)
      }
    }
    return { indices, left, right, top, bottom }
  })
  rowsKnown.set(block, rows)
  return rows
}

function pathOf(pts: readonly number[]): number {
  let length = 0
  for (let k = 3; k + 1 < pts.length; k += 3) length += Math.hypot(pts[k]! - pts[k - 3]!, pts[k + 1]! - pts[k - 2]!)
  return length
}

/** A stroke's size: its box's longer side. */
function bigOf(pts: readonly number[]): number {
  let [left, right, top, bottom] = [Infinity, -Infinity, Infinity, -Infinity]
  for (let k = 0; k + 1 < pts.length; k += 3) {
    left = Math.min(left, pts[k]!)
    right = Math.max(right, pts[k]!)
    top = Math.min(top, pts[k + 1]!)
    bottom = Math.max(bottom, pts[k + 1]!)
  }
  return Math.max(right - left, bottom - top, 0)
}

/**
 * Whether a stroke could be part of a letter, against the writer's usual stroke height: not a dot (under 0.15 of it,
 * as rowsOf's marks), not a line made straight or a shape, and not long and nearly straight (more than twice the usual
 * height, its path under twice its length: a line or an arrow drawn in one stroke; a written word's path goes up and
 * down, two to five times its length).
 */
export function letterLike(stroke: Stroke, usual: number): boolean {
  if (stroke.straight || stroke.shape) return false
  const big = bigOf(stroke.pts)
  if (big < 0.15 * usual) return false
  return !(big > 2 * usual && pathOf(stroke.pts) < 2 * big)
}

/** A line of writing, not a dot, a line or an arrow: two strokes that could be letters, or one long written one. */
export function isWriting(letters: readonly Stroke[], usual: number): boolean {
  return letters.length >= 2 || letters.some((stroke) => pathOf(stroke.pts) >= 2.5 * usual)
}

/** The writer's usual stroke height in the block: the middle one. */
export function usualOf(block: InkBlock): number {
  const heights = block.strokes
    .map((stroke) => {
      let [top, bottom] = [Infinity, -Infinity]
      for (let k = 1; k < stroke.pts.length; k += 3) {
        top = Math.min(top, stroke.pts[k]!)
        bottom = Math.max(bottom, stroke.pts[k]!)
      }
      return bottom - top
    })
    .filter((h) => h > 0)
    .sort((a, b) => a - b)
  return heights[heights.length >> 1] ?? 300
}

/** When a line was written: its strokes beside one video, in runs broken by a rest of LINE_REST or more. */
export function runsOf(times: readonly { t: number; e?: number | undefined }[]): Run[] {
  const runs: Run[] = []
  for (const vt of [...times].sort((a, b) => a.t - b.t)) {
    const last = runs.at(-1)
    const end = Math.max(vt.t, vt.e ?? vt.t)
    if (last && vt.t - last.to <= LINE_REST) last.to = Math.max(last.to, end)
    else runs.push({ from: vt.t, to: end })
  }
  return runs
}

/**
 * One mark a line of writing done beside a video: when it was written, beside the first video it was written by. Its
 * times are its letters' alone: a dot or an arrow added later does not stretch them.
 */
export function marksOf(block: InkBlock): Mark[] {
  const kept = marksKnown.get(block)
  if (kept) return kept
  const marks: Mark[] = []
  if (block.strokes.some((stroke) => stroke.vt)) {
    const usual = usualOf(block)
    for (const row of rowsIn(block)) {
      const letters = row.indices.map((i) => block.strokes[i]!).filter((stroke) => letterLike(stroke, usual))
      const first = letters.find((stroke) => stroke.vt)?.vt
      if (!first || !isWriting(letters, usual)) continue
      const times = letters.flatMap((stroke) => (stroke.vt?.m === first.m ? [stroke.vt] : []))
      // Beside the letters, level with their middle: a dot above them does not raise it.
      let [left, top, bottom] = [Infinity, Infinity, -Infinity]
      for (const stroke of letters) {
        for (let k = 0; k + 1 < stroke.pts.length; k += 3) {
          left = Math.min(left, stroke.pts[k]!)
          top = Math.min(top, stroke.pts[k + 1]!)
          bottom = Math.max(bottom, stroke.pts[k + 1]!)
        }
      }
      marks.push({ key: `${block.id}:${row.indices[0]}`, block: block.id, indices: row.indices, media: first.m, runs: runsOf(times), x: block.x + left, y: block.y + (top + bottom) / 2 })
    }
  }
  marksKnown.set(block, marks)
  return marks
}

/** A run as a person reads it: 2:23–2:31, or 2:23 when written within a second. */
const runText = (run: Run): string => (run.to - run.from >= 10 ? `${timeText(run.from)}–${timeText(run.to)}` : timeText(run.from))

/** A line's ⏱: each time it was written, a tap playing from there; × takes the times off its strokes. */
function TimeMark({ store, mark }: { store: EditorStore; mark: Mark }) {
  const takeOff = (): void => {
    const block = store.doc.block[mark.block]
    if (block?.type !== 'ink') return
    const replace = new Map<number, Stroke[]>()
    for (const i of mark.indices) {
      const stroke = block.strokes[i]
      if (!stroke?.vt) continue
      const rest = { ...stroke }
      delete rest.vt
      replace.set(i, [rest])
    }
    store.apply(editInk(store.doc, block.id, { replace }), { origin: 'toolbar' })
  }
  return (
    <span className="nw-video-mark nw-video-time" style={{ left: mm(mark.x), top: mm(mark.y) }} onPointerDown={(event) => event.stopPropagation()}>
      {mark.runs.map((run) => {
        const label = `Play the video from ${timeText(run.from)}, where this line was written${run.to - run.from >= 10 ? ` (${timeText(run.from)} to ${timeText(run.to)})` : ''}`
        return (
          <button key={run.from} type="button" aria-label={label} title={label} onClick={() => seekVideo(mark.media, run.from / 10)}>
            ⏱ {runText(run)}
          </button>
        )
      })}
      <button type="button" className="nw-video-clip-out" aria-label="Take the times off this line" title="Take the times off this line (Undo brings them back)" onClick={takeOff}>
        ×
      </button>
    </span>
  )
}

/** A ▶ mark's room from the page's right edge, and from its top and bottom, in the page's units. */
const CLIP_ROOM = { right: 900, edge: 400 }
/** How far right of a line's end a ▶ mark goes: 4 mm. */
const CLIP_GAP = 400

/** The page shown most in the window, and the middle of what shows of it, in the page's units. */
function pageInView(doc: Doc): { page: Id; y: number } | undefined {
  let best: { page: Id; y: number; seen: number } | undefined
  for (const sheet of document.querySelectorAll<HTMLElement>('.nw-page[data-page]')) {
    const page = doc.page[sheet.dataset.page ?? '']
    const box = sheet.getBoundingClientRect()
    const [top, bottom] = [Math.max(box.top, 0), Math.min(box.bottom, window.innerHeight)]
    if (!page || bottom <= top || box.height <= 0) continue
    if (!best || bottom - top > best.seen) best = { page: page.id, y: (((top + bottom) / 2 - box.top) / box.height) * page.h, seen: bottom - top }
  }
  return best && { page: best.page, y: best.y }
}

/**
 * Where a new ▶ mark goes: just right of the last line written beside `media` up to the part's end (`to`, tenths of a
 * second); with none, at the right margin of the page in view.
 */
export function clipPlace(doc: Doc, media: Id, to: number): { page: Id; x: number; y: number } | undefined {
  let found: { block: InkBlock; index: number; t: number } | undefined
  for (const block of Object.values(doc.block)) {
    if (block.type !== 'ink') continue
    for (const [index, stroke] of block.strokes.entries()) {
      const vt = stroke.vt
      if (vt?.m !== media) continue
      // The latest written by the part's end; with none by then, the earliest after it.
      const better = !found || (vt.t <= to ? found.t > to || vt.t >= found.t : found.t > to && vt.t < found.t)
      if (better) found = { block, index, t: vt.t }
    }
  }
  const clamp = (value: number, least: number, most: number): number => Math.round(Math.max(least, Math.min(most, value)))
  if (found) {
    const { block, index } = found
    const page = doc.page[block.page]
    const row = rowsIn(block).find((r) => r.indices.includes(index))
    if (page && row) return { page: page.id, x: clamp(block.x + row.right + CLIP_GAP, 0, page.w - CLIP_ROOM.right), y: clamp(block.y + (row.top + row.bottom) / 2, CLIP_ROOM.edge, page.h - CLIP_ROOM.edge) }
  }
  const shown = pageInView(doc) ?? (doc.pages[0] === undefined ? undefined : { page: doc.pages[0], y: 3000 })
  const page = shown && doc.page[shown.page]
  return page && shown && { page: page.id, x: page.w - CLIP_ROOM.right - 600, y: clamp(shown.y, CLIP_ROOM.edge, page.h - CLIP_ROOM.edge) }
}

/** A ▶ mark: a tap plays its part; dragged, it moves; × or Delete takes it out. */
function ClipMark({ store, clip }: { store: EditorStore; clip: Clip }) {
  const dragged = useRef(false)
  const label = `Play the hard part, ${timeText(clip.from)} to ${timeText(clip.to)}`
  const change = (clips: Clip[]): void => {
    store.apply([{ op: 'update', id: store.doc.id, set: { clips } }], { origin: 'toolbar' })
  }
  const remove = (): void => change((store.doc.clips ?? []).filter((c) => c.id !== clip.id))
  const press = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    if (event.button !== 0) return
    const mark = event.currentTarget.parentElement
    const sheet = event.currentTarget.closest<HTMLElement>('.nw-page')
    const page = store.doc.page[clip.page]
    if (!mark || !sheet || !page) return
    const per = page.w / sheet.getBoundingClientRect().width
    const start = { x: event.clientX, y: event.clientY }
    let moved = false
    const offset = (e: PointerEvent): { dx: number; dy: number } => ({ dx: (e.clientX - start.x) * per, dy: (e.clientY - start.y) * per })
    const move = (e: PointerEvent): void => {
      if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4) return
      moved = true
      const { dx, dy } = offset(e)
      mark.style.translate = `${mm(dx)} ${mm(dy)}`
    }
    const up = (e: PointerEvent): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      mark.style.translate = ''
      if (!moved || e.type === 'pointercancel') return
      dragged.current = true
      const { dx, dy } = offset(e)
      const x = Math.round(Math.max(0, Math.min(page.w - CLIP_ROOM.right, clip.x + dx)))
      const y = Math.round(Math.max(CLIP_ROOM.edge, Math.min(page.h - CLIP_ROOM.edge, clip.y + dy)))
      change((store.doc.clips ?? []).map((c) => (c.id === clip.id ? { ...c, x, y } : c)))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  const key = (event: KeyboardEvent): void => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return
    event.preventDefault()
    event.stopPropagation()
    remove()
  }
  return (
    <span className="nw-video-mark nw-video-clip" style={{ left: mm(clip.x), top: mm(clip.y) }}>
      <button
        type="button"
        aria-label={label}
        title={`${label}. Drag to move it.`}
        onPointerDown={press}
        onKeyDown={key}
        onClick={() => {
          if (dragged.current) {
            dragged.current = false
            return
          }
          seekVideo(clip.media, clip.from / 10, clip.to / 10)
        }}
      >
        ▶ {timeText(clip.from)}
      </button>
      <button type="button" className="nw-video-clip-out" aria-label={`Take out the mark at ${timeText(clip.from)}`} title="Take out this mark (Undo brings it back)" onPointerDown={(event) => event.stopPropagation()} onClick={remove}>
        ×
      </button>
    </span>
  )
}

/** The marks on one page, for the note's videos: ⏱ beside lines, and ▶ hard parts. */
export function VideoMarks({ store, doc, page }: { store: EditorStore; doc: Doc; page: Page }) {
  const shown = useSyncExternalStore(timesShown.subscribe, timesShown.snapshot)
  const videos = new Set((doc.media ?? []).map((m) => m.id))
  if (videos.size === 0) return null
  const marks = !shown ? [] : page.free.flatMap((id) => {
    const block = doc.block[id]
    return block?.type === 'ink' ? marksOf(block).filter((mark) => videos.has(mark.media)) : []
  })
  const clips = (doc.clips ?? []).filter((clip) => clip.page === page.id && videos.has(clip.media))
  return (
    <>
      {clips.map((clip) => (
        <ClipMark key={clip.id} store={store} clip={clip} />
      ))}
      {marks.map((mark) => (
        <TimeMark key={mark.key} store={store} mark={mark} />
      ))}
    </>
  )
}
