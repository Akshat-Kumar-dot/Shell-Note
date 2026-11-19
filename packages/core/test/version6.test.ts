// File format version 6 (16 November 2026): the board. A note of one endless page; its nodes, each a shape with
// words in it and the nodes it points to; ink that belongs to a node. A link is kept on the node it leaves, so it is
// made and taken away by `update`, and no operation is new. Nothing in an older note changes.
import { describe, expect, it } from 'vitest'
import { apply, createDoc, fromFiles, isEndless, outline, parseDoc, readBlocks, SCHEMA_VERSION, settle, startAs, structureProblems, toFiles, validateDoc, type Block, type Doc, type Op } from '../src/index.js'
import { BOARD, PHYSICS } from './fixtures/index.js'
import { expectError, step } from './helpers.js'

/** A node as `add` takes it. */
const node = (id: string, more: Record<string, unknown> = {}): Block => ({ id, r: 0, type: 'node', page: 'p1', x: 0, y: 0, w: 4000, h: 1600, shape: 'box', md: id, ...more }) as Block

describe('file format version 6', () => {
  it('is the version written', () => {
    expect(SCHEMA_VERSION).toBe(6)
  })

  it('opens a version 5 note unchanged but for its version', () => {
    const old = { ...structuredClone(PHYSICS), v: 5 }
    expect(parseDoc(old)).toEqual({ ...PHYSICS, v: 6 })
  })

  it('writes an older note’s files with nothing new in them', () => {
    const text = Object.values(toFiles(PHYSICS)).join('\n')
    expect(text).not.toMatch(/"endless"|"node"|"board"|"on"/u)
  })

  it('makes a board: one endless page, with nothing on it', () => {
    const doc = createDoc({ title: 'Plan', board: true })
    expect(validateDoc(doc)).toBe(doc)
    expect(doc.kind).toBe('board')
    expect(doc.pages).toHaveLength(1)
    expect(doc.page[doc.pages[0]!]).toEqual({ id: doc.pages[0], endless: true, bg: 'dots', free: [] })
    expect(Object.keys(doc.block)).toHaveLength(0)
  })

  it('starts a new note as a board, keeping its id and title, as the library starts a note of a kind', () => {
    const fresh = createDoc({ title: 'Plan' })
    const board = startAs(fresh, 'board')
    expect(validateDoc(board)).toBe(board)
    expect(board).toMatchObject({ id: fresh.id, title: 'Plan', kind: 'board' })
    expect(isEndless(board.page[board.pages[0]!]!)).toBe(true)
  })

  it('keeps a board through saving and opening: its page, its nodes, their links, the ink on a node', () => {
    const files = toFiles(BOARD)
    expect(files['doc.json']).toContain('"p1": {"id":"p1","endless":true,"bg":"dots","free":["n1","n2","n3","n4","f1","k1"]}')
    expect(fromFiles(files)).toEqual(BOARD)
  })
})

