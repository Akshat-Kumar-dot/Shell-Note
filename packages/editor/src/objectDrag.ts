// The ⊕ handle of a table or a diagram in a text column, as in Word (Stage 3a
// for tables; diagrams since 11 October 2026, at the person's word). A click
// chooses it as an object: Delete then removes it, Escape lets it go, and the
// bar shows its tools. A drag moves it: a line shows where it would go, between
// the blocks of any frame on any page, or at the point on bare paper, where a
// table gets a frame made for it, and a diagram goes on its own, at the size it
// was drawn, to be resized from its corners. On release it moves as one undo
// step, and stays chosen. The desk scrolls when the pointer nears its top or
// bottom, so it can go to a page out of view; Escape gives the drag up.
import { idTaken, newId, type Block, type Doc, type Frame, type Id, type Op } from '@shellnote/core'
import { frameSpotAt } from './geometry.js'
import type { EditorStore } from './store.js'

/** How far the pointer goes, in screen pixels, before a press on the handle is a drag rather than a click. */
const SLOP = 4
/** Within this many screen pixels of the desk's top or bottom, a drag scrolls it. */
const EDGE = 48
const SCROLL_STEP = 14

/** Where a dragged table or diagram would go: into a frame at an index, or onto a spot of bare paper. */
export type Drop = { frame: Id; at: number } | { page: Id; x: number; y: number; w: number }

/** Where the line showing a drop is drawn, on the screen. */
interface Line {
  left: number
  top: number
  width: number
}

/** Choose a table or diagram as an object, and take the focus off the text, so the keys act on it. */
export function chooseObject(store: EditorStore, id: Id): void {
  store.select({ blocks: [id] }, 'objects')
  const focused = document.activeElement
  if (focused instanceof HTMLElement && focused.closest('.ProseMirror')) focused.blur()
}

export function startObjectDrag(store: EditorStore, id: Id, down: PointerEvent): void {
  if (down.button !== 0) return
  down.preventDefault()
  down.stopPropagation()
  const handle = down.target instanceof Element ? down.target : null
  const desk = handle?.closest<HTMLElement>('.nw-desk') ?? null
  const figure = handle?.closest<HTMLElement>('.nw-table, .nw-diagram') ?? null
  let dragging = false
  let last = { x: down.clientX, y: down.clientY }
  let drop: Drop | undefined
  let scrolling = 0
  const line = document.createElement('div')
  line.className = 'nw-drop-line'

  const show = (): void => {
    const found = dropAt(store.doc, id, last.x, last.y)
    drop = found?.drop
    if (!found) return line.remove()
    Object.assign(line.style, { left: `${found.line.left}px`, top: `${found.line.top}px`, width: `${found.line.width}px` })
    if (!line.isConnected) document.body.append(line)
  }
  const scroll = (): void => {
    scrolling = 0
    if (!dragging || !desk) return
    const box = desk.getBoundingClientRect()
    const by = last.y < box.top + EDGE ? -SCROLL_STEP : last.y > box.bottom - EDGE ? SCROLL_STEP : 0
    if (by === 0) return
    desk.scrollTop += by
    show()
    scrolling = requestAnimationFrame(scroll)
  }
  const move = (event: PointerEvent): void => {
    last = { x: event.clientX, y: event.clientY }
    if (!dragging && Math.hypot(event.clientX - down.clientX, event.clientY - down.clientY) < SLOP) return
    if (!dragging) {
      dragging = true
      figure?.setAttribute('data-dragging', '')
      document.body.dataset.dragging = 'object'
    }
    show()
    if (!scrolling) scrolling = requestAnimationFrame(scroll)
  }
  const finish = (event: Event): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', finish)
    window.removeEventListener('pointercancel', finish)
    window.removeEventListener('keydown', escape, true)
    cancelAnimationFrame(scrolling)
    line.remove()
    figure?.removeAttribute('data-dragging')
    delete document.body.dataset.dragging
    if (event.type !== 'pointerup') return
    if (dragging && drop) moveObject(store, id, drop, figure ? drawnSize(store.doc, figure, drop) : undefined)
    chooseObject(store, id)
  }
  const escape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    finish(event)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', finish)
  window.addEventListener('pointercancel', finish)
  window.addEventListener('keydown', escape, true)
}

/** The size a block is drawn at, in document units of the page it is dropped on. */
function drawnSize(doc: Doc, figure: Element, drop: Drop): { w: number; h: number } | undefined {
  if (!('page' in drop)) return undefined
  const sheet = document.querySelector(`.nw-page[data-page="${CSS.escape(drop.page)}"]`)
  const page = doc.page[drop.page]
  if (!sheet || !page) return undefined
  const perPx = page.w / sheet.getBoundingClientRect().width
  const box = figure.getBoundingClientRect()
  return { w: Math.max(1, Math.round(box.width * perPx)), h: Math.max(1, Math.round(box.height * perPx)) }
}

