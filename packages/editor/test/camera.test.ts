// The board's camera: board points to the view and back, a zoom that keeps the point under the pointer still, the
// whole board fitted, the zoom's steps and limits, and the dots a step's middle snaps to.
import { describe, expect, it } from 'vitest'
import { BOARD_MAX_ZOOM, BOARD_MIN_ZOOM, centredOn, clampBoardZoom, fitting, panBy, pxPerUnit, seen, stepBoardZoom, toBoard, toDot, toView, zoomAt, type Camera } from '../src/board/camera.js'

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6

describe('the board’s camera', () => {
  it('takes a board point to the view and back', () => {
    const camera: Camera = { x: -2000, y: 500, zoom: 1.5 }
    const view = toView(camera, 3000, 4000)
    const back = toBoard(camera, view.x, view.y)
    expect(near(back.x, 3000) && near(back.y, 4000)).toBe(true)
    // 1 mm is 96 / 25.4 pixels at 100 %.
    expect(near(pxPerUnit(1) * 100, 96 / 25.4)).toBe(true)
  })

  it('zooms about a point of the view, which stays where it was', () => {
    const camera: Camera = { x: 0, y: 0, zoom: 1 }
    const under = toBoard(camera, 300, 200)
    const zoomed = zoomAt(camera, 2.5, 300, 200)
    const after = toView(zoomed, under.x, under.y)
    expect(near(after.x, 300) && near(after.y, 200)).toBe(true)
    expect(zoomed.zoom).toBe(2.5)
  })

  it('moves the board with a drag, the board point under the pointer going with it', () => {
    const camera: Camera = { x: 1000, y: 1000, zoom: 2 }
    const before = toBoard(camera, 100, 100)
    const moved = panBy(camera, 40, -10)
    const after = toBoard(moved, 140, 90)
    expect(near(after.x, before.x) && near(after.y, before.y)).toBe(true)
  })

  it('fits a box in the view with a margin, never past actual size, and centres a point', () => {
    const big = fitting({ x: -10000, y: 0, w: 100000, h: 50000 }, 1000, 600)
    const shown = seen(big, 1000, 600)
    expect(shown.x).toBeLessThanOrEqual(-10000)
    expect(shown.x + shown.w).toBeGreaterThanOrEqual(90000)
    expect(fitting({ x: 0, y: 0, w: 1000, h: 1000 }, 1000, 600).zoom).toBe(1)
    const centred = centredOn({ x: 5000, y: 7000 }, 800, 400, 1)
    const middle = toBoard(centred, 400, 200)
    expect(near(middle.x, 5000) && near(middle.y, 7000)).toBe(true)
  })

  it('zooms from 10 % to 400 %, by steps that start further out than a page’s', () => {
    expect(clampBoardZoom(0.01)).toBe(BOARD_MIN_ZOOM)
    expect(clampBoardZoom(9)).toBe(BOARD_MAX_ZOOM)
    expect(stepBoardZoom(0.1, 1)).toBe(0.15)
    expect(stepBoardZoom(0.25, -1)).toBe(0.2)
    expect(stepBoardZoom(4, 1)).toBe(BOARD_MAX_ZOOM)
    expect(stepBoardZoom(0.1, -1)).toBe(BOARD_MIN_ZOOM)
  })

  it('puts a step’s middle on the nearest 5 mm dot', () => {
    expect(toDot(1249)).toBe(1000)
    expect(toDot(1251)).toBe(1500)
    expect(toDot(-260)).toBe(-500)
  })
})
