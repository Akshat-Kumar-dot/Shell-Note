// Adding pictures. A picture is two things in a note: an asset (metadata keyed
// by the SHA-256 of its bytes, which the AssetStore keeps) and an image block
// that shows it. Pasted or picked with the caret in a frame, a picture goes
// into the text there. Dropped on text, it goes in where it was dropped.
// Anywhere else it is placed on the page, free to move.
import { apply, currentPage, freeSpace, idTaken, MARGIN, newId, type Block, type Doc, type Frame, type Id, type Op, type Page } from '@shellnote/core'
import { NodeSelection, type EditorState } from '@tiptap/pm/state'
import type { NewPicture } from './assets.js'
import { activeEditor } from './frame/active.js'
import type { EditorStore } from './store.js'

/**
 * Where new pictures go: into a frame at an index, or onto a page, centred on
 * a point when there is one, and no larger than `fit` when it is given, such
 * as a Select box the pictures go into.
 */
export type PictureSpot = { frame: Id; at: number } | { page: Id; x?: number; y?: number; fit?: { w: number; h: number } }

/** Document units (0.01 mm) per CSS pixel, which is 1/96 inch. */
const UNITS_PER_PX = 2540 / 96
/** The size of a picture that does not give its own. */
const UNKNOWN = { w: 8000, h: 6000 }
/** Pictures dropped together fan out by 5 mm, so each one shows. */
const FAN = 500

/** A new picture's size on a page: its pixels at 96 to the inch, shrunk to fit the page's width and half its height. */
export function pictureSize(meta: NewPicture['meta'], page: Pick<Page, 'w' | 'h'>): { w: number; h: number } {
  const own = meta.w !== undefined && meta.h !== undefined
  const w = own ? meta.w! * UNITS_PER_PX : UNKNOWN.w
  const h = own ? meta.h! * UNITS_PER_PX : UNKNOWN.h
  const fit = Math.min(1, (page.w - 2 * MARGIN) / w, (page.h - 2 * MARGIN) / 2 / h)
  return { w: Math.max(1, Math.round(w * fit)), h: Math.max(1, Math.round(h * fit)) }
}

/**
 * The operations that add pictures at a spot: the asset of each picture the
 * note does not have yet, then an image block for each. On a page, pictures
 * given no point go into the first free space from the top, one under
 * another. `heights` gives frames' heights as drawn, since a frame's own h
 * may not be up to date.
 */
export function pictureOps(doc: Doc, pictures: readonly NewPicture[], spot: PictureSpot, heights: Readonly<Record<Id, number>> = {}): Op[] {
  const ops: Op[] = []
  const fresh = new Set<Id>()
  const start = 'frame' in spot ? Math.min(spot.at, (doc.block[spot.frame] as Frame).kids.length) : 0
  let layout = withHeights(doc, heights)
  pictures.forEach((picture, i) => {
    const step: Op[] = []
    if (layout.asset[picture.hash] === undefined) step.push({ op: 'asset', hash: picture.hash, meta: picture.meta })
    const id = newId((candidate) => idTaken(doc, candidate) || fresh.has(candidate))
    fresh.add(id)
    if ('frame' in spot) {
      step.push({ op: 'add', block: { id, r: 0, type: 'image', parent: spot.frame, asset: picture.hash } as Block, at: start + i })
    } else {
      const page = doc.page[spot.page]!
      const own = pictureSize(picture.meta, page)
      const shrink = spot.fit ? Math.min(1, spot.fit.w / own.w, spot.fit.h / own.h) : 1
      const w = Math.max(1, Math.round(own.w * shrink))
      const h = Math.max(1, Math.round(own.h * shrink))
      const at =
        spot.x !== undefined && spot.y !== undefined
          ? centredOn(page, spot.x + i * FAN, spot.y + i * FAN, w, h)
          : (freeSpace(layout, page.id, MARGIN, MARGIN, w, h) ?? centredOn(page, page.w / 2, page.h / 2, w, h))
      step.push({ op: 'add', block: { id, r: 0, type: 'image', page: page.id, x: at.x, y: at.y, w, h, asset: picture.hash } as Block })
    }
    layout = apply(layout, step).doc
    ops.push(...step)
  })
  return ops
}

/** Where a box of w × h centred on (x, y) goes: there, moved onto the page where it would stick out. */
function centredOn(page: Page, x: number, y: number, w: number, h: number): { x: number; y: number } {
  return {
    x: Math.round(Math.max(0, Math.min(x - w / 2, page.w - w))),
    y: Math.round(Math.max(0, Math.min(y - h / 2, page.h - h))),
  }
}

