// The workspace as each person left it, kept in their browser, never in a note:
// where the panels are, which are open, where each bar is, and whether the video and a program are shown inside the
// Beside panel or taken out into panels of their own.
import { Shared } from '../video/state.js'
import { DEFAULT_LAYOUT, dock, float, giveBack, layoutFrom, type Layout, type PanelId } from './tree.js'

/** A bar along a side of the workspace, or floating as a box at a place, across or down. */
export type BarPlace = { at: 'top' | 'bottom' | 'left' | 'right' } | { at: 'float'; x: number; y: number; dir: 'row' | 'column' }
export type BarId = 'tools' | 'format'

/** What the Beside panel can hold inside it: the video, and another program's window. */
export type Inside = 'video' | 'program'

export interface Workspace {
  layout: Layout
  /** The side panel open, beside the notes. */
  side: boolean
  bars: Record<BarId, BarPlace>
  /** Shown inside the Beside panel (true), or in a panel of its own, where the layout puts it (false). */
  beside: Record<Inside, boolean>
}

/** A new name for the new design: the panel beside the notes moved to their right, so what was kept before is not read. */
const KEY = 'shellnote:workspace-2'
const OLD_VIDEO_KEY = 'shellnote:video-layout'
const DEFAULT: Workspace = { layout: DEFAULT_LAYOUT, side: false, bars: { tools: { at: 'top' }, format: { at: 'top' } }, beside: { video: true, program: true } }

function barFrom(value: unknown, fallback: BarPlace): BarPlace {
  if (typeof value !== 'object' || value === null) return fallback
  const o = value as Record<string, unknown>
  if (o.at === 'top' || o.at === 'bottom' || o.at === 'left' || o.at === 'right') return { at: o.at }
  if (o.at === 'float' && typeof o.x === 'number' && typeof o.y === 'number') return { at: 'float', x: o.x, y: o.y, dir: o.dir === 'column' ? 'column' : 'row' }
  return fallback
}

/** Where the video was before the workspace (the first video panel's five places), as a layout. */
function fromVideoPlace(saved: Record<string, unknown>): Layout {
  const place = saved.place
  if (place === 'right') return dock(DEFAULT_LAYOUT, 'video', 'notes', 'right')
  if (place === 'top' || place === 'bottom') return dock(DEFAULT_LAYOUT, 'video', 'area', place)
  const f = saved.float as Record<string, unknown> | undefined
  if (place === 'float' && f && ['x', 'y', 'w', 'h'].every((k) => typeof f[k] === 'number')) return float(DEFAULT_LAYOUT, 'video', f as unknown as { x: number; y: number; w: number; h: number })
  return DEFAULT_LAYOUT
}

function read(): Workspace {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Record<string, unknown> | null
    if (!saved) {
      const old = JSON.parse(localStorage.getItem(OLD_VIDEO_KEY) ?? 'null') as Record<string, unknown> | null
      return old ? { ...DEFAULT, layout: fromVideoPlace(old) } : DEFAULT
    }
    const bars = (saved.bars ?? {}) as Record<string, unknown>
    const beside = (saved.beside ?? {}) as Record<string, unknown>
    return {
      layout: layoutFrom(saved.layout),
      side: saved.side === true,
      bars: { tools: barFrom(bars.tools, DEFAULT.bars.tools), format: barFrom(bars.format, DEFAULT.bars.format) },
      beside: { video: beside.video !== false, program: beside.program !== false },
    }
  } catch {
    return DEFAULT
  }
}

export const workspace = new Shared<Workspace>(read())

function keep(next: Workspace): void {
  try {
    // The full view is for now, not for the next time.
    localStorage.setItem(KEY, JSON.stringify({ ...next, layout: { ...next.layout, full: undefined } }))
  } catch {
    // Storage is off: it lasts until the page closes.
  }
  workspace.set(next)
}

/** Change the layout, and keep it. */
export function changeLayout(change: (layout: Layout) => Layout): void {
  const layout = change(workspace.value.layout)
  if (layout !== workspace.value.layout) keep({ ...workspace.value, layout })
}

/** One panel over the whole workspace, or none. */
export function setFull(id: PanelId | undefined): void {
  changeLayout((layout) => ({ ...layout, full: id }))
}

export function setSideOpen(open: boolean): void {
  keep({ ...workspace.value, side: open, layout: !open && workspace.value.layout.full === 'side' ? { ...workspace.value.layout, full: undefined } : workspace.value.layout })
}

export function setBar(bar: BarId, place: BarPlace): void {
  keep({ ...workspace.value, bars: { ...workspace.value.bars, [bar]: place } })
}

/** The video or a program kept inside the Beside panel, or taken out into a panel of its own; with `change`, moved too. */
export function setInside(what: Inside, inside: boolean, change?: (layout: Layout) => Layout): void {
  const now = workspace.value
  const layout = change ? change(now.layout) : now.layout
  if (now.beside[what] === inside && layout === now.layout) return
  keep({ ...now, layout, beside: { ...now.beside, [what]: inside } })
}

/**
 * The video or a program put back inside the Beside panel: its place in the layout goes back to where the start has it
 * (the video above the panel, a program at the right), its room given back to the panel it was taken from, so the notes
 * are as wide as before it came out.
 */
export function putInside(what: Inside): void {
  setInside(what, true, (layout) => (what === 'video' ? dock(giveBack(layout, 'video'), 'video', 'side', 'top') : dock(giveBack(layout, 'program'), 'program', 'area', 'right')))
}

/** Back to how the workspace starts: the design sketch, the bars on top, the video and a program inside Beside. */
export function resetWorkspace(): void {
  keep({ ...DEFAULT, side: workspace.value.side })
}
