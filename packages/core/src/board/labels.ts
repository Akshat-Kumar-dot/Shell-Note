// Where a link's words go on a board, knowing every link. Each link's words start at the middle of its own path, as
// route.ts places them; when they would lie on a step, on another block, or on words placed before them, they move
// along their own path, a little either way and then further, to the first free place. Links are placed in the order
// they are given (a board gives them in the order its charts read), so the same board always shows the same places.
// Geometry alone, so the screen, the print and the library's picture place words alike. Units are 0.01 mm.
import type { Box } from '../ink/geometry.js'
import { overlaps } from '../ink/geometry.js'
import { pathPoints } from './hit.js'
import type { Point, Route } from './route.js'

/** A link's words as they are drawn: 3.6 mm letters, about 2 mm each, on a patch 5.6 mm high with 1.2 mm either side. */
export const LABEL_SIZE = 360
const LABEL_LETTER = 200
const LABEL_HEIGHT = 560
const LABEL_PAD = 120
/** Room kept between two links' words, and between words and what they must not cover: 0.5 mm. */
const GAP = 50
/** Where along its path a link's words are tried, as shares of its length: the middle first, then out either way. */
const TRIES = [0.5, 0.4, 0.6, 0.3, 0.7, 0.25, 0.75, 0.2, 0.8, 0.15, 0.85] as const
/** The squares the boxes to keep clear of are sorted into, so each try looks only near itself: 20 mm. */
const CELL = 2000

/** A letter that takes two letters' width: Chinese, Japanese and Korean writing, and most emoji. */
const wide = (char: string): boolean => (char.codePointAt(0) ?? 0) >= 0x1100

/** The size of the patch a link's words are drawn on. */
export function labelSize(text: string): { w: number; h: number } {
  const letters = [...text].reduce((sum, char) => sum + (wide(char) ? 2 : 1), 0)
  return { w: letters * LABEL_LETTER + 2 * LABEL_PAD, h: LABEL_HEIGHT }
}

/** The point a share of the way along a path of straight pieces. */
export function pointAlong(points: readonly Point[], share: number): Point {
  const lengths = points.slice(1).map((point, i) => Math.hypot(point.x - points[i]!.x, point.y - points[i]!.y))
  let left = (lengths.reduce((sum, length) => sum + length, 0) * share)
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i]!
    if (left <= length && length > 0) {
      const [a, b] = [points[i]!, points[i + 1]!]
      return { x: Math.round(a.x + ((b.x - a.x) * left) / length), y: Math.round(a.y + ((b.y - a.y) * left) / length) }
    }
    left -= length
  }
  return points.at(-1) ?? { x: 0, y: 0 }
}

/** Boxes sorted into squares, to find those near a box quickly. */
class Grid {
  readonly #cells = new Map<string, Box[]>()

  add(box: Box): void {
    for (const key of this.#keys(box)) {
      const cell = this.#cells.get(key)
      if (cell) cell.push(box)
      else this.#cells.set(key, [box])
    }
  }

  hits(box: Box): boolean {
    for (const key of this.#keys(box)) for (const other of this.#cells.get(key) ?? []) if (overlaps(box, other)) return true
    return false
  }

  #keys(box: Box): string[] {
    const keys: string[] = []
    for (let i = Math.floor(box.x / CELL); i <= Math.floor((box.x + box.w) / CELL); i++) for (let j = Math.floor(box.y / CELL); j <= Math.floor((box.y + box.h) / CELL); j++) keys.push(`${i},${j}`)
    return keys
  }
}

/** A box of a size, its middle on a point. */
const centred = (point: Point, size: { w: number; h: number }): Box => ({ x: Math.round(point.x - size.w / 2), y: Math.round(point.y - size.h / 2), w: size.w, h: size.h })

/**
 * The patches every link's words are drawn on, by each link's key: on its own path, clear of `keepClear` (the steps,
 * text boxes and pictures of the board) and of the words placed before them; at the middle of the path when no place
 * along it is clear. Links with no words are left out.
 */
export function placeLabels(links: readonly { key: string; route: Pick<Route, 'kind' | 'points'>; text: string }[], keepClear: readonly Box[]): Map<string, Box> {
  const clear = new Grid()
  for (const box of keepClear) clear.add({ x: box.x - GAP, y: box.y - GAP, w: box.w + 2 * GAP, h: box.h + 2 * GAP })
  const placed = new Map<string, Box>()
  for (const { key, route, text } of links) {
    if (text === '') continue
    const size = labelSize(text)
    const path = pathPoints(route)
    const spots = TRIES.map((share) => centred(pointAlong(path, share), size))
    const free = spots.find((spot) => !clear.hits(spot)) ?? spots[0]!
    placed.set(key, free)
    clear.add({ x: free.x - GAP, y: free.y - GAP, w: free.w + 2 * GAP, h: free.h + 2 * GAP })
  }
  return placed
}
