// Page overflow. When a frame reaches the bottom margin,
// the blocks that no longer fit move, whole, into its continuation frame on
// the next page, linked with `next`; and a frame's `h`, a cache of its height,
// is written as it is drawn. A frame that grows moves what lies below it, in
// its column, down out of its way. Version 1 only pushes forward: it does not
// pull text or blocks back when room frees up. These changes follow from the
// person's own, so they join the same undo step: one undo takes back the
// typing and the push together, and the page does not push again.
import { idTaken, MARGIN, newId, type Doc, type Frame, type Id, type Op } from '@shellnote/core'
import { useEffect } from 'react'
import { flushSync } from 'react-dom'
import { focusAt, frameEditors } from './frame/active.js'
import type { EditorStore } from './store.js'

/** How far a frame's drawn height may be from its h, in document units, before h is written again: 1 mm. */
const SLACK = 100

/**
 * The operations that push a frame's overflowing blocks into its
 * continuation frame. `bottoms` gives each block's bottom edge as drawn, in
 * document units from the top of its page. The first block stays even when it
 * alone is too tall, so nothing is pushed for ever. A frame without a
 * continuation gets one at the top of the next page, when that page is empty,
 * or of a new page after this one; it is as wide as this frame.
 */
export function overflowOps(doc: Doc, frameId: Id, bottoms: ReadonlyMap<Id, number>): Op[] {
  const frame = doc.block[frameId]
  if (frame?.type !== 'frame') return []
  const page = doc.page[frame.page]!
  const limit = page.h - MARGIN
  const from = frame.kids.findIndex((id, i) => i > 0 && (bottoms.get(id) ?? 0) > limit)
  if (from === -1) return []
  const ops: Op[] = []
  let target = frame.next
  if (target === undefined) {
    const taken = new Set<Id>()
    const fresh = (): Id => {
      const id = newId((candidate) => idTaken(doc, candidate) || taken.has(candidate))
      taken.add(id)
      return id
    }
    const index = doc.pages.indexOf(page.id)
    const after = doc.pages[index + 1]
    let onto = after !== undefined && doc.page[after]!.free.length === 0 ? after : undefined
    if (onto === undefined) {
      onto = fresh()
      ops.push({ op: 'page', add: { id: onto, w: page.w, h: page.h, bg: page.bg, free: [] }, at: index + 1 })
    }
    target = fresh()
    ops.push({ op: 'add', block: { id: target, r: 0, type: 'frame', page: onto, x: frame.x, y: MARGIN, w: frame.w, h: 0, kids: [] } })
    ops.push({ op: 'update', id: frameId, set: { next: target } })
  }
  frame.kids.slice(from).forEach((id, i) => ops.push({ op: 'move', id, to: { parent: target, at: i } }))
  return ops
}

/** The update that writes a frame's drawn height into its h, when they differ by more than 1 mm. */
export function heightOp(frame: Frame, drawn: number): Op | undefined {
  const h = Math.max(0, Math.round(drawn))
  return Math.abs(h - frame.h) > SLACK ? { op: 'update', id: frame.id, set: { h } } : undefined
}

/** The gap kept between a growing frame and what it pushes down, at most: 5 mm. A wider gap closes first. */
const KEEP_GAP = 500

/**
 * The moves that keep a frame growing to height `h` from running over what
 * lies below it on its page: each
 * block below it, in the same column, moves down only as far as it must,
 * keeping the gap it had, up to 5 mm; what that block then reaches moves on
 * in turn. Blocks beside the frame stay; nothing moves up or leaves its page.
 */
export function roomOps(doc: Doc, frameId: Id, h: number): Op[] {
  const frame = doc.block[frameId]
  if (frame?.type !== 'frame' || h <= frame.h) return []
  const page = doc.page[frame.page]!
  const sideBySide = (a: { x: number; w: number }, b: { x: number; w: number }): boolean => a.x < b.x + b.w && b.x < a.x + a.w
  const below = page.free
    .flatMap((id) => {
      const block = doc.block[id]
      return block && 'page' in block && block.id !== frameId && block.y >= frame.y + frame.h && sideBySide(block, frame) ? [block] : []
    })
    .sort((a, b) => a.y - b.y)
  // What has grown or moved so far: its edges before and after.
  const pushers = [{ x: frame.x, w: frame.w, was: frame.y + frame.h, now: frame.y + h }]
  const ops: Op[] = []
  for (const block of below) {
    let y = block.y
    for (const above of pushers) {
      if (sideBySide(above, block) && block.y >= above.was) y = Math.max(y, above.now + Math.min(KEEP_GAP, block.y - above.was))
    }
    y = Math.min(y, page.h - block.h)
    if (y > block.y) ops.push({ op: 'move', id: block.id, to: { page: page.id, x: block.x, y: Math.round(y) } })
    pushers.push({ x: block.x, w: block.w, was: block.y + block.h, now: Math.max(block.y, y) + block.h })
  }
  return ops
}

