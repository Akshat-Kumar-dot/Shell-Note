// The board on the screen (the Board, step 2): its one endless page under a camera that moves and zooms over it, with
// no edge (camera.ts). Steps are drawn by core's outlines with their words where core measured them, links by core's
// routes with their words where core placed them knowing every link (drawing.ts); text boxes, ink and pictures as on a
// page. Only what lies near the view is drawn.
//
// What a press does:
//   the Hand, Space held, the middle button, a finger on the bare board    moves the board
//   Ctrl and the wheel, a touchpad's pinch, two fingers                     zoom about the pointer
//   the wheel alone                                                         moves the board (with Shift, across)
//   Select, on a step, a text box, ink or a picture                         chooses it (with Shift, adds it or lets it
//                                                                           go); a drag moves what is chosen, a step's
//                                                                           middle to the nearest dot (Alt: freely)
//   Select, on a link                                                       chooses the link
//   Select, a drag on the bare board                                        chooses what lies wholly inside the box
//   a corner of the one chosen step, picture or text box                    sizes it (a text box, its width)
//   Step, a drag on the bare board, or a click                              a step of the tool's shape over the box
//                                                                           dragged, or of the usual size, the caret in it
//   Step, a drag from a step; any tool, a drag from a step's point          a link: let go on another step, the two are
//                                                                           joined; on the bare board, a step of the same
//                                                                           shape is made there, joined
//   a drag of a chosen link's end onto another step                         that end moves there, its words and look kept
//   Text, a click on the bare board; on a step or a text box                a text box there; types in it
//   a double-click on a step, a text box or a link                          types its words
// While a link is drawn, only a straight line from where it began to the pointer shows, and the step it would join
// shows its points, the one it will use marked: code chooses the sides (bd19a). Points show on the chosen step, on every
// step while the Step tool is in hand, and at the ends of a chosen link; never because the pointer stays near a step,
// and never in a link's middle (the patents check, rules 1 and 7); Customise turns them off.
// Tab adds a step after the chosen one, Enter types its words, Delete removes what is chosen, Escape stops typing and
// then lets go, the arrows move what is chosen 1 mm (with Shift, 5 mm). Each change is one undo step. Where the view was
// left is kept on this device, never in the note.
import { apply, boardLinks, drawnBox, grown, idTaken, isEndless, joinNewOps, joinOps, labelSize, linkKey, linkRoute, moveEndOps, moveOps, newId, newStepOp, nodeAt, nodeSize, overlaps, portOf, routeLink, type Box, type Doc, type DrawnLink, type FreeBlock, type Id, type InkBlock, type NodeBlock, type Op, type Point, type Side } from '@shellnote/core'
import { TextSelection } from '@tiptap/pm/state'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { FrameView, InkView, PlacedView, type AssetUrls } from '../blocks.js'
import { CORNERS, type Corner } from '../drag.js'
import { focusAt, frameEditors } from '../frame/active.js'
import { DraftFrame, type DraftSpot } from '../frame/DraftFrame.js'
import { FrameEditor } from '../frame/FrameEditor.js'
import { mm } from '../geometry.js'
import { boardPoints } from '../layout/custom.js'
import { heightOp } from '../overflow.js'
import { removeChosen, toggleChosen } from '../selection.js'
import type { EditorStore } from '../store.js'
import { chosenLink, linkWordsAsked, onScreen, typingStep } from './active.js'
import { centredOn, clampBoardZoom, fitting, panBy, pxPerUnit, seen, toBoard, toDot, zoomAt, type Camera } from './camera.js'
import { LinkLayer } from './LinkLayer.js'
import { addStepAfter } from './next.js'
import { StepView } from './StepView.js'
import { StepWords } from './StepWords.js'

export interface BoardViewProps {
  doc: Doc
  zoom: number
  onZoom?: ((zoom: number) => void) | undefined
  assets?: AssetUrls | undefined
  store?: EditorStore | undefined
}

const NO_ASSETS: AssetUrls = {}
const NO_STORE = (): (() => void) => () => {}
const NONE = { blocks: [] as Id[] }
/** How far a pointer travels, in screen pixels, before a press becomes a drag. */
const SLOP = 3
/** The arrow keys move what is chosen 1 mm, or 5 mm with Shift. */
const NUDGE = 100
const ARROWS: Readonly<Record<string, readonly [number, number]>> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
/** The smallest a corner makes a picture: 5 mm on its shorter side. */
const MIN_SIDE = 500
/** The narrowest a corner makes a text box: 20 mm. */
const MIN_TEXT = 2000
/** A text box the Text tool puts on the board: 60 mm wide, its first line on the point clicked. */
const TEXT_BOX = 6000
const HALF_LINE = 300
/** Room round ink, so the ends of its strokes are never cut: 5 mm. */
const INK_ROOM = 500
/** A line on the wheel, in pixels, for a wheel that counts lines. */
const WHEEL_LINE = 16
/** The four points where links join a step: the middle of each side. */
const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left']

/** Where the view of each board was left, on this device. */
const viewKey = (id: Id): string => `shellnote:board-view:${id}`
function savedView(id: Id): Camera | undefined {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(viewKey(id)) ?? 'null')
    if (typeof value !== 'object' || value === null) return undefined
    const { x, y, zoom } = value as Record<string, unknown>
    return typeof x === 'number' && typeof y === 'number' && typeof zoom === 'number' && Number.isFinite(x + y + zoom) ? { x, y, zoom: clampBoardZoom(zoom) } : undefined
  } catch {
    return undefined
  }
}
function saveView(id: Id, camera: Camera): void {
  try {
    localStorage.setItem(viewKey(id), JSON.stringify({ x: Math.round(camera.x), y: Math.round(camera.y), zoom: camera.zoom }))
  } catch {
    // Storage is off: the view is found again the next time.
  }
}

/** A block's box on the board; a text box at least a line high. */
const boxOf = (block: FreeBlock): Box => ({ x: block.x, y: block.y, w: block.w, h: block.type === 'frame' ? Math.max(block.h, 900) : block.h })

