// The stroke recorder's progress, kept in the library's IndexedDB (the `meta`
// store), one record for each ask drawn and one for the recording itself
// (the pen review's R4, 16 October 2026). It was one string in localStorage,
// written whole after every ask: some 15 ms at 2 MB and more as it grew, and
// past the browser's 5 MB the writes failed without a word. Now each ask is
// written alone, in order, and a write that fails says so.
import { result, transact } from '../storage/db.js'

/** One sample, as the pen gave it: x and y in 0.01 mm from the sheet's corner, pressure 0 to 1, tilt in degrees, time in ms, contact size in CSS pixels. */
export type Sample = [x: number, y: number, pressure: number, tiltX: number, tiltY: number, t: number, w: number, h: number]

export interface Recorded {
  kind: string
  strokes: { type: string; samples: Sample[] }[]
}

export interface Recording {
  v: 1
  device: { userAgent: string; dpr: number }
  started: string
  items: Recorded[]
}

/** Where progress was kept before: read once, carried over, and left there. */
export const OLD_KEY = 'shellnote:recorded-strokes'
const HEAD = 'recording:head'
const ITEM = 'recording:item:'
/** Each ask's key, numbered so the keys sort in the order drawn. */
const itemKey = (index: number): string => `${ITEM}${String(index).padStart(6, '0')}`
const ITEMS = (): IDBKeyRange => IDBKeyRange.bound(ITEM, `${ITEM}￿`)

function readOld(): Recording | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(OLD_KEY) ?? 'null') as Recording | null
    if (saved?.v === 1 && Array.isArray(saved.items)) return saved
  } catch {
    // Nothing kept, or storage is off.
  }
  return undefined
}

/**
 * The recording so far: from the library, or, the first time, the progress
 * localStorage held (left there, as the note of storage version 1 was), or a
 * new one.
 */
export function loadRecording(fresh: () => Recording): Promise<Recording> {
  return transact(['meta'], async (pick) => {
    const meta = pick('meta')
    const head = (await result(meta.get(HEAD))) as Omit<Recording, 'items'> | undefined
    if (head) return { ...head, items: (await result(meta.getAll(ITEMS()))) as Recorded[] }
    const recording = readOld() ?? fresh()
    const { items, ...rest } = recording
    meta.put(rest, HEAD)
    items.forEach((item, index) => meta.put(item, itemKey(index)))
    return recording
  })
}

let writing: Promise<void> = Promise.resolve()

/** Writes go one after another, in the order made, so a quick Back after Next ends right. */
function queued(work: (meta: IDBObjectStore) => void): Promise<void> {
  const next = writing.then(() => transact(['meta'], async (pick) => work(pick('meta'))))
  writing = next.catch(() => undefined)
  return next
}

/** Keep asks drawn, the first of them at `from`. */
export function keepItems(from: number, items: readonly Recorded[]): Promise<void> {
  return queued((meta) => items.forEach((item, k) => meta.put(item, itemKey(from + k))))
}

/** Forget the asks from `from` on. */
export function dropItems(from: number): Promise<void> {
  return queued((meta) => meta.delete(IDBKeyRange.bound(itemKey(from), `${ITEM}￿`)))
}
