// Where a board's nodes go, worked out by code alone: a node's size from its words, a whole chart in layers, one new
// step beside the node it follows. No model, command or assistant ever gives a position.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { apply, chartOps, createDoc, emptySpot, flowOf, GAP_ACROSS, GAP_ALONG, layoutChart, moveOps, nodesOn, nodeSize, NodeShape, readFlowchart, stepOps, tidyChartOps, validateDoc, type Block, type Doc, type Id, type NodeBlock, type Op } from '../../src/index.js'
import { BOARD } from '../fixtures/index.js'
import { expectError, step } from '../helpers.js'

type Box = { x: number; y: number; w: number; h: number }
const apart = (a: Box, b: Box, gap: number): boolean => a.x + a.w + gap <= b.x || b.x + b.w + gap <= a.x || a.y + a.h + gap <= b.y || b.y + b.h + gap <= a.y
const centre = (box: Box): { x: number; y: number } => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 })
const SIZE = { w: 4000, h: 1600 }
const sized = (...keys: string[]) => keys.map((key) => ({ key, ...SIZE }))
const links = (...pairs: string[]) => pairs.map((pair) => ({ from: pair.split('>')[0]!, to: pair.split('>')[1]! }))

/** A board with a chart on it, its nodes named n1, n2… in the order the chart names them. */
function boardOf(src: string): Doc {
  const doc = createDoc({ board: true })
  let count = 0
  return validateDoc(apply(doc, chartOps(doc, doc.pages[0]!, readFlowchart(src), () => `n${++count}`).ops).doc)
}
const node = (doc: Doc, id: Id): NodeBlock => doc.block[id] as NodeBlock
/** Ids for new nodes: m1, m2… */
const namer = (): (() => Id) => {
  let count = 0
  return () => `m${++count}`
}

describe('a node’s size', () => {
  it('comes from its words: wider for more letters, taller for more lines, in whole millimetres', () => {
    const short = nodeSize('box', 'Start')
    const longer = nodeSize('box', 'Ask a friend to review it')
    const lines = nodeSize('box', 'Ask a friend to review the whole of it before the end of the week')
    expect(longer.w).toBeGreaterThan(short.w)
    expect(longer.h).toBe(short.h)
    expect(lines.h).toBeGreaterThan(longer.h)
    expect(lines.w).toBeLessThanOrEqual(6200)
    for (const size of [short, longer, lines]) expect([size.w % 100, size.h % 100]).toEqual([0, 0])
  })

  it('counts the words as they are read, not their Markdown, and gives a node with no words a size', () => {
    expect(nodeSize('box', 'Ask a **friend** to review it')).toEqual(nodeSize('box', 'Ask a friend to review it'))
    expect(nodeSize('box', '').w).toBeGreaterThan(0)
    // A letter of Chinese takes two letters' width.
    expect(nodeSize('box', '開始開始開始開始開始開始開始開始').w).toBeGreaterThan(nodeSize('box', 'abababababababab').w)
  })

  it('leaves room for the shape: a diamond and a circle are larger than a box with the same words', () => {
    const box = nodeSize('box', 'Passed the review?')
    for (const shape of NodeShape.options) {
      const size = nodeSize(shape, 'Passed the review?')
      expect(size.h, shape).toBeGreaterThanOrEqual(box.h)
      // A circle is as wide as it is tall, wide enough for its words from corner to corner; the others, as a box.
      if (shape === 'circle' || shape === 'double-circle') expect([size.w === size.h, size.w > 3600]).toEqual([true, true])
      else expect(size.w, shape).toBeGreaterThanOrEqual(box.w)
    }
    expect(nodeSize('diamond', 'Passed the review?').h).toBeGreaterThan(box.h * 1.5)
    const circle = nodeSize('circle', 'Join')
    expect(circle.w).toBe(circle.h)
  })

  it('cuts a word longer than a line, and never grows without end', () => {
    const size = nodeSize('box', 'a'.repeat(400))
    expect(size.w).toBeLessThanOrEqual(6200)
    expect(size.h).toBeGreaterThan(8000)
  })
})

