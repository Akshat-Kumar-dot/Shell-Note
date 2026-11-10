// The pen on the page (the plan, A3 to A6). While an ink tool is chosen, every
// press on the page is caught on its way down, before text or a block under it
// can take it:
//
// - A pen, the mouse, or a finger when fingers draw: a stroke. Each new piece
//   is drawn once, in the event handler, on a canvas over the pages, exactly
//   as the page will draw it after the pen lifts (render.ts); only a frame of
//   prediction past the pen is drawn apart and thrown away. Where Chromium
//   has it, the system draws the last stretch to the pen's tip itself
//   (navigator.ink). Held still, the stroke snaps to a line or a shape, which
//   the pen then stretches, as on the iPad. On lifting it goes to core: one
//   undo step for the stroke as drawn, and one more for its correction.
// - The eraser, or the pen's eraser end: whole strokes, or the part of a
//   stroke it passes over, as one undo step for one sweep.
// - Fingers that do not draw scroll with one finger and zoom with two; palms
//   are ignored (palm.ts).
//
// Pressure is this person's own: the app learns how hard they usually press,
// and keeps each point's width relative to that (core's pens.ts). A mouse and
// a finger draw at an even width.
import {
  arrowOfTwo,
  arrowOnLift,
  bandOf,
  cutOps,
  drawShape,
  editInk,
  eraseOps,
  finish,
  heldBack,
  heldShape,
  idTaken,
  isWriting,
  newId,
  NORMAL_PRESSURE,
  onScreen,
  pagePoints,
  placeStroke,
  PointFilter,
  pointsOf,
  predict,
  rowsOf,
  samePoints,
  scaledKey,
  scratchTargets,
  scratchTest,
  shifted,
  sizeOf,
  snapAngle,
  straightOnLift,
  strokesAlong,
  strokeBox,
  StrokeModel,
  strokeWidths,
  symbolOf,
  tidyBoxOps,
  tidyOps,
  tidyStrokeOps,
  triplesOf,
  type Box,
  type Doc,
  type Id,
  type InkRef,
  type LastStroke,
  type PenExample,
  type PenSettings,
  type Pt,
  type RecognisedShape,
  type Stroke,
  type Taught,
  type TimedPt,
} from '@shellnote/core'
import { useEffect, useRef, useSyncExternalStore, type RefObject } from 'react'
import { clampZoom, px } from '../geometry.js'
import { inDesktopApp } from '../host.js'
import { INK_TOOLS, isInkTool, type EditorStore, type Tool } from '../store.js'
import { PalmRules, type Contact } from './palm.js'
import { LiveLine } from './live.js'
import { drawPiece, drawStretches, drawStroke, lookOf, stepped, type Mapping } from './render.js'
import { keepWords, kept, momentNow, type Moment } from '../program/moment.js'
import { videoTime } from '../video/state.js'
import { ERASER_RADIUS, forgetUndone, lastInput, learnPressure, penChoice, penLearner, penSettingsFor, rulesInForce, teachUndone, tidyBox, typicalPressure, type PenChoice } from './settings.js'

export { INK_TOOLS, isInkTool }

/**
 * Held still this long (moving no more than HOLD_SLOP), the stroke shows as the
 * line or shape it is; lifted then, it is kept so; moved on, it was a pause in
 * writing, and stays ink. Held HOLD_TIME, the shape is the pen's to stretch, as
 * on the iPad.
 */
export const SHOW_TIME = 250
export const HOLD_TIME = 500
const HOLD_SLOP = 100
/**
 * How far ahead the prediction draws, in milliseconds: half a frame. A guess
 * past the pen is taken back when it lifts, which shows on a quick flick, so
 * it is short, and none where the system draws the trail to the real tip.
 */
const AHEAD = 8
/** The pen's eraser end, as Pointer Events report it. */
const ERASER_BUTTON = 5
const ERASER_BUTTONS = 32
/** A pen lifting sweeps on for a moment, lightly: a held shape keeps the size it had this long before the lift. */
const LIFT_SWEEP = 60
/**
 * The line being written is levelled when the pen rests this long, in
 * milliseconds; written on again, it is levelled
 * again as one line, on the same first word.
 */
const REST = 1500

/** Work done when the browser is next idle, so the pen is never kept waiting, and within `most` ms at the latest. */
function later(work: () => void, most = 100): void {
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(work, { timeout: most })
  else window.setTimeout(work, 0)
}

/** How the soft, normal and firm settings move this person's usual pressure: soft makes a light hand draw wider. */
const NUDGE: Readonly<Record<Exclude<PenSettings['pressure'], 'off'>, number>> = { soft: 0.8, normal: 1, firm: 1.25 }
/** Pressing twice as hard as usual gives a line about half as wide again, up to twice the width: the fountain pen's full swing. */
const PRESSURE_POWER = 0.6
/**
 * How much of that swing each pen keeps: the plain pen is a ballpoint, its
 * width moving only a little with pressure (about 0.8 to 1.3 times), as on
 * paper and in Goodnotes' own pen; a pencil in between; the fountain pen all of
 * it.
 */
const PRESSURE_SWING: Readonly<Record<'pen' | 'pencil' | 'fountain', number>> = { pen: 0.3, pencil: 0.6, fountain: 1 }
/** A line thins by at most this much pressure for each 0.01 mm the pen travels, a sixth of its width a millimetre: a pen lifting leaves no thin tail. */
const THINNING_PER_UNIT = 0.2
/**
 * The width follows the pressure smoothly, over about 1.5 mm of travel or 30
 * ms, not reading by reading: a pen's pressure jitters a few per cent from one
 * reading to the next, which drawn as it comes makes the edges bumpy.
 */
const PRESSURE_EASE = { units: 150, ms: 30 }

/** A page under the pen: its id and where it is on the screen. */
interface Sheet {
  id: Id
  /** Document units per CSS pixel, and the page's top-left on the screen. */
  scale: number
  left: number
  top: number
}

function sheetAt(doc: Doc, target: EventTarget | null): Sheet | undefined {
  const el = target instanceof Element ? target.closest<HTMLElement>('.nw-page') : null
  const id = el?.dataset.page
  const page = id === undefined ? undefined : doc.page[id]
  if (!el || !page) return undefined
  const rect = el.getBoundingClientRect()
  return { id: page.id, scale: page.w / rect.width, left: rect.left, top: rect.top }
}

const toPage = (sheet: Sheet, clientX: number, clientY: number): { x: number; y: number } => ({ x: (clientX - sheet.left) * sheet.scale, y: (clientY - sheet.top) * sheet.scale })


/** CSS pixels to 0.01 mm: CSS fixes 96 pixels to the inch. */
const UNITS_PER_PX = 2540 / 96
/** How many times bigger than in the page's units the page is on the screen (1 at 100 %): a pen profile keeps strokes at the size the hand drew them. */
const screenFactor = (sheet: Sheet): number => UNITS_PER_PX / sheet.scale

/** How a stroke on this page is judged (core's learn.ts): at the size it was drawn, and by the person's own strokes when they have taught the pen. */
function taughtOn(sheet: Sheet): Taught {
  const learner = penLearner()
  return { ...(learner ? { learner } : {}), zoom: screenFactor(sheet) }
}

/** How far the pen leans from upright, in degrees, from what the hardware gives. */
function tiltOf(event: PointerEvent): number {
  const altitude = (event as PointerEvent & { altitudeAngle?: number }).altitudeAngle
  if (typeof altitude === 'number' && event.pointerType === 'pen') return Math.round(90 - (altitude * 180) / Math.PI)
  if (!event.tiltX && !event.tiltY) return 0
  const tx = Math.tan((event.tiltX * Math.PI) / 180)
  const ty = Math.tan((event.tiltY * Math.PI) / 180)
  return Math.round((Math.atan(Math.hypot(tx, ty)) * 180) / Math.PI)
}

