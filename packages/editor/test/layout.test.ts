// The workspace's layout: panels docked in a tree of splits, floating, or in full view.
import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYOUT, dock, dragged, float, layoutFrom, placesOf, withSizes, type Layout, type PanelId } from '../src/layout/tree.js'

const AREA = { x: 0, y: 0, w: 1200, h: 800 }
const only =
  (...ids: PanelId[]) =>
  (id: PanelId): boolean =>
    ids.includes(id)
/** The three panels of the design sketch; the program panel is shown only in the app on Windows. */
const all = only('notes', 'video', 'side')

describe('the workspace layout', () => {
  it('starts as designed: the video above the side panel on the left, the notes on the right', () => {
    expect(placesOf(DEFAULT_LAYOUT, AREA, all).rects).toEqual({
      video: { x: 0, y: 0, w: 480, h: 440 },
      side: { x: 0, y: 440, w: 480, h: 360 },
      notes: { x: 480, y: 0, w: 720, h: 800 },
    })
  })

  it('gives a hidden panel’s room to the others, and keeps its place for when it comes back', () => {
    expect(placesOf(DEFAULT_LAYOUT, AREA, only('notes', 'video')).rects).toEqual({ video: { x: 0, y: 0, w: 480, h: 800 }, notes: { x: 480, y: 0, w: 720, h: 800 } })
    expect(placesOf(DEFAULT_LAYOUT, AREA, only('notes')).rects).toEqual({ notes: AREA })
    expect(placesOf(DEFAULT_LAYOUT, AREA, only('notes')).splitters).toEqual([])
  })

  it('docks a panel beside another, taking half its room, or at a side of the whole area', () => {
    const right = dock(DEFAULT_LAYOUT, 'video', 'notes', 'right')
    expect(placesOf(right, AREA, all).rects).toEqual({ side: { x: 0, y: 0, w: 480, h: 800 }, notes: { x: 480, y: 0, w: 360, h: 800 }, video: { x: 840, y: 0, w: 360, h: 800 } })
    const top = dock(DEFAULT_LAYOUT, 'video', 'area', 'top')
    expect(placesOf(top, AREA, all).rects.video).toEqual({ x: 0, y: 0, w: 1200, h: 280 })
    expect(placesOf(top, AREA, all).rects.notes).toEqual({ x: 480, y: 280, w: 720, h: 520 })
    // Below the notes alone.
    const under = dock(DEFAULT_LAYOUT, 'side', 'notes', 'bottom')
    expect(placesOf(under, AREA, all).rects).toEqual({ video: { x: 0, y: 0, w: 480, h: 800 }, notes: { x: 480, y: 0, w: 720, h: 400 }, side: { x: 480, y: 400, w: 720, h: 400 } })
  })

  it('floats a panel over the others, kept inside the area; the notes never float', () => {
    const floating = float(DEFAULT_LAYOUT, 'video', { x: 1000, y: -50, w: 480, h: 300 })
    const places = placesOf(floating, AREA, all)
    expect(places.floating).toEqual(['video'])
    expect(places.rects.video).toEqual({ x: 720, y: 0, w: 480, h: 300 })
    expect(places.rects.side).toEqual({ x: 0, y: 0, w: 480, h: 800 })
    expect(float(DEFAULT_LAYOUT, 'notes', { x: 0, y: 0, w: 10, h: 10 })).toBe(DEFAULT_LAYOUT)
    // Docked again from floating.
    expect(placesOf(dock(floating, 'video', 'notes', 'top'), AREA, all).rects.video).toEqual({ x: 480, y: 0, w: 720, h: 400 })
  })

  it('shows one panel over the whole area in full view, and only it', () => {
    const full: Layout = { ...DEFAULT_LAYOUT, full: 'notes' }
    expect(placesOf(full, AREA, all)).toEqual({ rects: { notes: AREA }, floating: [], splitters: [] })
    // A full view of a hidden panel is no full view.
    expect(Object.keys(placesOf({ ...DEFAULT_LAYOUT, full: 'side' }, AREA, only('notes', 'video')).rects)).toEqual(['video', 'notes'])
  })

  it('drags the edge between two panels, each kept at least its smallest', () => {
    const places = placesOf(DEFAULT_LAYOUT, AREA, all)
    const between = places.splitters.find((s) => s.dir === 'row')!
    expect(between.at).toEqual({ x: 480, y: 0, w: 0, h: 800 })
    const wider = withSizes(DEFAULT_LAYOUT, between.path, dragged(between, 600, { a: 204, b: 240 }))
    expect(placesOf(wider, AREA, all).rects.notes).toEqual({ x: 600, y: 0, w: 600, h: 800 })
    const most = withSizes(DEFAULT_LAYOUT, between.path, dragged(between, 1190, { a: 204, b: 240 }))
    expect(placesOf(most, AREA, all).rects.notes!.w).toBe(240)
  })

  it('reads a layout back from storage, or starts again when it is not one', () => {
    expect(layoutFrom(JSON.parse(JSON.stringify(dock(DEFAULT_LAYOUT, 'video', 'notes', 'right'))))).toEqual(dock(DEFAULT_LAYOUT, 'video', 'notes', 'right'))
    expect(layoutFrom('nonsense')).toBe(DEFAULT_LAYOUT)
    expect(layoutFrom({ root: { kind: 'panel', id: 'video' } })).toBe(DEFAULT_LAYOUT)
    const twice = { root: { kind: 'split', dir: 'row', sizes: [1, 1], kids: [{ kind: 'panel', id: 'notes' }, { kind: 'panel', id: 'notes' }] } }
    expect(layoutFrom(twice)).toBe(DEFAULT_LAYOUT)
    // A panel missing comes back beside the notes.
    const placed = layoutFrom({ root: { kind: 'panel', id: 'notes' }, floating: { video: { x: 10, y: 10, w: 400, h: 300 } } })
    expect(placed.floating.video).toEqual({ x: 10, y: 10, w: 400, h: 300 })
    expect(Object.keys(placesOf(placed, AREA, all).rects).sort()).toEqual(['notes', 'side', 'video'])
    // A layout kept before the program panel existed: while no program is shown, the panels are as they were (the
    // notes not narrowed); shown, the program is at the right, its room taken from all of them alike.
    expect(placesOf(placed, AREA, all).rects).toEqual({ side: { x: 0, y: 0, w: 600, h: 800 }, notes: { x: 600, y: 0, w: 600, h: 800 }, video: { x: 10, y: 10, w: 400, h: 300 } })
    expect(placesOf(placed, AREA, only('notes', 'program')).rects).toEqual({ notes: { x: 0, y: 0, w: 576, h: 800 }, program: { x: 576, y: 0, w: 624, h: 800 } })
    // The person's sketch kept before it: the notes keep their 720 pixels.
    const sketch = { root: { kind: 'split', dir: 'row', sizes: [0.4, 0.6], kids: [{ kind: 'split', dir: 'column', sizes: [0.55, 0.45], kids: [{ kind: 'panel', id: 'video' }, { kind: 'panel', id: 'side' }] }, { kind: 'panel', id: 'notes' }] }, floating: {} }
    expect(placesOf(layoutFrom(sketch), AREA, all).rects.notes).toEqual({ x: 480, y: 0, w: 720, h: 800 })
  })

  it('never gives a panel less than its least where there is room, and stacks panels a narrow screen cannot fit side by side', () => {
    // A phone upright: the video and the notes one above the other, the whole width each, the video 200 pixels at least.
    const phone = { x: 0, y: 0, w: 390, h: 700 }
    const stacked = placesOf(DEFAULT_LAYOUT, phone, only('notes', 'video')).rects
    expect(stacked.video!.w).toBe(390)
    expect(stacked.notes!.w).toBe(390)
    expect(stacked.video!.y + stacked.video!.h).toBe(stacked.notes!.y)
    expect(stacked.video!.h).toBeGreaterThanOrEqual(240)
    // The edge between them drags up and down.
    expect(placesOf(DEFAULT_LAYOUT, phone, only('notes', 'video')).splitters[0]!.dir).toBe('column')
    // Just wide enough for both side by side: each its least, the video not its 40%.
    const narrow = placesOf(DEFAULT_LAYOUT, { x: 0, y: 0, w: 460, h: 700 }, only('notes', 'video')).rects
    expect(narrow.video!.w).toBeGreaterThanOrEqual(204 - 4)
    expect(narrow.notes!.w).toBeGreaterThanOrEqual(240 - 4)
    expect(narrow.video!.y).toBe(narrow.notes!.y)
    // Too short for the least height: as it was, no room being there to take.
    const short = placesOf(DEFAULT_LAYOUT, { x: 0, y: 0, w: 390, h: 300 }, only('notes', 'video')).rects
    expect(short.video!.h + short.notes!.h).toBe(300)
    // An iPad upright keeps the design sketch: side by side.
    const tablet = placesOf(DEFAULT_LAYOUT, { x: 0, y: 0, w: 768, h: 1000 }, only('notes', 'video')).rects
    expect(tablet.video!.y).toBe(tablet.notes!.y)
    expect(tablet.video!.w).toBeGreaterThanOrEqual(204)
  })

  it('puts a program right of the notes, the sketch unchanged while none is shown', () => {
    expect(placesOf(DEFAULT_LAYOUT, AREA, only('notes', 'video', 'side', 'program')).rects).toEqual({
      video: { x: 0, y: 0, w: 344, h: 440 },
      side: { x: 0, y: 440, w: 344, h: 360 },
      notes: { x: 344, y: 0, w: 516, h: 800 },
      program: { x: 860, y: 0, w: 340, h: 800 },
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