/** The document with frames as tall as they are drawn, for finding free space. */
function withHeights(doc: Doc, heights: Readonly<Record<Id, number>>): Doc {
  const taller = Object.entries(heights).filter(([id, h]) => {
    const block = doc.block[id]
    return block?.type === 'frame' && h > block.h
  })
  if (taller.length === 0) return doc
  const block = { ...doc.block }
  for (const [id, h] of taller) block[id] = { ...(block[id] as Frame), h: Math.round(h) }
  return { ...doc, block }
}

/** The height of each frame on a page as drawn, in document units, when the page is on screen. */
export function drawnHeights(doc: Doc, pageId: Id): Record<Id, number> {
  const page = doc.page[pageId]
  const sheet = document.querySelector<HTMLElement>(`.nw-page[data-page="${CSS.escape(pageId)}"]`)
  if (!page || !sheet) return {}
  const unitsPerPx = page.w / sheet.getBoundingClientRect().width
  const out: Record<Id, number> = {}
  for (const id of page.free) {
    if (doc.block[id]?.type !== 'frame') continue
    const frame = sheet.querySelector<HTMLElement>(`:scope > [data-id="${CSS.escape(id)}"]`)
    if (frame) out[id] = frame.getBoundingClientRect().height * unitsPerPx
  }
  return out
}

/** The frame being typed in and the index at its caret, where a picture or table goes; undefined when no frame has the caret. */
export function caretSpot(store: EditorStore): { frame: Id; at: number } | undefined {
  const editor = activeEditor.get()
  const frameId = activeEditor.frame()
  const frame = frameId === undefined ? undefined : store.doc.block[frameId]
  return editor?.isFocused && frame?.type === 'frame' ? { frame: frame.id, at: caretIndex(editor.state, frame.kids.length) } : undefined
}

/** Where the caret last was in a frame, even with no text typed in now: the toolbar is never locked (target.ts). */
export function lastCaretSpot(store: EditorStore): { frame: Id; at: number } | undefined {
  const editor = activeEditor.get()
  const frameId = activeEditor.frame()
  const frame = frameId === undefined ? undefined : store.doc.block[frameId]
  return editor && frame?.type === 'frame' ? { frame: frame.id, at: caretIndex(editor.state, frame.kids.length) } : undefined
}

/**
 * Where the Picture button, or a paste outside the text, puts pictures: at
 * the caret when a frame is being typed in; otherwise on the page of what is
 * selected, or else on the page in view.
 */
export function pictureSpot(store: EditorStore): PictureSpot {
  const caret = caretSpot(store)
  if (caret) return caret
  const { selection } = store
  const chosen = selection.blocks.some((id) => store.doc.block[id] !== undefined) || selection.here !== undefined
  const page = chosen ? currentPage(store.doc, selection) : store.pageInView
  return { page: page !== undefined && store.doc.page[page] ? page : store.doc.pages[0]! }
}

/**
 * Where a picture goes at the caret, as an index in the frame: after the
 * block with the caret, or in place of an empty line, which then follows the
 * picture. `kids` is the number of blocks core has in the frame.
 */
export function caretIndex(state: EditorState, kids: number): number {
  const { selection } = state
  const index = selection.$from.index(0)
  if (selection instanceof NodeSelection) return Math.min(kids, index + 1)
  // A caret between blocks, beside a picture or formula.
  if (selection.$from.depth === 0) return Math.min(kids, index)
  const block = state.doc.child(index)
  const emptyLine = block.type.name === 'textBlock' && block.content.size === 0
  return Math.min(kids, emptyLine ? index : index + 1)
}

/**
 * Add picture files at a spot, as one undo step, and select the ones placed
 * on a page. Files that are not pictures ShellNote can show are skipped, and
 * the reason is logged. Resolves to the new blocks' ids.
 */
export async function addPictures(store: EditorStore, files: readonly Blob[], spot: PictureSpot): Promise<Id[]> {
  const pictures: NewPicture[] = []
  for (const file of files) {
    try {
      pictures.push(await store.assets.add(file))
    } catch (error) {
      console.warn('shellnote: a picture was not added.', error)
    }
  }
  const doc = store.doc
  // The frame or page may have gone while the pictures were read.
  const there = 'frame' in spot ? doc.block[spot.frame]?.type === 'frame' : doc.page[spot.page] !== undefined
  if (pictures.length === 0 || !there) return []
  const ops = pictureOps(doc, pictures, spot, 'page' in spot ? drawnHeights(doc, spot.page) : {})
  store.apply(ops, { origin: 'pictures' })
  const ids = ops.flatMap((op) => (op.op === 'add' ? [op.block.id] : []))
  if ('page' in spot) store.select({ blocks: ids }, 'objects')
  return ids
}
