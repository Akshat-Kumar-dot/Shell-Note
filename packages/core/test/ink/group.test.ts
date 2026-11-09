// Grouping strokes into ink blocks, finding strokes, and erasing them. Every
// change goes through apply() and undoes exactly (step checks both).
import { describe, expect, it } from 'vitest'
import { apply, createDoc, type Doc, type Id, type InkBlock, type Stroke } from '../../src/index.js'
import { cutStroke, eraseOps, cutOps, hull, isScratch, scratchTargets } from '../../src/ink/erase.js'
import { editInk, JOIN_GAP, JOIN_TIME, placeStroke, shifted, type LastStroke } from '../../src/ink/group.js'
import { inkBlocks, strokeBox, strokesAlong, strokesAt, strokesInBox, strokesInLoop } from '../../src/ink/hit.js'
import { PEN_SIZE, reachOf } from '../../src/ink/pens.js'
import { step } from '../helpers.js'
import { around, cursive, drawn, zigzag } from './strokes.js'

const empty = (): { doc: Doc; page: Id } => {
  const doc = createDoc()
  return { doc, page: doc.pages[0]! }
}

/** A plain-pen stroke through (x, y) points, page coordinates, pressure 128. */
const line = (...xy: number[]): Stroke => {
  const pts: number[] = []
  for (let i = 0; i + 1 < xy.length; i += 2) pts.push(xy[i]!, xy[i + 1]!, 128)
  return { pts, color: 'ink', width: 'm' }
}

let counter = 0
const ids = (): Id => `ink${String(counter++).padStart(5, '0')}`

/** Write strokes one after another, `gap` ms apart, as the editor would. */
function write(doc: Doc, page: Id, strokes: readonly Stroke[], gap = 300): { doc: Doc; blocks: Id[] } {
  let last: LastStroke | undefined
  let now = 1000
  const blocks: Id[] = []
  for (const stroke of strokes) {
    const placed = placeStroke(doc, page, stroke, { now, last, newId: ids })
    doc = step(doc, placed.ops).doc
    blocks.push(placed.block)
    // The stroke takes 200 ms to write; the next one starts `gap` after it ends.
    last = { block: placed.block, at: now + 200 }
    now += 200 + gap
  }
  return { doc, blocks }
}

/** A block's strokes, back in page coordinates. */
const onPage = (doc: Doc, id: Id): number[][] => {
  const block = doc.block[id] as InkBlock
  return block.strokes.map((stroke) => shifted(stroke, block.x, block.y).pts)
}

/** The box round a block's ink, from its strokes, in page coordinates. */
const inkExtent = (block: InkBlock) => {
  const boxes = block.strokes.map(strokeBox)
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  return { x: block.x + x, y: block.y + y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y }
}

