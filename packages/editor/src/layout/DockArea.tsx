// The workspace's panels, docked like Obsidian's panes: each drawn at the
// place its layout gives it, in one flat list, so docking it elsewhere moves it and never makes it again (a playing
// video plays on). The edges between panels drag. A panel dragged by its bar shows where it would go, a side of
// another panel or of the whole area, and docks there; the video let go elsewhere floats there. A full view fills the
// area with one panel; Esc brings the layout back. The video and a program kept inside the Beside panel are drawn over
// the place Beside keeps for them (beside.ts), and are out of sight while it shows another part; dragged out, they
// dock or float where they are let go.
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'
import { commands } from '../commands/index.js'
import { besideSlot } from './beside.js'
import { changeLayout, setFull, setInside, workspace, type Inside } from './state.js'
import { dock, dragged, float, leastOf, PANEL_LEAST, PANELS, placesOf, withSizes, type Layout, type Node, type PanelId, type Rect, type Side, type Splitter } from './tree.js'

/** Where a panel is against the notes: beside, above or below them, floating, or inside the Beside panel. */
export type Where = 'left' | 'right' | 'top' | 'bottom' | 'float' | 'beside'

/** What a panel knows of its place, and how it asks to move. */
export interface PanelPlace {
  id: PanelId
  floating: boolean
  where: Where | undefined
  /** Not shown just now: another panel is in full view. */
  hidden: boolean
  full: boolean
  /** Start dragging the panel by its bar, to dock it elsewhere, or move it while it floats. */
  grab(event: ReactPointerEvent): void
  /** Floating: its place and size, changed from one of its edges or corners; kept when `done`. */
  rect: Rect | undefined
  area(): Rect
  setFloat(rect: Rect, done: boolean): void
}
const PanelContext = createContext<PanelPlace | undefined>(undefined)
export const usePanel = (): PanelPlace | undefined => useContext(PanelContext)

/** Where a dragged panel would go: a side of another panel, or of the whole area; and the room it would take. */
interface Zone {
  target: PanelId | 'area'
  side: Side
  preview: Rect
}

/** Within this many pixels of the area's edge, a panel docks at that side of the whole area. */
const AREA_EDGE = 28
/** Within this share of a panel's width or height from its edge, a panel docks at that side of it. */
const PANEL_EDGE = 0.3

/**
 * Where a dragged panel would dock with the pointer at x, y, and the box to show for it: a side of the whole area when
 * within AREA_EDGE of it (first, since that strip lies over the panels at the edge), else the nearest side of the panel
 * under the pointer when within PANEL_EDGE of it. In the middle of a panel, nowhere.
 */
function zoneAt(x: number, y: number, area: Rect, rects: Partial<Record<PanelId, Rect>>, floating: readonly PanelId[], moving: PanelId): Zone | undefined {
  const near = [
    { side: 'left' as const, d: x - area.x, preview: { ...area, w: Math.round(area.w * 0.35) } },
    { side: 'right' as const, d: area.x + area.w - x, preview: { ...area, x: area.x + Math.round(area.w * 0.65), w: Math.round(area.w * 0.35) } },
    { side: 'top' as const, d: y - area.y, preview: { ...area, h: Math.round(area.h * 0.35) } },
    { side: 'bottom' as const, d: area.y + area.h - y, preview: { ...area, y: area.y + Math.round(area.h * 0.65), h: Math.round(area.h * 0.35) } },
  ]
    .filter((n) => n.d >= 0 && n.d < AREA_EDGE)
    .sort((a, b) => a.d - b.d)[0]
  if (near) return { target: 'area', side: near.side, preview: near.preview }
  for (const id of PANELS) {
    const r = rects[id]
    if (!r || id === moving || floating.includes(id) || x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) continue
    const fx = (x - r.x) / r.w
    const fy = (y - r.y) / r.h
    const sides = [
      { side: 'left' as const, d: fx, preview: { ...r, w: Math.round(r.w / 2) } },
      { side: 'right' as const, d: 1 - fx, preview: { ...r, x: r.x + Math.round(r.w / 2), w: Math.round(r.w / 2) } },
      { side: 'top' as const, d: fy, preview: { ...r, h: Math.round(r.h / 2) } },
      { side: 'bottom' as const, d: 1 - fy, preview: { ...r, y: r.y + Math.round(r.h / 2), h: Math.round(r.h / 2) } },
    ]
      .filter((s) => s.d < PANEL_EDGE)
      .sort((a, b) => a.d - b.d)
    const best = sides[0]
    return best ? { target: id, side: best.side, preview: best.preview } : undefined
  }
  return undefined
}

/** The kid of a split at a path in the tree. */
function nodeAt(node: Node, path: readonly number[]): Node {
  return path.reduce((n, i) => (n.kind === 'split' ? n.kids[i]! : n), node)
}

const px = (r: Rect) => ({ left: r.x, top: r.y, width: r.w, height: r.h })

