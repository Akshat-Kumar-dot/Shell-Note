// Synthetic pen strokes for the ink tests: shapes and handwriting as a hand
// draws them, with sensor jitter, a slow wobble and pressure, from a seed, so
// every run draws the same. Real strokes from a test pen (the recorder page,
// ?record=strokes) join these as fixtures.
import type { Pt } from '../../src/ink/geometry.js'

/** A small seeded random source (mulberry32). */
export function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const gauss = (rand: () => number): number => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand())

export interface Hand {
  /** Sensor jitter, in 0.01 mm. */
  jitter?: number
  /** A slow wobble across the line, as a share of the stroke's size. */
  wobble?: number
  seed?: number
}

/** A path through corners, as a hand draws it: points 0.3 mm apart, jitter, a slow wobble, pressure rising then falling. */
export function drawn(corners: readonly { x: number; y: number }[], hand: Hand = {}): Pt[] {
  const rand = random(hand.seed ?? 1)
  const dense: { x: number; y: number }[] = []
  for (let i = 1; i < corners.length; i++) {
    const a = corners[i - 1]!
    const b = corners[i]!
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 30))
    for (let s = i === 1 ? 0 : 1; s <= n; s++) dense.push({ x: a.x + ((b.x - a.x) * s) / n, y: a.y + ((b.y - a.y) * s) / n })
  }
  const xs = dense.map((p) => p.x)
  const ys = dense.map((p) => p.y)
  const size = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  const phase = rand() * Math.PI * 2
  return dense.map((p, i) => {
    const t = i / Math.max(1, dense.length - 1)
    const wobble = (hand.wobble ?? 0) * size * Math.sin(phase + t * Math.PI * 2)
    return {
      x: p.x + gauss(rand) * (hand.jitter ?? 15) + wobble * 0.7,
      y: p.y + gauss(rand) * (hand.jitter ?? 15) + wobble,
      p: Math.round(90 + 80 * Math.sin(Math.PI * t)),
    }
  })
}

/** Points around an ellipse, starting at `start` radians and going round once (a little over, as hands do). */
export function around(cx: number, cy: number, rx: number, ry: number, start = 0, over = 0.06): { x: number; y: number }[] {
  const n = 80
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = start + (i / n) * (2 * Math.PI) * (1 + over)
    return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) }
  })
}

/** A word of handwriting: loops and humps of a few millimetres, as cursive letters are. */
export function cursive(x: number, y: number, letters: number, seed = 1): Pt[] {
  const rand = random(seed)
  const path: { x: number; y: number }[] = []
  let at = x
  for (let i = 0; i < letters; i++) {
    const w = 250 + rand() * 150
    const tall = rand() > 0.7 ? 700 : 350
    for (let s = 0; s <= 12; s++) {
      const t = s / 12
      path.push({ x: at + w * t + 60 * Math.sin(t * Math.PI * 2), y: y - tall * Math.sin(t * Math.PI) ** 2 })
    }
    at += w
  }
  return drawn(path, { jitter: 8, seed })
}

/** A zigzag across, as a person scratches something out. */
export function zigzag(x: number, y: number, w: number, h: number, teeth: number, seed = 1): Pt[] {
  const corners = Array.from({ length: teeth * 2 + 1 }, (_, i) => ({ x: x + (w * i) / (teeth * 2), y: y + (i % 2 === 0 ? 0 : h) }))
  return drawn(corners, { jitter: 10, seed })
}
