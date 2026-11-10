// The pages of a document, one below another, zoomable, drawing only the pages
// near the screen. Each slot is sized to its zoomed page, so the scroll area is
// right even for pages that are not drawn. With a store, the note can be
// edited: frames typed in, blocks on the page chosen, moved and resized, and
// pictures pasted or dropped. What a press on the page does depends on the
// tool: on bare paper, Type puts the caret on the nearest line, as Word does,
// and Free cursor puts a caret where it clicks, for a new frame; Select draws
// a box that takes only what is inside it, or with a click chooses one block;
// the ink tools draw and erase (ink/PenLayer.tsx). Above each page, in the gap, a slim bar: the page's number, a round
// + that puts a new page there, and the page's delete; under the last page, a round + adds one at the end.
import { idTaken, newId, type Doc, type FreeBlock, type Here, type Id, type Selection } from '@shellnote/core'
import { Plus, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { pictureFiles } from './assets.js'
import { FreeView, PageBox, type AssetUrls, type FreeRenderer } from './blocks.js'
import { MADE_TYPE, putMade, roomAt } from './layout/side/made.js'
import { ProgramMarks } from './program/ProgramMarks.js'
import { VideoMarks } from './video/VideoMarks.js'
import { caretNear } from './caret.js'
import { DraftFrame, type DraftSpot } from './frame/DraftFrame.js'
import { FrameEditor } from './frame/FrameEditor.js'
import { isInkTool, PenLayer } from './ink/PenLayer.js'
import { chosenPieces, marksOver, wordOps, type WordMarks } from './format.js'
import { FreeBox } from './FreeBox.js'
import { clampZoom, frameSpotAt, mm, PAGE_GAP, pageAt, pagesInView, px } from './geometry.js'
import { useOverflow } from './overflow.js'
import { addPictures, pictureSpot } from './pictures.js'
import { regionChoice } from './region.js'
import { removeChosen, type ScreenRect } from './selection.js'
import type { EditorStore } from './store.js'

export interface PageViewProps {
  /** The note to show. With a store, the store's own note is shown as it changes, so what holds the view need not
   * draw itself again for each key typed. */
  doc: Doc
  zoom: number
  /** Asked for a new zoom by Ctrl (or ⌘) and the wheel. Without it, the wheel only scrolls. */
  onZoom?: (zoom: number) => void
  /** Image URLs by asset hash, for a read-only view. With a store, its own pictures are shown. */
  assets?: AssetUrls
  /** With a store, the note can be edited and every change goes to it; without one, the view is read-only. */
  store?: EditorStore
  /** Room above the first page, in screen pixels, for a bar floating over the top of the desk. */
  topSpace?: number
}

const NO_ASSETS: AssetUrls = {}
const NO_STORE = (): (() => void) => () => {}
const NOTHING: Selection = { blocks: [] }
/** The word marks' keys, with Ctrl or ⌘, as in text: the toolbar's shortcuts. */
const MARK_KEYS: Partial<Record<string, keyof WordMarks>> = { b: 'bold', i: 'italic', e: 'code', u: 'underline', '=': 'sub' }
/** With Shift, many keyboards report "=" as "+". */
const SHIFT_MARK_KEYS: Partial<Record<string, keyof WordMarks>> = { x: 'strike', h: 'highlight', '=': 'sup', '+': 'sup' }
/** How far a pointer travels, in screen pixels, before a press becomes a Select box. */
const SLOP = 3
/** How long "Page N deleted" stays, with its Undo. */
const TOAST_MS = 8000

/** An area of a page in document units: a box being drawn, or a Select's box. */
type Area = Extract<Here, { page: Id }>

/** The block a press landed on: a line of text, a picture, a table, a formula; not a frame, which only holds them. */
function blockUnder(doc: Doc, target: Element): Id | undefined {
  const id = target.closest<HTMLElement>('[data-id]')?.dataset.id
  const block = id === undefined ? undefined : doc.block[id]
  return block && block.type !== 'frame' ? block.id : undefined
}

/** A rectangle on the screen as an area of the page drawn in `sheet`, kept on the page. */
function areaOf(doc: Doc, pageId: Id, sheet: Element, box: ScreenRect): Area {
  const rect = sheet.getBoundingClientRect()
  const page = doc.page[pageId]!
  const x = (clientX: number): number => Math.round(Math.min(page.w, Math.max(0, ((clientX - rect.left) / rect.width) * page.w)))
  const y = (clientY: number): number => Math.round(Math.min(page.h, Math.max(0, ((clientY - rect.top) / rect.height) * page.h)))
  return { page: pageId, x: x(box.left), y: y(box.top), w: x(box.right) - x(box.left), h: y(box.bottom) - y(box.top) }
}

/**
 * A new page at `at` in the page list, like the page above it (above the first, like the first): its size and its
 * paper. One undo step; the desk scrolls to it.
 */
function insertPage(store: EditorStore, at: number, desk: HTMLElement | null): void {
  const doc = store.doc
  const like = doc.page[doc.pages[Math.max(0, at - 1)]!]!
  const id = newId((candidate) => idTaken(store.doc, candidate))
  store.apply([{ op: 'page', add: { id, w: like.w, h: like.h, bg: like.bg, free: [] }, at }], { origin: 'toolbar' })
  requestAnimationFrame(() => desk?.querySelector(`.nw-page-slot[data-index="${at}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
}

/**
 * The desk: the note's pages in one scrolling area. Only the pages near the screen are drawn (`band`, from
 * `pagesInView`); the others are empty slots of the right height. `measure` runs once a frame at most while scrolling,
 * and asks for a redraw only when the band changes, so scrolling inside a band costs no render. With no store the note
 * is only shown; with one, `render` gives each block its editor, and the effects below take pictures and presses.
 */
export function PageView({ doc: given, zoom, onZoom, assets = NO_ASSETS, store, topSpace = 0 }: PageViewProps) {
  const doc = useSyncExternalStore(store?.subscribe ?? NO_STORE, () => (store ? store.doc : given))
  const pictures = useSyncExternalStore(store?.assets.subscribe ?? NO_STORE, () => store?.assets.snapshot() ?? assets)
  const render = useCallback<FreeRenderer>(
    (block: FreeBlock) => {
      if (!store) return <FreeView block={block} doc={doc} assets={pictures} />
      if (block.type === 'frame') return <FrameEditor frame={block} store={store} />
      return <FreeBox block={block} doc={doc} store={store} urls={pictures} />
    },
    [store, doc, pictures],
  )
  const desk = useRef<HTMLDivElement>(null)
  // Text that runs past a page's bottom margin continues on the next page.
  useOverflow(store)
  const heights = doc.pages.map((id) => px(doc.page[id]!.h, zoom))
  const key = heights.join(',')
  // Which pages to draw, worked out as the view is drawn from where it was last scrolled to, so
  // a page just added near the screen is drawn at once: text pushed onto it can take the caret there.
  const scrolled = useRef({ top: 0, height: 1000 })
  const band = pagesInView(heights, scrolled.current.top, scrolled.current.height)
  const drawn = useRef(band)
  drawn.current = band
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  const pageIds = useRef(doc.pages)
  pageIds.current = doc.pages

  const measure = useCallback(() => {
    const el = desk.current
    if (!el) return
    const sizes = key.split(',').map(Number)
    scrolled.current = { top: el.scrollTop, height: el.clientHeight }
    const next = pagesInView(sizes, el.scrollTop, el.clientHeight)
    if (next.first !== drawn.current.first || next.last !== drawn.current.last) redraw()
    if (store) store.pageInView = pageIds.current[pageAt(sizes, el.scrollTop + el.clientHeight / 2)]
  }, [key, store])

  useEffect(() => {
    const el = desk.current!
    let frame = 0
    const later = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    el.addEventListener('scroll', later, { passive: true })
    const resize = new ResizeObserver(later)
    resize.observe(el)
    measure()
    return () => {
      el.removeEventListener('scroll', later)
      resize.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [measure])

  // Zooming keeps one point still: the one under the pointer, or else the middle of the view.
  const anchor = useRef<{ x: number; y: number } | null>(null)
  const shownZoom = useRef(zoom)
  useEffect(() => {
    const el = desk.current!
    const onWheel = (event: WheelEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || !onZoom) return
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      anchor.current = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      onZoom(clampZoom(zoom * Math.exp(-event.deltaY * 0.0015)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoom, onZoom])
  useLayoutEffect(() => {
    const el = desk.current!
    const before = shownZoom.current
    shownZoom.current = zoom
    if (before === zoom) return
    const { x, y } = anchor.current ?? { x: el.clientWidth / 2, y: el.clientHeight / 2 }
    anchor.current = null
    const ratio = zoom / before
    el.scrollLeft = (el.scrollLeft + x) * ratio - x
    el.scrollTop = (el.scrollTop + y) * ratio - y
    measure()
  }, [zoom, measure])

  // Pictures pasted outside the text, or dropped on the paper.
  useEffect(() => {
    if (!store) return
    const el = desk.current!
    const carriesFiles = (event: DragEvent): boolean => event.dataTransfer?.types.includes('Files') === true
    // A thing made, dragged from the side panel's scratch pad.
    const carriesMade = (event: DragEvent): boolean => event.dataTransfer?.types.includes(MADE_TYPE) === true
    // A file dropped where nothing takes it must not make the browser leave the note to show it.
    const guard = (event: DragEvent): void => {
      if (carriesFiles(event)) event.preventDefault()
    }
    const onDragOver = (event: DragEvent): void => {
      if (!carriesFiles(event) && !carriesMade(event)) return
      event.preventDefault()
      event.dataTransfer!.dropEffect = 'copy'
    }
    const onDrop = (event: DragEvent): void => {
      if (!event.defaultPrevented && carriesMade(event)) {
        event.preventDefault()
        const sheet = (event.target as Element).closest<HTMLElement>('.nw-page')
        const page = sheet?.dataset.page === undefined ? undefined : store.doc.page[sheet.dataset.page]
        if (!sheet || !page) return
        const rect = sheet.getBoundingClientRect()
        const room = roomAt(store, page.id, ((event.clientX - rect.left) / rect.width) * page.w, ((event.clientY - rect.top) / rect.height) * page.h)
        if (room) putMade(store, event.dataTransfer!.getData(MADE_TYPE), room)
        return
      }
      // A frame took the pictures into its text.
      if (event.defaultPrevented || !carriesFiles(event)) return
      event.preventDefault()
      const sheet = (event.target as Element).closest<HTMLElement>('.nw-page')
      const page = sheet?.dataset.page === undefined ? undefined : store.doc.page[sheet.dataset.page]
      const files = pictureFiles(event.dataTransfer)
      if (!sheet || !page || files.length === 0) return
      const rect = sheet.getBoundingClientRect()
      const x = ((event.clientX - rect.left) / rect.width) * page.w
      const y = ((event.clientY - rect.top) / rect.height) * page.h
      void addPictures(store, files, { page: page.id, x, y })
    }
    const onPaste = (event: ClipboardEvent): void => {
      const target = event.target instanceof Element ? event.target : null
      // Text, form fields and captions take their own pastes.
      if (event.defaultPrevented || target?.closest('.ProseMirror, input, textarea, select, [contenteditable="true"]')) return
      const files = pictureFiles(event.clipboardData)
      if (files.length === 0) return
      event.preventDefault()
      void addPictures(store, files, pictureSpot(store))
    }
    el.addEventListener('dragover', onDragOver)
    el.addEventListener('drop', onDrop)
    window.addEventListener('dragover', guard)
    window.addEventListener('drop', guard)
    window.addEventListener('paste', onPaste)
    return () => {
      el.removeEventListener('dragover', onDragOver)
      el.removeEventListener('drop', onDrop)
      window.removeEventListener('dragover', guard)
      window.removeEventListener('drop', guard)
      window.removeEventListener('paste', onPaste)
    }
  }, [store])

  // Delete removes the blocks chosen as objects, and Escape lets them go. The
  // word marks' keys act on the text of chosen blocks and the pieces a Select
  // box holds, as they do in text.
  // Keys typed in text or a field are theirs.
  useEffect(() => {
    if (!store) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || store.selectionKind !== 'objects') return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('input, textarea, select, .ProseMirror')) return
      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        const name = (event.shiftKey ? SHIFT_MARK_KEYS : MARK_KEYS)[event.key.toLowerCase()]
        const pieces = chosenPieces(store.doc, store.selection)
        if (name === undefined || pieces.length === 0) return
        event.preventDefault()
        const ops = wordOps(store.doc, pieces, { [name]: !marksOver(store.doc, pieces)[name] })
        try {
          store.apply(ops, { origin: 'selection' })
        } catch (error) {
          console.warn('shellnote: that mark does not fit what the box holds', error)
        }
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        removeChosen(store)
      } else if (event.key === 'Escape') {
        store.select({ blocks: [] }, 'objects')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])

  const tool = useSyncExternalStore(store?.subscribeTool ?? NO_STORE, () => store?.tool ?? 'type')
  const selection = useSyncExternalStore(store?.subscribeSelection ?? NO_STORE, () => store?.selection ?? NOTHING)
  const [marquee, setMarquee] = useState<Area | null>(null)
  const [draft, setDraft] = useState<(DraftSpot & { key: number }) | null>(null)
  const drafts = useRef(0)

  // A page deleted, with all on it, as one undo step: "Page N deleted" and its Undo stay a few seconds, and go as soon
  // as the note changes again, so that Undo only ever takes back the delete. A note keeps one page at least.
  const [gone, setGone] = useState<{ number: number; at: number; doc: Doc } | null>(null)
  const deletePage = (id: Id): void => {
    if (!store) return
    const at = store.doc.pages.indexOf(id)
    if (at < 0 || store.doc.pages.length < 2) return
    try {
      store.apply([{ op: 'page', remove: id }], { origin: 'toolbar' })
    } catch (error) {
      console.warn('shellnote: the page could not be deleted', error)
      return
    }
    setGone({ number: at + 1, at, doc: store.doc })
  }
  useEffect(() => {
    if (!store || !gone) return
    if (store.doc !== gone.doc) {
      setGone(null)
      return
    }
    const timer = window.setTimeout(() => setGone(null), TOAST_MS)
    const off = store.subscribe(() => {
      if (store.doc !== gone.doc) setGone(null)
    })
    return () => {
      window.clearTimeout(timer)
      off()
    }
  }, [store, gone])
  const undoDelete = (): void => {
    if (!store || !gone) return
    setGone(null)
    if (store.doc !== gone.doc || !store.undo()) return
    requestAnimationFrame(() => desk.current?.querySelector(`.nw-page-slot[data-index="${gone.at}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }

  // The Select tool: a box drawn anywhere on a page, even over text or a
  // picture, takes only what is inside it (region.ts). The press is caught on
  // its way down, before the text or the picture under it can take it; only
  // a block placed on the page and chosen alone keeps its press, to be moved.
  useEffect(() => {
    if (!store || tool !== 'select') return
    const el = desk.current!
    const onDown = (event: PointerEvent): void => {
      if (event.button !== 0) return
      const target = event.target as Element
      const sheet = target.closest<HTMLElement>('.nw-page')
      const pageId = sheet?.dataset.page
      const before = store.selectionKind === 'objects' ? store.selection.blocks : []
      // Found now: letting go of the choice below redraws chosen words, taking the element pressed out of the page.
      const hit = blockUnder(store.doc, target)
      // A block placed on the page that is already chosen, alone, moves, or resizes from a corner, as with Type.
      const placed = target.closest<HTMLElement>('[data-free]')
      if (placed?.dataset.selected !== undefined && !event.shiftKey && before.length === 1) return
      ;(document.activeElement as HTMLElement | null)?.blur?.()
      store.select({ blocks: [] }, 'objects')
      // Beside the pages, such as on the scroll bar, the press is the desk's own.
      if (!sheet || pageId === undefined || !store.doc.page[pageId]) return
      event.preventDefault()
      event.stopPropagation()
      const start = { x: event.clientX, y: event.clientY }
      let dragged = false
      const box = (e: PointerEvent): ScreenRect => ({ left: Math.min(start.x, e.clientX), top: Math.min(start.y, e.clientY), right: Math.max(start.x, e.clientX), bottom: Math.max(start.y, e.clientY) })
      const move = (e: PointerEvent): void => {
        if (!dragged && Math.hypot(e.clientX - start.x, e.clientY - start.y) < SLOP) return
        dragged = true
        setMarquee(areaOf(store.doc, pageId, sheet, box(e)))
      }
      const end = (e: PointerEvent): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', end)
        setMarquee(null)
        if (e.type === 'pointercancel' || !store.doc.page[pageId]) return
        if (!dragged) {
          // A click, not a box: it chooses the block under it, or with Shift adds it or lets it go.
          if (hit === undefined || !store.doc.block[hit]) return
          const blocks = !event.shiftKey ? [hit] : before.includes(hit) ? before.filter((id) => id !== hit) : [...before, hit]
          store.select({ blocks }, 'objects')
          return
        }
        store.select(regionChoice(store.doc, pageId, sheet, box(e), areaOf(store.doc, pageId, sheet, box(e))), 'objects')
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', end)
    }
    el.addEventListener('pointerdown', onDown, true)
    return () => el.removeEventListener('pointerdown', onDown, true)
  }, [store, tool])

  /**
   * A press on bare paper, or beside the pages, lets go of what is chosen, or
   * with Shift keeps it. With Type, a click on a page puts the caret on the
   * nearest line, as in Word; with the Free cursor, a caret where it clicks,
   * for a new frame. Blocks handle presses on themselves; the Select tool
   * handles every press itself, above.
   */
  const onPaper = (event: ReactPointerEvent): void => {
    if (!store || event.button !== 0 || tool === 'select' || isInkTool(tool)) return
    const target = event.target as Element
    if (target.closest('[data-id], [data-free], .nw-draft')) return
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    const shift = event.shiftKey
    store.select({ blocks: shift && store.selectionKind === 'objects' ? store.selection.blocks : [] }, 'objects')
    const sheet = target.closest<HTMLElement>('.nw-page')
    const pageId = sheet?.dataset.page
    if (shift || !sheet || pageId === undefined || !store.doc.page[pageId]) return
    if (tool === 'type') {
      // Kept from the browser, which would take the focus back off the text.
      if (caretNear(store.doc, pageId, sheet, event.clientX, event.clientY)) event.preventDefault()
      return
    }
    event.preventDefault()
    const at = areaOf(store.doc, pageId, sheet, { left: event.clientX, top: event.clientY, right: event.clientX, bottom: event.clientY })
    setDraft({ key: ++drafts.current, page: pageId, ...frameSpotAt(store.doc.page[pageId]!, at.x, at.y) })
  }

  // The box of a Select, kept on the page until something else is selected.
  const region = store && store.selectionKind === 'objects' && selection.here && 'page' in selection.here ? selection.here : undefined
  // Room above the first page's own bar: a bar floating over the desk, over two rows, reaches about a gap below
  // `topSpace`, and would cover it. A page scrolled to stops as far down.
  const lead = store && topSpace > 0 ? topSpace + PAGE_GAP : topSpace

  return (
    <div className="nw-desk" ref={desk} data-tool={store ? tool : undefined} onPointerDown={store ? onPaper : undefined}>
      <div className="nw-pages" style={{ padding: PAGE_GAP, paddingTop: PAGE_GAP + lead, gap: PAGE_GAP, '--nw-page-gap': `${PAGE_GAP}px`, '--nw-top-space': `${lead}px` } as CSSProperties}>
        {doc.pages.map((id, i) => {
          const page = doc.page[id]!
          const shown = i >= band.first && i <= band.last
          return (
            <div key={id} className="nw-page-slot" data-index={i} data-shown={shown ? '' : undefined} style={{ width: px(page.w, zoom), height: px(page.h, zoom) }}>
              {shown ? (
                <div className="nw-page-zoom" style={{ transform: `scale(${zoom})`, '--nw-zoom': zoom } as CSSProperties}>
                  <PageBox page={page} doc={doc} assets={pictures} render={store ? render : undefined}>
                    {store && draft?.page === id ? (
                      <DraftFrame
                        key={draft.key}
                        store={store}
                        spot={draft}
                        onDone={() => setDraft((now) => (now?.key === draft.key ? null : now))}
                      />
                    ) : null}
                    {marquee?.page === id ? <div className="nw-marquee" style={{ left: mm(marquee.x), top: mm(marquee.y), width: mm(marquee.w), height: mm(marquee.h) }} /> : null}
                    {!marquee && region?.page === id ? <div className="nw-region" style={{ left: mm(region.x), top: mm(region.y), width: mm(region.w), height: mm(region.h) }} /> : null}
                    {store && doc.media ? <VideoMarks store={store} doc={doc} page={page} /> : null}
                    {store && doc.programs ? <ProgramMarks store={store} doc={doc} page={page} /> : null}
                  </PageBox>
                </div>
              ) : null}
              {store && shown ? (
                <div className="nw-page-bar">
                  <span className="nw-page-number">Page {i + 1}</span>
                  <button
                    type="button"
                    className="nw-page-insert"
                    aria-label={i === 0 ? 'Insert a page before page 1' : `Insert a page between pages ${i} and ${i + 1}`}
                    title="Insert a page here"
                    onClick={() => insertPage(store, i, desk.current)}
                  >
                    <Plus size={14} strokeWidth={2.5} aria-hidden />
                  </button>
                  {doc.pages.length > 1 ? (
                    <button type="button" className="nw-page-delete" aria-label={`Delete page ${i + 1}`} title={`Delete page ${i + 1}`} onClick={() => deletePage(id)}>
                      <Trash2 size={14} aria-hidden />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
        {store ? (
          <button type="button" className="nw-add-page" aria-label="Add a page" title="Add a page at the end, like the last one" onClick={() => insertPage(store, doc.pages.length, desk.current)}>
            <Plus size={22} strokeWidth={2.5} aria-hidden />
          </button>
        ) : null}
      </div>
      {store ? <PenLayer store={store} desk={desk} zoom={zoom} onZoom={onZoom} /> : null}
      {gone
        ? createPortal(
            <div className="nw-page-toast" role="status">
              <span>Page {gone.number} deleted</span>
              <button type="button" className="nw-page-toast-action" aria-label={`Undo deleting page ${gone.number}`} data-command="edit.undo" onClick={undoDelete}>
                Undo
              </button>
              <button type="button" className="nw-ibtn" aria-label="Dismiss" onClick={() => setGone(null)}>
                <X size={14} aria-hidden />
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