/**
 * The panels, in one flat list under one element, each placed absolutely where the layout puts it: docking never gives a
 * panel another parent, which would remake it and stop a playing video. A drag shows its layout as `draft`, and that
 * goes to the saved layout only on release, so a drag saves once and not on every move.
 */
export function DockArea({ panels }: { panels: Record<PanelId, ReactNode | null> }) {
  const saved = useSyncExternalStore(workspace.subscribe, workspace.snapshot)
  const host = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  // A drag under way: the layout as it would be (an edge, a floating panel moved), and where a dragged panel would go.
  const [draft, setDraft] = useState<Layout>()
  const [moving, setMoving] = useState<{ id: PanelId; ghost: Rect; zone: Zone | undefined }>()
  const slot = useSyncExternalStore(besideSlot.subscribe, besideSlot.snapshot)
  const layout = draft ?? saved.layout
  /** Kept inside the Beside panel: placed there, not by the layout. */
  const inside = (id: PanelId): id is Inside => (id === 'video' || id === 'program') && saved.beside[id]
  const shown = (id: PanelId): boolean => panels[id] !== null && !inside(id)
  // Which panels are shown, and where, as one value: a key typed in the notes changes none of what the places are worked out from.
  const showing = PANELS.map((id) => (panels[id] === null ? '-' : inside(id) ? `(${id})` : id)).join(' ')
  const area: Rect = useMemo(() => ({ x: 0, y: 0, w: size.w, h: size.h }), [size.w, size.h])
  // A panel kept inside Beside in full view fills the area alone, as any other does.
  const fullInside = layout.full !== undefined && inside(layout.full) && panels[layout.full] !== null ? layout.full : undefined
  // The panel beside the notes holding a video is at least as tall as its head, the video and a few of its lines.
  const smallest = useMemo(() => (slot?.for === 'video' && inside('video') && panels.video !== null ? { ...PANEL_LEAST, side: { w: PANEL_LEAST.side.w, h: slot.y + slot.h + 120 } } : PANEL_LEAST), [slot, showing])
  // `showing` stands for `shown` among what they hang on.
  const placed = useMemo(() => (fullInside ? { rects: { [fullInside]: area }, floating: [], splitters: [] } : placesOf(layout, area, shown, smallest)), [layout, area, showing, fullInside, smallest])
  // The video or a program inside Beside: over the place it keeps, while Beside shows it (and nothing else is in full view).
  const places = useMemo(() => {
    const side = placed.rects.side
    const rects = { ...placed.rects }
    for (const id of ['video', 'program'] as const) {
      if (!inside(id) || panels[id] === null || fullInside) continue
      if (side && slot?.for === id && (layout.full === undefined || layout.full === 'side')) rects[id] = { x: side.x + slot.x, y: side.y + slot.y, w: slot.w, h: slot.h }
    }
    return { ...placed, rects }
  }, [placed, slot, showing, fullInside, layout.full])
  // Where each panel was last: one hidden by a full view keeps its size, so a video player is not squeezed to nothing.
  const last = useRef<Partial<Record<PanelId, Rect>>>({})
  for (const id of PANELS) if (places.rects[id]) last.current[id] = places.rects[id]

  useLayoutEffect(() => {
    const element = host.current
    if (!element) return
    const measure = (): void => setSize({ w: element.clientWidth, h: element.clientHeight })
    measure()
    const watcher = new ResizeObserver(measure)
    watcher.observe(element)
    return () => watcher.disconnect()
  }, [])

  // Esc leaves the full view, when nothing else took it.
  useEffect(() => {
    if (!layout.full) return
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) setFull(undefined)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [layout.full])

  const local = (event: { clientX: number; clientY: number }): { x: number; y: number } => {
    const box = host.current!.getBoundingClientRect()
    return { x: event.clientX - box.left, y: event.clientY - box.top }
  }

  /** The edge between two panels, dragged. */
  const pull = (event: ReactPointerEvent, splitter: Splitter): void => {
    if (event.button !== 0) return
    event.preventDefault()
    const root = saved.layout.root
    const least = (i: number): number => {
      const l = leastOf(nodeAt(root, [...splitter.path, i]), shown, smallest)
      return splitter.dir === 'row' ? l.w : l.h
    }
    const bounds = { a: least(splitter.a), b: least(splitter.b) }
    let next = saved.layout
    const move = (e: PointerEvent): void => {
      const p = local(e)
      next = withSizes(saved.layout, splitter.path, dragged(splitter, splitter.dir === 'row' ? p.x : p.y, bounds))
      setDraft(next)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      changeLayout(() => next)
      setDraft(undefined)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  /** A panel dragged by its bar: docked where it is let go, floated (the video, the side panel), or moved while floating. */
  const grab = (event: ReactPointerEvent, id: PanelId): void => {
    if (event.button !== 0 || (event.target as Element).closest('button, input, select, a')) return
    const from = places.rects[id]
    if (!from) return
    event.preventDefault()
    const start = local(event)
    const isFloating = places.floating.includes(id)
    const offset = { x: start.x - from.x, y: start.y - from.y }
    let started = false
    let zone: Zone | undefined
    let ghost = from
    const move = (e: PointerEvent): void => {
      const p = local(e)
      if (!started && Math.hypot(p.x - start.x, p.y - start.y) < 5) return
      started = true
      const w = isFloating ? from.w : Math.min(from.w, 480)
      const h = isFloating ? from.h : Math.min(from.h, 320)
      ghost = { x: Math.round(p.x - Math.min(offset.x, w - 40)), y: Math.round(p.y - Math.min(offset.y, 20)), w, h }
      // Not onto what is kept inside Beside: it lies over Beside itself.
      zone = zoneAt(p.x, p.y, area, places.rects, [...places.floating, ...PANELS.filter(inside)], id)
      if (isFloating) setDraft(float(saved.layout, id, ghost))
      setMoving({ id, ghost, zone })
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      setMoving(undefined)
      setDraft(undefined)
      if (!started) return
      const to = (layout: Layout): Layout => (zone ? dock(layout, id, zone.target, zone.side) : id === 'notes' ? layout : float(layout, id, { ...ghost, w: Math.max(ghost.w, PANEL_LEAST[id].w), h: Math.max(ghost.h, PANEL_LEAST[id].h) }))
      // Out of Beside, by being dragged: it goes where it is let go.
      if (inside(id)) setInside(id, false, to)
      else changeLayout(to)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const whereOf = (id: PanelId): Where | undefined => {
    if (inside(id)) return 'beside'
    if (places.floating.includes(id)) return 'float'
    const r = places.rects[id]
    const n = places.rects.notes
    if (!r || !n || id === 'notes') return undefined
    if (r.x + r.w <= n.x) return 'left'
    if (r.x >= n.x + n.w) return 'right'
    if (r.y + r.h <= n.y) return 'top'
    if (r.y >= n.y + n.h) return 'bottom'
    return undefined
  }

  const placeOf = (id: PanelId): PanelPlace => ({
    id,
    floating: places.floating.includes(id),
    where: whereOf(id),
    hidden: !places.rects[id],
    full: layout.full === id,
    grab: (event) => grab(event, id),
    rect: places.floating.includes(id) ? places.rects[id] : undefined,
    area: () => area,
    setFloat: (rect, done) => {
      if (!done) return setDraft(float(saved.layout, id, rect))
      setDraft(undefined)
      changeLayout((layout) => float(layout, id, rect))
    },
  })

  return (
    <div className="nw-dock" ref={host} data-dragging={draft || moving ? '' : undefined} data-full={layout.full ?? undefined}>
      {size.w > 0
        ? PANELS.map((id) => {
            const content = panels[id]
            if (content === null) return null
            const rect = places.rects[id] ?? last.current[id] ?? area
            const place = placeOf(id)
            // Its top at the window's top right, under the app's own window buttons, which its head keeps clear of.
            const corner = !place.floating && !place.hidden && rect.y === 0 && rect.x + rect.w >= area.w
            return (
              <div key={id} className="nw-dock-panel" data-panel={id} data-floating={place.floating ? '' : undefined} data-inside={inside(id) ? '' : undefined} data-hidden={place.hidden ? '' : undefined} data-top-right={corner ? '' : undefined} style={px(rect)}>
                <PanelContext.Provider value={place}>{content}</PanelContext.Provider>
              </div>
            )
          })
        : null}
      {places.splitters.map((splitter) => (
        <div
          key={`${splitter.path.join('.')}:${splitter.a}`}
          className="nw-dock-splitter"
          data-dir={splitter.dir}
          style={px(splitter.at)}
          role="separator"
          aria-orientation={splitter.dir === 'row' ? 'vertical' : 'horizontal'}
          aria-label="Drag to share the room between these panels"
          onPointerDown={(event) => pull(event, splitter)}
        />
      ))}
      {moving && !places.floating.includes(moving.id) ? <div className="nw-dock-ghost" style={px(moving.ghost)} aria-hidden /> : null}
      {moving?.zone ? <div className="nw-dock-drop" style={px(moving.zone.preview)} aria-hidden /> : null}
    </div>
  )
}

/** The full view button on a panel's bar: the panel over the whole workspace, and back. */
export function useFullView(): { full: boolean; toggle: () => void } | undefined {
  const panel = usePanel()
  if (!panel) return undefined
  // The program panel is not among app control's panes yet (its commands are stage 5's): its full view is set here.
  if (panel.id === 'program') return { full: panel.full, toggle: () => setFull(panel.full ? undefined : 'program') }
  return { full: panel.full, toggle: () => commands.tap('panel.full', panel.full ? { on: false } : { pane: panel.id }) }
}