describe('grouping strokes into ink blocks', () => {
  it('puts the first stroke in a new ink block in front, its box tight round the ink', () => {
    const { doc, page } = empty()
    const after = write(doc, page, [line(5000, 6000, 9000, 6200)])
    const block = after.doc.block[after.blocks[0]!] as InkBlock
    expect(block.type).toBe('ink')
    expect(after.doc.page[page]!.free.at(-1)).toBe(block.id)
    const reach = reachOf({ pts: [0, 0, 128], width: 'm' })
    expect({ x: block.x, y: block.y, w: block.w, h: block.h }).toEqual({ x: 5000 - reach, y: 6000 - reach, w: 4000 + 2 * reach, h: 200 + 2 * reach })
    expect(onPage(after.doc, block.id)).toEqual([[5000, 6000, 128, 9000, 6200, 128]])
  })

  it('joins strokes written close in time and space, and grows the box to the right', () => {
    const { doc, page } = empty()
    const after = write(doc, page, [line(5000, 6000, 5400, 6600), line(5600, 6000, 6000, 6600), line(6200, 6000, 6600, 6600)])
    expect(new Set(after.blocks).size).toBe(1)
    const block = after.doc.block[after.blocks[0]!] as InkBlock
    expect(block.strokes).toHaveLength(3)
    expect({ x: block.x, y: block.y, w: block.w, h: block.h }).toEqual(inkExtent(block))
  })

  it('starts a new block for a stroke far away, or after a pause away from the ink', () => {
    const { doc, page } = empty()
    const far = write(doc, page, [line(5000, 6000, 5400, 6600), line(5000 + 400 + JOIN_GAP + 500, 6000, 5000 + 800 + JOIN_GAP + 500, 6600)])
    expect(new Set(far.blocks).size).toBe(2)
    const late = write(doc, page, [line(5000, 6000, 5400, 6600), line(6000, 6000, 6400, 6600)], JOIN_TIME + 1)
    expect(new Set(late.blocks).size).toBe(2)
  })

  it('adds to a drawing later, when the stroke falls mostly inside its ink', () => {
    const { doc, page } = empty()
    const drawing = write(doc, page, [line(5000, 5000, 9000, 5000, 9000, 9000, 5000, 9000, 5000, 5000)])
    const later = write(drawing.doc, page, [line(6000, 7000, 8000, 7000)], JOIN_TIME * 10)
    expect(later.blocks[0]).toBe(drawing.blocks[0])
  })

  it('moves the block corner for a stroke left of or above it, and the ink stays where it was written', () => {
    const { doc, page } = empty()
    const first = write(doc, page, [line(5000, 6000, 5400, 6600), line(5600, 6000, 6000, 6600)])
    const id = first.blocks[0]!
    const before = onPage(first.doc, id)
    // The next line starts a little left of the first, and higher: the block's corner moves.
    const placed = placeStroke(first.doc, page, line(4800, 5500, 5200, 5900), { now: 2000, last: { block: id, at: 1900 }, newId: ids })
    expect(placed.block).toBe(id)
    expect(placed.ops.map((op) => op.op)).toEqual(['remove', 'add'])
    const after = step(first.doc, placed.ops).doc
    const block = after.block[id] as InkBlock
    expect(onPage(after, id)).toEqual([...before, [4800, 5500, 128, 5200, 5900, 128]])
    expect({ x: block.x, y: block.y, w: block.w, h: block.h }).toEqual(inkExtent(block))
    // Its place among the page's blocks is kept.
    expect(after.page[page]!.free).toEqual(first.doc.page[page]!.free)
  })

  it('keeps a highlighter wide: its box holds its ink, not only its points', () => {
    const { doc, page } = empty()
    const after = write(doc, page, [{ ...line(5000, 6000, 9000, 6000), tool: 'highlighter', width: 'l' }])
    const block = after.doc.block[after.blocks[0]!] as InkBlock
    expect(block.h).toBe(PEN_SIZE.highlighter.l)
  })

  it("moves a snapped shape's key with its points", () => {
    const { doc, page } = empty()
    const circle: Stroke = { ...line(6000, 5000, 5000, 6000, 4000, 5000, 5000, 4000, 6000, 5000), shape: { kind: 'circle', key: [5000, 5000, 1000] } }
    const after = write(doc, page, [circle])
    const block = after.doc.block[after.blocks[0]!] as InkBlock
    expect(block.strokes[0]!.shape!.key).toEqual([5000 - block.x, 5000 - block.y, 1000])
  })

  it('removes a block whose last stroke goes', () => {
    const { doc, page } = empty()
    const after = write(doc, page, [line(5000, 6000, 9000, 6200)])
    const id = after.blocks[0]!
    const gone = step(after.doc, editInk(after.doc, id, { replace: new Map([[0, []]]) })).doc
    expect(gone.block[id]).toBeUndefined()
  })
})

