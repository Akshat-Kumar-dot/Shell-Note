// The workspace's layout: panels docked in a tree of splits, floating, or in full view.
import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYOUT, dock, dragged, float, giveBack, layoutFrom, placesOf, withSizes, type Layout, type PanelId } from '../src/layout/tree.js'

const AREA = { x: 0, y: 0, w: 1200, h: 800 }
const only =
  (...ids: PanelId[]) =>
  (id: PanelId): boolean =>
    ids.includes(id)
/** The three panels of the design sketch, the video taken out of Beside; the program panel is shown only in the app on Windows. */
const all = only('notes', 'video', 'side')

describe('the workspace layout', () => {
  it('starts as designed: the notes, and on their right the panel beside them, the video above it when taken out', () => {
    // 1200 by 0.69 is 828: the edge falls on a 4-pixel step.
    expect(placesOf(DEFAULT_LAYOUT, AREA, all).rects).toEqual({
      notes: { x: 0, y: 0, w: 828, h: 800 },
      video: { x: 828, y: 0, w: 372, h: 440 },
      side: { x: 828, y: 440, w: 372, h: 360 },
    })
  })

  it('gives a hidden panel’s room to the others, and keeps its place for when it comes back', () => {
    expect(placesOf(DEFAULT_LAYOUT, AREA, only('notes', 'video')).rects).toEqual({ notes: { x: 0, y: 0, w: 828, h: 800 }, video: { x: 828, y: 0, w: 372, h: 800 } })
    expect(placesOf(DEFAULT_LAYOUT, AREA, only('notes')).rects).toEqual({ notes: AREA })
    expect(placesOf(DEFAULT_LAYOUT, AREA, only('notes')).splitters).toEqual([])
  })

  it('docks a panel beside another, taking half its room, or at a side of the whole area', () => {
    // Right of the notes: the two share the notes' 828 pixels; the panel beside them keeps its own.
    const right = dock(DEFAULT_LAYOUT, 'video', 'notes', 'right')
    expect(placesOf(right, AREA, all).rects).toEqual({ notes: { x: 0, y: 0, w: 412, h: 800 }, video: { x: 412, y: 0, w: 416, h: 800 }, side: { x: 828, y: 0, w: 372, h: 800 } })
    const top = dock(DEFAULT_LAYOUT, 'video', 'area', 'top')
    expect(placesOf(top, AREA, all).rects.video).toEqual({ x: 0, y: 0, w: 1200, h: 280 })
    expect(placesOf(top, AREA, all).rects.notes).toEqual({ x: 0, y: 280, w: 828, h: 520 })
    // Below the notes alone.
    const under = dock(DEFAULT_LAYOUT, 'side', 'notes', 'bottom')
    expect(placesOf(under, AREA, all).rects).toEqual({ notes: { x: 0, y: 0, w: 828, h: 400 }, side: { x: 0, y: 400, w: 828, h: 400 }, video: { x: 828, y: 0, w: 372, h: 800 } })
  })

  it('floats a panel over the others, kept inside the area; the notes never float', () => {
    const floating = float(DEFAULT_LAYOUT, 'video', { x: 1000, y: -50, w: 480, h: 300 })
    const places = placesOf(floating, AREA, all)
    expect(places.floating).toEqual(['video'])
    expect(places.rects.video).toEqual({ x: 720, y: 0, w: 480, h: 300 })
    expect(places.rects.side).toEqual({ x: 828, y: 0, w: 372, h: 800 })
    expect(float(DEFAULT_LAYOUT, 'notes', { x: 0, y: 0, w: 10, h: 10 })).toBe(DEFAULT_LAYOUT)
    // Docked again from floating.
    expect(placesOf(dock(floating, 'video', 'notes', 'top'), AREA, all).rects.video).toEqual({ x: 0, y: 0, w: 828, h: 400 })
  })

  it('shows one panel over the whole area in full view, and only it', () => {
    const full: Layout = { ...DEFAULT_LAYOUT, full: 'notes' }
    expect(placesOf(full, AREA, all)).toEqual({ rects: { notes: AREA }, floating: [], splitters: [] })
    // A full view of a hidden panel is no full view.
    expect(Object.keys(placesOf({ ...DEFAULT_LAYOUT, full: 'side' }, AREA, only('notes', 'video')).rects)).toEqual(['notes', 'video'])
  })

  it('drags the edge between two panels, each kept at least its smallest', () => {
    const places = placesOf(DEFAULT_LAYOUT, AREA, all)
    const between = places.splitters.find((s) => s.dir === 'row')!
    expect(between.at).toEqual({ x: 828, y: 0, w: 0, h: 800 })
    // The notes' least is 240, the panel beside them 224.
    const narrower = withSizes(DEFAULT_LAYOUT, between.path, dragged(between, 600, { a: 240, b: 224 }))
    expect(placesOf(narrower, AREA, all).rects.notes).toEqual({ x: 0, y: 0, w: 600, h: 800 })
    const most = withSizes(DEFAULT_LAYOUT, between.path, dragged(between, 1190, { a: 240, b: 224 }))
    expect(placesOf(most, AREA, all).rects.side!.w).toBe(224)
    const least = withSizes(DEFAULT_LAYOUT, between.path, dragged(between, 10, { a: 240, b: 224 }))
    expect(placesOf(least, AREA, all).rects.notes!.w).toBe(240)
  })

  it('reads a layout back from storage, or starts again when it is not one', () => {
    expect(layoutFrom(JSON.parse(JSON.stringify(dock(DEFAULT_LAYOUT, 'video', 'notes', 'right'))))).toEqual(dock(DEFAULT_LAYOUT, 'video', 'notes', 'right'))
    expect(layoutFrom('nonsense')).toBe(DEFAULT_LAYOUT)
    expect(layoutFrom({ root: { kind: 'panel', id: 'video' } })).toBe(DEFAULT_LAYOUT)
    const twice = { root: { kind: 'split', dir: 'row', sizes: [1, 1], kids: [{ kind: 'panel', id: 'notes' }, { kind: 'panel', id: 'notes' }] } }
    expect(layoutFrom(twice)).toBe(DEFAULT_LAYOUT)
    // A panel missing comes back on the notes' right.
    const placed = layoutFrom({ root: { kind: 'panel', id: 'notes' }, floating: { video: { x: 10, y: 10, w: 400, h: 300 } } })
    expect(placed.floating.video).toEqual({ x: 10, y: 10, w: 400, h: 300 })
    expect(Object.keys(placesOf(placed, AREA, all).rects).sort()).toEqual(['notes', 'side', 'video'])
    // A layout kept before the program panel existed: while no program is shown, the panels are as they were (the
    // notes not narrowed); shown, the program is at the right, its room taken from all of them alike.
    expect(placesOf(placed, AREA, all).rects).toEqual({ notes: { x: 0, y: 0, w: 600, h: 800 }, side: { x: 600, y: 0, w: 600, h: 800 }, video: { x: 10, y: 10, w: 400, h: 300 } })
    expect(placesOf(placed, AREA, only('notes', 'program')).rects).toEqual({ notes: { x: 0, y: 0, w: 576, h: 800 }, program: { x: 576, y: 0, w: 624, h: 800 } })
    // The person's sketch kept before it: the notes keep their 720 pixels.
    const sketch = { root: { kind: 'split', dir: 'row', sizes: [0.4, 0.6], kids: [{ kind: 'split', dir: 'column', sizes: [0.55, 0.45], kids: [{ kind: 'panel', id: 'video' }, { kind: 'panel', id: 'side' }] }, { kind: 'panel', id: 'notes' }] }, floating: {} }
    expect(placesOf(layoutFrom(sketch), AREA, all).rects.notes).toEqual({ x: 480, y: 0, w: 720, h: 800 })
  })

  it('never gives a panel less than its least where there is room, and stacks panels a narrow screen cannot fit side by side', () => {
    // A phone upright: the notes and the panel beside them one above the other, the whole width each.
    const phone = { x: 0, y: 0, w: 390, h: 700 }
    const stacked = placesOf(DEFAULT_LAYOUT, phone, only('notes', 'side')).rects
    expect(stacked.side!.w).toBe(390)
    expect(stacked.notes!.w).toBe(390)
    expect(stacked.notes!.y + stacked.notes!.h).toBe(stacked.side!.y)
    expect(stacked.side!.h).toBeGreaterThanOrEqual(160)
    // The edge between them drags up and down.
    expect(placesOf(DEFAULT_LAYOUT, phone, only('notes', 'side')).splitters[0]!.dir).toBe('column')
    // Just wide enough for both side by side: each its least, the panel not its 31%.
    const narrow = placesOf(DEFAULT_LAYOUT, { x: 0, y: 0, w: 470, h: 700 }, only('notes', 'side')).rects
    expect(narrow.side!.w).toBeGreaterThanOrEqual(224 - 4)
    expect(narrow.notes!.w).toBeGreaterThanOrEqual(240 - 4)
    expect(narrow.side!.y).toBe(narrow.notes!.y)
    // Too short for the least height: as it was, no room being there to take.
    const short = placesOf(DEFAULT_LAYOUT, { x: 0, y: 0, w: 390, h: 300 }, only('notes', 'side')).rects
    expect(short.side!.h + short.notes!.h).toBe(300)
    // An iPad upright keeps the design sketch: side by side.
    const tablet = placesOf(DEFAULT_LAYOUT, { x: 0, y: 0, w: 768, h: 1000 }, only('notes', 'side')).rects
    expect(tablet.side!.y).toBe(tablet.notes!.y)
    expect(tablet.side!.w).toBeGreaterThanOrEqual(224)
    // A video taken out gets its least height on a phone too, with what the panel above it leaves.
    const video = placesOf(DEFAULT_LAYOUT, phone, only('notes', 'video')).rects
    expect(video.video!.h).toBeGreaterThanOrEqual(240)
  })

  it('puts a program taken out of Beside at the right of them all, the start unchanged while none is shown', () => {
    expect(placesOf(DEFAULT_LAYOUT, AREA, only('notes', 'video', 'side', 'program')).rects).toEqual({
      notes: { x: 0, y: 0, w: 592, h: 800 },
      video: { x: 592, y: 0, w: 264, h: 440 },
      side: { x: 592, y: 440, w: 264, h: 360 },
      program: { x: 856, y: 0, w: 344, h: 800 },
    })
  })
})

