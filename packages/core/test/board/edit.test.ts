// An assistant editing a board by ids (protocol v1.2): a link made, changed and taken away; a step added after or
// before a step, or alone; a whole flowchart from its Mermaid; a step's shape and colour, its words. Code does every
// place; what makes no sense on a step is refused with what to do instead. And on a note of pages, and for the app's
// own models, nothing of it is offered.
import { describe, expect, it } from 'vitest'
import { allowedOps, apply, editById, outline, outsideScope, parseReply, replyJsonSchema, validateDoc, ValidationError, type Aliases, type Doc, type NodeBlock, type Scope } from '../../src/index.js'
import { BOARD, PHYSICS } from '../fixtures/index.js'

const edit = (doc: Doc, ops: unknown, baseRev = doc.rev): Doc => {
  const done = editById({ doc, ops, baseRev })
  if (!done.result) throw new Error('The edit changed nothing.')
  validateDoc(done.result.doc)
  // One change, undone exactly.
  expect(Object.keys(apply(done.result.doc, done.result.inverse).doc.block).sort()).toEqual(Object.keys(doc.block).sort())
  return done.result.doc
}
/** The error an edit is refused with. */
function refusal(run: () => unknown): ValidationError {
  try {
    run()
  } catch (error) {
    if (error instanceof ValidationError) return error
    throw error
  }
  throw new Error('The edit was not refused.')
}
const node = (doc: Doc, id: string): NodeBlock => doc.block[id] as NodeBlock
const added = (before: Doc, after: Doc): NodeBlock[] => Object.values(after.block).filter((block): block is NodeBlock => block.type === 'node' && before.block[block.id] === undefined)
const apart = (a: NodeBlock, b: NodeBlock): boolean => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y

describe('a link', () => {
  it('points one step to another, with words or none, and is one change that undo takes back', () => {
    const after = edit(BOARD, [{ op: 'link', from: 'n4', to: 'n1', label: 'again' }])
    expect(node(after, 'n4').to).toEqual([{ node: 'n1', label: 'again' }])
    expect(outline(after)).toContain('n4 pill Publish → n1 again')
    // Nothing else changed.
    for (const id of ['n1', 'n2', 'n3', 'k1', 'f1', 't1']) expect({ ...after.block[id], r: 0 }).toEqual({ ...BOARD.block[id], r: 0 })
  })

  it('sent again for the same two steps, is that link changed in its place; with on: false, taken away', () => {
    const changed = edit(BOARD, [{ op: 'link', from: 'n3', to: 'n4', label: 'passed', line: 'thick' }])
    expect(node(changed, 'n3').to).toEqual([{ node: 'n4', label: 'passed', line: 'thick' }, { node: 'n2', label: 'no', path: 'curved' }])
    const gone = edit(BOARD, [{ op: 'link', from: 'n3', to: 'n2', on: false }])
    expect(node(gone, 'n3').to).toEqual([{ node: 'n4', label: 'yes' }])
    const none = edit(BOARD, [{ op: 'link', from: 'n1', to: 'n2', on: false }])
    expect(node(none, 'n1').to).toBeUndefined()
    // The same link again, or taking away one that is not there, changes nothing.
    expect(editById({ doc: BOARD, ops: [{ op: 'link', from: 'n1', to: 'n2' }], baseRev: BOARD.rev }).result).toBeUndefined()
    expect(editById({ doc: BOARD, ops: [{ op: 'link', from: 'n4', to: 'n1', on: false }], baseRev: BOARD.rev }).result).toBeUndefined()
  })

  it('keeps its words to one line and a most, whatever is sent', () => {
    const after = edit(BOARD, [{ op: 'link', from: 'n4', to: 'n1', label: `  two\nlines ${'very long '.repeat(40)}` }])
    const label = node(after, 'n4').to![0]!.label!
    expect(label.startsWith('two lines very long')).toBe(true)
    expect(label.length).toBeLessThanOrEqual(200)
    expect(label).not.toMatch(/\n|\s$/u)
  })

  it('is refused, with what to do, from or to what is no step, to itself, without "to", and on a note that is no board', () => {
    expect(refusal(() => editById({ doc: BOARD, ops: [{ op: 'link', from: 'n4', to: 'zz' }], baseRev: BOARD.rev })).code).toBe('unknown_id')
    expect(refusal(() => editById({ doc: BOARD, ops: [{ op: 'link', from: 't1', to: 'n1' }], baseRev: BOARD.rev })).hint).toMatch(/t1 is not a step: a link joins two steps/u)
    expect(refusal(() => editById({ doc: BOARD, ops: [{ op: 'link', from: 'n1', to: 'f1' }], baseRev: BOARD.rev })).hint).toMatch(/f1 is not a step/u)
    expect(refusal(() => editById({ doc: BOARD, ops: [{ op: 'link', from: 'n1', to: 'n1' }], baseRev: BOARD.rev })).hint).toMatch(/does not point to itself/u)
    expect(refusal(() => editById({ doc: BOARD, ops: [{ op: 'link', from: 'n1' }], baseRev: BOARD.rev })).hint).toMatch(/needs "to"/u)
    expect(refusal(() => editById({ doc: BOARD, ops: [{ op: 'link', to: 'n1' }], baseRev: BOARD.rev })).hint).toMatch(/needs "from"/u)
    expect(refusal(() => editById({ doc: PHYSICS, ops: [{ op: 'link', from: 't1', to: 't2' }], baseRev: PHYSICS.rev })).hint).toMatch(/on a board, and this note is not one/u)
  })

  it('does not touch a step changed since the board was read', () => {
    // n3 last changed at rev 2.
    expect(refusal(() => editById({ doc: BOARD, ops: [{ op: 'link', from: 'n3', to: 'n1' }], baseRev: 1 })).code).toBe('stale')
    expect(edit(BOARD, [{ op: 'link', from: 'n4', to: 'n3' }], 1).block.n4).toMatchObject({ to: [{ node: 'n3' }] })
  })
})

