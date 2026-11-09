// ↩ beside each line of writing done beside a program (other programs inside ShellNote, stage 4, step 4), as ⏱ beside a
// line written beside a video: the program's place when the line was written. A tap takes the program back there: the
// slide, the page, the address, the file and line. It is the person's own tap, and only theirs: no command, agent or
// terminal controls another program. A program that cannot go back (closed, its slide deleted) shows the line's place
// instead. × takes the places off the line.
import { editInk, type Doc, type Id, type InkBlock, type Page, type Place, type ProgramSource, type Stroke } from '@shellnote/core'
import { useState, useSyncExternalStore } from 'react'
import { mm } from '../geometry.js'
import type { EditorStore } from '../store.js'
import { timesShown } from '../video/state.js'
import { isWriting, letterLike, rowsIn, usualOf } from '../video/VideoMarks.js'
import { programHost, type ProgramHost } from './host.js'
import { placeKey, programBeside } from './moment.js'

type Moment = NonNullable<Stroke['pm']>

/** The ↩ of one line of writing: where it was written beside one program, each place once, in the order written. */
export interface ProgramMark {
  key: string
  block: Id
  /** The line's strokes, in the block. */
  indices: number[]
  m: Id
  moments: Moment[]
  /** The line's left end and its middle, on the page, in the page's units. */
  x: number
  y: number
  /** Written beside a video too: its ⏱ is there, so this goes under it. */
  under: boolean
}

/** A mark stays on the page: what is left of a line, less its gap to the line and to the page's edge, and at least this wide (12 mm), in the page's units. */
const ROOM_LEFT = 300
const LEAST_WIDE = 1200

/** A place's short words for its mark. */
export function placeWords(place: Place | undefined, source: ProgramSource | undefined): string {
  if (!place) return source?.title ?? source?.program ?? 'A program'
  if ('slide' in place) return `slide ${place.n}`
  if ('page' in place) return `p. ${place.page}`
  if ('address' in place) return siteOf(place.address)
  const name = place.file.split(/[/\\]/u).at(-1) ?? place.file
  return place.line === undefined ? name : `${name}:${place.line}`
}

/** An address as a person reads it: the site, or a file's name. */
function siteOf(address: string): string {
  try {
    const url = new URL(address)
    if (url.protocol === 'file:') return decodeURIComponent(url.pathname.split('/').at(-1) ?? address)
    return url.hostname.replace(/^www\./u, '') || address
  } catch {
    return address
  }
}

const sameness = (moment: Moment): string => JSON.stringify(moment.place ?? null)

// A block is never changed in place, so its marks are worked out once.
const marksKnown = new WeakMap<InkBlock, ProgramMark[]>()

/** One mark a line of writing done beside a program. Dots, lines and arrows get none, as with a video's times. */
export function programMarksOf(block: InkBlock): ProgramMark[] {
  const kept = marksKnown.get(block)
  if (kept) return kept
  const marks: ProgramMark[] = []
  if (block.strokes.some((stroke) => stroke.pm)) {
    const usual = usualOf(block)
    for (const row of rowsIn(block)) {
      const letters = row.indices.map((i) => block.strokes[i]!).filter((stroke) => letterLike(stroke, usual))
      const first = letters.find((stroke) => stroke.pm)?.pm
      if (!first || !isWriting(letters, usual)) continue
      const moments = new Map<string, Moment>()
      for (const stroke of letters) {
        // The first moment at each place: the picture kept when the view changed is on it.
        if (stroke.pm?.m === first.m && !moments.has(sameness(stroke.pm))) moments.set(sameness(stroke.pm), stroke.pm)
      }
      let [left, top, bottom] = [Infinity, Infinity, -Infinity]
      for (const stroke of letters) {
        for (let k = 0; k + 1 < stroke.pts.length; k += 3) {
          left = Math.min(left, stroke.pts[k]!)
          top = Math.min(top, stroke.pts[k + 1]!)
          bottom = Math.max(bottom, stroke.pts[k + 1]!)
        }
      }
      marks.push({ key: `${block.id}:${row.indices[0]}`, block: block.id, indices: row.indices, m: first.m, moments: [...moments.values()], x: block.x + left, y: block.y + (top + bottom) / 2, under: letters.some((stroke) => stroke.vt) })
    }
  }
  marksKnown.set(block, marks)
  return marks
}

/** A web page's address to open with no window of the program: in the person's own browser. Only a web page. */
export function pageAddress(place: Place): string | undefined {
  const address = 'address' in place ? place.address : 'page' in place && place.file ? `${place.file.split('#')[0]}#page=${place.page}` : undefined
  return address !== undefined && /^https?:\/\//iu.test(address) ? address : undefined
}

/**
 * Back to a place, by the window beside the note if it is the same program, else one open elsewhere, brought in front;
 * with none, a web page opens in the person's own browser. False when it cannot go back.
 */