describe('a chart laid out in layers', () => {
  it('puts a chain on one line, a layer after a layer, from 0, 0', () => {
    const boxes = layoutChart(sized('a', 'b', 'c'), links('a>b', 'b>c'))
    expect(boxes.get('a')).toEqual({ x: 0, y: 0, ...SIZE })
    expect(boxes.get('b')).toEqual({ x: 0, y: SIZE.h + GAP_ALONG, ...SIZE })
    expect(boxes.get('c')).toEqual({ x: 0, y: 2 * (SIZE.h + GAP_ALONG), ...SIZE })
  })

  it('puts a decision’s two branches level, one each side of it, and what joins them between them', () => {
    const boxes = layoutChart(sized('q', 'yes', 'no', 'end'), links('q>yes', 'q>no', 'yes>end', 'no>end'))
    const [q, yes, no, end] = ['q', 'yes', 'no', 'end'].map((key) => boxes.get(key)!)
    expect(yes!.y).toBe(no!.y)
    expect(yes!.x).toBeLessThan(no!.x)
    expect(no!.x - (yes!.x + yes!.w)).toBe(GAP_ACROSS)
    expect(centre(q!).x).toBe((centre(yes!).x + centre(no!).x) / 2)
    expect(centre(end!).x).toBe(centre(q!).x)
    expect(end!.y).toBeGreaterThan(yes!.y)
  })

  it('puts a node a layer after the furthest node pointing to it', () => {
    // c is reached straight from a and through b: it lies after b.
    const boxes = layoutChart(sized('a', 'b', 'c'), links('a>c', 'a>b', 'b>c'))
    expect(boxes.get('b')!.y).toBeGreaterThan(boxes.get('a')!.y)
    expect(boxes.get('c')!.y).toBeGreaterThan(boxes.get('b')!.y)
  })

  it('lays out a loop, the way back not counted: the nodes stay in the order the loop is entered', () => {
    const boxes = layoutChart(sized('a', 'b', 'c'), links('a>b', 'b>c', 'c>a'))
    expect(['a', 'b', 'c'].map((key) => boxes.get(key)!.y)).toEqual([0, SIZE.h + GAP_ALONG, 2 * (SIZE.h + GAP_ALONG)])
    // A loop with no start at all, and a node pointing to itself, are laid out too.
    expect(layoutChart(sized('a', 'b'), links('a>b', 'b>a', 'a>a')).size).toBe(2)
  })

  it('runs the way it is told: down, right, up or left', () => {
    const along = (flow: 'down' | 'right' | 'up' | 'left'): Box[] => {
      const boxes = layoutChart(sized('a', 'b'), links('a>b'), flow)
      return [boxes.get('a')!, boxes.get('b')!]
    }
    expect(along('down')[1]!.y).toBeGreaterThan(along('down')[0]!.y)
    expect(along('up')[1]!.y).toBeLessThan(along('up')[0]!.y)
    expect(along('right')[1]!.x).toBe(SIZE.w + GAP_ALONG)
    expect(along('right')[1]!.y).toBe(along('right')[0]!.y)
    expect(along('left')[1]!.x).toBeLessThan(along('left')[0]!.x)
    for (const flow of ['down', 'right', 'up', 'left'] as const) expect(Math.min(...along(flow).map((box) => box.x)) + Math.min(...along(flow).map((box) => box.y))).toBe(0)
  })

  it('leaves out a link that names no node of the chart, and lays out nodes that nothing joins side by side', () => {
    const boxes = layoutChart(sized('a', 'b'), links('a>zz', 'zz>b'))
    expect(boxes.get('a')!.y).toBe(boxes.get('b')!.y)
    expect(apart(boxes.get('a')!, boxes.get('b')!, GAP_ACROSS)).toBe(true)
  })

  it('whatever the chart, lays no node on another, puts each link’s end after its start unless it is a way back, and gives the same places each time', () => {
    const chart = fc.integer({ min: 1, max: 24 }).chain((count) =>
      fc.record({
        sizes: fc.array(fc.record({ w: fc.integer({ min: 20, max: 80 }), h: fc.integer({ min: 10, max: 60 }) }), { minLength: count, maxLength: count }),
        pairs: fc.array(fc.tuple(fc.nat(count - 1), fc.nat(count - 1)), { maxLength: count * 3 }),
        flow: fc.constantFrom('down' as const, 'right' as const, 'up' as const, 'left' as const),
      }),
    )
    fc.assert(
      fc.property(chart, ({ sizes, pairs, flow }) => {
        const nodes = sizes.map((size, i) => ({ key: `k${i}`, w: size.w * 100, h: size.h * 100 }))
        const joined = pairs.map(([a, b]) => ({ from: `k${a}`, to: `k${b}` }))
        const boxes = layoutChart(nodes, joined, flow)
        expect(boxes.size).toBe(nodes.length)
        const list = [...boxes.values()]
        for (const box of list) expect([Number.isInteger(box.x), Number.isInteger(box.y)]).toEqual([true, true])
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) expect(apart(list[i]!, list[j]!, GAP_ACROSS - 1), `${i} and ${j}`).toBe(true)
        expect(layoutChart(nodes, joined, flow)).toEqual(boxes)
        // With no loop in it, every link runs the way the chart does.
        const forward = joined.filter((link) => Number(link.from.slice(1)) < Number(link.to.slice(1)))
        const one = layoutChart(nodes, forward, 'down')
        for (const link of forward) expect(one.get(link.to)!.y).toBeGreaterThan(one.get(link.from)!.y)
      }),
      { numRuns: 200 },
    )
  })

  it('lays out five hundred nodes, the most a chart is read into, in a moment', () => {
    const nodes = sized(...Array.from({ length: 500 }, (_, i) => `k${i}`))
    const joined = Array.from({ length: 499 }, (_, i) => ({ from: `k${Math.floor(i / 2)}`, to: `k${i + 1}` }))
    expect(layoutChart(nodes, joined).size).toBe(500)
    // One chain of five hundred: as deep as a chart gets.
    expect(layoutChart(nodes, Array.from({ length: 499 }, (_, i) => ({ from: `k${i}`, to: `k${i + 1}` }))).get('k499')!.y).toBe(499 * (SIZE.h + GAP_ALONG))
  })
})

