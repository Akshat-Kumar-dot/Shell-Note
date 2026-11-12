// An edit that names blocks by their ids and carries its content (ai/byId.ts),
// and a block read in full (read.ts): what an assistant outside the app sends
// and is given.
import { describe, expect, it } from 'vitest'
import { apply, BLOCK_SHAPES, blockContent, editById, MAX_EDIT_OPS, outline, readBlocks, ValidationError, type Block, type Doc, type Frame, type TextBlock } from '../src/index.js'
import { EMPTY, MIXED, PHYSICS } from './fixtures/index.js'

const edit = (doc: Doc, ops: unknown, baseRev = doc.rev) => editById({ doc, ops, baseRev })
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
const text = (doc: Doc, id: string): TextBlock => doc.block[id] as TextBlock
/** The blocks an edit made. */
const made = (before: Doc, after: Doc): Block[] => Object.values(after.block).filter((block) => before.block[block.id] === undefined)

describe('an edit by block ids', () => {
  it('styles a block and inserts a diagram after another, as one change', () => {
    const done = edit(PHYSICS, {
      ops: [
        { op: 'style', ids: ['t1'], set: [{ color: 'blue' }, { size: 'l' }] },
        { op: 'insert', at: 'after', ref: 't2', kind: 'diagram', content: 'flowchart LR\n  A[Force] --> B[Acceleration]' },
      ],
    })
    const after = done.result!.doc
    expect(after.rev).toBe(PHYSICS.rev + 1)
    expect(text(after, 't1').style).toEqual({ color: 'blue', size: 'l' })
    const [diagram] = made(PHYSICS, after)
    expect(diagram).toMatchObject({ type: 'diagram', parent: 'f1', src: 'flowchart LR\n  A[Force] --> B[Acceleration]' })
    expect((after.block.f1 as Frame).kids).toEqual(['t1', 't2', diagram!.id, 'm1'])
    expect(done.targets).toEqual(['t1'])
    expect(done.result!.changed).toEqual(expect.arrayContaining(['t1', 'f1', diagram!.id]))
    // Undone exactly.
    expect(apply(after, done.result!.inverse).doc.block).toEqual(expect.objectContaining({ t1: { ...PHYSICS.block.t1, r: after.rev + 1 } }))
  })

  it('reads a list, one operation, flat fields, and an id where a list was meant', () => {
    expect(text(edit(PHYSICS, [{ op: 'style', ids: ['t1'], color: 'red' }]).result!.doc, 't1').style).toEqual({ color: 'red' })
    expect(text(edit(PHYSICS, { op: 'style', id: 't1', set: [{ role: 'h1' }] }).result!.doc, 't1').role).toBe('h1')
    expect(text(edit(PHYSICS, { op: 'mark', id: 't1', set: [{ bold: true }] }).result!.doc, 't1').md).toBe("**Newton's laws**")
    expect(text(edit(PHYSICS, { op: 'style', ids: ['t1'], set: [{ color: '#e0563a' }] }).result!.doc, 't1').style).toEqual({ color: '#e0563a' })
  })

  it('rewrites, deletes, moves and converts', () => {
    const rewritten = edit(PHYSICS, [{ op: 'rewrite', id: 't2', content: 'A body keeps its state of motion unless a *force* acts on it.' }]).result!.doc
    expect(text(rewritten, 't2').md).toBe('A body keeps its state of motion unless a *force* acts on it.')
    expect((edit(PHYSICS, [{ op: 'rewrite', id: 'm1', content: '$$F = m a$$' }]).result!.doc.block.m1 as { tex: string }).tex).toBe('F = m a')
    expect(edit(PHYSICS, [{ op: 'delete', ids: ['t2'] }]).result!.doc.block.t2).toBeUndefined()
    expect((edit(PHYSICS, [{ op: 'move', id: 'm1', at: 'before', ref: 't1' }]).result!.doc.block.f1 as Frame).kids).toEqual(['m1', 't1', 't2'])
    const listed = edit(PHYSICS, [{ op: 'convert', ids: ['t2'], into: 'list', content: '- An object at rest stays at rest\n- unless a force acts on it' }])
    const items = made(PHYSICS, listed.result!.doc) as TextBlock[]
    expect(items.map((item) => [item.role, item.md])).toEqual([['li', 'An object at rest stays at rest'], ['li', 'unless a force acts on it']])
    expect(listed.result!.doc.block.t2).toBeUndefined()
  })

  it('writes into an empty note, at the end of the text column named, in the order sent', () => {
    const column = Object.values(EMPTY.block).find((block) => block.type === 'frame')!.id
    const done = edit(EMPTY, [
      { op: 'insert', at: 'here', ref: column, kind: 'text', role: 'h1', content: 'Meeting notes' },
      { op: 'insert', at: 'here', ref: column, kind: 'text', content: 'Present: everyone.' },
      { op: 'insert', at: 'here', ref: column, kind: 'table', content: '| Who | What |\n| --- | --- |\n| Ann | Slides |' },
    ])
    const after = done.result!.doc
    const kids = (after.block[column] as Frame).kids.map((id) => after.block[id]!)
    expect(kids.map((kid) => kid.type)).toEqual(['text', 'text', 'table'])
    expect((kids[0] as TextBlock).md).toBe('Meeting notes')
    expect(kids[2]).toMatchObject({ rows: [['Who', 'What'], ['Ann', 'Slides']], head: true })
    // And after what a column already holds.
    const more = edit(PHYSICS, [{ op: 'insert', at: 'here', ref: 'f1', kind: 'math', content: 'a = F / m' }]).result!.doc
    expect((more.block.f1 as Frame).kids.slice(0, 3)).toEqual(['t1', 't2', 'm1'])
    expect((more.block.f1 as Frame).kids).toHaveLength(4)
    expect(refusal(() => edit(PHYSICS, [{ op: 'insert', at: 'here', ref: 't1', kind: 'text', content: 'x' }])).hint).toContain('text column')
    expect(refusal(() => edit(PHYSICS, [{ op: 'insert', at: 'here', kind: 'text', content: 'x' }])).code).toBe('bad_value')
  })

  it('refuses a block changed since the note was read, and takes an edit to another', () => {
    const typed = apply(PHYSICS, [{ op: 'update', id: 't2', set: { md: 'Typed by the person meanwhile.' } }]).doc
    const stale = refusal(() => edit(typed, [{ op: 'rewrite', id: 't2', content: 'Written by an assistant.' }], PHYSICS.rev))
    expect(stale.code).toBe('stale')
    expect(stale.hint).toContain('t2')
    expect(text(edit(typed, [{ op: 'style', ids: ['t1'], set: [{ color: 'blue' }] }], PHYSICS.rev).result!.doc, 't1').style).toEqual({ color: 'blue' })
    // A rev no read gave.
    expect(refusal(() => edit(PHYSICS, [{ op: 'delete', ids: ['t1'] }], PHYSICS.rev + 5)).code).toBe('bad_value')
    expect(refusal(() => edit(PHYSICS, [{ op: 'delete', ids: ['t1'] }], -1)).code).toBe('bad_value')
    expect(refusal(() => edit(PHYSICS, [{ op: 'delete', ids: ['t1'] }], 1.5)).code).toBe('bad_value')
  })

  it('says what to fix, in words that need no other context', () => {
    const cases: [unknown, string, string][] = [
      [{}, 'no_ops', '"ops"'],
      [[], 'no_ops', '"ops"'],
      [Array.from({ length: MAX_EDIT_OPS + 1 }, () => ({ op: 'delete', ids: ['t1'] })), 'too_many', String(MAX_EDIT_OPS)],
      [['delete t1'], 'bad_value', 'object'],
      [[{ op: 'erase', ids: ['t1'] }], 'unknown_op', 'style, mark, rewrite, insert, delete, move, convert, calc'],
      [[{ op: 'none', why: 'nothing to do' }], 'unknown_op', 'must be one of'],
      [[{ op: 'delete', ids: ['zz'] }], 'unknown_id', 'There is no block "zz"'],
      [[{ op: 'delete', ids: [7] }], 'unknown_id', 'There is no block 7'],
      [[{ op: 'delete' }], 'bad_value', '"ids"'],
      [[{ op: 'rewrite', content: 'x' }], 'bad_value', '"id"'],
      [[{ op: 'delete', ids: ['f1'] }], 'wrong_type', 'text column'],
      [[{ op: 'rewrite', id: 'k1', content: 'x' }], 'wrong_type', 'handwriting'],
      [[{ op: 'style', ids: ['m1'], set: [{ color: 'blue' }] }], 'wrong_type', 'use rewrite'],
      [[{ op: 'style', ids: ['t1'] }], 'bad_value', 'Say what to change'],
      [[{ op: 'style', ids: ['t1'], set: [{ color: 'pink' }] }], 'bad_value', 'color'],
      [[{ op: 'style', ids: ['t1'], set: [{ colour: 'blue' }] }], 'bad_value', 'not a style change'],
      [[{ op: 'insert', at: 'after', kind: 'text', content: 'x' }], 'bad_value', '"ref"'],
      [[{ op: 'insert', at: 'after', ref: 'zz', kind: 'text', content: 'x' }], 'unknown_id', 'zz'],
      [[{ op: 'insert', at: 'after', ref: 't1', kind: 'picture', content: 'x' }], 'bad_value', 'kind'],
      [[{ op: 'insert', at: 'after', ref: 't1', kind: 'text' }], 'bad_value', '"content"'],
      [[{ op: 'insert', at: 'after', ref: 't1', kind: 'text', content: '   ' }], 'bad_value', '"content"'],
      [[{ op: 'insert', at: 'after', ref: 't1', kind: 'text', content: 'x'.repeat(20_001) }], 'bad_value', '20000'],
      [[{ op: 'insert', at: 'after', ref: 't1', kind: 'text', content: 'One paragraph.\n\nAnother.' }], 'content', 'One paragraph'],
      [[{ op: 'insert', at: 'after', ref: 't1', kind: 'text', content: 'Some <b>bold</b> words' }], 'content', 'No HTML'],
      [[{ op: 'insert', at: 'after', ref: 't1', kind: 'diagram', content: 'sequenceDiagram\n  A->>B: hello' }], 'content', 'flowchart, a pie or an xychart'],
      [[{ op: 'insert', at: 'after', ref: 't1', kind: 'table', content: 'Name, Age' }], 'content', 'pipe table'],
      [[{ op: 'move', id: 't1', at: 'after' }], 'bad_value', '"ref"'],
      [[{ op: 'move', id: 't1', at: 'after', ref: 't1' }], 'bad_value', 'next to itself'],
      [[{ op: 'mark', id: 't1', set: [{ link: true }] }], 'bad_value', '"href"'],
      [[{ op: 'mark', id: 't1', set: [{ link: true }], href: 'javascript:alert(1)' }], 'content', 'Links must start with'],
      [[{ op: 'mark', id: 't1', set: [{ link: true }], href: 'https://a.example/ b' }], 'bad_value', 'one web address'],
      [[{ op: 'calc', id: 'm1', action: 'solve' }], 'not_ready', 'not ready'],
    ]
    for (const [ops, code, words] of cases) {
      const error = refusal(() => edit(PHYSICS, ops))
      expect([JSON.stringify(ops).slice(0, 80), error.code], error.hint).toEqual([JSON.stringify(ops).slice(0, 80), code])
      expect(error.hint).toContain(words)
    }
  })

  it('names the operation at fault when there are several, and then changes nothing', () => {
    const error = refusal(() => edit(PHYSICS, [{ op: 'style', ids: ['t1'], set: [{ color: 'blue' }] }, { op: 'delete', ids: ['zz'] }]))
    expect(error.toJSON()).toMatchObject({ error: 'unknown_id', got: 'zz', op: 1 })
    expect(refusal(() => edit(PHYSICS, [{ op: 'delete', ids: ['zz'] }])).details).not.toHaveProperty('op')
    const second = refusal(() => edit(PHYSICS, [{ op: 'delete', ids: ['t2'] }, { op: 'style', ids: ['t2'], set: [{ color: 'red' }] }]))
    expect(second.toJSON()).toMatchObject({ error: 'unknown_id', op: 1 })
  })

  it('tidies what is written as the app does, and takes a link with its address', () => {
    const fenced = edit(PHYSICS, [{ op: 'insert', at: 'after', ref: 't2', kind: 'diagram', content: '```mermaid\ngraph TD\n  A -> B\n```' }])
    expect((made(PHYSICS, fenced.result!.doc)[0] as { src: string }).src).toBe('graph TD\n  A --> B')
    expect(fenced.ai[0]).toMatchObject({ content: 'graph TD\n  A --> B' })
    const linked = edit(PHYSICS, [{ op: 'mark', id: 't1', set: [{ link: true }], href: 'https://en.wikipedia.org/wiki/Newton' }])
    expect(text(linked.result!.doc, 't1').md).toBe("[Newton's laws](https://en.wikipedia.org/wiki/Newton)")
    // The caller's own check of a diagram is asked too.
    const checked = refusal(() => editById({ doc: PHYSICS, baseRev: PHYSICS.rev, mermaid: () => 'Line 2 does not read.', ops: [{ op: 'insert', at: 'after', ref: 't2', kind: 'diagram', content: 'pie\n  "a" : 1' }] }))
    expect([checked.code, checked.hint]).toEqual(['content', 'Line 2 does not read.'])
  })

  it('that changes nothing is no change', () => {
    const none = edit(PHYSICS, [{ op: 'rewrite', id: 't1', content: "Newton's laws" }, { op: 'style', ids: ['t1'], set: [{ color: 'ink' }] }])
    expect(none.result).toBeUndefined()
    expect(none.ops).toEqual([])
  })

  it('changes only the blocks it names, whatever they are', () => {
    for (const doc of [PHYSICS, MIXED]) {
      const texts = Object.values(doc.block).filter((block): block is TextBlock => block.type === 'text')
      const [first, last] = [texts[0]!, texts.at(-1)!]
      const after = edit(doc, [
        { op: 'rewrite', id: first.id, content: 'Changed.' },
        { op: 'insert', at: 'after', ref: last.id, kind: 'text', content: 'Added.' },
      ]).result!.doc
      expect(after.title).toBe(doc.title)
      for (const block of Object.values(doc.block)) {
        if (block.id === first.id || block.type === 'frame') continue
        expect(after.block[block.id], block.id).toEqual(block)
      }
      expect(made(doc, after)).toHaveLength(1)
    }
  })
})

