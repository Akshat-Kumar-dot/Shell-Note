// Arrows taken as the pen lifts, with no hold (people make arrows in one
// stroke or in two, the head in one and the line in another, and small arrows
// of an inch or less must work too): made-up
// arrows drawn every usual way, at sizes from a hand long down to half an inch,
// smoothed as the pen layer smooths, and the strokes that only look like part
// of one, left alone.
import { describe, expect, it } from 'vitest'
import { MM, type Pt } from '../../src/ink/geometry.js'
import { arrowOfTwo, arrowOnLift, arrowShape, penPoints, pointsOf, recognise, twoStrokeArrow } from '../../src/index.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cursive, drawn, zigzag } from './strokes.js'

const DEG = Math.PI / 180
const SEEDS = [1, 2, 3]
const DIRECTIONS = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4 + 0.05)

/** Through the corners as a hand draws (strokes.ts), at about 75 mm a second, smoothed as the pen layer smooths. */
const pen = (corners: readonly { x: number; y: number }[], seed: number): Pt[] =>
  penPoints(
    drawn(corners, { seed, wobble: 0.003 }).map((pt, i) => [pt.x, pt.y, pt.p, 0, 0, i * 4]),
    1,
  )

/** An arrow's strokes: the tail at the origin, pointing along `angle`, the shaft `length` long, barbs at 35° off straight back. */
function arrow(way: string, length: number, angle: number): { x: number; y: number }[][] {
  const at = (u: number, v: number) => ({ x: u * Math.cos(angle) - v * Math.sin(angle), y: u * Math.sin(angle) + v * Math.cos(angle) })
  const barb = Math.max(2.5 * MM, 0.28 * length)
  const tail = at(0, 0)
  const tip = at(length, 0)
  const up = at(length - barb * Math.cos(35 * DEG), -barb * Math.sin(35 * DEG))
  const down = at(length - barb * Math.cos(35 * DEG), barb * Math.sin(35 * DEG))
  switch (way) {
    case 'two barbs':
      return [[tail, tip, up, tip, down]]
    case 'a barb drawn in to the tip':
      return [[tail, at(length - 0.3 * barb, 0), up, tip, down]]
    case 'a closed head':
      return [[tail, tip, up, down, tip]]
    case 'the head first':
      return [[up, tip, down, tip, tail]]
    case 'one barb':
      return [[tail, tip, down]]
    case 'a line, then a V':
      return [[tail, tip], [up, tip, down]]
    case 'a V, then a line':
      return [[up, tip, down], [tail, tip]]
    case 'a line, then one barb':
      return [[tail, tip], [tip, down]]
    default:
      throw new Error(way)
  }
}

/** How many of the directions and hands give an arrow, its tail and tip where they were drawn. */
function rate(way: string, mm: number, take: (strokes: Pt[][]) => number[] | undefined): number {
  let right = 0
  let all = 0
  for (const angle of DIRECTIONS) {
    for (const seed of SEEDS) {
      all++
      const key = take(arrow(way, mm * MM, angle).map((corners) => pen(corners, seed)))
      if (!key) continue
      const near = Math.max(1.5 * MM, 0.08 * mm * MM)
      const tip = { x: mm * MM * Math.cos(angle), y: mm * MM * Math.sin(angle) }
      if (Math.hypot(key[0]!, key[1]!) < near && Math.hypot(key[2]! - tip.x, key[3]! - tip.y) < near) right++
    }
  }
  return right / all
}
const oneStroke = (strokes: Pt[][]): number[] | undefined => arrowShape(strokes[0]!)?.key
const twoStrokes = (strokes: Pt[][]): number[] | undefined => twoStrokeArrow(strokes[0]!, strokes[1]!)?.key

