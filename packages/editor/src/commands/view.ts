// The view, the panels and choosing blocks, as commands (app control, step
// 3a): each does what its button did, and the buttons now call them.
import { blockDetail, blockOf, blocksList, type Box, type Doc } from '@shellnote/core'
import { clampZoom, stepZoom } from '../geometry.js'
import { workspace as layout, resetWorkspace, setBar, setSideOpen, type BarId } from '../layout/state.js'
import { showSideTab, sideTab, type SideTab } from '../layout/sideTab.js'
import type { Commands } from './run.js'

const pct = (zoom: number): string => `${Math.round(zoom * 100)} %`

export function defineView(commands: Commands): void {
  commands.define('screen.zoom', ['workspace'], ({ percent, step }, { workspace }) => {
    const now = workspace.zoom()
    const next = typeof percent === 'number' ? clampZoom(percent / 100) : step === 'in' ? stepZoom(now, 1) : step === 'out' ? stepZoom(now, -1) : step === 'actual' ? 1 : undefined
    if (next === undefined) throw new Error('Give a percent (zoom to 150) or a step: in, out or actual.')
    workspace.setZoom(next)
    return `zoom ${pct(next)}`
  })
  commands.define('screen.page', ['note'], ({ page }, { note }) => {
    const pages = note.store.doc.pages
    const id = pages[(page as number) - 1]
    if (id === undefined) throw new Error(`The note has ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}.`)
    // Only pages near the screen are drawn, but every page has its slot: scrolled to it, the page is drawn there. (The
    // page itself was looked for, so a page far from the screen was never reached, and still said so.)
    const slot = document.querySelector(`.nw-page-slot[data-index="${(page as number) - 1}"]`)
    if (!slot) throw new Error('The pages are not on the screen now: open the note first (note.open).')
    slot.scrollIntoView({ block: 'start' })
    return `page ${String(page)} of ${pages.length}`
  })
  commands.define('screen.fullscreen', [], async ({ on }) => {
    if (on === false) {
      if (document.fullscreenElement) await document.exitFullscreen()
      return 'full screen off'
    }
    try {
      await document.documentElement.requestFullscreen()
    } catch {
      // The browser lets a page fill the screen only straight after a person's click or key.
      throw new Error('Full screen needs a click or a key from the person: the full screen button, or F11.')
    }
    return 'full screen on'
  })
  commands.define('panel.show', ['workspace'], ({ panel }) => {
    if (panel === 'side') setSideOpen(true)
    else showSideTab(panel as SideTab)
    return `side panel open on ${panel === 'side' ? sideTab.value : String(panel)}`
  })
  commands.define('panel.hide', ['workspace'], () => {
    setSideOpen(false)
    return 'side panel closed'
  })
  commands.define('bar.place', ['workspace'], ({ bar, place }) => {
    setBar(bar as BarId, { at: place as 'top' | 'bottom' | 'left' | 'right' })
    return `${String(bar)} bar at the ${String(place)}`
  })
  commands.define('bar.float', ['workspace'], ({ bar }) => {
    const id = bar as BarId
    const now = layout.value.bars[id]
    // Floating already, it stays where it is; else near the workspace's top left, as its menu puts it.
    if (now.at !== 'float') setBar(id, { at: 'float', x: 80, y: 80, dir: 'row' })
    return `${id} bar floating over the note`
  })
  commands.define('bar.turn', ['workspace'], ({ bar }) => {
    const id = bar as BarId
    const now = layout.value.bars[id]
    if (now.at !== 'float') throw new Error(`The ${id} bar is along a side, where it lies as the side does: bar.float first.`)
    setBar(id, { ...now, dir: now.dir === 'row' ? 'column' : 'row' })
    return `${id} bar turned ${now.dir === 'row' ? 'down' : 'across'}`
  })
  commands.define('layout.reset', ['workspace'], () => {
    resetWorkspace()
    return 'panels and bars where they start'
  })
  commands.define('note.blocks', ['note'], ({ page }, { note }) => blocksList(note.store.doc, page as number | undefined, drawnBoxes(note.store.doc)))
  commands.define('note.block', ['note'], ({ block }, { note }) => blockDetail(note.store.doc, String(block), drawnBoxes(note.store.doc)))
  commands.define('select.area', ['note'], async ({ page, x, y, w, h }, { note }) => {
    const doc = note.store.doc
    const pageId = doc.pages[(page as number) - 1]
    if (pageId === undefined) throw new Error(`The note has ${doc.pages.length} ${doc.pages.length === 1 ? 'page' : 'pages'}: no page ${String(page)}.`)
    const size = doc.page[pageId]!
    const units = (mm: unknown): number => Math.round((mm as number) * 100)
    const left = Math.min(size.w - 1, units(x))
    const top = Math.min(size.h - 1, units(y))
    const here = { page: pageId, x: left, y: top, w: Math.max(1, Math.min(size.w - left, units(w))), h: Math.max(1, Math.min(size.h - top, units(h))) }
    const sheet = typeof document === 'undefined' ? null : document.querySelector(`.nw-page[data-page="${CSS.escape(pageId)}"]`)
    if (!sheet) throw new Error(`Page ${String(page)} is not drawn now: screen.page page=${String(page)} first.`)
    // The box on the screen, as a Select box dragged over that place would be; then the Select box's own choice.
    const drawn = sheet.getBoundingClientRect()
    const across = drawn.width / size.w
    const down = drawn.height / size.h
    const rect = { left: drawn.left + here.x * across, top: drawn.top + here.y * down, right: drawn.left + (here.x + here.w) * across, bottom: drawn.top + (here.y + here.h) * down }
    const { regionChoice } = await import('../region.js')
    const choice = regionChoice(doc, pageId, sheet, rect, here)
    note.store.select(choice, 'objects')
    const words = [...new Set((choice.words ?? []).map((piece) => piece.block))]
    const held = [choice.blocks.length > 0 ? `the blocks ${choice.blocks.join(', ')}` : '', words.length > 0 ? `words of ${words.join(', ')}` : ''].filter(Boolean).join(' and ')
    return `area chosen on page ${String(page)}, at ${here.x / 100}, ${here.y / 100} mm, ${here.w / 100} × ${here.h / 100} mm: it holds ${held || 'nothing yet, so what is put there goes into it'}`
  })
  commands.define('select.blocks', ['note'], ({ blocks }, { note }) => {
    // Each by its id, or by its words, never a guess.
    const ids = [...new Set((blocks as string[]).map((written) => blockOf(note.store.doc, written)))]
    note.store.select({ blocks: ids }, 'objects')
    return `chosen: ${ids.join(', ')}`
  })
  commands.define('select.none', ['note'], (_, { note }) => {
    note.store.select({ blocks: [] }, 'objects')
    return 'nothing chosen'
  })
}