describe('a chart put on a board', () => {
  const SRC = 'flowchart TD\n  A([Start]) --> B[Write the draft]\n  B --> C{Passed?}\n  C -->|yes| D([Publish])\n  C -. no .-> B'

  it('is a node for each of its nodes, sized for its words, each with its links, in one change that undo takes back', () => {
    const doc = createDoc({ board: true })
    const made = chartOps(doc, doc.pages[0]!, readFlowchart(SRC), namer())
    expect([...made.made]).toEqual([['A', 'm1'], ['B', 'm2'], ['C', 'm3'], ['D', 'm4']])
    const after = step(doc, made.ops).doc
    expect(node(after, 'm1')).toMatchObject({ shape: 'pill', md: 'Start', to: [{ node: 'm2' }], ...nodeSize('pill', 'Start') })
    expect(node(after, 'm3')).toMatchObject({ shape: 'diamond', to: [{ node: 'm4', label: 'yes' }, { node: 'm2', label: 'no', line: 'dotted' }] })
    expect(node(after, 'm4').to).toBeUndefined()
    // An empty board takes it from 0, 0, and the box said is the whole chart's.
    expect(made.box).toMatchObject({ x: 0, y: 0 })
    expect(Math.min(...nodesOn(after, after.pages[0]!).map((each) => each.y))).toBe(0)
    expect(flowOf(nodesOn(after, after.pages[0]!))).toBe('down')
  })

  it('goes where the board is empty: beside what is there, or round where the person is looking when that is free', () => {
    const first = boardOf(SRC)
    const page = first.pages[0]!
    const second = chartOps(first, page, readFlowchart('flowchart LR\n  X --> Y'), namer())
    const both = step(first, second.ops).doc
    const old = nodesOn(first, page)
    for (const added of [node(both, 'm1'), node(both, 'm2')]) for (const there of old) expect(apart(added, there, 1000)).toBe(true)
    expect(node(both, 'm2').x).toBeGreaterThan(node(both, 'm1').x)
    // Round a point far from everything, it is centred there.
    const near = chartOps(first, page, readFlowchart('flowchart LR\n  X --> Y'), namer(), { x: -50_000, y: 20_000 })
    expect(near.box.x + near.box.w / 2).toBeCloseTo(-50_000, -1)
    expect(emptySpot(createDoc({ board: true }), 'none', SIZE)).toEqual({ x: 0, y: 0 })
  })
})