describe('a step added', () => {
  it('after a step with one next step goes between them, the rest moving along, the ink on a step with it', () => {
    const after = edit(BOARD, [{ op: 'insert', at: 'after', ref: 'n2', kind: 'step', content: 'Check the spelling' }])
    const [step] = added(BOARD, after)
    expect(step).toMatchObject({ shape: 'box', md: 'Check the spelling', to: [{ node: 'n3' }] })
    expect(node(after, 'n2').to).toEqual([{ node: step!.id }])
    const down = node(after, 'n3').y - node(BOARD, 'n3').y
    expect(down).toBeGreaterThan(0)
    expect(node(after, 'n4').y - node(BOARD, 'n4').y).toBe(down)
    expect((after.block.k1 as NodeBlock).y - (BOARD.block.k1 as NodeBlock).y).toBe(down)
    expect(outline(after)).toContain(`n2 box Write the draft → ${step!.id}`)
  })

  it('before a step takes its place and the links that led to it, in the shape asked', () => {
    const after = edit(BOARD, [{ op: 'insert', at: 'before', ref: 'n3', kind: 'step', content: 'Ask a friend', shape: 'round' }])
    const [step] = added(BOARD, after)
    expect(step).toMatchObject({ shape: 'round', to: [{ node: 'n3' }], y: node(BOARD, 'n3').y })
    expect(node(after, 'n2').to).toEqual([{ node: step!.id }])
  })

  it('alone, "here" with no "ref", goes where the board has room', () => {
    const after = edit(BOARD, [{ op: 'insert', at: 'here', kind: 'step', content: 'A loose idea', shape: 'circle' }])
    const [step] = added(BOARD, after)
    expect(step).toMatchObject({ shape: 'circle', md: 'A loose idea' })
    expect(step!.to).toBeUndefined()
    for (const there of Object.values(BOARD.block)) if (there.type === 'node') expect(apart(step!, there)).toBe(true)
  })

  it('is refused next to what is no step, "here" with a "ref", and on a note that is no board', () => {
    expect(refusal(() => editById({ doc: BOARD, ops: [{ op: 'insert', at: 'after', ref: 't1', kind: 'step', content: 'x' }], baseRev: BOARD.rev })).hint).toMatch(/t1 is a text block, not a step/u)
    expect(refusal(() => editById({ doc: BOARD, ops: [{ op: 'insert', at: 'here', ref: 'n1', kind: 'step', content: 'x' }], baseRev: BOARD.rev })).hint).toMatch(/leave "ref" out/u)
    expect(refusal(() => editById({ doc: PHYSICS, ops: [{ op: 'insert', at: 'after', ref: 't1', kind: 'step', content: 'x' }], baseRev: PHYSICS.rev })).hint).toMatch(/a flowchart is a diagram/u)
    expect(refusal(() => editById({ doc: BOARD, ops: [{ op: 'insert', at: 'after', ref: 'n1', kind: 'text', content: 'x', shape: 'diamond' }], baseRev: BOARD.rev })).hint).toMatch(/Only a step has a shape/u)
  })
})