describe('every kind of block', () => {
  const kinds = Object.keys(BLOCK_SHAPES)
  // A note with a block of every kind the schema knows. A new kind of block needs a sample here: these tests then
  // hold it to the same rules as the others.
  const frame = Object.values(MIXED.block).find((block) => block.type === 'frame')!.id
  const ALL = apply(MIXED, [{ op: 'add', block: { id: 'tb9', r: 0, type: 'table', parent: frame, rows: [['Name', 'Age'], ['**Ann**', '31']], head: true, caption: 'Ages' } }]).doc
  const sample = (type: string): Block => Object.values(ALL.block).find((block) => block.type === type)!

  it('is in the sample notes, in the outline, and reads in full', () => {
    for (const type of kinds) {
      const block = sample(type)
      expect(block, `the sample note holds no ${type} block: add one above`).toBeDefined()
      const doc = ALL
      expect(outline(doc)).toMatch(new RegExp(`^\\s*${block.id} `, 'mu'))
      expect(readBlocks(doc, [block.id]).startsWith(`${block.id} `)).toBe(true)
      expect(typeof blockContent(block)).toBe('string')
    }
  })

  it('is taken or refused by each operation with a teaching error, never a fault', () => {
    const content: Record<string, string> = { text: 'New words.', math: 'x^2', diagram: 'pie\n  "a" : 1', table: '| a | b |\n| --- | --- |\n| 1 | 2 |', image: 'A described picture.', ink: 'words', frame: 'x' }
    for (const type of kinds) {
      const block = sample(type)
      const doc = ALL
      const other = Object.values(doc.block).find((each) => each.type === 'text' && each.id !== block.id)!.id
      const tries: unknown[] = [
        { op: 'style', ids: [block.id], set: [{ color: 'blue' }] },
        { op: 'mark', id: block.id, set: [{ bold: true }] },
        { op: 'rewrite', id: block.id, content: content[type] ?? 'x' },
        { op: 'delete', ids: [block.id] },
        { op: 'move', id: block.id, at: 'after', ref: other },
        { op: 'convert', ids: [block.id], into: 'paragraph', content: 'One paragraph.' },
        { op: 'convert', ids: [block.id], into: 'table', content: content.table },
        { op: 'insert', at: 'after', ref: block.id, kind: 'text', content: 'After it.' },
        { op: 'insert', at: 'before', ref: block.id, kind: 'math', content: 'x' },
      ]
      for (const op of tries) {
        try {
          const done = edit(doc, [op])
          // Taken: the note it leaves is whole, and its undo brings the old one back.
          if (done.result) expect(Object.keys(apply(done.result.doc, done.result.inverse).doc.block).sort()).toEqual(Object.keys(doc.block).sort())
        } catch (error) {
          expect(error, `${type}: ${JSON.stringify(op)}`).toBeInstanceOf(ValidationError)
          expect((error as ValidationError).hint.length, JSON.stringify(op)).toBeGreaterThan(10)
        }
      }
    }
  })

  it('reads back as it was written: what read_blocks gives, rewrite takes with no change', () => {
    for (const doc of [PHYSICS, ALL]) {
      for (const block of Object.values(doc.block)) {
        if (block.type === 'frame' || block.type === 'ink') continue
        const written = blockContent(block)
        if (written.trim() === '') continue
        expect(edit(doc, [{ op: 'rewrite', id: block.id, content: written }]).result, `${block.id} (${block.type}): ${written.slice(0, 60)}`).toBeUndefined()
      }
    }
  })
})