describe('one new step', () => {
  const CHAIN = 'flowchart TD\n  A[One] --> B[Two]\n  B -->|then| C[Three]\n  C --> D[Four]'

  it('after a node with one next step goes between them, and that step moves along with all after it', () => {
    const doc = boardOf(CHAIN)
    const { ops, id } = stepOps(doc, 'n2', 'after', { md: 'Two and a half' }, namer())
    const after = step(doc, ops).doc
    const added = node(after, id)
    const moved = added.h + GAP_ALONG
    // Under n2, where n3 was; n3 and n4 moved down by the new step's height and a gap; n1 and n2 stayed.
    expect([added.y, centre(added).x]).toEqual([node(doc, 'n3').y, centre(node(doc, 'n2')).x])
    expect([node(after, 'n3').y - node(doc, 'n3').y, node(after, 'n4').y - node(doc, 'n4').y]).toEqual([moved, moved])
    expect([node(after, 'n1').y, node(after, 'n2').y]).toEqual([node(doc, 'n1').y, node(doc, 'n2').y])
    // The link keeps its words on its first half: Two, then, the new step, Three.
    expect(node(after, 'n2').to).toEqual([{ node: id, label: 'then' }])
    expect(added.to).toEqual([{ node: 'n3' }])
  })

  it('after the last node is its next step; after a decision, one more branch beside the others', () => {
    const doc = boardOf('flowchart TD\n  Q{Ready?} -->|yes| Y[Go]\n  Q -->|no| N[Wait]')
    const last = stepOps(doc, 'n2', 'after', { md: 'Done', shape: 'pill', color: 'green' }, namer())
    const one = step(doc, last.ops).doc
    expect(node(one, last.id)).toMatchObject({ shape: 'pill', color: 'green', y: node(doc, 'n2').y + node(doc, 'n2').h + GAP_ALONG })
    expect(node(one, 'n2').to).toEqual([{ node: last.id }])

    const branch = stepOps(doc, 'n1', 'after', { md: 'Ask again' }, namer())
    const two = step(doc, branch.ops).doc
    const added = node(two, branch.id)
    expect(added.y).toBe(node(doc, 'n2').y)
    expect(added.x).toBe(node(doc, 'n3').x + node(doc, 'n3').w + GAP_ACROSS)
    expect(node(two, 'n1').to).toEqual([{ node: 'n2', label: 'yes' }, { node: 'n3', label: 'no' }, { node: branch.id }])
    // Nothing else moved.
    for (const id of ['n1', 'n2', 'n3']) expect([node(two, id).x, node(two, id).y]).toEqual([node(doc, id).x, node(doc, id).y])
  })

  it('before a node takes its place and the links that led to it; before a first node, it stands ahead of it', () => {
    const doc = boardOf(CHAIN)
    const { ops, id } = stepOps(doc, 'n3', 'before', { md: 'Check' }, namer())
    const after = step(doc, ops).doc
    expect(node(after, id).y).toBe(node(doc, 'n3').y)
    expect(node(after, 'n2').to).toEqual([{ node: id, label: 'then' }])
    expect(node(after, id).to).toEqual([{ node: 'n3' }])
    expect(node(after, 'n3').y).toBe(node(doc, 'n3').y + node(after, id).h + GAP_ALONG)
    expect(node(after, 'n4').y - node(after, 'n3').y).toBe(node(doc, 'n4').y - node(doc, 'n3').y)

    const first = stepOps(doc, 'n1', 'before', { md: 'Begin' }, namer())
    const led = step(doc, first.ops).doc
    expect(node(led, first.id).y + node(led, first.id).h + GAP_ALONG).toBe(node(doc, 'n1').y)
    expect(node(led, first.id).to).toEqual([{ node: 'n1' }])
    expect(node(led, 'n1').y).toBe(node(doc, 'n1').y)
  })

  it('follows a chart that runs to the right, and a way back that is a node’s only link', () => {
    const doc = boardOf('flowchart LR\n  A[One] --> B[Two] --> C[Three]\n  C --> A')
    const between = stepOps(doc, 'n1', 'after', { md: 'New' }, namer())
    const after = step(doc, between.ops).doc
    expect(node(after, between.id).x).toBe(node(doc, 'n1').x + node(doc, 'n1').w + GAP_ALONG)
    expect(node(after, 'n2').x).toBeGreaterThan(node(doc, 'n2').x)
    expect(node(after, 'n2').y).toBe(node(doc, 'n2').y)
    // After the last, whose one link goes back to the first: it is put on that link, and nothing behind it moves.
    const loop = stepOps(doc, 'n3', 'after', { md: 'Again?' }, namer())
    const looped = step(doc, loop.ops).doc
    expect(node(looped, 'n3').to).toEqual([{ node: loop.id }])
    expect(node(looped, loop.id).to).toEqual([{ node: 'n1' }])
    expect(node(looped, loop.id).x).toBeGreaterThan(node(doc, 'n3').x)
    for (const id of ['n1', 'n2', 'n3']) expect(node(looped, id).x).toBe(node(doc, id).x)
  })

  it('never lies on something else: it goes aside until it is clear', () => {
    let doc = boardOf('flowchart TD\n  A[One]')
    const page = doc.pages[0]!
    const one = node(doc, 'n1')
    // A box of text just where a step after n1 would go.
    const frame = { id: 'fx', r: 0, type: 'frame', page, x: one.x, y: one.y + one.h + GAP_ALONG, w: 4000, h: 1500, kids: [] } as Block
    doc = apply(doc, [{ op: 'add', block: frame }]).doc
    const { ops, id } = stepOps(doc, 'n1', 'after', { md: 'Two' }, namer())
    const after = step(doc, ops).doc
    expect(apart(node(after, id), frame as unknown as Box, 300)).toBe(true)
    expect(node(after, id).y).toBe(one.y + one.h + GAP_ALONG)
  })

  it('moves the ink written on a node with the node', () => {
    const { ops } = stepOps(BOARD, 'n2', 'after', { md: 'Check' }, namer())
    const after = step(BOARD, ops).doc
    const down = node(after, 'n3').y - node(BOARD, 'n3').y
    expect(down).toBeGreaterThan(0)
    const [was, now] = [BOARD.block.k1 as Extract<Block, { type: 'ink' }>, after.block.k1 as Extract<Block, { type: 'ink' }>]
    expect([now.x - was.x, now.y - was.y]).toEqual([0, down])
    // The box of text beside the chart is no part of it, and stays.
    expect(after.block.f1).toEqual(BOARD.block.f1)
  })

  it('is refused after a block that is no node, and for a node with no room for one more link', () => {
    expectError(() => stepOps(BOARD, 't1', 'after', { md: 'x' }, namer()), 'wrong_type', /not a step of a flowchart/u)
    expectError(() => stepOps(BOARD, 'zz', 'after', { md: 'x' }, namer()), 'wrong_type')
    let doc = boardOf(`flowchart TD\n${Array.from({ length: 64 }, (_, i) => `hub --> k${i}`).join('\n')}`)
    doc = validateDoc(doc)
    expectError(() => stepOps(doc, 'n1', 'after', { md: 'x' }, namer()), 'bad_value', /64 steps already/u)
  })
})

