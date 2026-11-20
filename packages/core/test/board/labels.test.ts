// A link's words, placed knowing every link: on the link's own path, never on a step or on other words, the same
// places every time; and a board's links as they are drawn.
import { describe, expect, it } from 'vitest'
import { apply, boardLinks, chartOps, labelSize, linkKey, placeLabels, readFlowchart, type Box, type Doc, type Route } from '../../src/index.js'
import { BOARD } from '../fixtures/index.js'

const overlap = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const down = (x: number, from: number, to: number): Pick<Route, 'kind' | 'points'> => ({ kind: 'angled', points: [{ x, y: from }, { x, y: to }] })

describe('a link’s words', () => {
  it('take room by their letters, a wide letter twice', () => {
    expect(labelSize('yes')).toEqual({ w: 840, h: 560 })
    expect(labelSize('no').w).toBeLessThan(labelSize('next post').w)
    expect(labelSize('是').w).toBe(labelSize('ab').w)
  })

  it('sit at the middle of their path when it is clear', () => {
    const placed = placeLabels([{ key: 'a', route: down(1000, 0, 10000), text: 'yes' }], [])
    expect(placed.get('a')).toEqual({ x: 580, y: 4720, w: 840, h: 560 })
  })

  it('move along their own path when the middle is taken, and never onto a step', () => {
    const step: Box = { x: 0, y: 4000, w: 2000, h: 2000 }
    const label = placeLabels([{ key: 'a', route: down(1000, 0, 10000), text: 'yes' }], [step]).get('a')!
    expect(overlap(label, step)).toBe(false)
    // Still on its line.
    expect(label.x + label.w / 2).toBe(1000)
  })

  it('keep clear of the words placed before them, and come out the same every time', () => {
    const links = [
      { key: 'a', route: down(1000, 0, 10000), text: 'no' },
      { key: 'b', route: down(1100, 0, 10000), text: 'next post' },
      { key: 'c', route: down(5000, 0, 10000), text: '' },
    ]
    const once = placeLabels(links, [])
    expect(overlap(once.get('a')!, once.get('b')!)).toBe(false)
    expect(once.has('c')).toBe(false)
    expect(placeLabels(links, [])).toEqual(once)
  })
})

describe('a board’s links, as drawn', () => {
  it('come in the order the chart reads, each with its path and its words’ place, clear of every step', () => {
    const links = boardLinks(BOARD, 'p1')
    expect(links.map((link) => linkKey(link.from, link.to))).toEqual(['n1>n2', 'n2>n3', 'n3>n4', 'n3>n2'])
    expect(links.find((link) => link.to === 'n2' && link.from === 'n3')!.route.kind).toBe('curved')
    const steps = Object.values(BOARD.block).filter((block) => block.type === 'node') as Box[]
    for (const link of links.filter((one) => one.link.label !== undefined)) for (const step of steps) expect(overlap(link.label!, step)).toBe(false)
    expect(links.filter((link) => link.label !== undefined).map((link) => link.link.label)).toEqual(['yes', 'no'])
  })

  it('keep two ways back of a chart in lanes of their own, their words apart', () => {
    const chart = readFlowchart('flowchart TD\n  A[Draft] --> B[Review] --> C{Passed?}\n  C -->|yes| D[Publish]\n  C -->|no| A\n  D -->|next post| A')
    const board: Doc = { ...BOARD, block: {}, page: { p1: { id: 'p1', endless: true, bg: 'dots', free: [] } } }
    let n = 0
    const doc = apply(board, chartOps(board, 'p1', chart, () => `x${++n}`).ops).doc
    const labelled = boardLinks(doc, 'p1').filter((link) => link.label !== undefined)
    expect(labelled).toHaveLength(3)
    for (const a of labelled) for (const b of labelled) if (a !== b) expect(overlap(a.label!, b.label!)).toBe(false)
  })

  it('never let two ways back share a lane when a step moved aside pushes both out', () => {
    const chart = readFlowchart('flowchart TD\n  A([Start]) --> B[Write] --> C[Review] --> D{Passed?}\n  D -->|yes| E([Publish])\n  D -->|no| B\n  E -.->|next post| A')
    const board: Doc = { ...BOARD, block: {}, page: { p1: { id: 'p1', endless: true, bg: 'dots', free: [] } } }
    let n = 0
    const made = chartOps(board, 'p1', chart, () => `x${++n}`)
    const drawn = apply(board, made.ops).doc
    // Review, taken out to the right of the column a little further each time, into where the ways back pass.
    const review = drawn.block[made.made.get('C')!] as Box & { page: string }
    const lanes = (dx: number): number[] => {
      const moved = apply(drawn, [{ op: 'move', id: made.made.get('C')!, to: { page: 'p1', x: review.x + dx, y: review.y } }]).doc
      const back = boardLinks(moved, 'p1').filter((link) => link.route.from === link.route.to)
      expect(back).toHaveLength(2)
      return back.map((link) => link.route.points[1]!.x)
    }
    const still = lanes(0)
    let pushed = 0
    for (let dx = 1000; dx <= 8000; dx += 500) {
      const [one, two] = lanes(dx) as [number, number]
      expect(Math.abs(one - two), `Review moved ${dx / 100} mm`).toBeGreaterThanOrEqual(800)
      if (one !== still[0] || two !== still[1]) pushed++
    }
    // Review did push the ways back out: the lanes were tested where they meet it.
    expect(pushed).toBeGreaterThan(0)
  })
})