describe('a board’s nodes and links', () => {
  it('takes a chart’s nodes in any order, each with its links, in one change', () => {
    const doc = createDoc({ board: true })
    const page = doc.pages[0]!
    const a = { ...node('a1', { to: [{ node: 'b1', label: 'next' }] }), page }
    const b = { ...node('b1', { to: [{ node: 'a1' }] }), page }
    // a1 points to b1 before b1 is there: the links are checked as the change finally stands.
    const made = step(doc, [{ op: 'add', block: a } as Op, { op: 'add', block: b } as Op])
    expect(made.doc.block.a1).toMatchObject({ to: [{ node: 'b1', label: 'next' }] })
    // Alone, a link to a node that is not there is refused, with the way to fix it.
    expectError(() => apply(doc, [{ op: 'add', block: a } as Op]), 'unknown_id', /points to b1, which does not exist/u)
  })

  it('makes a link by update of the node it leaves, and undo takes it back', () => {
    const linked = step(BOARD, [{ op: 'update', id: 'n4', set: { to: [{ node: 'n1', label: 'again' }] } }])
    expect(linked.doc.block.n4).toMatchObject({ to: [{ node: 'n1', label: 'again' }] })
    const back = apply(linked.doc, linked.inverse).doc
    expect(back.block.n4).not.toHaveProperty('to')
  })

  it('takes a node’s links away with an empty list, or null', () => {
    expect(step(BOARD, [{ op: 'update', id: 'n3', set: { to: [] } }]).doc.block.n3).not.toHaveProperty('to')
    expect(step(BOARD, [{ op: 'update', id: 'n3', set: { to: null } }]).doc.block.n3).not.toHaveProperty('to')
  })

  it('refuses a link to what is not there, to what is not a node, to itself, or twice, each with a hint', () => {
    const link = (to: unknown): Op => ({ op: 'update', id: 'n4', set: { to } })
    expectError(() => apply(BOARD, [link([{ node: 'zz' }])]), 'unknown_id', /use a node id/u)
    expectError(() => apply(BOARD, [link([{ node: 't1' }])]), 'bad_ref', /has type text, not node/u)
    expectError(() => apply(BOARD, [link([{ node: 'n4' }])]), 'bad_shape', /does not point to itself/u)
    expectError(() => apply(BOARD, [link([{ node: 'n1' }, { node: 'n1', label: 'again' }])]), 'bad_shape', /once/u)
    expectError(() => apply(BOARD, [link([{ node: 'n1', label: 'two\nlines' }])]), 'bad_shape', /one line/u)
    expectError(() => apply(BOARD, [link([{ node: 'n1', path: 'zigzag' }])]), 'bad_shape')
  })

  it('removes a node with the links to it and the ink on it, and undo puts all of it back', () => {
    const gone = step(BOARD, [{ op: 'remove', id: 'n3' }])
    expect(gone.doc.block.n3).toBeUndefined()
    // The ink written on it went with it; the link n2 had to it went too.
    expect(gone.doc.block.k1).toBeUndefined()
    expect(gone.doc.block.n2).not.toHaveProperty('to')
    expect(gone.doc.page.p1!.free).toEqual(['n1', 'n2', 'n4', 'f1'])
    expect(validateDoc(gone.doc)).toBe(gone.doc)
    const back = apply(gone.doc, gone.inverse).doc
    expect(back.page.p1!.free).toEqual(BOARD.page.p1!.free)
    expect(back.block.n2).toMatchObject({ to: [{ node: 'n3' }] })
  })

  it('removes a node that others point to among several, leaving their other links', () => {
    const gone = step(BOARD, [{ op: 'remove', id: 'n2' }])
    expect(gone.doc.block.n1).not.toHaveProperty('to')
    expect(gone.doc.block.n3).toMatchObject({ to: [{ node: 'n4', label: 'yes' }] })
  })

  it('changes a node’s words as a paragraph’s, its shape and its colour', () => {
    const spliced = step(BOARD, [{ op: 'splice', id: 'n2', field: 'md', at: 0, del: 5, ins: 'Draft' }])
    expect(spliced.doc.block.n2).toMatchObject({ md: 'Draft the **draft**' })
    const shaped = step(BOARD, [{ op: 'update', id: 'n2', set: { shape: 'cylinder', color: 'green' } }])
    expect(shaped.doc.block.n2).toMatchObject({ shape: 'cylinder', color: 'green' })
    expectError(() => apply(BOARD, [{ op: 'update', id: 'n2', set: { shape: 'blob' } }]), 'bad_shape')
  })

  it('moves a node as any block placed on a page, below zero too, its links untouched', () => {
    const moved = step(BOARD, [{ op: 'move', id: 'n3', to: { page: 'p1', x: -90000, y: -4000 } }])
    expect(moved.doc.block.n3).toMatchObject({ x: -90000, y: -4000, to: [{ node: 'n4', label: 'yes' }, { node: 'n2', label: 'no', path: 'curved' }] })
  })

  it('does not touch a node changed since an edit was prepared', () => {
    // n3 last changed at rev 2: an edit based on rev 1 may not link from it, nor remove it.
    expectError(() => apply(BOARD, [{ op: 'update', id: 'n3', set: { to: null } }], { baseRev: 1 }), 'stale')
    expectError(() => apply(BOARD, [{ op: 'remove', id: 'n3' }], { baseRev: 1 }), 'stale')
    expect(() => apply(BOARD, [{ op: 'update', id: 'n4', set: { to: [{ node: 'n3' }] } }], { baseRev: 1 })).not.toThrow()
  })

  it('keeps ink on a node of its own page, or on none', () => {
    expectError(() => apply(BOARD, [{ op: 'update', id: 'k1', set: { on: 't1' } }]), 'bad_ref', /not node/u)
    expectError(() => apply(BOARD, [{ op: 'update', id: 'k1', set: { on: 'zz' } }]), 'unknown_id')
    expect(step(BOARD, [{ op: 'update', id: 'k1', set: { on: 'n1' } }]).doc.block.k1).toMatchObject({ on: 'n1' })
    expect(step(BOARD, [{ op: 'update', id: 'k1', set: { on: null } }]).doc.block.k1).not.toHaveProperty('on')
  })
})