/** Every sample the pointer sent since the last event (Chromium), or just this one. */
function samples(event: PointerEvent): PointerEvent[] {
  const list = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : []
  return list.length > 0 ? list : [event]
}

/** Whether a sample carries a real pressure: a pen's, not a mouse's or a finger's. */
const pressed = (event: PointerEvent): boolean => event.pointerType === 'pen' && event.pressure > 0

/** A colour token's value, for the canvas, which cannot read CSS variables; a highlighter's named colours are its own, lighter ones. */
function colourValue(color: string, highlighter: boolean): string {
  if (color.startsWith('#')) return color
  return getComputedStyle(document.documentElement).getPropertyValue(`--nw-${highlighter ? 'hl-' : ''}${color}`).trim() || '#1d1d22'
}

const contact = (event: PointerEvent): Contact => ({ width: event.width, height: event.height, timeStamp: event.timeStamp })

/** What a stroke will be drawn with. */
type Look = Pick<Stroke, 'color' | 'width' | 'tool'>

function lookFor(tool: Tool, choice: PenChoice): Look {
  if (tool === 'highlighter') return { tool: 'highlighter', color: choice.highlighterColor, width: choice.highlighterWidth }
  return choice.kind === 'pen' ? { color: choice.color, width: choice.width } : { tool: choice.kind, color: choice.color, width: choice.width }
}

/** The system's own ink trail, drawn ahead of the page (Chromium on Windows). */
interface InkPresenter {
  updateInkTrailStartPoint(event: PointerEvent, style: { color: string; diameter: number }): void
}

/** A stroke being drawn. */
interface Drawing {
  kind: 'draw'
  /** The video beside the note, and where it was as the pen went down: kept on the stroke. */
  vt?: { m: Id; t: number; e?: number }
  /** The program beside the note, and where it was as the pen went down: kept on the stroke. */
  moment?: Moment
  pointer: number
  pointerType: string
  sheet: Sheet
  look: Look
  settings: PenSettings
  /** Drawing: the colour on the canvas, the stroke's normal width, where its units land. */
  colour: string
  size: number
  map: Mapping
  filter: PointFilter
  /** The line as a weight on a spring the pen pulls (core's smooth.ts), and the pen's own filtered points, which it trails. */
  model: StrokeModel
  pens: TimedPt[]
  /** The points as kept, their pressure already this person's (128 their usual), and the widths they draw at. */
  points: TimedPt[]
  widths: number[]
  tilts: number[]
  tilt: number
  /** The pen's own pressures, to learn from. */
  raw: number[]
  started: number
  /** Where the pen last moved more than HOLD_SLOP, and the timer that fires if it stays. */
  holdFrom: { x: number; y: number }
  hold: number
  /**
   * Held: the shape as it snapped and as stretched since (with when), the
   * point it grows from, and how far the pen was from there when it snapped;
   * `firm` once held HOLD_TIME, when the pen stretches it (before, moving on
   * takes it back).
   */
  snapped?: { first: RecognisedShape; shape: RecognisedShape; sizes: { t: number; shape: RecognisedShape }[]; anchor: { x: number; y: number }; reach: number; pressure: number; firm: boolean } | undefined
  /** The pen as it is now, on the page and on the screen. */
  at: { x: number; y: number }
  client: { x: number; y: number }
  /** The newest sample taken: the same samples come both raw and once a frame. */
  seen: number
  /** The stroke as it will be kept, cut into stretches, the part no later point can change worked out once (live.ts). */
  live: LiveLine
}

interface Erasing {
  kind: 'erase'
  pointer: number
  sheet: Sheet
  part: boolean
  radius: number
  last: { x: number; y: number }
  /** Whether this sweep has taken anything yet: its later changes join that undo step. */
  took: boolean
  seen: number
  pointerType: string
  map: Mapping
}

interface Fingers {
  kind: 'fingers'
  at: Map<number, { x: number; y: number }>
  /** At the start of a pinch: the zoom, the distance between the fingers. */
  pinch?: { zoom: number; distance: number } | undefined
}

/** A box dragged over writing, with the wand, to tidy it: where it began and where the pen is, on the page. */
interface Boxing {
  kind: 'box'
  pointer: number
  sheet: Sheet
  from: { x: number; y: number }
  to: { x: number; y: number }
  map: Mapping
}

type Gesture = Drawing | Erasing | Fingers | Boxing

/**
 * A stroke just kept: its page, its block, its place there, and its points
 * on the page, by which it is known again (a block growing left or up moves
 * its strokes within it), so one since changed or taken away is not joined.
 */
interface Previous {
  sheet: Id
  block: Id
  index: number
  page: Pt[]
}


/** A cursor as a picture: a dot as wide as the pen draws, or the eraser's ring, with a light edge so it shows on any ink. */
function cursorOf(tool: Tool, choice: PenChoice, zoom: number): string {
  const look = lookFor(tool, choice)
  const ring = tool === 'eraser'
  const across = ring ? px(2 * ERASER_RADIUS[choice.eraserSize], zoom) : px(sizeOf(look), zoom)
  const d = Math.round(Math.min(64, Math.max(ring ? 8 : 5, across)))
  const c = d / 2 + 2
  const colour = ring ? '#6b7079' : colourValue(look.color, look.tool === 'highlighter')
  const shape = ring
    ? `<circle cx='${c}' cy='${c}' r='${d / 2}' fill='none' stroke='white' stroke-width='3'/><circle cx='${c}' cy='${c}' r='${d / 2}' fill='none' stroke='${colour}' stroke-width='1.5'/>`
    : `<circle cx='${c}' cy='${c}' r='${d / 2 + 0.75}' fill='white' fill-opacity='0.85'/><circle cx='${c}' cy='${c}' r='${d / 2}' fill='${colour}'/>`
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${2 * c}' height='${2 * c}'>${shape}</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${c} ${c}, crosshair`
}

export interface PenLayerProps {
  store: EditorStore
  desk: RefObject<HTMLDivElement | null>
  zoom: number
  onZoom?: ((zoom: number) => void) | undefined
}