describe('finding strokes', () => {
  const { doc: blank, page } = empty()
  // Two words of three strokes, 20 mm apart; then a long straight line kept as two points.
  const words = write(blank, page, [line(5000, 6000, 5400, 6600), line(5600, 6000, 6000, 6600), line(6200, 6000, 6600, 6600)])
  // Each write starts with no stroke before it, as after a pause.
  const more = write(words.doc, page, [line(9000, 6000, 9400, 6600), line(9600, 6000, 10000, 6600)])
  const doc = write(more.doc, page, [line(3000, 12000, 15000, 12000)]).doc

  it('finds the stroke under a tap, and none a few millimetres off', () => {
    expect(strokesAt(doc, page, { x: 5200, y: 6300 }, 100)).toEqual([{ block: words.blocks[0], index: 0 }])
    expect(strokesAt(doc, page, { x: 7500, y: 6300 }, 100)).toEqual([])
  })

  it('finds a long line the eraser crosses between its two points', () => {
    const [ref] = strokesAlong(doc, page, [{ x: 9000, y: 11000 }, { x: 9000, y: 13000 }], 50)
    expect(ref).toBeDefined()
    expect((doc.block[ref!.block] as InkBlock).strokes[ref!.index]!.pts).toHaveLength(6)
  })

  it('finds the strokes mostly inside a lasso or a box, not their neighbours', () => {
    const loop = around(5800, 6300, 1400, 700).map(({ x, y }) => ({ x, y }))
    expect(strokesInLoop(doc, page, loop).map((ref) => ref.index).sort()).toEqual([0, 1, 2])
    expect(strokesInLoop(doc, page, loop).every((ref) => ref.block === words.blocks[0])).toBe(true)
    expect(strokesInBox(doc, page, { x: 8800, y: 5800, w: 1400, h: 1000 }).map((ref) => ref.block)).toEqual([more.blocks.at(-1), more.blocks.at(-1)])
  })

  it('lists ink blocks front to back', () => {
    expect(inkBlocks(doc, page).map((block) => block.id)).toEqual([...doc.page[page]!.free].reverse().filter((id) => doc.block[id]!.type === 'ink'))
  })

  it('is quick on a page of 2,000 strokes', () => {
    // Forty lines of fifty strokes, written without pause, so each line is one block.
    let big = blank
    for (let row = 0; row < 40; row++) {
      let last: LastStroke | undefined
      for (let i = 0; i < 50; i++) {
        const pts = drawn([{ x: 2000 + i * 340, y: 3000 + row * 600 }, { x: 2200 + i * 340, y: 3300 + row * 600 }], { seed: row * 50 + i, jitter: 5 })
        const stroke: Stroke = { pts: pts.flatMap((pt) => [Math.round(pt.x), Math.round(pt.y), pt.p]), color: 'ink', width: 'm' }
        const placed = placeStroke(big, page, stroke, { now: i * 300, last, newId: ids })
        big = apply(big, placed.ops).doc
        last = { block: placed.block, at: i * 300 + 200 }
      }
    }
    expect(inkBlocks(big, page)).toHaveLength(40)
    const start = performance.now()
    for (let i = 0; i < 100; i++) strokesAlong(big, page, [{ x: 2000 + i * 100, y: 5000 }, { x: 2050 + i * 100, y: 5100 }], 100)
    // A hundred eraser moves; each is far under a frame.
    expect((performance.now() - start) / 100).toBeLessThan(4)
  })
})