/** The box round everything on a board's page; none on an empty board. */
function contentBox(doc: Doc, free: readonly Id[]): Box | undefined {
  let box: { x0: number; y0: number; x1: number; y1: number } | undefined
  for (const id of free) {
    const block = doc.block[id]
    if (!block || !('page' in block)) continue
    const b = boxOf(block)
    box = box ? { x0: Math.min(box.x0, b.x), y0: Math.min(box.y0, b.y), x1: Math.max(box.x1, b.x + b.w), y1: Math.max(box.y1, b.y + b.h) } : { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h }
  }
  return box && { x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0 }
}

/** The block placed on the board that holds a chosen one: a text box for its paragraphs, else itself. */
function ownerOf(doc: Doc, id: Id): FreeBlock | undefined {
  const block = doc.block[id]
  if (!block) return undefined
  if ('parent' in block) {
    const frame = doc.block[block.parent]
    return frame && 'page' in frame ? frame : undefined
  }
  return 'page' in block ? block : undefined
}

/** The step a block is or belongs to: a step itself, or the step ink is written on. */
function stepOf(doc: Doc, block: FreeBlock | undefined): NodeBlock | undefined {
  if (block?.type === 'node') return block
  if (block?.type !== 'ink' || block.on === undefined) return undefined
  const on = doc.block[block.on]
  return on?.type === 'node' ? on : undefined
}

/** What a press chooses: a text box's paragraphs, else the block. */
function chosenIds(doc: Doc, block: FreeBlock): Id[] {
  return block.type === 'frame' ? (block.kids.length > 0 ? block.kids : [block.id]) : [block.id]
}

/** The moves that take some blocks of a board `dx`, `dy` along: a step with the ink on it, the rest as they are. */
function movesOf(doc: Doc, owners: readonly FreeBlock[], dx: number, dy: number): Op[] {
  if (dx === 0 && dy === 0) return []
  const steps = new Set(owners.filter((block) => block.type === 'node').map((block) => block.id))
  const ops = moveOps(doc, steps, dx, dy)
  for (const block of owners) {
    if (block.type === 'node' || (block.type === 'ink' && block.on !== undefined && steps.has(block.on))) continue
    ops.push({ op: 'move', id: block.id, to: { page: block.page, x: block.x + dx, y: block.y + dy } })
  }
  return ops
}

/** A box made by dragging one corner of another, `dx`, `dy` along; a picture keeps its shape. */
function sizedBox(from: Box, corner: Corner, dx: number, dy: number, keepShape: boolean, least: { w: number; h: number }): Box {
  const west = corner === 'nw' || corner === 'sw'
  const north = corner === 'nw' || corner === 'ne'
  let w = Math.max(least.w, from.w + (west ? -dx : dx))
  let h = Math.max(least.h, from.h + (north ? -dy : dy))
  if (keepShape) {
    const ratio = from.w / from.h
    if (w / h > ratio) h = Math.max(least.h, w / ratio)
    else w = Math.max(least.w, h * ratio)
  }
  w = Math.round(w)
  h = Math.round(h)
  return { x: west ? from.x + from.w - w : from.x, y: north ? from.y + from.h - h : from.y, w, h }
}

/** A board's links while some steps are being moved or sized: those of the steps in hand run from where they are going. */
function linksLive(links: readonly DrawnLink[], doc: Doc, boxes: ReadonlyMap<Id, Box>): DrawnLink[] {
  return links.map((link) => {
    const [a, b] = [boxes.get(link.from), boxes.get(link.to)]
    if (!a && !b) return link
    const from = doc.block[link.from] as NodeBlock
    const to = doc.block[link.to] as NodeBlock
    const route = routeLink({ shape: from.shape, box: a ?? from }, { shape: to.shape, box: b ?? to }, link.flow, link.link.path)
    if (!link.label) return { ...link, route }
    const size = labelSize(link.link.label ?? '')
    return { ...link, route, label: { x: Math.round(route.label.x - size.w / 2), y: Math.round(route.label.y - size.h / 2), ...size } }
  })
}

/** Whether a point lies on a text box, a picture, a formula or a diagram: not the bare board, where a link makes a step. */
function onBlock(doc: Doc, free: readonly Id[], point: Point): boolean {
  return free.some((id) => {
    const block = doc.block[id]
    if (!block || !('page' in block) || block.type === 'node' || block.type === 'ink') return false
    const b = boxOf(block)
    return point.x >= b.x && point.x <= b.x + b.w && point.y >= b.y && point.y <= b.y + b.h
  })
}

/** A link being drawn or one of its ends moved: what letting it go would do, to mark the point it will join. */
type Joining = { kind: 'link'; from: Id } | { kind: 'end'; link: { from: Id; to: Id }; end: 'from' | 'to' }

/** The point a link let go on a step would join it by, as code will run it; none when nothing would be joined. */
function joinPoint(doc: Doc, joining: Joining, onto: Id): Point | undefined {
  if (joining.kind === 'link') return linkRoute(doc, joining.from, onto)?.points.at(-1)
  const { link, end } = joining
  const ops = moveEndOps(doc, link.from, link.to, end, onto)
  if (ops.length === 0) return undefined
  try {
    const after = apply(doc, ops).doc
    return end === 'to' ? linkRoute(after, link.from, onto)?.points.at(-1) : linkRoute(after, onto, link.to)?.points[0]
  } catch {
    return undefined
  }
}

/** A drag under way. */
type Drag =
  | { kind: 'pan'; pointer: number; x: number; y: number; camera: Camera }
  | { kind: 'move'; pointer: number; x: number; y: number; owners: FreeBlock[]; lead: Box; going: boolean }
  | { kind: 'size'; pointer: number; x: number; y: number; block: FreeBlock; corner: Corner }
  | { kind: 'box'; pointer: number; x: number; y: number; start: Point; going: boolean; shift: boolean; before: Id[] }
  | { kind: 'draw'; pointer: number; x: number; y: number; start: Point; going: boolean }
  | { kind: 'join'; pointer: number; x: number; y: number; joining: Joining; start: Point; going: boolean; target?: Id | undefined; port?: Point | undefined }

/** What a drag shows before it is let go. */
type Live =
  | { kind: 'move'; dx: number; dy: number; ids: ReadonlySet<Id> }
  | { kind: 'size'; id: Id; box: Box }
  | { kind: 'box'; box: Box }
  | { kind: 'draw'; box: Box }
  | { kind: 'line'; from: Point; to: Point; target?: Id | undefined; port?: Point | undefined; moving?: string | undefined }
  | undefined

