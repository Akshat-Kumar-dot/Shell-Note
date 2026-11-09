// A bar that moves: the tools, or the pen and format bar, along the top, down
// the left or right side, along the bottom, or floating as a box, like Windows Ink's. Its grip, dragged, carries it:
// let go near a side of the workspace it goes along that side, elsewhere it floats there. Tapped, the grip offers the
// places. Each person's own, kept in their browser.
import { GripVertical } from 'lucide-react'
import { memo, useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { commands } from '../commands/index.js'
import { useDismiss } from '../dismiss.js'
import { placeMenu } from '../popover.js'
import { setBar, workspace, type BarId, type BarPlace } from './state.js'
import { watchFloatingBar, watchStrip } from './stripFit.js'

/** Let go this near a side of the workspace, a bar goes along that side. */
const SNAP = 40

const PLACES: [BarPlace['at'], string][] = [
  ['top', 'Along the top'],
  ['left', 'Down the left side'],
  ['right', 'Down the right side'],
  ['bottom', 'Along the bottom'],
  ['float', 'Floating box'],
]

/** The workspace a bar moves over: the app's main area. */
const workspaceBox = (from: Element): DOMRect | undefined => from.closest('.app')?.querySelector('.main')?.getBoundingClientRect()

/** Drawn again only when its place or its bar changes: a key typed redraws the bar inside, not this. */
export const MovableBar = memo(function MovableBar({ id, label, children }: { id: BarId; label: string; children: ReactNode }) {
  const saved = useSyncExternalStore(workspace.subscribe, workspace.snapshot)
  const place = saved.bars[id]
  const dir = place.at === 'float' ? place.dir : place.at === 'left' || place.at === 'right' ? 'column' : 'row'
  const [menu, setMenu] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setMenu(false), [])
  useDismiss(menu, root, close)
  const dragged = useRef(false)

  // Floating and turned down, it stays in sight below where it is, in more columns if need be.
  const turnedDown = place.at === 'float' && dir === 'column'
  const from = place.at === 'float' ? place.y : 0
  useLayoutEffect(() => {
    const bar = root.current
    return turnedDown && bar ? watchFloatingBar(bar, () => workspaceBox(bar)) : undefined
  }, [turnedDown, from])

  /** The grip dragged: the bar floats under the pointer, and goes along a side when let go near it. */
  const grab = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    const box = workspaceBox(event.currentTarget)
    const bar = root.current?.getBoundingClientRect()
    if (!box || !bar) return
    const start = { x: event.clientX, y: event.clientY }
    const offset = { x: event.clientX - bar.left, y: event.clientY - bar.top }
    const turn = place.at === 'float' ? place.dir : 'row'
    dragged.current = false
    const move = (e: PointerEvent): void => {
      if (!dragged.current && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5) return
      dragged.current = true
      setMenu(false)
      setBar(id, { at: 'float', x: Math.round(Math.max(0, e.clientX - box.left - offset.x)), y: Math.round(Math.max(0, e.clientY - box.top - offset.y)), dir: turn })
    }
    const up = (e: PointerEvent): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      if (!dragged.current) return
      const near = [
        { at: 'left' as const, d: e.clientX - box.left },
        { at: 'right' as const, d: box.right - e.clientX },
        { at: 'top' as const, d: e.clientY - box.top },
        { at: 'bottom' as const, d: box.bottom - e.clientY },
      ]
        .filter((n) => n.d < SNAP)
        .sort((a, b) => a.d - b.d)[0]
      if (near) setBar(id, { at: near.at })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  /** One of the places, from the grip's menu (bar.place, bar.float); floating, where the bar is now, or near the workspace's top left. */
  const choose = (at: BarPlace['at']): void => {
    setMenu(false)
    if (at === 'float') commands.tap('bar.float', { bar: id })
    else commands.tap('bar.place', { bar: id, place: at })
  }

  return (
    <div className="nw-bar" ref={root} data-bar={id} data-at={place.at} data-dir={dir} style={place.at === 'float' ? { left: place.x, top: place.y } : undefined}>
      <button
        type="button"
        className="nw-bar-grip"
        aria-label={`Move the ${label}`}
        aria-haspopup="menu"
        aria-expanded={menu}
        title={`Drag to move the ${label}, or tap for its places`}
        onPointerDown={grab}
        onClick={() => {
          if (dragged.current) {
            dragged.current = false
            return
          }
          setMenu(!menu)
        }}
      >
        <GripVertical size={16} aria-hidden />
      </button>
      {children}
      {menu ? (
        <div ref={placeMenu} className="nw-popover nw-bar-menu" role="menu" aria-label={`Where the ${label} goes`}>
          {PLACES.map(([at, text]) => (
            <button key={at} type="button" role="menuitemradio" aria-checked={place.at === at} className="nw-bar-place" data-command={at === 'float' ? 'bar.float' : 'bar.place'} onClick={() => choose(at)}>
              {text}
            </button>
          ))}
          {place.at === 'float' ? (
            <button
              type="button"
              role="menuitem"
              className="nw-bar-place"
              data-command="bar.turn"
              onClick={() => {
                setMenu(false)
                commands.tap('bar.turn', { bar: id })
              }}
            >
              {place.dir === 'row' ? 'Turn it down' : 'Turn it across'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
})

/** The bars along one side of the workspace, out of the panels' way. */
export function BarStrip({ side, children }: { side: 'left' | 'right' | 'bottom'; children: ReactNode[] }) {
  const bars = children.filter((child) => child !== null && child !== false)
  const strip = useRef<HTMLDivElement>(null)
  const shown = bars.length > 0
  // Down a side, every option stays in sight (stripFit.ts). Along the bottom a strip's bars wrap by themselves.
  useLayoutEffect(() => (shown && side !== 'bottom' && strip.current ? watchStrip(strip.current) : undefined), [shown, side])
  if (!shown) return null
  return (
    <div className="nw-bar-strip" ref={strip} data-side={side}>
      {bars}
    </div>
  )
}