describe('erasing', () => {
  const { doc: blank, page } = empty()

  it('removes whole strokes, one undo step', () => {
    const { doc, blocks } = write(blank, page, [line(5000, 6000, 5400, 6600), line(5600, 6000, 6000, 6600)])
    const after = step(doc, eraseOps(doc, strokesAt(doc, page, { x: 5200, y: 6300 }, 100))).doc
    expect(onPage(after, blocks[0]!)).toEqual([[5600, 6000, 128, 6000, 6600, 128]])
  })

  it('cuts a stroke where the eraser crosses it, at the edge of the eraser', () => {
    const stroke: Stroke = { pts: [0, 0, 100, 4000, 0, 200], color: 'red', width: 's', tool: 'pencil', tilt: [10, 50], straight: true }
    const pieces = cutStroke(stroke, [{ x: 2000, y: -500 }, { x: 2000, y: 500 }], 200)!
    expect(pieces).toHaveLength(2)
    const [left, right] = pieces as [Stroke, Stroke]
    expect(left.pts[0]).toBe(0)
    expect(Math.abs(left.pts.at(-3)! - 1800)).toBeLessThanOrEqual(2)
    expect(Math.abs(right.pts[0]! - 2200)).toBeLessThanOrEqual(2)
    expect(right.pts.at(-3)).toBe(4000)
    // Pressure and tilt carry on along the line; the look stays; a piece of a line is still straight.
    expect(Math.abs(left.pts.at(-1)! - 145)).toBeLessThanOrEqual(1)
    expect(left.tilt).toHaveLength(left.pts.length / 3)
    expect(Math.abs(left.tilt!.at(-1)! - 28)).toBeLessThanOrEqual(1)
    expect(left).toMatchObject({ color: 'red', width: 's', tool: 'pencil', straight: true })
  })

  it('keeps the video time on both pieces of a stroke cut in two', () => {
    const stroke: Stroke = { pts: [0, 0, 100, 4000, 0, 200], color: 'red', width: 's', vt: { m: 'Vid00001', t: 830 } }
    const pieces = cutStroke(stroke, [{ x: 2000, y: -500 }, { x: 2000, y: 500 }], 200)!
    expect(pieces.map((piece) => piece.vt)).toEqual([{ m: 'Vid00001', t: 830 }, { m: 'Vid00001', t: 830 }])
  })

  it('leaves a stroke the eraser misses, and takes one it covers', () => {
    const stroke = line(0, 0, 1000, 0)
    expect(cutStroke(stroke, [{ x: 500, y: 600 }], 200)).toBeUndefined()
    expect(cutStroke(stroke, [{ x: -100, y: 0 }, { x: 1100, y: 0 }], 200)).toEqual([])
  })

  it('drops the shape of a stroke cut in two', () => {
    const circle: Stroke = { ...line(1000, 0, 0, 1000, -1000, 0, 0, -1000, 1000, 0), shape: { kind: 'circle', key: [0, 0, 1000] } }
    const pieces = cutStroke(circle, [{ x: -1500, y: 0 }, { x: -500, y: 0 }], 100)!
    expect(pieces.length).toBeGreaterThan(0)
    expect(pieces.every((piece) => piece.shape === undefined)).toBe(true)
  })

  it('cuts strokes on the page in one undo step, the pieces in the stroke\'s place', () => {
    const { doc, blocks } = write(blank, page, [line(5000, 6000, 9000, 6000), line(5000, 7000, 9000, 7000)])
    const after = step(doc, cutOps(doc, page, [{ x: 7000, y: 5500 }, { x: 7000, y: 6500 }], 150)).doc
    const strokes = onPage(after, blocks[0]!)
    expect(strokes).toHaveLength(3)
    expect(strokes[0]![0]).toBe(5000)
    expect(strokes[1]!.at(-3)).toBe(9000)
    expect(strokes[2]).toEqual([5000, 7000, 128, 9000, 7000, 128])
  })
})

