// A bar down a side shows every one of its options. A bar taller than the window used to run past its bottom edge, and
// with both bars on one side nothing of the second showed but its first button. So, measured each time and never set by
// sizes: first the buttons grow shorter; if that is not enough, a bar runs on into another column as words run on to another
// line, and two bars stand side by side. Only a window hardly taller than one group of buttons still scrolls, up and down.

/** The strip's own, and a floating bar's, menus: opening one changes nothing about how the bar fits. */
const MENUS = '.nw-popover, .nw-font-library, .nw-table-grid, .nw-dropdown'

const STYLES = ['box-sizing', 'flex-wrap', 'height', 'width', 'align-content', 'justify-content']

const contentOf = (bar: HTMLElement): HTMLElement | null => bar.querySelector<HTMLElement>(':scope > .nw-toolstrip, :scope > .nw-formatbar')

function asOneColumn(bar: HTMLElement): void {
  const content = contentOf(bar)
  if (content) for (const name of STYLES) content.style.removeProperty(name)
}

/**
 * Lets a bar's groups run on into more columns, the bar at most `room` pixels high. A flex box of columns does not grow across
 * by itself as they wrap, in any browser, so it is told how wide they came to.
 */
function intoColumns(bar: HTMLElement, room: number): void {
  const content = contentOf(bar)
  if (!content) return
  const grip = bar.querySelector<HTMLElement>(':scope > .nw-bar-grip')?.offsetHeight ?? 0
  const height = Math.max(0, room - grip - 2)
  if (content.offsetHeight <= height) return
  Object.assign(content.style, { boxSizing: 'border-box', flexWrap: 'wrap', height: `${height}px`, alignContent: 'flex-start', justifyContent: 'flex-start' })
  const style = getComputedStyle(content)
  const left = content.getBoundingClientRect().left
  const right = Math.max(...[...content.children].map((kid) => kid.getBoundingClientRect().right))
  content.style.width = `${Math.ceil(right - left + parseFloat(style.paddingRight) + parseFloat(style.borderRightWidth))}px`
}

/** Calls `fit` now, and whenever the element's height or the buttons inside it change. Returns the function that stops. */
function whenChanged(element: HTMLElement, fit: () => void): () => void {
  fit()
  let high = element.clientHeight
  const size = new ResizeObserver(() => {
    // Only its height: what `fit` sets is its width.
    if (element.clientHeight === high) return
    high = element.clientHeight
    fit()
  })
  size.observe(element)
  const buttons = new MutationObserver((records) => {
    const ours = (node: Node): boolean => node instanceof Element && (node.matches(MENUS) || node.closest(MENUS) !== null)
    if (records.some((record) => !ours(record.target) && ![...record.addedNodes, ...record.removedNodes].every(ours))) fit()
  })
  buttons.observe(element, { childList: true, subtree: true })
  return () => {
    size.disconnect()
    buttons.disconnect()
  }
}

/**
 * Keeps a side strip's bars all in sight. Its width only grows while the window's height and the strip's bars stay the same, so
 * choosing another tool, whose bar is shorter, does not move the note a person is writing on.
 */
export function watchStrip(strip: HTMLElement): () => void {
  let widest = 0
  let high = -1
  let count = 0
  const stop = whenChanged(strip, () => {
    const bars = [...strip.querySelectorAll<HTMLElement>(':scope > .nw-bar')]
    if (strip.clientHeight !== high || bars.length !== count) {
      widest = 0
      high = strip.clientHeight
      count = bars.length
    }
    bars.forEach(asOneColumn)
    delete strip.dataset.fit
    strip.style.removeProperty('width')
    const style = getComputedStyle(strip)
    const room = strip.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
    const stacked = (): number => bars.reduce((sum, bar) => sum + bar.offsetHeight, 0) + parseFloat(style.rowGap || '0') * (bars.length - 1)
    if (stacked() > room) {
      strip.dataset.fit = 'short'
      if (stacked() > room) {
        strip.dataset.fit = 'columns'
        bars.forEach((bar) => intoColumns(bar, room))
      }
    }
    // A multiple of 4 pixels, so the panels beside it start on a whole screen pixel (the strip's own rule in theme.css).
    strip.style.width = 'max-content'
    const needs = Math.ceil(strip.getBoundingClientRect().width / 4) * 4
    strip.style.removeProperty('width')
    const usual = strip.offsetWidth
    widest = Math.max(widest, needs, usual)
    if (widest > usual) strip.style.width = `${widest}px`
  })
  return () => {
    stop()
    strip.querySelectorAll<HTMLElement>(':scope > .nw-bar').forEach(asOneColumn)
  }
}

/** Keeps a bar floating and turned down within the workspace below it, in as many columns as that takes. */
export function watchFloatingBar(bar: HTMLElement, workspace: () => DOMRect | undefined): () => void {
  const stop = whenChanged(bar, () => {
    asOneColumn(bar)
    const box = workspace()
    if (box) intoColumns(bar, box.bottom - bar.getBoundingClientRect().top - 8)
  })
  return () => {
    stop()
    asOneColumn(bar)
  }
}