describe('arrows taken as the pen lifts', () => {
  it('takes an arrow drawn in one stroke, every usual way, from a hand long down to half an inch', () => {
    for (const way of ['two barbs', 'a barb drawn in to the tip', 'a closed head', 'the head first']) {
      for (const mm of [40, 25, 18, 12]) expect(rate(way, mm, oneStroke), `${way}, ${mm} mm`).toBeGreaterThanOrEqual(0.9)
    }
  })

 it('takes a quick small arrow with a barb on each side, down to 8 mm and often smaller', () => {
    for (const way of ['two barbs', 'a barb drawn in to the tip', 'a closed head', 'the head first']) {
      expect(rate(way, 8, oneStroke), `${way}, 8 mm`).toBeGreaterThanOrEqual(0.75)
      expect(rate(way, 6, oneStroke), `${way}, 6 mm`).toBeGreaterThan(0)
    }
  })

  it("takes at least half of quick arrows by the rules alone: a hook up to the upper barb, the shaft bowing, the head lopsided", () => {
    const page = JSON.parse(readFileSync(join(import.meta.dirname, 'pages', 'quick-arrows.json'), 'utf8')) as { arrows: number[][] }
    const taken = page.arrows.filter((pts) => arrowShape(pointsOf(pts))?.kind === 'arrow').length
    expect(taken / page.arrows.length, `${taken} of ${page.arrows.length}`).toBeGreaterThanOrEqual(0.5)
  })

  it('takes one barb alone from an inch up, since smaller it is a 1 with its flag; held, at any size', () => {
    expect(rate('one barb', 40, oneStroke)).toBeGreaterThanOrEqual(0.9)
    for (const mm of [18, 12]) {
      expect(rate('one barb', mm, oneStroke), `${mm} mm`).toBe(0)
      expect(rate('one barb', mm, (strokes) => ((shape) => (shape?.kind === 'arrow' ? shape.key : undefined))(recognise(strokes[0]!, true))), `${mm} mm, held`).toBeGreaterThanOrEqual(0.9)
    }
  })

  it('leaves alone what only looks like part of an arrow: letters, lines, a flick as the pen lifts, handwriting', () => {
    const strokes: Record<string, { x: number; y: number }[]> = {
      'a straight line': [{ x: 0, y: 0 }, { x: 5000, y: 200 }],
      'a line with a flick at its end': [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 3930, y: 70 }],
      'a 1 with its flag': [{ x: -500, y: 450 }, { x: 0, y: 0 }, { x: 0, y: 1500 }],
      'a J': [{ x: 0, y: 0 }, { x: 0, y: 2600 }, { x: -100, y: 2900 }, { x: -400, y: 3000 }, { x: -700, y: 2850 }, { x: -850, y: 2600 }],
      'an L': [{ x: 0, y: 0 }, { x: 0, y: 2000 }, { x: 1200, y: 2000 }],
      'a 7': [{ x: 0, y: 0 }, { x: 1500, y: 0 }, { x: 600, y: 2500 }],
      'a tick': [{ x: 0, y: 1000 }, { x: 400, y: 1500 }, { x: 1800, y: 0 }],
      'a V': [{ x: 0, y: 0 }, { x: 800, y: 2000 }, { x: 1600, y: 0 }],
      'an angle': [{ x: 0, y: 0 }, { x: 2000, y: 4000 }, { x: 4000, y: 0 }],
      'a y': [{ x: 0, y: 0 }, { x: 250, y: 300 }, { x: 500, y: 0 }, { x: 250, y: 300 }, { x: 0, y: 900 }],
      'a k': [{ x: 0, y: 0 }, { x: 0, y: 800 }, { x: 0, y: 500 }, { x: 400, y: 300 }, { x: 100, y: 500 }, { x: 450, y: 800 }],
      'a z': [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 0, y: 500 }, { x: 500, y: 500 }],
    }
    // As drawn, and at half the size, as small as quick arrows are taken.
    for (const [name, corners] of Object.entries(strokes)) {
      for (const scale of [1, 0.5]) {
        for (const seed of [1, 2, 3, 4, 5]) expect(arrowShape(pen(corners.map((c) => ({ x: c.x * scale, y: c.y * scale })), seed)), `${name} ×${scale}, hand ${seed}`).toBeUndefined()
      }
    }
    for (const seed of [1, 2, 3]) {
      expect(arrowShape(cursive(0, 0, 5, seed)), `handwriting, hand ${seed}`).toBeUndefined()
      expect(arrowShape(zigzag(0, 0, 4000, 1500, 6, seed)), `a zigzag, hand ${seed}`).toBeUndefined()
    }
  })

  it('joins a line and its head drawn as the next stroke, either one first, from a hand long down to half an inch', () => {
    for (const way of ['a line, then a V', 'a V, then a line']) {
      for (const mm of [40, 25, 18, 12]) expect(rate(way, mm, twoStrokes), `${way}, ${mm} mm`).toBeGreaterThanOrEqual(0.9)
    }
    expect(rate('a line, then one barb', 40, twoStrokes)).toBeGreaterThanOrEqual(0.9)
    expect(rate('a line, then one barb', 12, twoStrokes)).toBe(0)
  })

  it('never joins the V of a Y, the < of a K, the bar of a T, a second line, or a head away from the end', () => {
    const line = [{ x: 0, y: 0 }, { x: 0, y: 3000 }]
    const others: Record<string, { x: number; y: number }[]> = {
      'the V of a Y, opening away': [{ x: -800, y: -1500 }, { x: 0, y: 0 }, { x: 800, y: -1500 }],
      'the < of a K, at the middle': [{ x: 1200, y: 0 }, { x: 0, y: 1500 }, { x: 1200, y: 3000 }],
      'the bar of a T, across': [{ x: -1000, y: 0 }, { x: 1000, y: 0 }],
      'a second line beside it': [{ x: 400, y: 0 }, { x: 400, y: 3000 }],
      'a head 5 mm from the end': [{ x: -700, y: 3600 }, { x: 0, y: 3500 }, { x: 700, y: 3600 }].map((pt) => ({ ...pt, y: pt.y + 500 })),
    }
    for (const [name, corners] of Object.entries(others)) {
      for (const seed of [1, 2, 3]) {
        expect(twoStrokeArrow(pen(line, seed), pen(corners, seed)), `${name}, hand ${seed}`).toBeUndefined()
        expect(twoStrokeArrow(pen(corners, seed), pen(line, seed)), `${name} first, hand ${seed}`).toBeUndefined()
      }
    }
  })

  it('judges an arrow at the size it was drawn on the screen, and gives it back at its size on the page', () => {
    // Drawn 16 mm long on the screen at 400 %: 4 mm on the page.
    const page = (strokes: Pt[][]): Pt[][] => strokes.map((points) => points.map((pt) => ({ ...pt, x: pt.x / 4, y: pt.y / 4 })))
    const one = page(arrow('two barbs', 16 * MM, 0.05).map((corners) => pen(corners, 1)))
    expect(arrowOnLift(one[0]!, { zoom: 1 })).toBeUndefined()
    const zoomed = arrowOnLift(one[0]!, { zoom: 4 })
    expect(zoomed?.kind).toBe('arrow')
    expect(Math.abs(zoomed!.key[2]! - 4 * MM * Math.cos(0.05))).toBeLessThan(0.5 * MM)
    const two = page(arrow('a line, then a V', 16 * MM, 0.05).map((corners) => pen(corners, 1)))
    expect(arrowOfTwo(two[0]!, two[1]!, 1)).toBeUndefined()
    expect(arrowOfTwo(two[0]!, two[1]!, 4)?.kind).toBe('arrow')
  })
})