export function BoardView({ doc: given, zoom, onZoom, assets = NO_ASSETS, store }: BoardViewProps) {
  const doc = useSyncExternalStore(store?.subscribe ?? NO_STORE, () => (store ? store.doc : given))
  const pictures = useSyncExternalStore(store?.assets.subscribe ?? NO_STORE, () => store?.assets.snapshot() ?? assets)
  const selection = useSyncExternalStore(store?.subscribeSelection ?? NO_STORE, () => store?.selection ?? NONE)
  const tool = useSyncExternalStore(store?.subscribeTool ?? NO_STORE, () => store?.tool ?? 'select')
  const link = useSyncExternalStore(chosenLink.subscribe, chosenLink.snapshot)
  const typing = useSyncExternalStore(typingStep.subscribe, typingStep.snapshot)
  const pointsOn = useSyncExternalStore(boardPoints.subscribe, boardPoints.snapshot)
  const pageId = doc.pages[0]!
  const page = doc.page[pageId]
  const free = page?.free ?? []
  const desk = useRef<HTMLDivElement>(null)
  const arrow = `nw-arrow-${useId().replace(/:/gu, '')}`

  // ----- the camera -----------------------------------------------------------------
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [camera, setCameraState] = useState<Camera | undefined>(undefined)
  const cameraRef = useRef<Camera | undefined>(undefined)
  const sizeRef = useRef(size)
  sizeRef.current = size
  const docRef = useRef(doc)
  docRef.current = doc
  const saving = useRef(0)
  const setCamera = useCallback(
    (next: Camera): void => {
      cameraRef.current = next
      setCameraState(next)
      window.clearTimeout(saving.current)
      saving.current = window.setTimeout(() => saveView(docRef.current.id, next), 300)
    },
    [],
  )
  /** A zoom the board itself made: told to the workspace, which shows it, and never applied twice. */
  const zoomTo = useCallback(
    (next: Camera): void => {
      setCamera(next)
      if (onZoom) onZoom(next.zoom)
    },
    [setCamera, onZoom],
  )

  useLayoutEffect(() => {
    const el = desk.current!
    const measure = (): void => setSize((now) => (now.w === el.clientWidth && now.h === el.clientHeight ? now : { w: el.clientWidth, h: el.clientHeight }))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Where the board opens: where it was left on this device; the first time, all of it in view.
  useLayoutEffect(() => {
    if (cameraRef.current || size.w === 0 || size.h === 0) return
    const box = contentBox(doc, free)
    const start = savedView(doc.id) ?? (box ? fitting(box, size.w, size.h) : centredOn({ x: 0, y: 0 }, size.w, size.h, 1))
    zoomTo(start)
    // Once, when the view first has a size.
  }, [size])

  // A zoom from elsewhere (the Zoom menu, a command, the keys): about the middle of the view.
  useLayoutEffect(() => {
    const now = cameraRef.current
    if (!now || Math.abs(now.zoom - zoom) < 1e-9) return
    const next = clampBoardZoom(zoom)
    setCamera(zoomAt(now, next, sizeRef.current.w / 2, sizeRef.current.h / 2))
    if (next !== zoom && onZoom) onZoom(next)
  }, [zoom, onZoom, setCamera])

  // For what acts on the view from outside it: the whole board, the middle, a block brought into view.
  useEffect(() => {
    onScreen({
      fit: () => {
        const box = contentBox(docRef.current, docRef.current.page[pageId]?.free ?? [])
        const { w, h } = sizeRef.current
        const next = box ? fitting(box, w, h) : centredOn({ x: 0, y: 0 }, w, h, 1)
        zoomTo(next)
        return next.zoom
      },
      middle: () => {
        const now = cameraRef.current
        const { w, h } = sizeRef.current
        return now ? toBoard(now, w / 2, h / 2) : { x: 0, y: 0 }
      },
      show: (id) => {
        const block = ownerOf(docRef.current, id)
        const now = cameraRef.current
        if (!block || !now) return
        const box = boxOf(block)
        setCamera(centredOn({ x: box.x + box.w / 2, y: box.y + box.h / 2 }, sizeRef.current.w, sizeRef.current.h, now.zoom))
      },
    })
    return () => onScreen(undefined)
  }, [pageId, setCamera, zoomTo])

  // A step's words typed in place belong to this board alone: none is typed once it is gone.
  useEffect(() => () => typingStep.set(undefined), [])

  // ----- moving and zooming by the wheel ---------------------------------------------
  useEffect(() => {
    const el = desk.current!
    const onWheel = (event: WheelEvent): void => {
      const now = cameraRef.current
      if (!now) return
      event.preventDefault()
      const scale = event.deltaMode === 1 ? WHEEL_LINE : event.deltaMode === 2 ? el.clientHeight : 1
      if (event.ctrlKey || event.metaKey) {
        const rect = el.getBoundingClientRect()
        zoomTo(zoomAt(now, clampBoardZoom(now.zoom * Math.exp(-event.deltaY * scale * 0.0015)), event.clientX - rect.left, event.clientY - rect.top))
        return
      }
      const [dx, dy] = event.shiftKey && event.deltaX === 0 ? [event.deltaY, 0] : [event.deltaX, event.deltaY]
      setCamera(panBy(now, -dx * scale, -dy * scale))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setCamera, zoomTo])

  // ----- a text box's height, written as it is drawn ----------------------------------
  // As on a page (overflow.ts), joined to the change that made it: a board has no page to push words onto.
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
        const now = cameraRef.current
        if (!lastRecorded || !now) return
        const k = pxPerUnit(now.zoom)
        const ops = ids.flatMap((id) => {
          const block = store.doc.block[id]
          const drawn = desk.current?.querySelector(`.nw-frame[data-id="${CSS.escape(id)}"]`)
          const op = block?.type === 'frame' && drawn ? heightOp(block, drawn.getBoundingClientRect().height / k) : undefined
          return op ? [op] : []
        })
        if (ops.length === 0) return
        try {
          store.apply(ops, { origin: 'layout', join: true })
        } catch (error) {
          console.warn('shellnote: a text box’s height could not be written', error)
        }
      })
    })
    return () => {
      stop()
      cancelAnimationFrame(request)
    }
  }, [store])

  // ----- what is drawn --------------------------------------------------------------
  const links = useMemo(() => boardLinks(doc, pageId), [doc, pageId])
  const [live, setLive] = useState<Live>(undefined)
  const [draft, setDraft] = useState<(DraftSpot & { key: number }) | undefined>(undefined)
  const drafts = useRef(0)
  const owners = useMemo(() => {
    const seenIds = new Set<Id>()
    const list: FreeBlock[] = []
    for (const id of store?.selectionKind === 'objects' ? selection.blocks : []) {
      const owner = ownerOf(doc, id)
      if (owner && !seenIds.has(owner.id)) {
        seenIds.add(owner.id)
        list.push(owner)
      }
    }
    return list
  }, [doc, selection, store])
  const chosenKey = link && doc.block[link.from]?.type === 'node' && (doc.block[link.from] as NodeBlock).to?.some((one) => one.node === link.to) ? linkKey(link.from, link.to) : undefined

  // A chosen link that is gone is let go.
  useEffect(() => {
    if (link && chosenKey === undefined) chosenLink.set(undefined)
  }, [link, chosenKey])

  // Words done, the keys are the board's again: Tab, Delete and the arrows reach what is chosen.
  const wasTyping = useRef(typing)
  useEffect(() => {
    const was = wasTyping.current
    wasTyping.current = typing
    if (was !== undefined && typing === undefined && (document.activeElement === null || document.activeElement === document.body)) desk.current?.focus({ preventScroll: true })
  }, [typing])

  /** A block's box as drawn now: where a drag is taking it. */
  const liveBox = (block: FreeBlock): Box => {
    const box = boxOf(block)
    if (live?.kind === 'size' && live.id === block.id) return live.box
    if (live?.kind === 'move') {
      const moving = live.ids.has(block.id) || (block.type === 'ink' && block.on !== undefined && live.ids.has(block.on))
      if (moving) return { ...box, x: box.x + live.dx, y: box.y + live.dy }
    }
    return box
  }

  const drawnLinks = useMemo(() => {
    if (live?.kind !== 'move' && live?.kind !== 'size') return links
    const boxes = new Map<Id, Box>()
    if (live.kind === 'size') boxes.set(live.id, live.box)
    else
      for (const id of live.ids) {
        const block = doc.block[id]
        if (block?.type === 'node') boxes.set(id, { x: block.x + live.dx, y: block.y + live.dy, w: block.w, h: block.h })
      }
    return boxes.size === 0 ? links : linksLive(links, doc, boxes)
  }, [links, live, doc])

  // ----- presses ---------------------------------------------------------------------
  const drag = useRef<Drag | undefined>(undefined)
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ distance: number; middle: { x: number; y: number }; camera: Camera } | undefined>(undefined)
  const space = useRef(false)
  const [panning, setPanning] = useState(false)

  /** A point of the screen as a point of the view, and of the board. */
  const where = (event: { clientX: number; clientY: number }): { view: { x: number; y: number }; board: { x: number; y: number } } => {
    const rect = desk.current!.getBoundingClientRect()
    const view = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    return { view, board: cameraRef.current ? toBoard(cameraRef.current, view.x, view.y) : view }
  }

  const run = (ops: Op[], key?: string): boolean => {
    if (!store || ops.length === 0) return false
    try {
      store.apply(ops, { origin: 'board', ...(key === undefined ? {} : { key }) })
      return true
    } catch (error) {
      console.warn('shellnote: the board could not be changed', error)
      return false
    }
  }

  /** An id no block of the note has. */
  const fresh = (): Id => newId((candidate) => idTaken(store!.doc, candidate))

  /** A step just made by hand: chosen, the caret in its words. */
  const typeNew = (id: Id): void => {
    store?.select({ blocks: [id] }, 'objects')
    typingStep.set(id)
  }

  const letGo = (): void => {
    store?.select({ blocks: [] }, 'objects')
    chosenLink.set(undefined)
  }

  /** The caret in a text box: where it was pressed, or else at the end of its words. */
  const typeIn = (frameId: Id, at?: { clientX: number; clientY: number }): void => {
    const editor = frameEditors.get(frameId)
    if (!editor) return
    // Focused, the box takes presses (the board's styles), so the point pressed can be found in its words.
    editor.view.focus()
    const pos = at ? editor.view.posAtCoords({ left: at.clientX, top: at.clientY }) : null
    if (pos) editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(pos.pos))))
    else focusAt(editor)
  }

  const startPinch = (): void => {
    const [a, b] = [...touches.current.values()]
    if (!a || !b || !cameraRef.current) return
    // Two fingers: whatever one finger began is given up.
    drag.current = undefined
    setLive(undefined)
    pinch.current = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), middle: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, camera: cameraRef.current }
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!cameraRef.current) return
    const target = event.target as Element
    // The board's own controls, a link inside a step's words, and words being typed keep their presses.
    if (target.closest('button, input, select, textarea, a[href], .ProseMirror')) return
    const { view, board } = where(event)
    if (event.pointerType === 'touch') {
      touches.current.set(event.pointerId, view)
      if (touches.current.size === 2) {
        startPinch()
        return
      }
    }
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    desk.current!.focus({ preventScroll: true })
    const begin = (next: Drag): void => {
      drag.current = next
      desk.current!.setPointerCapture(event.pointerId)
      event.preventDefault()
    }
    const pan = (): void => begin({ kind: 'pan', pointer: event.pointerId, x: event.clientX, y: event.clientY, camera: cameraRef.current! })
    if (event.button === 1 || space.current || tool === 'hand') return pan()
    if (event.button !== 0 || !store) return

    // A point where links join: from a step's, a drag draws a link; from a chosen link's end, it moves that end.
    const point = target.closest<HTMLElement>('[data-point]')
    if (point) {
      const at = { x: Number(point.dataset.x), y: Number(point.dataset.y) }
      const chosen = chosenLink.value
      if (point.dataset.end && chosen) {
        const end = point.dataset.end as 'from' | 'to'
        const drawn = drawnLinks.find((one) => one.from === chosen.from && one.to === chosen.to)
        // The line runs from the end that stays.
        const fixed = drawn ? (end === 'to' ? drawn.route.points[0]! : drawn.route.points.at(-1)!) : at
        return begin({ kind: 'join', pointer: event.pointerId, x: event.clientX, y: event.clientY, joining: { kind: 'end', link: chosen, end }, start: fixed, going: false })
      }
      if (point.dataset.step) return begin({ kind: 'join', pointer: event.pointerId, x: event.clientX, y: event.clientY, joining: { kind: 'link', from: point.dataset.step }, start: at, going: false })
    }

    // A corner of the one chosen block: it is sized.
    const corner = target.closest<HTMLElement>('[data-corner]')?.dataset.corner as Corner | undefined
    if (corner && owners.length === 1) return begin({ kind: 'size', pointer: event.pointerId, x: event.clientX, y: event.clientY, block: owners[0]!, corner })

    // A link: chosen alone.
    const linkEl = target.closest<SVGGElement>('.nw-link')
    if (linkEl?.dataset.from && linkEl.dataset.to) {
      store.select({ blocks: [] }, 'objects')
      chosenLink.set({ from: linkEl.dataset.from, to: linkEl.dataset.to })
      return
    }

    const id = target.closest<HTMLElement>('[data-id]')?.dataset.id
    const block = id === undefined ? undefined : ownerOf(doc, id)
    const step = stepOf(doc, block)

    // The Step tool: from a step, a link; on the bare board (or ink on it), a step.
    if (tool === 'step') {
      if (step) return begin({ kind: 'join', pointer: event.pointerId, x: event.clientX, y: event.clientY, joining: { kind: 'link', from: step.id }, start: board, going: false })
      if (block && block.type !== 'ink') return
      if (event.pointerType === 'touch') return pan()
      chosenLink.set(undefined)
      return begin({ kind: 'draw', pointer: event.pointerId, x: event.clientX, y: event.clientY, start: board, going: false })
    }

    // The Text tool: a click types in a step or a text box, or puts a text box on the bare board.
    if (tool === 'free') {
      event.preventDefault()
      chosenLink.set(undefined)
      if (step) return typeNew(step.id)
      if (block?.type === 'frame') return typeIn(block.id, event)
      if (block && block.type !== 'ink') return
      if (event.pointerType === 'touch') return pan()
      letGo()
      setDraft({ key: ++drafts.current, page: pageId, x: Math.round(board.x), y: Math.round(board.y - HALF_LINE), w: TEXT_BOX })
      return
    }

    // A block: chosen, and what is chosen moves with the drag.
    if (block) {
      chosenLink.set(undefined)
      const ids = chosenIds(doc, block)
      const already = owners.some((owner) => owner.id === block.id)
      if (event.shiftKey) {
        for (const one of ids) toggleChosen(store, one)
        return
      }
      if (!already) store.select({ blocks: ids }, 'objects')
      // A finger on a block not chosen yet chooses it, and a drag then moves the board: only what is chosen moves.
      if (event.pointerType === 'touch' && !already) return pan()
      const moving = already ? owners : [block]
      return begin({ kind: 'move', pointer: event.pointerId, x: event.clientX, y: event.clientY, owners: moving, lead: boxOf(block), going: false })
    }

    // The bare board: a finger moves it; the mouse and the pen draw a box that chooses what lies wholly inside.
    if (event.pointerType === 'touch') return pan()
    chosenLink.set(undefined)
    const before = event.shiftKey && store.selectionKind === 'objects' ? store.selection.blocks : []
    if (!event.shiftKey) store.select({ blocks: [] }, 'objects')
    begin({ kind: 'box', pointer: event.pointerId, x: event.clientX, y: event.clientY, start: board, going: false, shift: event.shiftKey, before })
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'touch' && touches.current.has(event.pointerId)) {
      touches.current.set(event.pointerId, where(event).view)
      const p = pinch.current
      if (p && touches.current.size >= 2) {
        const [a, b] = [...touches.current.values()] as [{ x: number; y: number }, { x: number; y: number }]
        const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const zoomNow = clampBoardZoom(p.camera.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / p.distance))
        zoomTo(panBy(zoomAt(p.camera, zoomNow, p.middle.x, p.middle.y), middle.x - p.middle.x, middle.y - p.middle.y))
        return
      }
    }
    const d = drag.current
    if (d?.pointer !== event.pointerId) return
    const dx = event.clientX - d.x
    const dy = event.clientY - d.y
    if (d.kind === 'pan') {
      setCamera(panBy(d.camera, dx, dy))
      return
    }
    const k = pxPerUnit(cameraRef.current!.zoom)
    if (d.kind === 'move') {
      if (!d.going && Math.hypot(dx, dy) < SLOP) return
      d.going = true
      let [mx, my] = [Math.round(dx / k), Math.round(dy / k)]
      // A step's middle goes to the nearest dot of the paper; with Alt, where it is let go.
      if (!event.altKey && d.owners.some((owner) => owner.type === 'node')) {
        const lead = d.owners.find((owner) => owner.type === 'node')!
        mx = toDot(lead.x + lead.w / 2 + mx) - (lead.x + lead.w / 2)
        my = toDot(lead.y + lead.h / 2 + my) - (lead.y + lead.h / 2)
      }
      setLive({ kind: 'move', dx: mx, dy: my, ids: new Set(d.owners.map((owner) => owner.id)) })
      return
    }
    if (d.kind === 'size') {
      const block = d.block
      const from = boxOf(block)
      if (block.type === 'frame') {
        // A text box is sized across: its words fill its height.
        const box = sizedBox(from, d.corner, dx / k, 0, false, { w: MIN_TEXT, h: from.h })
        setLive({ kind: 'size', id: block.id, box: { ...box, y: from.y, h: from.h } })
        return
      }
      const least = block.type === 'node' ? nodeSize(block.shape, block.md) : { w: MIN_SIDE, h: MIN_SIDE }
      setLive({ kind: 'size', id: block.id, box: sizedBox(from, d.corner, dx / k, dy / k, block.type === 'image', least) })
      return
    }
    const { board } = where(event)
    if (!d.going && Math.hypot(dx, dy) < SLOP) return
    d.going = true
    if (d.kind === 'join' && store) {
      // The step it would join: under the pointer, never the one it leaves, nor (an end moved) the one at its other end.
      const { joining } = d
      const fixed = joining.kind === 'link' ? joining.from : joining.end === 'to' ? joining.link.from : joining.link.to
      const over = nodeAt(store.doc, pageId, board.x, board.y, new Set([fixed]))
      if (over?.id !== d.target) {
        d.target = over?.id
        d.port = over && pointsOn ? joinPoint(store.doc, joining, over.id) : undefined
      }
      setLive({ kind: 'line', from: d.start, to: board, target: d.target, port: d.port, moving: joining.kind === 'end' ? linkKey(joining.link.from, joining.link.to) : undefined })
      return
    }
    // A box: from where it began to the pointer, to choose what lies inside it, or to draw a step over.
    const { start } = d
    const box = { x: Math.min(start.x, board.x), y: Math.min(start.y, board.y), w: Math.abs(board.x - start.x), h: Math.abs(board.y - start.y) }
    setLive({ kind: d.kind === 'draw' ? 'draw' : 'box', box })
  }

  const finish = (event: ReactPointerEvent<HTMLDivElement>): void => {
    touches.current.delete(event.pointerId)
    if (touches.current.size < 2) pinch.current = undefined
    const d = drag.current
    if (d?.pointer !== event.pointerId) return
    drag.current = undefined
    const shown = live
    setLive(undefined)
    if (event.type === 'pointercancel' || !store) return
    if (d.kind === 'move' && shown?.kind === 'move') run(movesOf(store.doc, d.owners, shown.dx, shown.dy))
    else if (d.kind === 'size' && shown?.kind === 'size') {
      const ops: Op[] = []
      const from = boxOf(d.block)
      if (shown.box.x !== from.x || shown.box.y !== from.y || shown.box.w !== from.w || shown.box.h !== from.h) {
        // A text box keeps the height its words give it: only its place across and its width change.
        const to = d.block.type === 'frame' ? { page: d.block.page, x: shown.box.x, y: d.block.y, w: shown.box.w } : { page: d.block.page, ...shown.box }
        ops.push({ op: 'move', id: d.block.id, to })
      }
      run(ops)
    } else if (d.kind === 'draw') {
      // A step of the tool's shape: over the box dragged, or of the usual size where it was clicked.
      const { board } = where(event)
      const shape = store.stepShape
      const id = fresh()
      if (run([newStepOp(pageId, drawnBox(shape, d.start, d.going ? board : undefined, event.altKey), shape, id)])) typeNew(id)
    } else if (d.kind === 'join') {
      const { joining } = d
      if (!d.going) {
        // A click on a step with the Step tool chooses it.
        if (joining.kind === 'link' && tool === 'step') store.select({ blocks: [joining.from] }, 'objects')
        return
      }
      const { board } = where(event)
      const fixed = joining.kind === 'link' ? joining.from : joining.end === 'to' ? joining.link.from : joining.link.to
      const onto = nodeAt(store.doc, pageId, board.x, board.y, new Set([fixed]))
      if (joining.kind === 'end') {
        const { link: was, end } = joining
        if (onto && run(moveEndOps(store.doc, was.from, was.to, end, onto.id))) chosenLink.set(end === 'to' ? { from: was.from, to: onto.id } : { from: onto.id, to: was.to })
        return
      }
      if (onto) {
        run(joinOps(store.doc, joining.from, onto.id))
        return
      }
      // Let go on a text box or a picture, nothing is made; on the bare board, a step of the same shape, joined.
      if (onBlock(store.doc, free, board)) return
      const id = fresh()
      const ops = joinNewOps(store.doc, joining.from, board, event.altKey, id)
      if (ops && run(ops)) typeNew(id)
    } else if (d.kind === 'box') {
      if (shown?.kind !== 'box') {
        if (!d.shift) letGo()
        return
      }
      const inside = free.flatMap((id) => {
        const block = store.doc.block[id]
        if (!block || !('page' in block)) return []
        const b = boxOf(block)
        const box = shown.box
        return b.x >= box.x && b.y >= box.y && b.x + b.w <= box.x + box.w && b.y + b.h <= box.y + box.h ? chosenIds(store.doc, block) : []
      })
      store.select({ blocks: [...new Set([...d.before, ...inside])] }, 'objects')
    }
  }

  /** A double-click types: a step's words, a text box's, or a link's in the row. */
  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (!store || tool === 'hand' || space.current) return
    // What lies under the pointer: the board held the pointer for the presses before, so the event is its own.
    const target = document.elementFromPoint(event.clientX, event.clientY) ?? (event.target as Element)
    if (target.closest('button, input, select, textarea, a[href], .ProseMirror, [data-point], [data-corner]')) return
    const linkEl = target.closest<SVGGElement>('.nw-link')
    if (linkEl?.dataset.from && linkEl.dataset.to) {
      store.select({ blocks: [] }, 'objects')
      chosenLink.set({ from: linkEl.dataset.from, to: linkEl.dataset.to })
      linkWordsAsked.set(linkWordsAsked.value + 1)
      return
    }
    const id = target.closest<HTMLElement>('[data-id]')?.dataset.id
    const block = id === undefined ? undefined : ownerOf(store.doc, id)
    const step = stepOf(store.doc, block)
    if (step) typeNew(step.id)
    else if (block?.type === 'frame') typeIn(block.id, event)
  }

  // ----- keys ----------------------------------------------------------------------------
  useEffect(() => {
    if (!store) return
    const typed = (event: KeyboardEvent): boolean => {
      const target = event.target instanceof Element ? event.target : null
      return target?.closest('input, textarea, select, [contenteditable="true"], .ProseMirror') != null
    }
    /** The one step chosen, alone. */
    const oneStep = (): NodeBlock | undefined => {
      const blocks = store.selectionKind === 'objects' ? store.selection.blocks : []
      const block = blocks.length === 1 ? store.doc.block[blocks[0]!] : undefined
      return block?.type === 'node' ? block : undefined
    }
    /** The one text box chosen: its paragraphs, or itself when it has none. */
    const oneBox = (): Id | undefined => {
      const blocks = store.selectionKind === 'objects' ? store.selection.blocks : []
      const frames = new Set(blocks.map((id) => ownerOf(store.doc, id)).map((owner) => (owner?.type === 'frame' ? owner.id : undefined)))
      return frames.size === 1 && !frames.has(undefined) ? [...frames][0] : undefined
    }
    /**
     * Escape in a text box of the board: typing stops, and the box is chosen. Taken before the words' own keys, which
     * would choose the line the caret is in; an open menu takes it first.
     */
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('.sh-menu, .nw-popover')) return
      const target = event.target instanceof Element ? event.target : null
      if (!target || !desk.current?.contains(target) || !target.closest('.nw-frame .ProseMirror')) return
      event.preventDefault()
      event.stopPropagation()
      const frameId = target.closest<HTMLElement>('.nw-frame')?.dataset.id
      const frame = frameId === undefined ? undefined : store.doc.block[frameId]
      ;(target as HTMLElement).blur?.()
      store.select({ blocks: frame?.type === 'frame' ? chosenIds(store.doc, frame) : [] }, 'objects')
      desk.current.focus({ preventScroll: true })
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || typed(event)) return
      if (event.key === ' ' && !event.repeat) {
        // Space held moves the board under the pointer, as in drawing programs; never a button's press.
        const focused = document.activeElement
        if (focused && focused !== document.body && !desk.current?.contains(focused)) return
        event.preventDefault()
        space.current = true
        setPanning(true)
        return
      }
      const plain = !event.ctrlKey && !event.metaKey && !event.altKey
      // Tab and Enter are the board's only while it has the keys: on a button of a row, they are the button's.
      const focused = document.activeElement
      const onBoard = !focused || focused === document.body || desk.current?.contains(focused) === true
      if ((event.key === 'Tab' || event.key === 'Enter') && !onBoard) return
      if (event.key === 'Tab' && plain && !event.shiftKey) {
        // The next step, after the one chosen: chosen, the caret in its words.
        if (oneStep()) {
          event.preventDefault()
          void addStepAfter(store)
        }
        return
      }
      if (event.key === 'Enter' && plain && !event.shiftKey) {
        const step = oneStep()
        const box = step ? undefined : oneBox()
        if (step) typingStep.set(step.id)
        else if (chosenLink.value) linkWordsAsked.set(linkWordsAsked.value + 1)
        else if (box !== undefined) typeIn(box)
        else return
        event.preventDefault()
        return
      }
      const chosen = chosenLink.value
      const objects = store.selectionKind === 'objects' && store.selection.blocks.length > 0
      if (!objects && !chosen) return
      const arrowKey = ARROWS[event.key]
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        if (chosen) {
          const from = store.doc.block[chosen.from]
          if (from?.type === 'node') {
            const kept = (from.to ?? []).filter((one) => one.node !== chosen.to)
            run([{ op: 'update', id: from.id, set: { to: kept.length > 0 ? kept : null } }])
          }
          chosenLink.set(undefined)
        } else removeChosen(store)
      } else if (event.key === 'Escape') {
        letGo()
      } else if (arrowKey && objects && plain) {
        event.preventDefault()
        const step = event.shiftKey ? 5 * NUDGE : NUDGE
        const chosenOwners = [...new Map(store.selection.blocks.map((id) => ownerOf(store.doc, id)).filter((owner): owner is FreeBlock => owner !== undefined).map((owner) => [owner.id, owner])).values()]
        run(movesOf(store.doc, chosenOwners, arrowKey[0] * step, arrowKey[1] * step), `nudge:${chosenOwners.map((owner) => owner.id).join(',')}`)
      }
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key !== ' ') return
      space.current = false
      setPanning(false)
    }
    window.addEventListener('keydown', onEscape, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onEscape, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
    // `run`, `letGo` and `typeIn` read only the store and the desk.
  }, [store])

  // ----- drawing --------------------------------------------------------------------------
  if (!page || !isEndless(page)) return <p className="nw-board" role="note">This board has no page to show.</p>
  const k = camera ? pxPerUnit(camera.zoom) : 1
  const view = camera ? seen(camera, size.w, size.h) : { x: 0, y: 0, w: 0, h: 0 }
  // Drawn: what lies in view and as much again round it, so a short move shows nothing missing.
  const near = grown(view, Math.max(view.w, view.h) / 2)
  const inkOn = new Map<Id, InkBlock[]>()
  for (const id of free) {
    const block = doc.block[id]
    if (block?.type === 'ink' && block.on !== undefined && doc.block[block.on]) inkOn.set(block.on, [...(inkOn.get(block.on) ?? []), block])
  }
  const drawInk = (block: InkBlock) => {
    const box = liveBox(block)
    if (!overlaps(box, near)) return null
    const area = { x: box.x - INK_ROOM, y: box.y - INK_ROOM, w: box.w + 2 * INK_ROOM, h: box.h + 2 * INK_ROOM }
    // The strokes are drawn at the block's own place; a move shifts the drawing.
    const shift = { x: box.x - block.x, y: box.y - block.y }
    return (
      <div key={block.id} className="nw-free nw-board-ink" data-id={block.id} style={{ left: mm(box.x), top: mm(box.y), width: mm(box.w), height: mm(box.h) }}>
        <InkView block={block} page={{ x: area.x - shift.x, y: area.y - shift.y, w: area.w, h: area.h }} />
      </div>
    )
  }
  const drawBlock = (block: FreeBlock) => {
    if (block.type === 'ink') return block.on !== undefined && doc.block[block.on] ? null : drawInk(block)
    const box = liveBox(block)
    if (block.type === 'node') {
      const ink = inkOn.get(block.id) ?? []
      if (!overlaps(box, near)) return null
      const inHand = (live?.kind === 'move' && live.ids.has(block.id)) || (live?.kind === 'size' && live.id === block.id)
      return [<StepView key={block.id} node={block} box={inHand ? box : undefined} typing={typing === block.id} />, ...ink.map(drawInk)]
    }
    // A text box being typed in is drawn wherever it is, so its words are never taken away under the caret.
    if (!overlaps(box, near) && !(block.type === 'frame' && frameEditors.get(block.id)?.isFocused)) return null
    if (block.type === 'frame') {
      const moved = box.x !== block.x || box.y !== block.y || box.w !== block.w ? { ...block, x: box.x, y: box.y, w: box.w } : block
      return store ? <FrameEditor key={block.id} frame={moved} store={store} /> : <FrameView key={block.id} frame={moved} doc={doc} assets={pictures} />
    }
    return (
      <div key={block.id} className="nw-free" data-free={block.type} data-id={block.id} style={{ left: mm(box.x), top: mm(box.y), width: mm(box.w), height: mm(box.h) }}>
        <PlacedView block={block} doc={doc} assets={pictures} />
      </div>
    )
  }
  const alone = owners.length === 1 && owners[0]!.type !== 'ink' ? owners[0]! : undefined
  const typed = typing === undefined ? undefined : doc.block[typing]

  // The points where links join: on the chosen steps; on every step in view while the Step tool is in hand; on the step
  // a link being drawn would join. Never while the board is being moved, nor with the switch off.
  const pointed: NodeBlock[] = []
  if (store && pointsOn && !panning) {
    const take = (node: NodeBlock): void => {
      if (!pointed.some((one) => one.id === node.id)) pointed.push(node)
    }
    if (tool === 'step') for (const id of free) {
      const block = doc.block[id]
      if (block?.type === 'node' && overlaps(boxOf(block), near)) take(block)
    }
    for (const owner of owners) if (owner.type === 'node') take(owner)
    if (live?.kind === 'line' && live.target !== undefined) {
      const target = doc.block[live.target]
      if (target?.type === 'node') take(target)
    }
  }
  const chosenDrawn = store && pointsOn && chosenKey !== undefined && live?.kind !== 'line' ? drawnLinks.find((one) => linkKey(one.from, one.to) === chosenKey) : undefined
  const bg = page.bg
  const dot = 500 * k
  // Dots no closer than 8 pixels: far out, every second, fourth… dot.
  const spacing = dot <= 0 ? 0 : dot * 2 ** Math.max(0, Math.ceil(Math.log2(8 / dot)))
  const paper = {
    '--nw-zoom': camera?.zoom ?? 1,
    '--nw-dots': `${spacing}px`,
    // The dots on the board's own 5 mm points, where a step's middle snaps.
    backgroundPosition: camera ? `${-camera.x * k - spacing / 2}px ${-camera.y * k - spacing / 2}px` : undefined,
  } as CSSProperties

  return (
    <div
      ref={desk}
      className="nw-desk nw-board"
      data-tool={store ? tool : undefined}
      data-bg={bg}
      data-panning={panning || drag.current?.kind === 'pan' ? '' : undefined}
      data-drawing={live?.kind === 'line' || live?.kind === 'draw' ? '' : undefined}
      tabIndex={-1}
      aria-label="Board"
      style={paper}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onDoubleClick={onDoubleClick}
    >
      {camera ? (
        <div className="nw-board-world" style={{ transform: `translate(${-camera.x * k}px, ${-camera.y * k}px) scale(${camera.zoom})` }}>
          <LinkLayer links={drawnLinks} view={near} chosen={chosenKey} moving={live?.kind === 'line' ? live.moving : undefined} arrow={arrow} />
          {free.map((id) => {
            const block = doc.block[id]
            return block && 'page' in block ? drawBlock(block) : null
          })}
          {owners.map((owner) => {
            const box = liveBox(owner)
            return <div key={`chosen-${owner.id}`} className="nw-chosen" style={{ left: mm(box.x), top: mm(box.y), width: mm(box.w), height: mm(box.h) }} />
          })}
          {alone
            ? CORNERS.map((corner) => {
                const box = liveBox(alone)
                const x = corner === 'nw' || corner === 'sw' ? box.x : box.x + box.w
                const y = corner === 'nw' || corner === 'ne' ? box.y : box.y + box.h
                return <span key={corner} className="nw-board-corner" data-corner={corner} data-across={alone.type === 'frame' ? '' : undefined} style={{ left: mm(x), top: mm(y) }} />
              })
            : null}
          {pointed.map((node) => {
            const box = liveBox(node)
            return SIDES.map((side) => {
              const at = portOf(node.shape, box, side)
              return <span key={`${node.id}-${side}`} className="nw-point" data-point={side} data-step={node.id} data-x={at.x} data-y={at.y} title="Drag to draw a link" style={{ left: mm(at.x), top: mm(at.y) }} />
            })
          })}
          {chosenDrawn
            ? (['from', 'to'] as const).map((end) => {
                const at = end === 'from' ? chosenDrawn.route.points[0]! : chosenDrawn.route.points.at(-1)!
                return <span key={end} className="nw-point" data-point="end" data-end={end} data-x={at.x} data-y={at.y} title={end === 'from' ? 'Drag onto another step: the link leaves it instead' : 'Drag onto another step: the link leads there instead'} style={{ left: mm(at.x), top: mm(at.y) }} />
              })
            : null}
          {live?.kind === 'line' ? (
            <svg className="nw-drag-line" viewBox={`${near.x} ${near.y} ${near.w} ${near.h}`} style={{ left: mm(near.x), top: mm(near.y), width: mm(near.w), height: mm(near.h) }} aria-hidden>
              <line x1={live.from.x} y1={live.from.y} x2={live.to.x} y2={live.to.y} />
            </svg>
          ) : null}
          {live?.kind === 'line' && live.port ? <span className="nw-point" data-marked="" style={{ left: mm(live.port.x), top: mm(live.port.y) }} /> : null}
          {live?.kind === 'box' || live?.kind === 'draw' ? <div className="nw-marquee" data-step={live.kind === 'draw' ? '' : undefined} style={{ left: mm(live.box.x), top: mm(live.box.y), width: mm(live.box.w), height: mm(live.box.h) }} /> : null}
          {store && typed?.type === 'node' ? <StepWords key={typed.id} node={live?.kind === 'size' && live.id === typed.id ? { ...typed, ...live.box } : typed} store={store} /> : null}
          {store && draft ? <DraftFrame key={draft.key} store={store} spot={draft} onDone={() => setDraft((now) => (now?.key === draft.key ? undefined : now))} /> : null}
        </div>
      ) : null}
    </div>
  )
}