describe('a whole flowchart', () => {
  const SRC = 'flowchart TD\n  A([Begin]) --> B{Ready?}\n  B -->|yes| C[Go]\n  B -->|no| A'

  it('is read from its Mermaid into steps with their links, laid out where the board has room', () => {
    const after = edit(BOARD, [{ op: 'insert', at: 'here', kind: 'flowchart', content: SRC }])
    const made = added(BOARD, after)
    expect(made.map((each) => [each.shape, each.md])).toEqual([['pill', 'Begin'], ['diamond', 'Ready?'], ['box', 'Go']])
    const [a, b, c] = made
    expect(b!.to).toEqual([{ node: c!.id, label: 'yes' }, { node: a!.id, label: 'no' }])
    for (const one of made) for (const there of Object.values(BOARD.block)) if (there.type === 'node') expect(apart(one, there)).toBe(true)
  })

  it('is taken in a code fence, as models write it', () => {
    expect(added(BOARD, edit(BOARD, [{ op: 'insert', at: 'here', kind: 'flowchart', content: `\`\`\`mermaid\n${SRC}\n\`\`\`` }]))).toHaveLength(3)
  })

  it('that does not read is refused with its line, for the retry; another kind of diagram too', () => {
    const bad = refusal(() => editById({ doc: BOARD, ops: [{ op: 'insert', at: 'here', kind: 'flowchart', content: 'flowchart TD\n  A --> B\n  C[Unclosed' }], baseRev: BOARD.rev }))
    expect([bad.code, bad.hint]).toEqual(['content', expect.stringMatching(/^Line 3 of the flowchart does not read/u)])
    expect(refusal(() => editById({ doc: BOARD, ops: [{ op: 'insert', at: 'here', kind: 'flowchart', content: 'pie\n  "a" : 1' }], baseRev: BOARD.rev })).hint).toMatch(/not a pie/u)
    expect(refusal(() => editById({ doc: BOARD, ops: [{ op: 'insert', at: 'here', kind: 'flowchart', content: 'flowchart TD\n  A --> B', shape: 'box' }], baseRev: BOARD.rev })).hint).toMatch(/leave "shape" out/u)
  })
})

describe('a step’s look and words', () => {
  it('takes a shape and a colour, and in a new shape fits its words again about the same middle', () => {
    const after = edit(BOARD, [{ op: 'style', ids: ['n2'], set: [{ shape: 'diamond' }, { color: 'green' }] }])
    const [was, now] = [node(BOARD, 'n2'), node(after, 'n2')]
    expect(now).toMatchObject({ shape: 'diamond', color: 'green' })
    expect(now.w).toBeGreaterThan(was.w)
    expect(Math.abs(now.x + now.w / 2 - (was.x + was.w / 2))).toBeLessThanOrEqual(1)
    // Its usual colour takes the colour away.
    expect(node(edit(BOARD, [{ op: 'style', ids: ['n3'], set: [{ color: 'ink' }] }]), 'n3').color).toBeUndefined()
  })

  it('is refused what a step does not have: a size, a font, bold words; and a shape is a step’s alone', () => {
    expect(refusal(() => editById({ doc: BOARD, ops: [{ op: 'style', ids: ['n2'], set: [{ size: 'l' }] }], baseRev: BOARD.rev })).hint).toMatch(/style changes its shape and its color, not size/u)
    expect(refusal(() => editById({ doc: BOARD, ops: [{ op: 'style', ids: ['t1'], set: [{ shape: 'diamond' }] }], baseRev: BOARD.rev })).hint).toMatch(/only a step of a board has a shape/u)
  })

  it('gets new words, and its size follows them, larger or smaller', () => {
    const board = edit(BOARD, [{ op: 'insert', at: 'here', kind: 'flowchart', content: 'flowchart TD\n  A[Write the whole of the first draft] --> B[Send]' }])
    const [first] = added(BOARD, board)
    const shorter = edit(board, [{ op: 'rewrite', id: first!.id, content: 'Write' }])
    expect(node(shorter, first!.id).md).toBe('Write')
    expect(node(shorter, first!.id).w).toBeLessThan(first!.w)
    const longer = edit(BOARD, [{ op: 'rewrite', id: 'n1', content: 'Start here, with the brief from the editor' }])
    expect(node(longer, 'n1').w).toBeGreaterThan(node(BOARD, 'n1').w)
  })

  it('made larger by a person, keeps its size for fewer words', () => {
    const big = apply(BOARD, [{ op: 'move', id: 'n1', to: { page: 'p1', x: 0, y: 0, w: 9000, h: 3000 } }]).doc
    const after = edit(big, [{ op: 'rewrite', id: 'n1', content: 'Go' }])
    expect([node(after, 'n1').w, node(after, 'n1').h]).toEqual([9000, 3000])
  })
})