describe('the side panel’s web page', () => {
  it('takes a web address as typed, and nothing else', async () => {
    const { webAddress } = await import('../src/layout/side/web.js')
    expect(webAddress('wikipedia.org')).toBe('https://wikipedia.org/')
    expect(webAddress('  http://example.com/a?b=1 ')).toBe('http://example.com/a?b=1')
    expect(webAddress('javascript:alert(1)')).toBeUndefined()
    expect(webAddress('ftp://files.example.com')).toBeUndefined()
    expect(webAddress('')).toBeUndefined()
  })
})

describe('the side panel’s description', () => {
  it('reads a chapter line: its time and its words, in the ways creators write them', async () => {
    const { chapterOf } = await import('../src/layout/side/DescriptionTab.js')
    expect(chapterOf('0:00 Introduction')).toEqual({ t: 0, text: 'Introduction' })
    expect(chapterOf('(1:05) - Backpropagation')).toEqual({ t: 650, text: 'Backpropagation' })
    expect(chapterOf('1:02:03 | The end')).toEqual({ t: 37230, text: 'The end' })
    expect(chapterOf('Subscribe for more')).toBeUndefined()
    expect(chapterOf('3:75 not a time')).toBeUndefined()
  })
})

describe('putting a panel back', () => {
  it('gives its room back to the neighbour it took it from, the notes first, and keeps every other share', () => {
    // Docked left of the notes, it took half of their room; given back, they are as wide as before.
    const out = dock(DEFAULT_LAYOUT, 'video', 'notes', 'left')
    expect(placesOf(out, AREA, all).rects.notes!.w).toBeLessThan(828)
    const back = giveBack(out, 'video')
    expect(placesOf(back, AREA, all).rects).toEqual({ notes: { x: 0, y: 0, w: 828, h: 800 }, side: { x: 828, y: 0, w: 372, h: 800 } })
    // Above the notes: the column they were split into becomes the notes again.
    expect(giveBack(dock(DEFAULT_LAYOUT, 'video', 'notes', 'top'), 'video').root).toEqual(giveBack(DEFAULT_LAYOUT, 'video').root)
    // Floating, it took no room: only its float goes.
    const floating = float(DEFAULT_LAYOUT, 'video', { x: 10, y: 10, w: 400, h: 300 })
    expect(giveBack(floating, 'video').floating).toEqual({})
  })
})