export function PenLayer({ store, desk, zoom, onZoom }: PenLayerProps) {
  const tool = useSyncExternalStore(store.subscribeTool, store.toolSnapshot)
  const choice = useSyncExternalStore(penChoice.subscribe, penChoice.snapshot)
  const boxing = useSyncExternalStore(tidyBox.subscribe, tidyBox.snapshot)
  // Two canvases over the desk. The wet one holds the stroke so far, as the page will draw it. The tail one holds what
  // is thrown away with each event: the guess past the pen, the pen's dot, the eraser's ring, the wand's box.
  const wetCanvas = useRef<HTMLCanvasElement>(null)
  const tailCanvas = useRef<HTMLCanvasElement>(null)
  const palm = useRef(new PalmRules('auto'))
  const last = useRef<LastStroke | undefined>(undefined)
  // The newest zoom, for a pinch that started before it changed.
  const zoomNow = useRef(zoom)
  zoomNow.current = zoom
  const zoomTo = useRef(onZoom)
  zoomTo.current = onZoom
  // The last correction made on lifting (a symbol, a line straightened, a scratch-out): the document just after it, and the stroke as drawn on the screen.
  const corrected = useRef<{ doc: Doc; points: Pt[] } | undefined>(undefined)

  // Undone at once, a correction teaches the pen to leave strokes like that one alone;
  // redone at once, the correction stands, and the lesson goes (the pen review's R6).
  useEffect(() => {
    let seen = store.doc
    let lesson: { example: PenExample; redoable: number } | undefined
    return store.subscribe((change) => {
      const before = seen
      seen = change.doc
      const taught = lesson
      lesson = undefined
      // An undo or a redo, with one fewer left to redo: the undone correction was redone.
      if (taught && !change.recorded && store.history.undone.length === taught.redoable - 1) forgetUndone(taught.example)
      const last = corrected.current
      // Only an undo of the correction itself, straight after it: anything undone or redone before then lets it go.
      if (!last || change.recorded) return
      corrected.current = undefined
      if (last.doc !== before) return
      const example = teachUndone(last.points)
      if (example) lesson = { example, redoable: store.history.undone.length }
    })
  }, [store])

  // A pen seen anywhere, at any time, stops fingers drawing in the automatic mode; a pen near the screen makes touches palms.
  useEffect(() => {
    const seen = (event: PointerEvent): void => {
      if (event.pointerType !== 'pen') return
      palm.current.pen(event.type === 'pointerdown' ? 'down' : event.type === 'pointerup' ? 'up' : event.type === 'pointercancel' ? 'leave' : 'move', event.timeStamp)
    }
    // Leaving one element for another while writing is no lifting; a pen gone out of range simply stops sending.
    const kinds = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const
    for (const kind of kinds) window.addEventListener(kind, seen, { capture: true, passive: true })
    return () => {
      for (const kind of kinds) window.removeEventListener(kind, seen, { capture: true })
    }
  }, [])

  // The cursor: a dot as wide as the pen, in its colour; the eraser's ring; a cross while the wand drags a box.
  useEffect(() => {
    const el = desk.current
    if (!el) return
    if (isInkTool(tool) && !boxing) el.style.setProperty('--nw-pen-cursor', cursorOf(tool, choice, zoom))
    else el.style.removeProperty('--nw-pen-cursor')
  }, [desk, tool, choice, zoom, boxing])

  useEffect(() => {
    const el = desk.current
    const wet = wetCanvas.current
    const tail = tailCanvas.current
    if (!el || !wet || !tail || !isInkTool(tool)) return
    // Drawn past the page's own frames where that is safe. Not on Android: Chrome there puts such a canvas straight on the
    // screen, where a transparent one can show black over everything (a test phone, 6 November 2026: "the screens turns
    // black as soon as i write with pen").
    const options: CanvasRenderingContext2DSettings = /\bAndroid\b/u.test(navigator.userAgent) ? {} : { desynchronized: true }
    const context = (canvas: HTMLCanvasElement): CanvasRenderingContext2D | null => canvas.getContext('2d', options) ?? canvas.getContext('2d')
    const ctx = context(wet)
    const tailCtx = context(tail)
    if (!ctx || !tailCtx) return
    // No caret is left in the note once an ink tool is chosen: on an iPad a caret is where Scribble, the system's own
    // handwriting, takes the pen's strokes for itself (a test iPad, 6 November 2026). The text stops being editable too,
    // for as long as the tool is chosen (FrameEditor.tsx).
    const typingIn = document.activeElement
    if (typingIn instanceof HTMLElement && el.contains(typingIn)) typingIn.blur()
    const picked = window.getSelection()
    if (picked?.anchorNode && el.contains(picked.anchorNode)) picked.removeAllRanges()
    // From here to the effect's end, all lives as long as the tool stays chosen: another tool runs the clean-up, and
    // this starts again. Plain variables, not React state: a pen moving draws no React.
    let gesture: Gesture | undefined
    /** The stroke kept last on a page, by this pen: the line a head drawn next may join (joinArrow). */
    let previous: Previous | undefined
    /**
     * Handwriting on the page the pen is on, in the order written: the line
     * being written, and one just finished until it is levelled. Its rows and
     * words (rowsOf) give the word a stroke is tidied with as it lifts, and the
     * line levelled when the pen rests or the next line starts (tc1,
     * la1, lc1).
     */
    let writing: { sheet: Id; refs: InkRef[] } | undefined
    /** The timer that levels the line being written after a rest (REST). */
    let rest = 0
    let dirty = false
    let clearing = 0
    let presenter: InkPresenter | undefined
    // Not in the desktop app: there, inside WebView2, the system draws its ink trail over the whole window, the
    // title bar and the bars included, and never takes it away. The app
    // draws its own short prediction instead, as a browser without the trail does (drawTail).
    const ink = inDesktopApp() ? undefined : (navigator as Navigator & { ink?: { requestPresenter(options: { presentationArea: Element }): Promise<InkPresenter> } }).ink
    wet.dataset.trail = 'own'
    ink
      ?.requestPresenter({ presentationArea: wet })
      .then((found) => {
        presenter = found
        wet.dataset.trail = 'system'
      })
      .catch(() => undefined)

    /**
     * The canvases cover the desk, at the screen's own pixels, lined up with
     * them: at 125 % or 150 % a CSS pixel is not a whole screen pixel, and a
     * canvas a fraction off would draw the line a quarter pixel away from
     * where the page draws it, which shows on a fine line when the pen lifts.
     */
    const fit = (): void => {
      const rect = el.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const left = Math.round(rect.left * dpr)
      const top = Math.round(rect.top * dpr)
      const w = Math.round((rect.left + rect.width) * dpr) - left
      const h = Math.round((rect.top + rect.height) * dpr) - top
      let resized = false
      for (const canvas of [wet, tail]) {
        Object.assign(canvas.style, { left: `${left / dpr}px`, top: `${top / dpr}px`, width: `${w / dpr}px`, height: `${h / dpr}px` })
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w
          canvas.height = h
          resized = true
        }
      }
      // A canvas made a new size forgets what it drew and how (its colour, its round ends, the highlighter's look):
      // the desk can change size while the pen writes, as a notice comes, so a stroke under way is set up again and
      // drawn again at once, where the page now is (found 18 October 2026: drawn on in the default black till it lifted).
      if (resized && gesture && gesture.kind !== 'fingers') {
        gesture.map = mapping(gesture.sheet)
        if (gesture.kind === 'draw') {
          prepare(ctx, wet, gesture)
          prepare(tailCtx, tail, gesture)
          redraw(gesture)
          drawTip(gesture)
        }
      }
    }
    const clearTail = (): void => {
      tailCtx.setTransform(1, 0, 0, 1, 0, 0)
      tailCtx.clearRect(0, 0, tail.width, tail.height)
    }
    const clear = (): void => {
      cancelAnimationFrame(clearing)
      if (!dirty) return
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, wet.width, wet.height)
      clearTail()
      dirty = false
    }
    /** Page units to canvas pixels, worked out once a stroke, from the canvas's own size on the screen and in pixels. */
    const mapping = (sheet: Sheet): Mapping => {
      const canvasRect = wet.getBoundingClientRect()
      const perCss = canvasRect.width > 0 ? wet.width / canvasRect.width : window.devicePixelRatio || 1
      return { scale: perCss / sheet.scale, dx: (sheet.left - canvasRect.left) * perCss, dy: (sheet.top - canvasRect.top) * perCss }
    }
    /** Set a canvas to draw a stroke: its colour, its see-through look, round ends. */
    const prepare = (canvasCtx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, d: Drawing): void => {
      const look = lookOf(d.look.tool)
      canvasCtx.setTransform(1, 0, 0, 1, 0, 0)
      canvasCtx.globalAlpha = 1
      canvasCtx.strokeStyle = d.colour
      canvasCtx.fillStyle = d.colour
      canvasCtx.lineCap = 'round'
      canvasCtx.lineJoin = 'round'
      // The whole layer is see-through, not each piece, so pieces do not darken where they meet.
      canvas.style.opacity = String(look.opacity)
      canvas.style.mixBlendMode = look.under ? 'multiply' : 'normal'
    }

    /** Let the stroke's own drawing in the page take over before the live one goes, so nothing flickers. */
    const clearSoon = (): void => {
      cancelAnimationFrame(clearing)
      clearing = requestAnimationFrame(() => {
        clearing = requestAnimationFrame(clear)
      })
    }

    /** Apply as one undo step, or joined to the last; false when it did not fit and nothing changed. */
    const apply = (ops: Parameters<EditorStore['apply']>[0], join = false): boolean => {
      if (ops.length === 0) return false
      try {
        store.apply(ops, { origin: 'pen', ...(join ? { join: true } : {}) })
        return true
      } catch (error) {
        console.warn('shellnote: the ink could not be changed', error)
        return false
      }
    }

    // ----- drawing -----

    const startDrawing = (event: PointerEvent, sheet: Sheet): void => {
      clear()
      const settings = penSettingsFor(store.doc)
      const look = lookFor(tool, penChoice.value)
      const at = toPage(sheet, event.clientX, event.clientY)
      const time = videoTime()
      const moment = momentNow(store)
      const d: Drawing = {
        kind: 'draw',
        ...(time ? { vt: time } : {}),
        ...(moment ? { moment } : {}),
        pointer: event.pointerId,
        pointerType: event.pointerType,
        sheet,
        look,
        settings,
        colour: colourValue(look.color, look.tool === 'highlighter'),
        size: sizeOf(look),
        map: mapping(sheet),
        filter: new PointFilter(settings.smoothing),
        model: new StrokeModel(settings.smoothing),
        pens: [],
        points: [],
        widths: [],
        tilts: [],
        tilt: 0,
        raw: [],
        started: event.timeStamp,
        holdFrom: at,
        hold: 0,
        at,
        client: { x: event.clientX, y: event.clientY },
        seen: -Infinity,
        live: new LiveLine(look),
      }
      prepare(ctx, wet, d)
      prepare(tailCtx, tail, d)
      dirty = true
      gesture = d
      window.clearTimeout(rest)
      rest = 0
      addSamples(d, event)
    }

    /** A stroke's place, the same however far it has been moved. */
    const placeOf = (ref: InkRef): string => `${ref.block}:${ref.index}`

    /** The rows of the handwriting remembered, each a list of words, as the strokes themselves (rowsOf). */
    const rowsIn = (w: NonNullable<typeof writing>): InkRef[][][] => rowsOf(w.refs.map((ref) => ref.page)).map((row) => row.map((word) => word.map((i) => w.refs[i]!)))

    /**
     * Tidy words as one finished line: one undo step. The strokes are
     * followed to where they now are, the arrow's line too.
     */
    const tidyWriting = (words: readonly InkRef[][]): void => {
      const { ops, moved } = tidyOps(store.doc, words, true, { ...penSettingsFor(store.doc), rules: rulesInForce() })
      if (ops.length === 0 || !apply(ops)) return
      if (writing) writing.refs = writing.refs.map((ref) => moved.get(ref) ?? ref)
      const before = previous
      if (before) for (const [was, now] of moved) if (was.block === before.block && samePoints(was.page, before.page)) previous = { ...before, page: now.page }
    }

    /**
     * The rows other than the one the newest stroke is in: finished, as a new
     * line has begun. With Words and lines, each is levelled as one finished
     * line: its letters onto their words'
     * baselines, its words onto the first word's, evenly spaced, one undo
     * step each. Then they are forgotten.
     */
    const finishRows = (w: NonNullable<typeof writing>, level: boolean): void => {
      const newest = w.refs.at(-1)
      if (!newest) return
      for (const row of rowsIn(w)) {
        if (row.some((word) => word.some((ref) => placeOf(ref) === placeOf(newest)))) continue
        const done = new Set(row.flat().map(placeOf))
        if (level) tidyWriting(row)
        w.refs = w.refs.filter((ref) => !done.has(placeOf(ref)))
      }
    }

    /** The row being written levelled as it stands, and kept: written on, it is levelled again as one line. */
    const levelNewest = (w: NonNullable<typeof writing>): void => {
      const newest = w.refs.at(-1)
      const row = newest && rowsIn(w).find((r) => r.some((word) => word.some((ref) => placeOf(ref) === placeOf(newest))))
      if (row) tidyWriting(row)
    }

    /**
     * A handwriting stroke just kept: remembered in the order written. A new
     * line begun finishes the lines before it; with Words and lines, the line
     * being written is levelled after the pen rests (REST). Done when the
     * browser is idle, so the pen is never kept waiting.
     */
    const wrote = (d: Drawing, block: Id, index: number): void => {
      const b = store.doc.block[block]
      const stroke = b?.type === 'ink' ? b.strokes[index] : undefined
      if (b?.type !== 'ink' || !stroke || !isWriting(stroke)) return
      if (!writing || writing.sheet !== d.sheet.id) writing = { sheet: d.sheet.id, refs: [] }
      const w = writing
      w.refs.push({ block, index, page: pagePoints(b, stroke) })
      const level = d.settings.neaten === 'line'
      later(() => {
        // Only if it is still this page's writing: the idle moment may come after the pen has gone to another page.
        if (writing === w) finishRows(w, level)
      })
      if (!level || !rulesInForce().rest) return
      window.clearTimeout(rest)
      rest = window.setTimeout(() => {
        rest = 0
        later(() => {
          if (writing === w) levelNewest(w)
        })
      }, REST)
    }

    /**
     * A handwriting stroke tidied as the pen lifts: its own small
     * fixes, the strokes before it in its word as they are, at the letter
     * size of its line so far; a second undo step, drawn on the live layer in
     * the same event, so nothing changes after the lift.
     */
    const tidyAtLift = (d: Drawing, blockId: Id): void => {
      if (d.settings.neaten !== 'word' && d.settings.neaten !== 'line') return
      const block = store.doc.block[blockId]
      if (block?.type !== 'ink') return
      const index = block.strokes.length - 1
      const stroke = block.strokes[index]
      if (!stroke || !isWriting(stroke)) return
      const ref: InkRef = { block: blockId, index, page: pagePoints(block, stroke) }
      let earlier: InkRef[] = []
      let size = bandOf([ref.page])?.size
      const w = writing && writing.sheet === d.sheet.id ? writing : undefined
      if (w && w.refs.length > 0) {
        // This stroke is not in `writing` yet (`wrote` comes after): it is looked at as the last of the list, at `me`.
        const me = w.refs.length
        for (const row of rowsOf([...w.refs.map((r) => r.page), ref.page])) {
          const word = row.find((indexes) => indexes.includes(me))
          if (!word) continue
          earlier = word.filter((i) => i !== me).map((i) => w.refs[i]!)
          size = bandOf(row.flat().map((i) => (i === me ? ref.page : w.refs[i]!.page)))?.size ?? size
        }
      }
      if (size === undefined) return
      const { ops, now } = tidyStrokeOps(store.doc, ref, earlier, size, rulesInForce())
      if (ops.length > 0 && apply(ops)) showKept(d, now.page)
    }

    /** A sample's pressure as kept: this person's usual pressure is 128; a mouse, a finger, a marker, a highlighter and a pen with pressure off keep an even width. */
    const pressureOf = (sample: PointerEvent, d: Drawing): number => {
      if (d.settings.pressure === 'off' || !pressed(sample) || d.look.tool === 'marker' || d.look.tool === 'highlighter') return NORMAL_PRESSURE
      const usual = typicalPressure() * NUDGE[d.settings.pressure]
      const full = Math.min(2, Math.max(0.3, Math.pow(sample.pressure / usual, PRESSURE_POWER)))
      const factor = 1 + (full - 1) * PRESSURE_SWING[d.look.tool ?? 'pen']
      return Math.min(255, Math.round(NORMAL_PRESSURE * factor))
    }

    /**
     * One pen event, taken into the stroke. This is the hot path: it runs for every event while writing, so it draws
     * only what is new. An event can carry several samples, and the same sample can come twice (from pointerrawupdate,
     * then pointermove): `d.seen` drops the repeats. Each sample goes through the filter, then the ink model, which
     * gives back the points now settled (`keep`). A shape the pen has snapped to stretches instead of gaining points.
     * While the pen keeps moving, the wait for it to stay still (which snaps a shape) starts again.
     */
    const addSamples = (d: Drawing, event: PointerEvent): void => {
      const from = d.points.length
      for (const sample of samples(event)) {
        if (sample.timeStamp <= d.seen) continue
        d.seen = sample.timeStamp
        const at = toPage(d.sheet, sample.clientX, sample.clientY)
        d.at = at
        d.client = { x: sample.clientX, y: sample.clientY }
        if (pressed(sample)) d.raw.push(sample.pressure)
        if (d.snapped?.firm) {
          // A light touch is the pen lifting off: it does not stretch the shape.
          if (!pressed(sample) || sample.pressure > 0.35 * typicalPressure()) stretch(d, sample.timeStamp)
          continue
        }
        const pen = d.filter.add({ ...at, p: pressureOf(sample, d), t: sample.timeStamp })
        d.pens.push(pen)
        d.tilt = d.look.tool === 'pencil' ? Math.max(0, Math.min(90, tiltOf(sample))) : 0
        for (const pt of d.model.add(pen)) keep(d, pt)
      }
      const movedOn = Math.hypot(d.at.x - d.holdFrom.x, d.at.y - d.holdFrom.y) > HOLD_SLOP
      if (d.snapped) {
        if (d.snapped.firm || !movedOn) {
          drawSnapped(d)
          return
        }
        // Moved on before the shape was the pen's: a pause in writing, so the stroke goes on as ink.
        d.snapped = undefined
      } else if (d.points.length === from) return
      redraw(d)
      // The pen moved on: wait again for it to stay still.
      if (movedOn || d.hold === 0) {
        d.holdFrom = d.at
        window.clearTimeout(d.hold)
        d.hold = window.setTimeout(() => held(d), SHOW_TIME)
      }
      drawTail(d, event)
    }

    /**
     * The system draws on from the last piece to the pen's tip, ahead of the
     * page (navigator.ink). It is told on pointermove, the event a frame is
     * drawn from, as the API's own examples do: told only on pointerrawupdate,
     * which pointermove follows with no new samples, it may have drawn nothing
     * (the person felt the pen late, 16 October 2026).
     */
    const inkTrail = (d: Drawing, event: PointerEvent): void => {
      if (!presenter || !event.isTrusted || d.snapped || d.widths.length === 0 || lookOf(d.look.tool).opacity !== 1) return
      try {
        presenter.updateInkTrailStartPoint(event, { color: d.colour, diameter: Math.max(1, (d.widths.at(-1)! * d.map.scale) / (window.devicePixelRatio || 1)) })
      } catch {
        // Not for this event; the canvas still shows the stroke.
      }
    }

    /**
     * The pen's dot, drawn at its tip while it writes: Windows hides the
     * cursor while a Windows Ink pen touches, so the round cursor went as the
     * pen wrote and came back as it stopped. The
     * same dot as the cursor (cursorOf), on the layer thrown away each event,
     * at the newest sample: where the pen is, ahead of the smoothed line.
     */
    const drawTip = (d: Drawing): void => {
      if (d.pointerType !== 'pen') return
      // Canvas pixels to a CSS pixel: the cursor's size is in CSS pixels.
      const perCss = d.map.scale * d.sheet.scale
      const r = (Math.min(64, Math.max(5, sizeOf(d.look) / d.sheet.scale)) * perCss) / 2
      const x = d.at.x * d.map.scale + d.map.dx
      const y = d.at.y * d.map.scale + d.map.dy
      tailCtx.save()
      tailCtx.setTransform(1, 0, 0, 1, 0, 0)
      tailCtx.globalAlpha = 0.85
      tailCtx.fillStyle = '#ffffff'
      tailCtx.beginPath()
      tailCtx.arc(x, y, r + 0.75 * perCss, 0, 2 * Math.PI)
      tailCtx.fill()
      tailCtx.globalAlpha = 1
      tailCtx.fillStyle = d.colour
      tailCtx.beginPath()
      tailCtx.arc(x, y, r, 0, 2 * Math.PI)
      tailCtx.fill()
      tailCtx.restore()
    }

    /** A point's width, as core draws it (pens.ts), from its kept pressure and tilt. */
    const widthAt = (d: Drawing, i: number): number => strokeWidths({ pts: [0, 0, Math.round(d.points[i]!.p)], ...d.look, ...(d.look.tool === 'pencil' ? { tilt: [d.tilts[i]!] } : {}) })[0]!

    /** A point of the line with its pressure eased from the one before, never thinning faster than the pen travels. */
    const eased = (before: TimedPt | undefined, pt: TimedPt): TimedPt => {
      if (!before) return pt
      const step = Math.hypot(pt.x - before.x, pt.y - before.y)
      // The further the pen went, or the longer it took, the nearer this point's pressure comes to the pen's.
      const follow = 1 - Math.exp(-(step / PRESSURE_EASE.units + Math.max(0, pt.t - before.t) / PRESSURE_EASE.ms))
      const p = before.p + (pt.p - before.p) * follow
      return { ...pt, p: Math.max(p, before.p - THINNING_PER_UNIT * step) }
    }

    /** Keep a point of the line, its pressure eased. */
    const keep = (d: Drawing, pt: TimedPt): void => {
      d.points.push(eased(d.points.at(-1), pt))
      d.tilts.push(d.tilt)
      d.widths.push(widthAt(d, d.points.length - 1))
    }

    /**
     * The stroke as it will be kept: only the points that change its line or
     * its width (core's finish), in whole units, with a pencil's tilt at each.
     */
    const keptStroke = (d: Drawing, points: readonly TimedPt[], tilts: readonly number[]): Stroke => {
      const kept = finish(points)
      const stroke: Stroke = { pts: triplesOf(kept), ...d.look }
      if (d.vt) stroke.vt = d.vt
      if (d.look.tool === 'pencil') {
        // `finish` keeps the same objects, so each kept point finds its tilt by being itself.
        const index = new Map(points.map((pt, i) => [pt as { x: number }, i]))
        stroke.tilt = kept.map((pt) => tilts[index.get(pt) ?? 0] ?? 0)
      }
      return stroke
    }

    /**
     * Draw the stroke so far, with its end as lifting now would leave it (the
     * spring's catch-up, StrokeModel.preview), exactly as the page will draw
     * it: the very stroke that would be kept, its points and widths, cut into
     * the same stretches with the same curves (render.ts), one line per width.
     * So lifting changes nothing.
     */
    const redraw = (d: Drawing): void => {
      const end: TimedPt[] = []
      let before = d.points.at(-1)
      for (const pt of d.model.preview()) {
        before = eased(before, pt)
        end.push(before)
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, wet.width, wet.height)
      drawStretches(ctx, d.live.stretches(d.points, d.tilts, end, d.tilt), d.map)
    }

    /**
     * On a layer of its own, thrown away with the next event: a little
     * prediction past the pen (the browser's guess where it has one, else
     * core's), even where the system draws its own ink trail, since whether
     * that trail draws cannot be known from here; and the pen's dot at its tip.
     */
    const drawTail = (d: Drawing, event: PointerEvent): void => {
      clearTail()
      drawTip(d)
      const pen = d.pens.at(-1)
      if (!pen) return
      const theirs = typeof event.getPredictedEvents === 'function' ? event.getPredictedEvents() : []
      const ahead = theirs.length > 0 ? theirs.slice(0, 1).map((e) => heldBack(d.pens, toPage(d.sheet, e.clientX, e.clientY), AHEAD)) : [predict(d.pens, AHEAD)].filter((pt) => pt !== undefined)
      const width = stepped(d.widths.at(-1)!, d.size)
      let from: { x: number; y: number } = pen
      for (const pt of ahead) {
        drawPiece(tailCtx, from, pt, width, d.map)
        from = pt
      }
    }

    /** Held still: a line or a shape, if it is one and the switches allow it. */
    const held = (d: Drawing): void => {
      if (gesture !== d || d.snapped || d.points.length < 3) return
      const shape = heldShape(d.points, taughtOn(d.sheet))
      if (!shape) return
      if (shape.kind === 'line' ? d.settings.lines === 'off' : d.settings.shapes === 'off') return
      // Lines and arrows grow from their start; other shapes from their middle.
      const open = shape.kind === 'line' || shape.kind === 'arrow'
      const xs = shape.points.map((pt) => pt.x)
      const ys = shape.points.map((pt) => pt.y)
      const anchor = open ? { x: shape.key[0]!, y: shape.key[1]! } : { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
      const pressure = shape.points[0]?.p ?? NORMAL_PRESSURE
      d.snapped = { first: shape, shape, sizes: [{ t: performance.now(), shape }], anchor, reach: Math.max(1, Math.hypot(d.at.x - anchor.x, d.at.y - anchor.y)), pressure, firm: false }
      drawSnapped(d)
      d.hold = window.setTimeout(() => {
        if (gesture === d && d.snapped) d.snapped.firm = true
      }, HOLD_TIME - SHOW_TIME)
    }

    /** After a shape snaps, the pen stretches it: a line's end follows the pen, other shapes grow or shrink with it, from the shape as it snapped. */
    const stretch = (d: Drawing, t: number): void => {
      const snapped = d.snapped!
      const { kind, key } = snapped.first
      let next: number[]
      if (kind === 'line' || kind === 'arrow') {
        const b = snapAngle({ x: key[0]!, y: key[1]!, p: snapped.pressure }, { ...d.at, p: snapped.pressure })
        next = [key[0]!, key[1]!, Math.round(b.x), Math.round(b.y), ...key.slice(4)]
      } else {
        next = scaledKey(kind, key, snapped.anchor, Math.hypot(d.at.x - snapped.anchor.x, d.at.y - snapped.anchor.y) / snapped.reach)
      }
      snapped.shape = { kind, key: next, points: drawShape(kind, next, snapped.pressure) }
      snapped.sizes.push({ t, shape: snapped.shape })
      // Only the newest matter: `correction` looks back LIFT_SWEEP from the lift.
      if (snapped.sizes.length > 64) snapped.sizes.shift()
    }

    /** The snapped shape, drawn again whole as it stretches. */
    const drawSnapped = (d: Drawing): void => {
      const shape = d.snapped!.shape
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, wet.width, wet.height)
      clearTail()
      const stroke = { pts: triplesOf(shape.points), ...d.look }
      drawStroke(ctx, shape.points, strokeWidths(stroke), d.size, d.map)
      drawTip(d)
    }

    /**
     * The pen lifted: the stroke joins the note, in this order, and each step can end it there:
     *
     * 1. a scratch-out over ink erases that ink and is not kept;
     * 2. the stroke goes in as drawn, one undo step (with the place of a program beside the note, if one is there);
     * 3. a second stroke that makes an arrow's head joins its shaft (`joinArrow`);
     * 4. a correction (a line straightened, a shape) is a second undo step, so one undo gives back the stroke as drawn;
     *    with none, the word is tidied (`tidyAtLift`).
     *
     * The live layer stays as it is until the page has drawn the kept stroke (`clearSoon`), so nothing flickers.
     */
    const endDrawing = (d: Drawing, event: PointerEvent): void => {
      window.clearTimeout(d.hold)
      gesture = undefined
      clearTail()
      lastInput.set(d.raw.length > 0 ? { type: d.pointerType, pressure: [Math.min(...d.raw), Math.max(...d.raw)] } : { type: d.pointerType })
      learnFrom(d)
      // The video's time as the pen lifts, when it has moved on: the stroke's end, so a line shows from and to.
      if (d.vt) {
        const now = videoTime()
        if (now?.m === d.vt.m && now.t > d.vt.t) d.vt = { ...d.vt, e: now.t }
      }
      // The line catches up with the pen and ends where it lifted: as it was already drawn.
      if (!d.snapped) {
        for (const pt of d.model.finish()) keep(d, pt)
        redraw(d)
      }
      if (d.points.length === 0) return clear()
      const doc = store.doc
      const stroke = keptStroke(d, d.points, d.tilts)
      // A scratch-out over ink deletes it, and is not kept itself; even if a pause before lifting snapped it to a shape.
      if (d.settings.scratch && d.look.tool !== 'highlighter') {
        const targets = scratchTargets(doc, d.sheet.id, d.points, scratchTest(taughtOn(d.sheet)))
        if (targets.length > 0) {
          if (apply(eraseOps(doc, targets))) corrected.current = { doc: store.doc, points: onScreen(d.points, screenFactor(d.sheet)) }
          clearSoon()
          return
        }
      }
      // Forgotten from here: only a stroke this lift goes on to keep may be joined by the next.
      const before = previous
      previous = undefined
      // The program beside the note: its first line adds it to the note, in the stroke's own undo step.
      const beside = d.moment && kept(doc, d.moment)
      if (beside) stroke.pm = beside.pm
      const placed = placeStroke(doc, d.sheet.id, stroke, { now: d.started, last: last.current, newId: () => newId((id) => idTaken(store.doc, id)) })
      if (!apply([...(beside?.ops ?? []), ...placed.ops])) return clear()
      if (beside?.pm.place && d.moment) keepWords(store, beside.pm.m, d.moment.window, beside.pm.place)
      last.current = { block: placed.block, at: event.timeStamp }
      if (!d.snapped && joinArrow(d, before, placed.block)) return clearSoon()
      // The correction is a second undo step: one undo gives back the stroke as drawn.
      const block = store.doc.block[placed.block]
      const fixed = correction(d, event.timeStamp, block?.type === 'ink' ? nearBoxes(block, block.strokes.length - 1) : [])
      if (fixed && block?.type === 'ink') {
        const done = apply(editInk(store.doc, block.id, { replace: new Map([[block.strokes.length - 1, [shifted({ ...fixed, ...d.look, ...(d.vt ? { vt: d.vt } : {}), ...(stroke.pm ? { pm: stroke.pm } : {}) }, -block.x, -block.y)]]]) }))
        if (done) showKept(d, pointsOf(fixed.pts))
        // A shape held for was asked for; a correction made unasked can be taught away by undoing it.
        if (done && !d.snapped) corrected.current = { doc: store.doc, points: onScreen(d.points, screenFactor(d.sheet)) }
      }
      if (!fixed && !d.snapped) tidyAtLift(d, placed.block)
      const now = store.doc.block[placed.block]
      if (now?.type === 'ink') {
        previous = { sheet: d.sheet.id, block: now.id, index: now.strokes.length - 1, page: pagePoints(now, now.strokes.at(-1)!) }
        wrote(d, now.id, now.strokes.length - 1)
      }
      clearSoon()
    }

    /**
     * What the pen keeps on its live layer once a lift has changed the stroke
     * (a line straightened, an arrow, a symbol, two strokes joined): the
     * change, drawn in the same event, so the frame after the lift shows it.
     * Left alone, the layer would show the stroke as drawn over the change
     * until the page has drawn it (clearSoon), two frames later.
     */
    const showKept = (d: Drawing, points: readonly Pt[]): void => {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, wet.width, wet.height)
      drawStroke(ctx, points, strokeWidths({ pts: triplesOf(points), ...d.look }), d.size, d.map)
      dirty = true
    }

    /**
     * An arrow drawn in two strokes:
     * this stroke, just placed, and the one kept just before it on this page,
     * a line and its head, either first, become one arrow, as a second undo
     * step that gives both back as drawn. Nothing is taught by undoing it:
     * each stroke alone is plain ink anyway.
     */
    const joinArrow = (d: Drawing, before: Previous | undefined, placedIn: Id): boolean => {
      if (!before || before.sheet !== d.sheet.id || d.look.tool === 'highlighter' || d.settings.lines !== 'auto') return false
      const doc = store.doc
      const lineBlock = doc.block[before.block]
      const headBlock = doc.block[placedIn]
      if (lineBlock?.type !== 'ink' || headBlock?.type !== 'ink') return false
      const { index } = before
      const line = lineBlock.strokes[index]
      const headIndex = headBlock.strokes.length - 1
      if (!line || (lineBlock.id === headBlock.id && index === headIndex) || !samePoints(pagePoints(lineBlock, line), before.page)) return false
      const shape = arrowOfTwo(before.page, pagePoints(headBlock, headBlock.strokes[headIndex]!), taughtOn(d.sheet).zoom)
      if (!shape) return false
      const { color, width, tool } = line
      const arrow = { pts: triplesOf(shape.points), shape: { kind: shape.kind, key: shape.key }, color, width, ...(tool ? { tool } : {}) }
      const ops =
        lineBlock.id === headBlock.id
          ? editInk(doc, lineBlock.id, { replace: new Map([[index, [shifted(arrow, -lineBlock.x, -lineBlock.y)]], [headIndex, []]]) })
          : [...editInk(doc, lineBlock.id, { replace: new Map([[index, [shifted(arrow, -lineBlock.x, -lineBlock.y)]]]) }), ...editInk(doc, headBlock.id, { replace: new Map([[headIndex, []]]) })]
      if (!apply(ops)) return false
      showKept(d, shape.points)
      return true
    }

    /** Learn this person's usual pressure from the middle of a pen stroke, where the pen neither lands nor lifts. */
    const learnFrom = (d: Drawing): void => {
      if (d.raw.length < 8) return
      const middle = d.raw.slice(Math.floor(d.raw.length * 0.15), Math.ceil(d.raw.length * 0.85)).sort((a, b) => a - b)
      learnPressure(middle[middle.length >> 1]!)
    }

    /** The boxes, on the page, of the strokes written just before one in its block: what a comma is measured against. */
    const nearBoxes = (block: Extract<Doc['block'][string], { type: 'ink' }>, index: number): Box[] =>
      block.strokes.slice(Math.max(0, index - 8), index).map((stroke) => {
        const b = strokeBox(stroke)
        return { x: b.x + block.x, y: b.y + block.y, w: b.w, h: b.h }
      })

    /**
     * What the stroke becomes: the shape it was held into, as it was before the
     * pen swept off; else a symbol, the moment it lifts, when symbols are on;
     * else, when lines straighten on their own, an arrow, or a clearly
     * straight line.
     */
    const correction = (d: Drawing, liftedAt: number, near: readonly Box[]): Omit<Stroke, 'color' | 'width' | 'tool'> | undefined => {
      if (d.snapped) {
        const before = [...d.snapped.sizes].reverse().find((size) => size.t <= liftedAt - LIFT_SWEEP) ?? d.snapped.sizes[0]!
        const { kind, key, points } = before.shape
        return { pts: triplesOf(points), shape: { kind, key }, ...(kind === 'line' ? { straight: true as const } : {}) }
      }
      if (d.look.tool === 'highlighter') return undefined
      const taught = taughtOn(d.sheet)
      const symbol = symbolOf(d.points, d.settings.symbols, near, taught)
      if (symbol) return { pts: triplesOf(symbol.points), shape: { kind: symbol.kind, key: symbol.key } }
      if (d.settings.lines !== 'auto') return undefined
      // An arrow, with no hold, goes with the lines.
      const arrow = arrowOnLift(d.points, taught)
      if (arrow) return { pts: triplesOf(arrow.points), shape: { kind: arrow.kind, key: arrow.key } }
      const line = straightOnLift(d.points, taught)
      return line && { pts: triplesOf([line.a, line.b]), straight: true }
    }

    // ----- erasing -----

    const startErasing = (event: PointerEvent, sheet: Sheet): void => {
      const choice = penChoice.value
      const at = toPage(sheet, event.clientX, event.clientY)
      const e: Erasing = { kind: 'erase', pointer: event.pointerId, sheet, part: choice.eraser === 'part', radius: ERASER_RADIUS[choice.eraserSize], last: at, took: false, seen: event.timeStamp, pointerType: event.pointerType, map: mapping(sheet) }
      gesture = e
      tail.style.opacity = '1'
      tail.style.mixBlendMode = 'normal'
      dirty = true
      erase(e, [at])
      drawRing(e)
    }

    /** The eraser's ring, drawn where it is while a pen erases, for the cursor Windows hides then (drawTip). */
    const drawRing = (e: Erasing): void => {
      clearTail()
      if (e.pointerType !== 'pen') return
      const perCss = e.map.scale * e.sheet.scale
      const r = (Math.min(64, Math.max(8, (2 * e.radius) / e.sheet.scale)) * perCss) / 2
      const x = e.last.x * e.map.scale + e.map.dx
      const y = e.last.y * e.map.scale + e.map.dy
      tailCtx.save()
      tailCtx.setTransform(1, 0, 0, 1, 0, 0)
      tailCtx.globalAlpha = 1
      for (const [colour, width] of [['#ffffff', 3], ['#6b7079', 1.5]] as const) {
        tailCtx.strokeStyle = colour
        tailCtx.lineWidth = width * perCss
        tailCtx.beginPath()
        tailCtx.arc(x, y, r, 0, 2 * Math.PI)
        tailCtx.stroke()
      }
      tailCtx.restore()
    }

    const erase = (e: Erasing, path: { x: number; y: number }[]): void => {
      const doc = store.doc
      const ops = e.part ? cutOps(doc, e.sheet.id, path, e.radius) : eraseOps(doc, strokesAlong(doc, e.sheet.id, path, e.radius))
      if (ops.length > 0) {
        apply(ops, e.took)
        e.took = true
      }
    }

    const moveErasing = (e: Erasing, event: PointerEvent): void => {
      const fresh = samples(event).filter((sample) => sample.timeStamp > e.seen)
      if (fresh.length === 0) return
      e.seen = fresh.at(-1)!.timeStamp
      const path = [e.last, ...fresh.map((sample) => toPage(e.sheet, sample.clientX, sample.clientY))]
      e.last = path.at(-1)!
      erase(e, path)
      drawRing(e)
    }

    // ----- fingers: scroll and zoom -----

    const moveFingers = (f: Fingers, event: PointerEvent): void => {
      const before = f.at.get(event.pointerId)
      if (!before) return
      const now = { x: event.clientX, y: event.clientY }
      if (f.at.size === 1) {
        el.scrollLeft -= now.x - before.x
        el.scrollTop -= now.y - before.y
      } else if (f.pinch) {
        const [a, b] = [...f.at.entries()].map(([id, pt]) => (id === event.pointerId ? now : pt))
        const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y)
        zoomTo.current?.(clampZoom((f.pinch.zoom * distance) / f.pinch.distance))
        // Half: each finger's move comes as its own event, so together they scroll as their middle moves.
        el.scrollLeft -= (now.x - before.x) / 2
        el.scrollTop -= (now.y - before.y) / 2
      }
      f.at.set(event.pointerId, now)
    }

    const startPinch = (f: Fingers): void => {
      const [a, b] = [...f.at.values()]
      if (a && b) f.pinch = { zoom: zoomNow.current, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) }
    }

    // ----- the events -----

    /** Keep the pointer's events coming here when it leaves the page; a pointer the browser no longer knows cannot be. */
    const capture = (event: PointerEvent): void => {
      try {
        el.setPointerCapture(event.pointerId)
      } catch {
        // Its events still come while it is over the desk.
      }
    }

    /**
     * What a press means depends on what is pressing, in this order: a palm is ignored; a finger that does not draw, or
     * a second finger, scrolls and zooms (`Fingers`); a pen coming down just after a finger cancels that finger's stroke,
     * since it was the hand; then a press on a sheet erases, starts the wand's box, or starts a stroke. A press it takes
     * goes no further (preventDefault, stopPropagation, capture), so the page neither scrolls nor selects under the pen.
     */
    const onDown = (event: PointerEvent): void => {
      palm.current.mode = penSettingsFor(store.doc).penOnly
      const touch = event.pointerType === 'touch'
      if (touch && palm.current.isPalm(contact(event))) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      // The pages' own buttons (the bar above each page, the + under the last) are pressed, by a finger too.
      if (gesture === undefined && event.target instanceof Element && event.target.closest('.nw-page-bar, .nw-add-page')) return
      // A finger that does not draw, or a second finger: scrolling and zooming.
      if (touch && (gesture?.kind === 'fingers' || !palm.current.fingerDraws(contact(event)) || (gesture?.kind === 'draw' && gesture.pointerType === 'touch'))) {
        event.preventDefault()
        event.stopPropagation()
        // A finger stroke under way becomes a gesture, and is dropped.
        if (gesture?.kind === 'draw') {
          window.clearTimeout(gesture.hold)
          clear()
          gesture = { kind: 'fingers', at: new Map([[gesture.pointer, gesture.client]]) }
        }
        const fingers: Fingers = gesture?.kind === 'fingers' ? gesture : { kind: 'fingers', at: new Map() }
        fingers.at.set(event.pointerId, { x: event.clientX, y: event.clientY })
        if (fingers.at.size === 2) startPinch(fingers)
        gesture = fingers
        capture(event)
        return
      }
      const eraserEnd = event.pointerType === 'pen' && (event.button === ERASER_BUTTON || (event.buttons & ERASER_BUTTONS) !== 0)
      if (event.button !== 0 && !eraserEnd) return
      // The pen comes down just after a finger began a stroke: that was the hand, not a stroke.
      if (event.pointerType === 'pen' && gesture?.kind === 'draw' && gesture.pointerType === 'touch' && PalmRules.lateCancel(gesture.started, event.timeStamp)) {
        window.clearTimeout(gesture.hold)
        gesture = undefined
        clear()
      }
      if (gesture) return
      // A ⏱ beside a line is pressed, not written on.
      if (event.target instanceof Element && event.target.closest('.nw-video-mark')) return
      fit()
      const sheet = sheetAt(store.doc, event.target)
      if (!sheet) return
      event.preventDefault()
      event.stopPropagation()
      ;(document.activeElement as HTMLElement | null)?.blur?.()
      if (store.selection.blocks.length > 0 || store.selection.here) store.select({ blocks: [] }, 'objects')
      capture(event)
      if (tool === 'eraser' || eraserEnd) startErasing(event, sheet)
      else if (tidyBox.value) startBoxing(event, sheet)
      else startDrawing(event, sheet)
    }

    // ----- the wand's box -----

    const startBoxing = (event: PointerEvent, sheet: Sheet): void => {
      const at = toPage(sheet, event.clientX, event.clientY)
      gesture = { kind: 'box', pointer: event.pointerId, sheet, from: at, to: at, map: mapping(sheet) }
      tail.style.opacity = '1'
      tail.style.mixBlendMode = 'normal'
      dirty = true
    }

    /** The box as dragged so far, dashed, on the layer thrown away each event. */
    const drawBox = (b: Boxing): void => {
      clearTail()
      const x0 = Math.min(b.from.x, b.to.x) * b.map.scale + b.map.dx
      const y0 = Math.min(b.from.y, b.to.y) * b.map.scale + b.map.dy
      const w = Math.abs(b.to.x - b.from.x) * b.map.scale
      const h = Math.abs(b.to.y - b.from.y) * b.map.scale
      const perCss = b.map.scale * b.sheet.scale
      tailCtx.save()
      tailCtx.setTransform(1, 0, 0, 1, 0, 0)
      tailCtx.globalAlpha = 1
      tailCtx.strokeStyle = '#4f6bd8'
      tailCtx.fillStyle = 'rgba(79, 107, 216, 0.08)'
      tailCtx.lineWidth = 1.5 * perCss
      tailCtx.setLineDash([6 * perCss, 4 * perCss])
      tailCtx.fillRect(x0, y0, w, h)
      tailCtx.strokeRect(x0, y0, w, h)
      tailCtx.restore()
    }

    /** The box let go: the writing in it tidied as finished lines, one undo step, and the wand put down. */
    const endBoxing = (b: Boxing): void => {
      gesture = undefined
      clearTail()
      tidyBox.set(false)
      const box = { x: Math.min(b.from.x, b.to.x), y: Math.min(b.from.y, b.to.y), w: Math.abs(b.to.x - b.from.x), h: Math.abs(b.to.y - b.from.y) }
      if (box.w < 1 || box.h < 1) return
      const ops = tidyBoxOps(store.doc, b.sheet.id, box, { ...penSettingsFor(store.doc), rules: rulesInForce() })
      if (ops.length > 0) apply(ops)
    }

    const onMove = (event: PointerEvent): void => {
      const g = gesture
      if (!g) return
      if (g.kind === 'fingers') {
        // Scrolling and zooming need no more than once a frame.
        if (event.type === 'pointermove') moveFingers(g, event)
      } else if (g.pointer !== event.pointerId) return
      else if (g.kind === 'draw') {
        addSamples(g, event)
        if (event.type === 'pointermove') inkTrail(g, event)
      } else if (g.kind === 'box') {
        g.to = toPage(g.sheet, event.clientX, event.clientY)
        drawBox(g)
      } else moveErasing(g, event)
      event.preventDefault()
    }

    const onUp = (event: PointerEvent): void => {
      const g = gesture
      if (!g) return
      if (g.kind === 'fingers') {
        g.at.delete(event.pointerId)
        g.pinch = undefined
        if (g.at.size === 0) gesture = undefined
        return
      }
      if (g.pointer !== event.pointerId) return
      if (g.kind === 'draw') {
        if (event.type === 'pointercancel') {
          window.clearTimeout(g.hold)
          gesture = undefined
          clear()
        } else endDrawing(g, event)
      } else if (g.kind === 'box') {
        if (event.type === 'pointercancel') {
          gesture = undefined
          clearTail()
        } else endBoxing(g)
      } else {
        gesture = undefined
        clearTail()
      }
    }

    // Chromium sends pointerrawupdate as soon as the pen moves, not once a frame: a frame less behind the pen.
    // pointermove still comes, with the same samples, which are skipped as seen.
    const raw = 'onpointerrawupdate' in window
    fit()
    const resize = new ResizeObserver(fit)
    resize.observe(el)
    // iPadOS with Scribble on: Safari swallows pen events even over what cannot be typed in, unless the page keeps the
    // touches for itself (WebKit bug 217430, Apple's forums, thread 662874). They have nothing else to do here: the desk's
    // `touch-action: none` already gives no scrolling, and pointer events go on. Set now, ahead of any touch: Safari ignores
    // one added during a touch.
    const keepTouch = (event: TouchEvent): void => event.preventDefault()
    el.addEventListener('touchmove', keepTouch, { passive: false })
    // Nor does a long press or a double tap select what is under the pen (the iPad again: "selects many like icons").
    const noSelecting = (event: Event): void => event.preventDefault()
    el.addEventListener('selectstart', noSelecting)
    el.addEventListener('pointerdown', onDown, true)
    if (raw) el.addEventListener('pointerrawupdate' as 'pointermove', onMove)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    window.addEventListener('resize', fit)
    return () => {
      resize.disconnect()
      el.removeEventListener('touchmove', keepTouch)
      el.removeEventListener('selectstart', noSelecting)
      el.removeEventListener('pointerdown', onDown, true)
      if (raw) el.removeEventListener('pointerrawupdate' as 'pointermove', onMove)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      window.removeEventListener('resize', fit)
      if (gesture?.kind === 'draw') window.clearTimeout(gesture.hold)
      window.clearTimeout(rest)
      clear()
    }
  }, [store, desk, tool])

  const hidden = !isInkTool(tool)
  return (
    <>
      <canvas ref={wetCanvas} className="nw-live-ink" hidden={hidden} aria-hidden />
      <canvas ref={tailCanvas} className="nw-live-ink" hidden={hidden} aria-hidden />
    </>
  )
}