describe('steps removed, and what a step does not do', () => {
  it('takes the links to a removed step and the ink on it, alone or named with it', () => {
    for (const ids of [['n3'], ['n3', 'k1']]) {
      const after = edit(BOARD, [{ op: 'delete', ids }])
      expect([after.block.n3, after.block.k1]).toEqual([undefined, undefined])
      expect(node(after, 'n2').to).toBeUndefined()
    }
  })

  it('is never moved or converted by hand: its place follows its links', () => {
    expect(refusal(() => editById({ doc: BOARD, ops: [{ op: 'move', id: 'n4', at: 'after', ref: 'n1' }], baseRev: BOARD.rev })).hint).toMatch(/link it differently/u)
    expect(refusal(() => editById({ doc: BOARD, ops: [{ op: 'convert', ids: ['n2'], into: 'paragraph', content: 'x' }], baseRev: BOARD.rev })).hint).toMatch(/not converted/u)
  })

  it('words, a formula or a table put "here" on a board go where it has room', () => {
    const after = edit(BOARD, [{ op: 'insert', at: 'here', kind: 'text', content: 'Due on Friday' }])
    const frame = Object.values(after.block).find((block) => block.type === 'frame' && BOARD.block[block.id] === undefined)!
    expect(frame).toMatchObject({ type: 'frame' })
    expect(outline(after)).toContain('p Due on Friday')
  })
})

describe('the scope rule on a board', () => {
  /** What an edit naming only these steps may change. */
  const only = (ids: string[]): Aliases =>
    ({ selected: ids.map((id) => ({ alias: id, id })), near: [], refs: ids, blocks: ids, pieces: [], id: (alias: string) => alias, alias: (id: string) => id, words: () => undefined }) as unknown as Aliases

  it('lets code move a step aside, and still refuses another step’s words or where its links lead among steps that stay', () => {
    const moved = apply(BOARD, [{ op: 'move', id: 'n1', to: { page: 'p1', x: 500, y: -900 } }]).doc
    expect(outsideScope(BOARD, moved, { blocks: ['n2'] }, only(['n2']))).toBeNull()
    const relinked = apply(BOARD, [{ op: 'update', id: 'n1', set: { to: [{ node: 'n4' }] } }]).doc
    expect(outsideScope(BOARD, relinked, { blocks: ['n2'] }, only(['n2']))).toMatch(/Only what is selected may change/u)
    const reworded = apply(BOARD, [{ op: 'splice', id: 'n1', field: 'md', at: 0, del: 5, ins: 'Begin' }]).doc
    expect(outsideScope(BOARD, reworded, { blocks: ['n2'] }, only(['n2']))).toMatch(/Only what is selected may change/u)
    const reshaped = apply(BOARD, [{ op: 'update', id: 'n1', set: { shape: 'diamond' } }]).doc
    expect(outsideScope(BOARD, reshaped, { blocks: ['n2'] }, only(['n2']))).toMatch(/Only what is selected may change/u)
  })
})

describe('for the app’s own models, on a note of pages', () => {
  const scope: Scope = { set: 'full', selected: ['a', 'b'], refs: ['a', 'b'], here: false, maxOps: 1, inline: false, shape: 'list' }

  it('nothing of a board is in the schema or offered, byte for byte as before', () => {
    // ("link" is a word change too, as it always was: the operation is what must not be there.)
    const json = JSON.stringify(replyJsonSchema(scope))
    expect(json).not.toMatch(/"const":"link"|"step"|"flowchart"|"shape"/u)
    expect(allowedOps(scope)).not.toContain('link')
    expect(refusal(() => parseReply('{"ops":[{"op":"link","from":"a","to":"b"}]}', scope)).code).toBe('unknown_op')
    expect(refusal(() => parseReply('{"ops":[{"op":"insert","at":"after","ref":"a","kind":"step"}]}', scope)).hint).toMatch(/go on a board/u)
    expect(refusal(() => parseReply('{"ops":[{"op":"style","ids":["a"],"set":[{"shape":"diamond"}]}]}', scope)).hint).toMatch(/"shape" is not a style change/u)
  })

  it('on a board, the link, the two kinds and the shape are offered', () => {
    const board = { ...scope, board: true }
    const json = JSON.stringify(replyJsonSchema(board))
    expect(json).toMatch(/"const":"link"/u)
    expect(json).toMatch(/"flowchart"/u)
    expect(json).toMatch(/"shape"/u)
    expect(allowedOps(board)).toContain('link')
    expect(parseReply('{"ops":[{"op":"link","from":"a","to":"b","label":"yes"}]}', board)).toEqual([{ op: 'link', from: 'a', to: 'b', label: 'yes' }])
    // A link leaves a selected step, and points to one that may be a neighbour only.
    expect(refusal(() => parseReply('{"ops":[{"op":"link","from":"c","to":"b"}]}', board)).hint).toMatch(/"from"/u)
  })
})