/** A frame as drawn: its height, and its blocks' bottom edges, in document units from the top of the page. */
function measure(doc: Doc, frame: Frame): { height: number; bottoms: Map<Id, number> } | undefined {
  const element = document.querySelector<HTMLElement>(`.nw-frame[data-id="${CSS.escape(frame.id)}"]`)
  const sheet = element?.closest('.nw-page')?.getBoundingClientRect()
  if (!element || !sheet || sheet.width === 0) return undefined
  const scale = doc.page[frame.page]!.w / sheet.width
  const bottoms = new Map<Id, number>()
  for (const kid of frame.kids) {
    const drawn = element.querySelector(`[data-id="${CSS.escape(kid)}"]`)
    if (drawn) bottoms.set(kid, (drawn.getBoundingClientRect().bottom - sheet.top) * scale)
  }
  return { height: element.getBoundingClientRect().height * scale, bottoms }
}

/**
 * Settle frames after a change: push what overflows, or else write the
 * drawn height. The caret moves with the block it is in.
 */
function settle(store: EditorStore, frameIds: readonly Id[]): void {
  for (const id of frameIds) {
    const doc = store.doc
    const frame = doc.block[id]
    if (frame?.type !== 'frame') continue
    const drawn = measure(doc, frame)
    if (!drawn) continue
    const pushed = overflowOps(doc, id, drawn.bottoms)
    const height = pushed.length === 0 ? heightOp(frame, drawn.height) : undefined
    // A frame that grows moves what lies below it down, in the same undo step.
    const ops = height ? [height, ...roomOps(doc, id, Math.max(0, Math.round(drawn.height)))] : pushed
    if (ops.length === 0) continue
    // Where the caret is, in case its block is pushed along.
    const editor = frameEditors.get(id)
    const caret = editor?.isFocused ? editor.state.selection.$head : undefined
    const caretBlock = caret && caret.depth > 0 ? (caret.node(1).attrs.id as Id | null) : null
    try {
      // Drawn at once, with a new continuation frame's editor, so the caret can move before the next key.
      flushSync(() => store.apply(ops, { origin: 'layout', join: true }))
    } catch (error) {
      console.warn('shellnote: the page layout could not be settled', error)
      continue
    }
    const target = (store.doc.block[id] as Frame).next
    if (caret && caretBlock && target && pushed.some((op) => op.op === 'move' && op.id === caretBlock)) {
      const offset = caret.depth === 1 ? caret.parentOffset : 0
      store.focusRequest = { frame: target, block: caretBlock, offset }
      const next = frameEditors.get(target)
      if (next) focusAt(next, caretBlock, offset)
    }
  }
}

/**
 * Settle the frames a change touched as the page is next drawn. Only after a
 * new change: after undo or redo the note is as it was, and pushing again
 * would trap undo.
 */
export function useOverflow(store: EditorStore | undefined): void {
  useEffect(() => {
    if (!store) return
    const frames = new Set<Id>()
    let request = 0
    let lastRecorded = true
    const stop = store.subscribe((change) => {
      lastRecorded = change.recorded
      if (!change.recorded) {
        frames.clear()
        return
      }
      for (const id of change.changed) {
        const block = change.doc.block[id]
        if (block?.type === 'frame') frames.add(id)
        else if (block && 'parent' in block) frames.add(block.parent)
      }
      if (frames.size === 0 || request !== 0) return
      request = requestAnimationFrame(() => {
        request = 0
        const ids = [...frames]
        frames.clear()
        // An undo since the change: the step to join is not this change's.
        if (lastRecorded) settle(store, ids)
      })
    })
    return () => {
      stop()
      cancelAnimationFrame(request)
    }
  }, [store])
}
