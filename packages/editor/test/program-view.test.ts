// Whether a program's view has changed (stage 4, step 7): the small grey copy, and the rule measured on real frames.
import { describe, expect, it } from 'vitest'
import { cellsChanged, CELLS_CHANGE, greyOf, viewChanged } from '../src/program/view.js'

/** A white frame of this size, with these boxes painted black: each `[x, y, w, h]`. */
function frame(width: number, height: number, boxes: readonly (readonly [number, number, number, number])[] = []): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255)
  for (const [x0, y0, w, h] of boxes) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const at = (y * width + x) * 4
        rgba[at] = rgba[at + 1] = rgba[at + 2] = 0
      }
    }
  }
  return rgba
}

describe('the small grey copy', () => {
  it('is 32 by 20, whatever the frame’s shape, and reads black and white', () => {
    expect(greyOf(frame(900, 700), 900, 700)).toHaveLength(640)
    expect([...greyOf(frame(320, 200), 320, 200)].every((cell) => cell === 255)).toBe(true)
    expect([...greyOf(frame(320, 200, [[0, 0, 320, 200]]), 320, 200)].every((cell) => cell === 0)).toBe(true)
    // A frame smaller than the copy: nothing read past its edge.
    expect(greyOf(frame(5, 3), 5, 3).some((cell) => Number.isNaN(cell))).toBe(false)
  })
})

describe('whether the view changed', () => {
  const [w, h] = [900, 700]
  const page = greyOf(frame(w, h), w, h)

  it('is no for the same picture, and for something small', () => {
    expect(cellsChanged(page, page)).toBe(0)
    expect(viewChanged(page, page)).toBe(false)
    // A 28 px button lit: four cells at most, as measured.
    expect(viewChanged(page, greyOf(frame(w, h, [[8, 8, 28, 28]]), w, h))).toBe(false)
  })

  it('is yes when much of it did', () => {
    expect(viewChanged(page, greyOf(frame(w, h, [[0, 0, w, 200]]), w, h))).toBe(true)
    expect(cellsChanged(page, greyOf(frame(w, h, [[0, 0, w, 200]]), w, h))).toBeGreaterThanOrEqual(CELLS_CHANGE)
  })
})