describe('blocks read in full', () => {
  it('say what each is, then its content as an edit writes it', () => {
    expect(readBlocks(PHYSICS, ['t1', 't2', 'm1', 'g1', 'k1', 'f1'])).toBe(
      [
        "t1 h2\nNewton's laws",
        't2 p\nAn object at rest stays at rest unless a **force** acts on it.',
        'm1 math\nF = ma',
        'g1 image\nFree-body diagram of a block on a slope',
        'k1 ink 1 stroke (not read)',
        'f1 frame holding t1, t2, m1',
      ].join('\n\n'),
    )
    const styled = edit(PHYSICS, [{ op: 'style', ids: ['t1'], set: [{ color: 'blue' }, { size: 'l' }] }]).result!.doc
    expect(readBlocks(styled, ['t1'])).toBe("t1 h2 size=l color=blue\nNewton's laws")
    expect(refusal(() => readBlocks(PHYSICS, ['t1', 'zz'])).toJSON()).toMatchObject({ error: 'unknown_id', got: 'zz' })
  })

  it('never hold the strokes of handwriting, a picture\'s bytes, or what a note keeps from other programs', () => {
    const all = readBlocks(MIXED, Object.keys(MIXED.block)) + readBlocks(PHYSICS, Object.keys(PHYSICS.block))
    expect(all).not.toMatch(/"pts"|strokes"|"pm"|a91f/u)
  })
})