describe('a board and the other kinds of note', () => {
  it('a node sits only on a board’s endless page', () => {
    expectError(() => apply(PHYSICS, [{ op: 'add', block: node('n9') }]), 'wrong_type', /a flowchart is a diagram/u)
  })

  it('a board stays a board, and a note does not become one', () => {
    expectError(() => apply(BOARD, [{ op: 'update', id: BOARD.id, set: { kind: 'mixed' } }]), 'bad_field', /stays a board/u)
    expectError(() => apply(BOARD, [{ op: 'update', id: BOARD.id, set: { kind: null } }]), 'bad_field', /stays a board/u)
    expectError(() => apply(PHYSICS, [{ op: 'update', id: PHYSICS.id, set: { kind: 'board' } }]), 'bad_field', /made as one/u)
    // The other kinds go on changing among themselves, and a board's title changes as any note's.
    expect(apply(PHYSICS, [{ op: 'update', id: PHYSICS.id, set: { kind: 'text' } }]).doc.kind).toBe('text')
    expect(apply(BOARD, [{ op: 'update', id: BOARD.id, set: { title: 'Publishing' } }]).doc.title).toBe('Publishing')
  })

  it('a board is one page: it takes no second, and no other note takes an endless one', () => {
    expectError(() => apply(BOARD, [{ op: 'page', add: { id: 'p2', w: 21000, h: 29700, bg: 'blank', free: [] } }]), 'bad_doc', /one endless page/u)
    expectError(() => apply(BOARD, [{ op: 'page', remove: 'p1' }]), 'last_page')
    expectError(() => apply(PHYSICS, [{ op: 'page', add: { id: 'p2', endless: true, bg: 'blank', free: [] } }]), 'bad_doc', /Only a board/u)
  })

  it('an endless page has no size to set; its paper changes', () => {
    expectError(() => apply(BOARD, [{ op: 'update', id: 'p1', set: { w: 21000 } }]), 'bad_field', /no width/u)
    expectError(() => apply(PHYSICS, [{ op: 'update', id: 'p1', set: { endless: true } }]), 'bad_field', /neither becomes the other/u)
    const ruled = step(BOARD, [{ op: 'update', id: 'p1', set: { bg: 'grid' } }])
    expect(ruled.doc.page.p1).toMatchObject({ endless: true, bg: 'grid' })
  })

  it('has no line to a next page, so nothing on it is ever moved to one', () => {
    expect(isEndless(BOARD.page.p1!)).toBe(true)
    expect(settle(BOARD, Object.keys(BOARD.block))).toEqual([])
  })

  it('finds a board that is broken when it is opened from a file', () => {
    const broken = (change: (doc: Doc) => void): Doc => {
      const doc = structuredClone(BOARD) as Doc
      change(doc)
      return doc
    }
    const linkTo = (target: string) => (doc: Doc) => Object.assign(doc.block.n4!, { to: [{ node: target }] })
    expectError(() => validateDoc(broken(linkTo('zz'))), 'bad_doc', /points to zz/u)
    expectError(() => validateDoc(broken(linkTo('t1'))), 'bad_doc', /not a node of its page/u)
    expectError(() => validateDoc(broken(linkTo('n4'))), 'bad_shape', /itself/u)
    expectError(() => validateDoc(broken((doc) => Object.assign(doc.block.k1!, { on: 'f1' }))), 'bad_doc', /ink k1 is on f1/u)
    expectError(() => validateDoc(broken((doc) => void delete doc.kind)), 'bad_doc', /not a board/u)
    expectError(() => validateDoc(broken((doc) => void (doc.page.p1 = { id: 'p1', w: 21000, h: 29700, bg: 'dots', free: doc.page.p1!.free }))), 'bad_doc', /a board has one page, and it is endless/u)
    expectError(() => validateDoc(broken((doc) => void Object.assign(doc.page.p1!, { w: 5 }))), 'bad_shape')
  })

  it('checks a full board, fifty thousand nodes each pointing to the next, in time that grows with their number', () => {
    const chain = (count: number): Doc => {
      const doc = structuredClone(createDoc({ board: true })) as Doc
      const page = doc.pages[0]!
      for (let i = 0; i < count; i++) {
        const id = `n${i.toString(36)}`
        doc.block[id] = { ...node(id, i + 1 < count ? { to: [{ node: `n${(i + 1).toString(36)}` }] } : {}), page } as Block
        doc.page[page]!.free.push(id)
      }
      return doc
    }
    // The middle of three runs: one slow run, on a busy computer, decides nothing.
    const timed = (doc: Doc): number => {
      const runs = [0, 1, 2].map(() => {
        const before = performance.now()
        expect(structureProblems(doc)).toEqual([])
        return performance.now() - before
      })
      return runs.sort((a, b) => a - b)[1]!
    }
    const [fifth, full] = [chain(10_000), chain(49_999)]
    timed(fifth)
    // Five times the nodes take about five times as long. Were each link looked up among all the nodes, it would
    // be twenty-five times.
    expect(timed(full) / Math.max(1, timed(fifth))).toBeLessThan(12)
  })
})

describe('what a reader of a board is given', () => {
  it('a node’s line holds where it points, so no link is looked up in another list', () => {
    const lines = outline(BOARD).split('\n')
    expect(lines).toContain('n1 pill Start → n2')
    expect(lines).toContain('n2 box Write the draft → n3')
    expect(lines).toContain('n3 diamond Passed? → n4 yes, n2 no')
    expect(lines).toContain('n4 pill Publish')
    expect(lines).toContain('k1 ink (1 stroke) on n3')
  })

  it('a node read in full gives its shape, its colour, its links, then its words as they are written', () => {
    expect(readBlocks(BOARD, ['n3', 'n2'])).toBe('n3 diamond color=blue → n4 yes, n2 no\nPassed?\n\nn2 box → n3\nWrite the **draft**')
  })

  it('a link’s words cannot pose as another link', () => {
    const doc = apply(BOARD, [{ op: 'update', id: 'n4', set: { to: [{ node: 'n1', label: 'no, n2 → n3' }] } }]).doc
    expect(outline(doc)).toContain('n4 pill Publish → n1 no n2 n3')
  })
})