export async function goBack(host: ProgramHost | undefined, source: ProgramSource | undefined, place: Place | undefined): Promise<boolean> {
  if (!place) return false
  if (host?.goTo && source) {
    const program = source.program.toLowerCase()
    const beside = programBeside()
    if (beside?.program.toLowerCase() === program) {
      if (await host.goTo(beside.id, place, false).catch(() => false)) return true
    } else {
      const windows = (await host.list().catch(() => [])).filter((window) => window.left_out === null && window.program.toLowerCase() === program)
      const target = windows.find((window) => window.title === source.title) ?? windows[0]
      if (target && (await host.goTo(target.id, place, true).catch(() => false))) return true
    }
  }
  const address = pageAddress(place)
  if (address === undefined) return false
  window.open(address, '_blank', 'noopener,noreferrer')
  return true
}

/** What a line kept of a place the program cannot go back to now: its picture, its words, and when it was written. */
function MomentShown({ store, moment, source, onClose }: { store: EditorStore; moment: Moment; source: ProgramSource | undefined; onClose: () => void }) {
  const pictures = useSyncExternalStore(store.assets.subscribe, store.assets.snapshot)
  const picture = moment.pic === undefined ? undefined : pictures[moment.pic]
  const key = moment.place && placeKey(moment.place)
  const words = source?.places?.find((one) => placeKey(one.place) === key)?.words
  return (
    <span className="nw-program-moment" role="dialog" aria-label="Where this line was written">
      <button type="button" className="nw-video-clip-out" aria-label="Close" title="Close" onClick={onClose}>
        ×
      </button>
      <strong>{placeWords(moment.place, source)}</strong>
      <span>{source?.title ?? source?.program}</span>
      <span>{new Date(moment.at).toLocaleString()}</span>
      {moment.place ? <span>It cannot go back there now: the program is closed, or that place has gone.</span> : null}
      {picture ? <img src={picture} alt={`The program when this line was written: ${placeWords(moment.place, source)}`} draggable={false} /> : null}
      {words ? <span className="nw-program-moment-words">{words}</span> : null}
    </span>
  )
}

function Mark({ store, mark, source }: { store: EditorStore; mark: ProgramMark; source: ProgramSource | undefined }) {
  const host = useSyncExternalStore(programHost.subscribe, programHost.snapshot)
  const [shown, setShown] = useState<Moment>()
  const takeOff = (): void => {
    const block = store.doc.block[mark.block]
    if (block?.type !== 'ink') return
    const replace = new Map<number, Stroke[]>()
    for (const i of mark.indices) {
      const stroke = block.strokes[i]
      if (!stroke?.pm) continue
      const rest = { ...stroke }
      delete rest.pm
      replace.set(i, [rest])
    }
    const ops = editInk(store.doc, block.id, { replace })
    // A picture no other line keeps goes with its places: nothing kept that the person took off.
    const gone = new Set(mark.indices.flatMap((i) => block.strokes[i]?.pm?.pic ?? []))
    const others = Object.values(store.doc.block).flatMap((one) => (one.type === 'ink' ? one.strokes.filter((stroke, i) => one.id !== block.id || !mark.indices.includes(i)) : []))
    for (const stroke of others) if (stroke.pm?.pic !== undefined) gone.delete(stroke.pm.pic)
    for (const hash of gone) if (store.doc.asset[hash]) ops.push({ op: 'asset', hash, meta: null })
    store.apply(ops, { origin: 'toolbar' })
  }
  return (
    <span className="nw-video-mark nw-video-time nw-program-mark" data-under={mark.under ? '' : undefined} style={{ left: mm(mark.x), top: mm(mark.y) }} onPointerDown={(event) => event.stopPropagation()}>
      {mark.moments.map((moment) => {
        const words = placeWords(moment.place, source)
        const label = moment.place ? `Back to ${words} of ${source?.title ?? source?.program ?? 'the program'}, where this line was written` : `Where this line was written: ${words}`
        return (
          <button
            key={sameness(moment)}
            type="button"
            aria-label={label}
            title={label}
            style={{ maxWidth: mm(Math.max(mark.x - ROOM_LEFT, LEAST_WIDE)) }}
            onClick={() => {
              void goBack(host, source, moment.place).then((went) => setShown(went ? undefined : moment))
            }}
          >
            ↩ {words}
          </button>
        )
      })}
      <button type="button" className="nw-video-clip-out" aria-label="Take the places off this line" title="Take the places off this line (Undo brings them back)" onClick={takeOff}>
        ×
      </button>
      {shown ? <MomentShown store={store} moment={shown} source={source} onClose={() => setShown(undefined)} /> : null}
    </span>
  )
}

/** The ↩ marks on one page, for the programs the note was written beside. */
export function ProgramMarks({ store, doc, page }: { store: EditorStore; doc: Doc; page: Page }) {
  const shown = useSyncExternalStore(timesShown.subscribe, timesShown.snapshot)
  if (!shown) return null
  const marks = page.free.flatMap((id) => {
    const block = doc.block[id]
    return block?.type === 'ink' ? programMarksOf(block) : []
  })
  return (
    <>
      {marks.map((mark) => (
        <Mark key={mark.key} store={store} mark={mark} source={doc.programs?.find((source) => source.id === mark.m)} />
      ))}
    </>
  )
}
