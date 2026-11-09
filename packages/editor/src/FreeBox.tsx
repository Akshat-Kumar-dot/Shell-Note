// A block placed on the page, as the person edits it: a picture, or a
// formula, diagram or handwriting until their own editors come. Click to
// choose it, Shift+click to add it to the chosen blocks or take it away, and
// drag to move it; the arrow keys nudge it, and Delete removes every chosen
// block. A picture or a diagram also resizes from a corner, keeping its
// shape, and a picture takes a caption, which Enter goes to. The page shows a
// drag as it happens, and core hears of it once, when the button is let go,
// so each move or resize is one undo step.
import type { Doc, FreeBlock, Op } from '@shellnote/core'
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from 'react'
import { ImageView, PlacedView, type AssetUrls } from './blocks.js'
import { CORNERS, moveBox, resizeBox, type Box, type Corner } from './drag.js'
import { CaptionEditor } from './frame/CaptionEditor.js'
import { mm } from './geometry.js'
import { removeChosen, toggleChosen } from './selection.js'
import type { EditorStore } from './store.js'

/** A block placed on the page that is not a frame. */
export type Placed = Exclude<FreeBlock, { type: 'frame' }>

/** A drag under way: which corner, if it resizes; where it started; the box it is making; screen pixels to document units. */
interface Drag {
  pointer: number
  corner: Corner | undefined
  startX: number
  startY: number
  from: Box
  to: Box | undefined
  unitsPerPx: number
}

/** How far a pointer travels, in screen pixels, before a press becomes a drag. */
const SLOP = 3
/** The arrow keys nudge by 1 mm, or by 10 mm with Shift. */
const NUDGE = 100
const ARROWS: Readonly<Record<string, readonly [number, number]>> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
const NAMES: Readonly<Record<Placed['type'], string>> = { image: 'Picture', math: 'Formula', diagram: 'Diagram', ink: 'Handwriting' }

export function FreeBox({ block, doc, store, urls }: { block: Placed; doc: Doc; store: EditorStore; urls: AssetUrls }) {
  const selection = useSyncExternalStore(store.subscribeSelection, store.selectionSnapshot)
  const selected = store.selectionKind === 'objects' && selection.blocks.includes(block.id)
  const [live, setLive] = useState<Box | null>(null)
  const drag = useRef<Drag | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const page = doc.page[block.page]!
  const shown = live ?? block
  const picture = block.type === 'image' ? block : undefined
  // Chosen on its own, a picture or a diagram shows its corners to resize, and a picture its caption line.
  const alone = selected && selection.blocks.length === 1

  // A block chosen while nothing has the focus takes it, so Delete and the arrows reach it.
  useEffect(() => {
    if (selected && (document.activeElement === null || document.activeElement === document.body)) box.current?.focus({ preventScroll: true })
  }, [selected])

  const run = (ops: Op[], key?: string): void => {
    if (ops.length === 0) return
    try {
      store.apply(ops, { origin: 'box', ...(key === undefined ? {} : { key }) })
    } catch (error) {
      console.warn('shellnote: the block could not be changed', error)
    }
  }

  const begin = (event: PointerEvent, corner: Corner | undefined): void => {
    const sheet = box.current?.closest('.nw-page')
    if (event.button !== 0 || !sheet || !box.current) return
    event.preventDefault()
    event.stopPropagation()
    box.current.focus({ preventScroll: true })
    // Shift+click adds the block to the chosen ones, or takes it away, and moves nothing.
    if (event.shiftKey && corner === undefined) {
      toggleChosen(store, block.id)
      return
    }
    store.select({ blocks: [block.id] }, 'objects')
    box.current.setPointerCapture(event.pointerId)
    drag.current = {
      pointer: event.pointerId,
      corner,
      startX: event.clientX,
      startY: event.clientY,
      from: { x: block.x, y: block.y, w: block.w, h: block.h },
      to: undefined,
      unitsPerPx: page.w / sheet.getBoundingClientRect().width,
    }
  }

  const follow = (event: PointerEvent): void => {
    const d = drag.current
    if (d?.pointer !== event.pointerId) return
    const across = event.clientX - d.startX
    const down = event.clientY - d.startY
    if (d.to === undefined && Math.hypot(across, down) < SLOP) return
    const dx = across * d.unitsPerPx
    const dy = down * d.unitsPerPx
    d.to = d.corner ? resizeBox(d.from, d.corner, dx, dy, page) : moveBox(d.from, dx, dy, page)
    setLive(d.to)
  }

  const finish = (event: PointerEvent): void => {
    const d = drag.current
    if (d?.pointer !== event.pointerId) return
    drag.current = null
    if (d.to) {
      const ops: Op[] = []
      if (d.to.x !== d.from.x || d.to.y !== d.from.y) ops.push({ op: 'move', id: block.id, to: { page: block.page, x: d.to.x, y: d.to.y } })
      if (d.to.w !== d.from.w || d.to.h !== d.from.h) ops.push({ op: 'update', id: block.id, set: { w: d.to.w, h: d.to.h } })
      run(ops)
    }
    setLive(null)
  }

  const cancel = (): void => {
    drag.current = null
    setLive(null)
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    // Keys typed in a caption are the caption's.
    if (event.target !== box.current) return
    const arrow = ARROWS[event.key]
    if (event.key === 'Escape') {
      if (drag.current) cancel()
      else {
        store.select({ blocks: [] }, 'objects')
        box.current?.blur()
      }
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      // This block and every other chosen one.
      if (!selected) store.select({ blocks: [block.id] }, 'objects')
      removeChosen(store)
    } else if (event.key === 'Enter' && picture) {
      box.current?.querySelector<HTMLElement>('.nw-caption .ProseMirror')?.focus()
    } else if (arrow) {
      const step = event.shiftKey ? 10 * NUDGE : NUDGE
      const to = moveBox(block, arrow[0] * step, arrow[1] * step, page)
      if (to.x !== block.x || to.y !== block.y) run([{ op: 'move', id: block.id, to: { page: block.page, x: to.x, y: to.y } }], `nudge:${block.id}`)
    } else {
      return
    }
    // Handled here: the page's own keys must not act on it again.
    event.preventDefault()
    event.stopPropagation()
  }

  const caption = picture && (picture.caption !== undefined || alone) ? <CaptionEditor id={block.id} store={store} /> : null
  return (
    <div
      ref={box}
      className={picture ? 'nw-free nw-box nw-picture' : 'nw-free nw-box'}
      data-free={block.type}
      data-selected={selected ? '' : undefined}
      data-dragging={live ? '' : undefined}
      tabIndex={0}
      aria-label={picture?.alt ? `Picture: ${picture.alt}` : NAMES[block.type]}
      style={{ left: mm(shown.x), top: mm(shown.y), width: mm(shown.w), height: mm(shown.h) }}
      onPointerDown={(event) => {
        if (!(event.target as Element).closest('.nw-caption')) begin(event, undefined)
      }}
      onPointerMove={follow}
      onPointerUp={finish}
      onPointerCancel={cancel}
      onKeyDown={onKeyDown}
    >
      {picture ? <ImageView block={picture} doc={doc} assets={urls} caption={caption} /> : <PlacedView block={block} doc={doc} assets={urls} />}
      {/* A picture or a diagram resizes here: handwriting would stretch, and a formula will size itself. */}
      {(picture || block.type === 'diagram') && alone
        ? CORNERS.map((corner) => <span key={corner} className="nw-handle" data-corner={corner} aria-hidden="true" onPointerDown={(event) => begin(event, corner)} />)
        : null}
    </div>
  )
}
