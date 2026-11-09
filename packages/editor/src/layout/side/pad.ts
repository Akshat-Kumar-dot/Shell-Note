// The scratch pad's data: what the AI made, kept per note in the person's
// browser until it is put into the note, and where it goes then. Apart from the list's drawing (made.tsx), so the
// commands (pad.put, pad.remove) need nothing drawn.
import { answerOps, idTaken, MARGIN, newId, type Id } from '@shellnote/core'
import type { EditorStore } from '../../store.js'
import { Shared } from '../../video/state.js'

export interface Made {
  id: string
  kind: 'table' | 'diagram' | 'text'
  /** What it was asked to be of. */
  about: string
  /** As an answer writes it: a pipe table, a fenced Mermaid diagram, or Markdown. */
  text: string
  at: number
}

/** What a dragged thing from the scratch pad carries: its text, for the page to take. */
export const MADE_TYPE = 'application/x-shellnote-made'

const keyOf = (doc: Id): string => `shellnote:made:${doc}`

function read(doc: Id): Made[] {
  try {
    const saved = JSON.parse(localStorage.getItem(keyOf(doc)) ?? '[]') as unknown
    return Array.isArray(saved) ? (saved as Made[]).filter((m) => typeof m?.text === 'string' && typeof m.id === 'string') : []
  } catch {
    return []
  }
}

/** Each note's scratch pad, read once and shared. */
const pads = new Map<Id, Shared<Made[]>>()
export function padOf(doc: Id): Shared<Made[]> {
  let pad = pads.get(doc)
  if (!pad) pads.set(doc, (pad = new Shared(read(doc))))
  return pad
}
function keep(doc: Id, items: Made[]): void {
  try {
    localStorage.setItem(keyOf(doc), JSON.stringify(items))
  } catch {
    // Storage is off: it lasts until the page closes.
  }
  padOf(doc).set(items)
}
export function addMade(doc: Id, item: Omit<Made, 'id' | 'at'>): void {
  keep(doc, [{ ...item, id: Math.random().toString(36).slice(2, 10), at: Date.now() }, ...padOf(doc).value])
}
export function removeMade(doc: Id, id: string): void {
  keep(doc, padOf(doc).value.filter((m) => m.id !== id))
}

/** Where something goes in the note when nothing is chosen, as a Select box would be: given, or the empty part in view. */
export type Room = { page: Id; x: number; y: number; w: number; h: number }

/** Put a thing made into the note: at `room`, else into what is chosen; one undo step. False when there was nowhere. */
export function putMade(store: EditorStore, text: string, room: Room | undefined): boolean {
  const doc = store.doc
  const made = new Set<Id>()
  const fresh = (): Id => {
    const id = newId((candidate) => idTaken(doc, candidate) || made.has(candidate))
    made.add(id)
    return id
  }
  const selection = room ? { blocks: [], here: room } : store.selection
  const ops = answerOps(doc, selection, text, fresh)
  if (ops.length === 0) return false
  store.apply(ops, { origin: 'toolbar' })
  return true
}

/** Room below the page's last block for a thing made, at least: 40 mm. */
const ROOM_LEAST = 4000

/**
 * Where a thing made goes when nothing is chosen in the note: the empty part of the page in view, below its last
 * block as drawn (a text frame's height is its text's), within the margins; none when that page is full.
 */
export function emptyPartInView(store: EditorStore): Room | undefined {
  let best: { sheet: HTMLElement; seen: number } | undefined
  for (const sheet of document.querySelectorAll<HTMLElement>('.nw-page[data-page]')) {
    const box = sheet.getBoundingClientRect()
    const seen = Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0)
    if (seen > 0 && (!best || seen > best.seen)) best = { sheet, seen }
  }
  const page = best && store.doc.page[best.sheet.dataset.page ?? '']
  if (!best || !page) return undefined
  const box = best.sheet.getBoundingClientRect()
  let bottom = MARGIN
  for (const block of best.sheet.querySelectorAll<HTMLElement>(':scope > .nw-free, :scope > * > .nw-free')) {
    const drawn = block.getBoundingClientRect()
    if (drawn.height > 0) bottom = Math.max(bottom, Math.round(((drawn.bottom - box.top) / box.height) * page.h))
  }
  const y = bottom + 500
  const h = page.h - MARGIN - y
  return h >= ROOM_LEAST ? { page: page.id, x: MARGIN, y, w: page.w - 2 * MARGIN, h } : undefined
}

/** A room at a point dropped on a page: from there to the right margin, 80 mm down at most. */
export function roomAt(store: EditorStore, page: Id, x: number, y: number): Room | undefined {
  const p = store.doc.page[page]
  if (!p) return undefined
  const left = Math.max(MARGIN, Math.min(p.w - MARGIN - 4000, Math.round(x)))
  const top = Math.max(MARGIN, Math.min(p.h - MARGIN - 2000, Math.round(y)))
  return { page, x: left, y: top, w: p.w - MARGIN - left, h: Math.min(8000, p.h - MARGIN - top) }
}