describe('moving and tidying', () => {
  it('moves nodes and the ink on them, and nothing for no distance', () => {
    const ops = moveOps(BOARD, ['n3'], 700, -200)
    expect(ops.map((op) => (op as Extract<Op, { op: 'move' }>).id).sort()).toEqual(['k1', 'n3'])
    const after = step(BOARD, ops).doc
    expect(node(after, 'n3')).toMatchObject({ x: node(BOARD, 'n3').x + 700, y: node(BOARD, 'n3').y - 200 })
    expect(moveOps(BOARD, ['n3'], 0, 0)).toEqual([])
  })

  it('lays a chart out again where it stands, each node keeping its size; a chart just laid out stays as it is', () => {
    const doc = boardOf('flowchart TD\n  A[One] --> B[Two] --> C[Three]')
    const page = doc.pages[0]!
    expect(tidyChartOps(doc, page)).toEqual([])
    // Dragged out of line, and one made larger by hand.
    const messy = apply(doc, [
      { op: 'move', id: 'n2', to: { page, x: 9000, y: -3000 } },
      { op: 'update', id: 'n3', set: { w: 7000 } },
    ]).doc
    const tidy = step(messy, tidyChartOps(messy, page)).doc
    const [a, b, c] = ['n1', 'n2', 'n3'].map((id) => node(tidy, id))
    expect([centre(b!).x, centre(c!).x]).toEqual([centre(a!).x, centre(a!).x])
    expect(b!.y).toBe(a!.y + a!.h + GAP_ALONG)
    expect(c!.w).toBe(7000)
    // Its first corner is where the messy one's was.
    expect([Math.min(a!.x, b!.x, c!.x), Math.min(a!.y, b!.y, c!.y)]).toEqual([Math.min(...nodesOn(messy, page).map((each) => each.x)), Math.min(...nodesOn(messy, page).map((each) => each.y))])
    expect(tidyChartOps(tidy, page)).toEqual([])
    expect(tidyChartOps(createDoc({ board: true }), 'none')).toEqual([])
  })
})
