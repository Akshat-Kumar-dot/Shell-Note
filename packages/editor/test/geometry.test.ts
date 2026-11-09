import { describe, expect, it } from 'vitest'
import { mm, PAGE_GAP, pagesInView, px, stepZoom } from '../src/index.js'
import { listMarker } from '../src/markers.js'

describe('units on screen', () => {
  it('turn document units into CSS millimetres and pixels', () => {
    expect(mm(2000)).toBe('20mm')
    expect(mm(8250)).toBe('82.5mm')
    // An A4 page is 297 mm tall: 1122.5 CSS pixels at 100%, twice that at 200%.
    expect(px(29700)).toBeCloseTo(1122.52, 2)
    expect(px(29700, 2)).toBeCloseTo(2245.04, 2)
  })
})

describe('which pages to draw', () => {
  const pages = (n: number): number[] => Array.from({ length: n }, () => 1000)

  it('draws the pages on screen and one either side', () => {
    expect(pagesInView(pages(3), 0, 800)).toEqual({ first: 0, last: 1 })
    // 1500 to 2300 overlaps the second page (1048 to 2048) and the third (2072 to 3072).
    expect(pagesInView(pages(3), 1500, 800)).toEqual({ first: 0, last: 2 })
    expect(pagesInView(pages(30), 15000, 800)).toEqual({ first: 13, last: 16 })
    expect(pagesInView(pages(30), 15000, 800, 0)).toEqual({ first: 14, last: 15 })
  })

  it('copes with the edges', () => {
    expect(pagesInView([], 0, 800)).toEqual({ first: 0, last: -1 })
    // Scrolled past the bottom of the last page: still draw it.
    const end = 30 * (1000 + PAGE_GAP) + 500
    expect(pagesInView(pages(30), end, 800)).toEqual({ first: 28, last: 29 })
  })
})

describe('zoom steps', () => {
  it('step to the next level, and stop at the ends', () => {
    expect(stepZoom(1, 1)).toBe(1.1)
    expect(stepZoom(1, -1)).toBe(0.9)
    expect(stepZoom(0.95, 1)).toBe(1)
    expect(stepZoom(4, 1)).toBe(4)
    expect(stepZoom(0.25, -1)).toBe(0.25)
  })
})

describe('list markers', () => {
  it('show 1., a. and i. by level, as word processors do', () => {
    expect([1, 2, 26, 27].map((n) => listMarker(0, n))).toEqual(['1', '2', '26', '27'])
    expect([1, 2, 26, 27].map((n) => listMarker(1, n))).toEqual(['a', 'b', 'z', 'aa'])
    expect([1, 4, 9, 14].map((n) => listMarker(2, n))).toEqual(['i', 'iv', 'ix', 'xiv'])
    expect(listMarker(3, 2)).toBe('2')
  })
})
