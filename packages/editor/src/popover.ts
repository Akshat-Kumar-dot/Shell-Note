// Where a menu opened from a button goes. With a bar down a side, the colour panel was cut off by the strip the bar sits in,
// made that strip scroll sideways, or ran off the screen. So a menu is placed against the window, never its parent:
// `position: fixed`, which a scrolling strip cannot cut off. It opens towards the room: from a bar on the left to its right,
// on the right to its left, along the bottom upwards; anything else below, or above when only there is there room. It stays
// on the screen, and scrolls inside itself only when it is taller than the window.
//
// Give a menu `ref={placeMenu}`. It stays where it is in the page's tree, so a press inside it is still inside its button's
// group (useDismiss), and the menu is drawn in the right place before the first paint.

/** Between a menu and its button, and at least between a menu and the window's edge, in pixels. */
const GAP = 6
const MARGIN = 8

/** What a menu opens from: the group holding its button. A bar's own menu has only the grip beside it. */
const ANCHORS = '.nw-popover-anchor, .nw-font-menu, .nw-table-picker, .nw-menu-anchor, .nw-chat-plus'

type Side = 'below' | 'above' | 'right' | 'left'
const OPPOSITE: Record<Side, Side> = { below: 'above', above: 'below', right: 'left', left: 'right' }

function anchorOf(menu: HTMLElement): Element | null {
  const parent = menu.parentElement
  return parent?.closest(ANCHORS) ?? parent?.querySelector(':scope > .nw-bar-grip') ?? parent ?? null
}

/** The side a menu would rather open on, from where its bar is. A floating bar opens towards the larger part of the window. */
function wantedSide(menu: HTMLElement, at: DOMRect): Side {
  const bar = menu.closest<HTMLElement>('.nw-bar')
  switch (bar?.dataset.at) {
    case 'left':
      return 'right'
    case 'right':
      return 'left'
    case 'bottom':
      return 'above'
    case 'float':
      if (bar.dataset.dir === 'column') return at.left + at.width / 2 < window.innerWidth / 2 ? 'right' : 'left'
      return at.top + at.height / 2 < window.innerHeight / 2 ? 'below' : 'above'
    default:
      return 'below'
  }
}

const within = (value: number, least: number, most: number): number => Math.max(least, Math.min(most, value))

function place(menu: HTMLElement): void {
  const anchor = anchorOf(menu)
  if (!anchor) return
  const at = anchor.getBoundingClientRect()
  const { style } = menu
  const [wide, high] = [window.innerWidth, window.innerHeight]

  // Back to its own size, at the window's corner: where that lands tells of an ancestor that moves `fixed` (none today).
  Object.assign(style, { position: 'fixed', left: '0px', top: '0px', right: 'auto', bottom: 'auto', transform: 'none', maxWidth: `${wide - 2 * MARGIN}px`, maxHeight: '', overflowY: '' })
  const own = menu.getBoundingClientRect()
  const w = own.width
  let h = own.height
  if (h > high - 2 * MARGIN) {
    h = high - 2 * MARGIN
    Object.assign(style, { maxHeight: `${h}px`, overflowY: 'auto' })
  }

  const room: Record<Side, number> = { below: high - at.bottom - GAP - MARGIN, above: at.top - GAP - MARGIN, right: wide - at.right - GAP - MARGIN, left: at.left - GAP - MARGIN }
  let side = wantedSide(menu, at)
  const needs = side === 'below' || side === 'above' ? h : w
  if (room[side] < needs && room[OPPOSITE[side]] > room[side]) side = OPPOSITE[side]

  const across = side === 'below' || side === 'above'
  const x = across ? at.left + at.width / 2 - w / 2 : side === 'right' ? at.right + GAP : at.left - GAP - w
  const y = !across ? at.top : side === 'below' ? at.bottom + GAP : at.top - GAP - h
  style.left = `${Math.round(within(x, MARGIN, wide - MARGIN - w) - own.left)}px`
  style.top = `${Math.round(within(y, MARGIN, high - MARGIN - h) - own.top)}px`
}

/** A menu that opens at the pointer, already `position: fixed`: moved only as far as it takes to be whole on the screen. */
export function keepOnScreen(menu: HTMLElement): void {
  const { style } = menu
  const [wide, high] = [window.innerWidth, window.innerHeight]
  const own = menu.getBoundingClientRect()
  let h = own.height
  if (h > high - 2 * MARGIN) {
    h = high - 2 * MARGIN
    Object.assign(style, { maxHeight: `${h}px`, overflowY: 'auto' })
  }
  style.left = `${Math.round(within(own.left, MARGIN, wide - MARGIN - own.width))}px`
  style.top = `${Math.round(within(own.top, MARGIN, high - MARGIN - h))}px`
}

/**
 * A menu's ref: places it now, and again whenever the window, the menu's size or anything scrolling round its button changes,
 * until it closes. A scroll inside the menu itself moves nothing.
 */
export function placeMenu(menu: HTMLElement | null): (() => void) | void {
  if (!menu) return
  const again = (event?: Event): void => {
    if (event?.target instanceof Node && menu.contains(event.target)) return
    place(menu)
  }
  place(menu)
  const size = new ResizeObserver(() => again())
  size.observe(menu)
  window.addEventListener('resize', again)
  window.addEventListener('scroll', again, true)
  return () => {
    size.disconnect()
    window.removeEventListener('resize', again)
    window.removeEventListener('scroll', again, true)
  }
}
