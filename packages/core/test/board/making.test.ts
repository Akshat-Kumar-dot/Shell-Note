// What a person's hand makes on a board: a step drawn by a drag or a click, its middle on a dot; a link drawn to a step
// or to the bare board, where a step of the same shape is made; a link's end taken to another step, its words and look
// kept; and the route a link will take, so its point can be marked before it is let go.
import { describe, expect, it } from 'vitest'
import { apply, boardLinks, drawnBox, joinNewOps, joinOps, linkRoute, moveEndOps, newStepOp, nodeSize, portOf, toDot, type NodeBlock } from '../../src/index.js'
import { BOARD } from '../fixtures/index.js'

const node = (doc: typeof BOARD, id: string): NodeBlock => doc.block[id] as NodeBlock
const middle = (box: { x: number; y: number; w: number; h: number }) => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 })

describe('a step drawn by hand', () => {
  it('is of the usual size for its shape about a click, its middle on the nearest dot', () => {
    const box = drawnBox('box', { x: 1230, y: 4410 })
    expect({ w: box.w, h: box.h }).toEqual(nodeSize('box', ''))
    expect(middle(box)).toEqual({ x: 1000, y: 4500 })
    // Alt held: just where it was clicked.
    expect(middle(drawnBox('diamond', { x: 1230, y: 4410 }, undefined, true))).toEqual({ x: 1230, y: 4410 })
  })

  it('lies over the box dragged, in whole millimetres, never smaller than its shape needs', () => {
    const big = drawnBox('box', { x: 0, y: 0 }, { x: 9040, y: 5960 })
    expect({ w: big.w, h: big.h }).toEqual({ w: 9000, h: 6000 })
    expect(middle(big)).toEqual({ x: toDot(4520), y: toDot(2980) })
    // Dragged the other way, the same box.
    expect(drawnBox('box', { x: 9040, y: 5960 }, { x: 0, y: 0 })).toEqual(big)
    const small = drawnBox('circle', { x: 0, y: 0 }, { x: 300, y: 200 })
    expect({ w: small.w, h: small.h }).toEqual(nodeSize('circle', ''))
  })

  it('goes in with no words, as one change', () => {
    const done = apply(BOARD, [newStepOp('p1', drawnBox('hexagon', { x: 20000, y: 0 }), 'hexagon', 'n9')]).doc
    expect(node(done, 'n9')).toMatchObject({ type: 'node', shape: 'hexagon', md: '', page: 'p1' })
    expect(done.page.p1!.free.at(-1)).toBe('n9')
  })
})

describe('a link drawn by hand', () => {
  it('joins one step to another, and nothing when they are one step, joined so already, or not both steps', () => {
    const ops = joinOps(BOARD, 'n4', 'n1')
    expect(ops).toEqual([{ op: 'update', id: 'n4', set: { to: [{ node: 'n1' }] } }])
    expect(apply(BOARD, ops).doc.block.n4).toMatchObject({ to: [{ node: 'n1' }] })
    expect(joinOps(BOARD, 'n1', 'n1')).toEqual([])
    expect(joinOps(BOARD, 'n1', 'n2')).toEqual([])
    expect(joinOps(BOARD, 'n1', 'f1')).toEqual([])
    // The other way round is a link of its own.
    expect(joinOps(BOARD, 'n2', 'n1')).toHaveLength(1)
  })

  it('let go on the bare board makes a step of the same shape there, joined, in one change', () => {
    const ops = joinNewOps(BOARD, 'n1', { x: 12020, y: 380 }, false, 'n9')!
    const done = apply(BOARD, ops).doc
    expect(node(done, 'n9')).toMatchObject({ shape: 'pill', md: '', ...nodeSize('pill', '') })
    expect(middle(node(done, 'n9'))).toEqual({ x: 12000, y: 500 })
    expect(node(done, 'n1').to).toEqual([{ node: 'n2' }, { node: 'n9' }])
  })
})

describe("a chosen link's end taken to another step", () => {
  it('leads the link there instead, its words and look kept, in its place among the links', () => {
    const done = apply(BOARD, moveEndOps(BOARD, 'n3', 'n4', 'to', 'n1')).doc
    expect(node(done, 'n3').to).toEqual([{ node: 'n1', label: 'yes' }, { node: 'n2', label: 'no', path: 'curved' }])
  })

  it('leaves another step instead, in one change', () => {
    const ops = moveEndOps(BOARD, 'n3', 'n4', 'from', 'n2')
    expect(ops).toHaveLength(2)
    const done = apply(BOARD, ops).doc
    expect(node(done, 'n2').to).toEqual([{ node: 'n3' }, { node: 'n4', label: 'yes' }])
    expect(node(done, 'n3').to).toEqual([{ node: 'n2', label: 'no', path: 'curved' }])
    // Its last link gone, a step has no "to".
    expect(node(apply(BOARD, moveEndOps(BOARD, 'n2', 'n3', 'from', 'n4')).doc, 'n2').to).toBeUndefined()
  })

  it('changes nothing onto the steps it joins, onto a pair joined already, or onto what is not a step', () => {
    expect(moveEndOps(BOARD, 'n3', 'n4', 'to', 'n4')).toEqual([])
    expect(moveEndOps(BOARD, 'n3', 'n4', 'to', 'n3')).toEqual([])
    expect(moveEndOps(BOARD, 'n3', 'n4', 'to', 'n2')).toEqual([])
    expect(moveEndOps(BOARD, 'n3', 'n2', 'from', 'n1')).toEqual([])
    expect(moveEndOps(BOARD, 'n3', 'n4', 'to', 'f1')).toEqual([])
    expect(moveEndOps(BOARD, 'n1', 'n4', 'to', 'n3')).toEqual([])
  })
})

describe('the route a link will take', () => {
  it('is the route the board draws for a link there is', () => {
    const drawn = boardLinks(BOARD, 'p1').find((link) => link.from === 'n3' && link.to === 'n2')!
    expect(linkRoute(BOARD, 'n3', 'n2')).toEqual(drawn.route)
  })

  it('for a link not made yet, enters by the side it takes once it is made', () => {
    const route = linkRoute(BOARD, 'n4', 'n1')!
    const drawn = boardLinks(apply(BOARD, joinOps(BOARD, 'n4', 'n1')).doc, 'p1').find((link) => link.from === 'n4' && link.to === 'n1')!
    expect(route.to).toBe(drawn.route.to)
    expect(route.points.at(-1)).toEqual(portOf('pill', node(BOARD, 'n1'), route.to))
    // A way back goes round a side: it enters by a side, not the top.
    expect(['left', 'right']).toContain(route.to)
    expect(linkRoute(BOARD, 'n1', 'n1')).toBeUndefined()
    expect(linkRoute(BOARD, 'n1', 'f1')).toBeUndefined()
  })
})