describe('scratching out', () => {
  const { doc: blank, page } = empty()

  it('knows a scratch-out, up and down or side to side, from writing and shapes', () => {
    for (let seed = 1; seed <= 10; seed++) {
      expect(isScratch(zigzag(5000, 6000, 3000, 800, 4, seed)), `zigzag ${seed}`).toBe(true)
      const sideways = drawn(Array.from({ length: 9 }, (_, i) => ({ x: i % 2 === 0 ? 5000 : 8000, y: 6000 + i * 80 })), { seed, jitter: 10 })
      expect(isScratch(sideways), `side to side ${seed}`).toBe(true)
      expect(isScratch(drawn(around(6000, 6000, 1500, 1000), { seed })), `circle ${seed}`).toBe(false)
      expect(isScratch(drawn([{ x: 5000, y: 6000 }, { x: 9000, y: 6100 }], { seed })), `line ${seed}`).toBe(false)
    }
  })

  it('deletes the strokes it covers, and only those', () => {
    const { doc, blocks } = write(blank, page, [line(5000, 6000, 5400, 6600), line(5600, 6000, 6000, 6600), line(9000, 6000, 9400, 6600)])
    // The third stroke, 30 mm off, is a block of its own.
    expect(blocks).toEqual([blocks[0], blocks[0], blocks[2]])
    const targets = scratchTargets(doc, page, zigzag(4800, 5900, 1400, 800, 5, 3))
    expect(targets).toHaveLength(2)
    expect(targets).toEqual(expect.arrayContaining([{ block: blocks[0], index: 0 }, { block: blocks[0], index: 1 }]))
    const after = step(doc, eraseOps(doc, targets)).doc
    expect(after.block[blocks[0]!]).toBeUndefined()
    expect(onPage(after, blocks[2]!)).toEqual([[9000, 6000, 128, 9400, 6600, 128]])
  })

  it('keeps a scratch-like stroke drawn where there is no ink, or over ink it hardly crosses', () => {
    expect(scratchTargets(blank, page, zigzag(4800, 5900, 1400, 800, 5, 3))).toEqual([])
    expect(scratchTargets(blank, page, cursive(5000, 6000, 6))).toEqual([])
    // A word written over a dot and a short dash: they sit inside it, but it crosses them less than four times.
    const marks = write(blank, page, [line(5500, 5800), line(6200, 5800, 6260, 5800)]).doc
    expect(scratchTargets(marks, page, cursive(5000, 6000, 6))).toEqual([])
  })

  it('takes two back-and-forths over a word for a scratch-out, not only long scribbles', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { doc, blocks } = write(blank, page, [line(5000, 6000, 5400, 6600), line(5600, 6000, 6000, 6600)])
      // Four passes across the word, as a quick scribble.
      const scribble = drawn([{ x: 4900, y: 6150 }, { x: 6100, y: 6250 }, { x: 4950, y: 6350 }, { x: 6080, y: 6450 }, { x: 4900, y: 6500 }], { seed, jitter: 10 })
      const targets = scratchTargets(doc, page, scribble)
      expect(targets.map((ref) => ref.block), `seed ${seed}`).toEqual([blocks[0], blocks[0]])
    }
  })

  it('takes a long word scribbled over only in part', () => {
    // One cursive stroke 30 mm long; the scribble covers its first third.
    const word = cursive(5000, 6600, 10, 2)
    const { doc, blocks } = write(blank, page, [{ pts: word.flatMap((pt) => [Math.round(pt.x), Math.round(pt.y), 128]), color: 'ink', width: 'm' }])
    const scribble = zigzag(4900, 6000, 1200, 700, 4, 5)
    expect(scratchTargets(doc, page, scribble)).toEqual([{ block: blocks[0], index: 0 }])
  })

  it('deletes nothing for a ring drawn twice round words, nor for writing beside them', () => {
    const { doc } = write(blank, page, [line(5000, 6000, 5400, 6600), line(5600, 6000, 6000, 6600)])
    const twice = drawn(around(5500, 6300, 1200, 800, 0, 1.0), { seed: 4 })
    expect(isScratch(twice)).toBe(true)
    expect(scratchTargets(doc, page, twice)).toEqual([])
    expect(scratchTargets(doc, page, cursive(6400, 6600, 6, 3))).toEqual([])
  })

  it('outlines points with their convex hull', () => {
    expect(hull([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }, { x: 0, y: 10 }])).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])
  })
})