/**
 * Each drawn block's box on its page, in the note's units, measured where the pages are drawn now: a block inside a
 * frame has no place of its own in the data. Pages not drawn, and blocks with no size, are left out.
 */
export function drawnBoxes(doc: Doc): Map<string, Box & { page: string }> {
  const boxes = new Map<string, Box & { page: string }>()
  if (typeof document === 'undefined') return boxes
  for (const pageId of doc.pages) {
    const sheet = document.querySelector<HTMLElement>(`.nw-page[data-page="${CSS.escape(pageId)}"]`)
    const page = doc.page[pageId]
    if (!sheet || !page) continue
    const drawn = sheet.getBoundingClientRect()
    if (drawn.width === 0) continue
    const per = page.w / drawn.width
    for (const element of sheet.querySelectorAll<HTMLElement>('[data-id]')) {
      const id = element.dataset.id
      if (id === undefined || boxes.has(id) || doc.block[id] === undefined) continue
      const box = element.getBoundingClientRect()
      if (box.width === 0 && box.height === 0) continue
      boxes.set(id, { x: Math.round((box.left - drawn.left) * per), y: Math.round((box.top - drawn.top) * per), w: Math.round(box.width * per), h: Math.round(box.height * per), page: pageId })
    }
  }
  return boxes
}

/** The view's line of the app-state map. */
export function viewLine(zoom: number | undefined): string | undefined {
  if (zoom === undefined) return undefined
  const saved = layout.value
  const bars = Object.entries(saved.bars).map(([bar, place]) => `${bar} ${place.at}`).join(', ')
  return `zoom ${pct(zoom)} · side panel ${saved.side ? `open on ${sideTab.value}` : 'closed'} · bars ${bars} · full view ${saved.layout.full ?? 'off'} · full screen ${typeof document !== 'undefined' && document.fullscreenElement ? 'on' : 'off'}`
}