/** Where a table or diagram dragged to a point on the screen would go, and where to draw the line that shows it. */
export function dropAt(doc: Doc, id: Id, x: number, y: number): { drop: Drop; line: Line } | undefined {
  const hits = document.elementsFromPoint(x, y)
  const frameEl = hits.map((el) => el.closest<HTMLElement>('.nw-frame[data-id]')).find((el) => el !== null)
  const frame = frameEl ? doc.block[frameEl.dataset.id!] : undefined
  if (frameEl && frame?.type === 'frame') {
    const box = frameEl.getBoundingClientRect()
    // Among the frame's other blocks: before the first whose middle is below the pointer.
    const kids = frame.kids.filter((kid) => kid !== id)
    let at = kids.length
    let top = box.top
    for (let i = 0; i < kids.length; i++) {
      const rect = frameEl.querySelector(`[data-id="${CSS.escape(kids[i]!)}"]`)?.getBoundingClientRect()
      if (!rect) continue
      if (y < rect.top + rect.height / 2) {
        at = i
        top = rect.top
        break
      }
      top = rect.bottom
    }
    return { drop: { frame: frame.id, at }, line: { left: box.left, top, width: box.width } }
  }
  const sheet = hits.map((el) => el.closest<HTMLElement>('.nw-page[data-page]')).find((el) => el !== null)
  const page = sheet ? doc.page[sheet.dataset.page!] : undefined
  if (!sheet || !page) return undefined
  const rect = sheet.getBoundingClientRect()
  const spot = frameSpotAt(page, Math.round(((x - rect.left) / rect.width) * page.w), Math.round(((y - rect.top) / rect.height) * page.h))
  const scale = rect.width / page.w
  return { drop: { page: page.id, ...spot }, line: { left: rect.left + spot.x * scale, top: y, width: spot.w * scale } }
}

/**
 * The operations that move a table or diagram from its text column to where
 * it was dropped: nothing when that is where it already is. On bare paper, a
 * table goes into a new frame there, and a diagram goes on its own, `size`
 * big (the size it was drawn), free to move and resize. A frame left empty
 * goes too, unless text flows through it from page to page.
 */
export function moveOps(doc: Doc, id: Id, drop: Drop, size?: { w: number; h: number }): Op[] {
  const object = doc.block[id]
  if ((object?.type !== 'table' && object?.type !== 'diagram') || !('parent' in object)) return []
  const from = doc.block[object.parent] as Frame
  const ops: Op[] = []
  let to: Id | undefined
  if ('frame' in drop) {
    // `at` counts the frame's other blocks, as move does once the block is taken out: the same index is the same place.
    if (drop.frame === from.id && drop.at === from.kids.indexOf(id)) return []
    to = drop.frame
    ops.push({ op: 'move', id, to: { parent: to, at: drop.at } })
  } else if (object.type === 'diagram') {
    // The size it was drawn at (or as wide as a frame there, three fifths as tall), shrunk to fit the page if need be, keeping its shape; dropped near an edge, it comes in from it.
    const page = doc.page[drop.page]!
    const want = size ?? { w: drop.w, h: Math.round(drop.w * 0.6) }
    const fit = Math.min(1, page.w / want.w, page.h / want.h)
    const w = Math.max(1, Math.round(want.w * fit))
    const h = Math.max(1, Math.round(want.h * fit))
    ops.push({ op: 'move', id, to: { page: drop.page, x: Math.min(drop.x, page.w - w), y: Math.min(drop.y, page.h - h), w, h } })
  } else {
    to = newId((candidate) => idTaken(doc, candidate))
    ops.push({ op: 'add', block: { id: to, r: 0, type: 'frame', page: drop.page, x: drop.x, y: drop.y, w: drop.w, h: 0, kids: [] } as Block })
    ops.push({ op: 'move', id, to: { parent: to, at: 0 } })
  }
  const linked = from.next !== undefined || Object.values(doc.block).some((block) => block.type === 'frame' && block.next === from.id)
  if (from.id !== to && from.kids.length === 1 && !linked) ops.push({ op: 'remove', id: from.id })
  return ops
}

/** Move a table or diagram to where it was dropped, as one undo step. */
export function moveObject(store: EditorStore, id: Id, drop: Drop, size?: { w: number; h: number }): void {
  const ops = moveOps(store.doc, id, drop, size)
  if (ops.length === 0) return
  try {
    store.apply(ops, { origin: 'object-move' })
  } catch (error) {
    console.warn('shellnote: it could not go there', error)
  }
}
