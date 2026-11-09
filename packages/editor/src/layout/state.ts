// The workspace as each person left it, kept in their browser, never in a note:
// where the panels are, which are open, and where each bar is.
import { Shared } from '../video/state.js'
import { DEFAULT_LAYOUT, dock, float, layoutFrom, type Layout, type PanelId } from './tree.js'

/** A bar along a side of the workspace, or floating as a box at a place, across or down. */
export type BarPlace = { at: 'top' | 'bottom' | 'left' | 'right' } | { at: 'float'; x: number; y: number; dir: 'row' | 'column' }
export type BarId = 'tools' | 'format'

export interface Workspace {
  layout: Layout
  /** The side panel open, beside the notes. */
  side: boolean
  bars: Record<BarId, BarPlace>
}

const KEY = 'shellnote:workspace'
const OLD_VIDEO_KEY = 'shellnote:video-layout'
const DEFAULT: Workspace = { layout: DEFAULT_LAYOUT, side: false, bars: { tools: { at: 'top' }, format: { at: 'top' } } }

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
    return { layout: layoutFrom(saved.layout), side: saved.side === true, bars: { tools: barFrom(bars.tools, DEFAULT.bars.tools), format: barFrom(bars.format, DEFAULT.bars.format) } }
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

/** Back to how the workspace starts: the design sketch, the bars on top. */
export function resetWorkspace(): void {
  keep({ ...DEFAULT, side: workspace.value.side })
}
