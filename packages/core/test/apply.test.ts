// Unit tests for apply(). Every successful case goes through step(), which
// also checks that the result is valid and that the inverse restores the input.
import { describe, expect, it } from 'vitest'
import { apply, validateDoc, type Block, type Doc, type Op } from '../src/index.js'
import physics from './fixtures/physics.json' with { type: 'json' }
import { deepFreeze, expectError, step } from './helpers.js'

// Frozen, so any attempt by apply() to modify its input throws.
const base: Doc = deepFreeze(validateDoc(structuredClone(physics)))

const text = (id: string, md: string, parent = 'f1'): Block =>
  ({ id, r: 0, type: 'text', parent, role: 'p', indent: 0, md }) as Block
const frame = (id: string, page: string, y = 2000): Block =>
  ({ id, r: 0, type: 'frame', page, x: 2000, y, w: 17000, h: 0, kids: [] }) as Block
const blankPage = (id: string) => ({ id, w: 21000, h: 29700, bg: 'blank' as const, free: [] })

describe('add', () => {
  it('inserts a child into a frame at an index and stamps r', () => {
    const { doc, changed } = step(base, [{ op: 'add', block: text('t3', 'Second law'), at: 2 }])
    expect(doc.block.f1).toMatchObject({ kids: ['t1', 't2', 't3', 'm1'], r: 13 })
    expect(doc.block.t3).toMatchObject({ md: 'Second law', r: 13 })
    expect(changed).toEqual(expect.arrayContaining(['f1', 't3']))
  })

  it('places a free block on a page, in front by default', () => {
    const block = { id: 'm2', r: 0, type: 'math', page: 'p1', x: 2000, y: 22000, w: 4000, h: 1200, tex: 'E = mc^2' } as Block
    const { doc } = step(base, [{ op: 'add', block }])
    expect(doc.page.p1!.free).toEqual(['f1', 'g1', 'k1', 'm2'])
  })

  it('refuses a used id, a frame with children, a missing frame, or a non-frame parent', () => {
    expectError(() => apply(base, [{ op: 'add', block: text('t1', 'again') }]), 'duplicate_id', /already used/)
    expectError(() => apply(base, [{ op: 'add', block: { ...frame('f9', 'p1'), kids: ['t1'] } as Block }]), 'not_empty')
    expectError(() => apply(base, [{ op: 'add', block: text('t9', 'x', 'nope') }]), 'unknown_id', /no block nope/)
    expectError(() => apply(base, [{ op: 'add', block: text('t9', 'x', 'g1') }]), 'bad_ref', /not frame/)
    expectError(() => apply(base, [{ op: 'add', block: text('t9', 'x'), at: 9 }]), 'bad_range', /largest allowed is 3/)
  })

  it('refuses an image whose asset is unknown', () => {
    const image = { id: 'g2', r: 0, type: 'image', parent: 'f1', asset: 'beef' } as Block
    expectError(() => apply(base, [{ op: 'add', block: image }]), 'bad_ref', /asset beef does not exist/)
  })
})

describe('remove', () => {
  it('removes a child, and undo puts it back at the same index', () => {
    const { doc } = step(base, [{ op: 'remove', id: 't2' }])
    expect(doc.block.t2).toBeUndefined()
    expect(doc.block.f1).toMatchObject({ kids: ['t1', 'm1'] })
  })

  it('removes a frame together with its children', () => {
    const { doc, inverse } = step(base, [{ op: 'remove', id: 'f1' }])
    expect(Object.keys(doc.block).sort()).toEqual(['g1', 'k1'])
    expect(doc.page.p1!.free).toEqual(['g1', 'k1'])
    expect(inverse.map((op) => op.op)).toEqual(['add', 'add', 'add', 'add'])
  })

  it('ends the chain when a continuation frame is removed, and undo relinks it', () => {
    const linked = apply(base, [
      { op: 'page', add: blankPage('p2') },
      { op: 'add', block: frame('f2', 'p2') },
      { op: 'update', id: 'f1', set: { next: 'f2' } },
    ]).doc
    const { doc } = step(linked, [{ op: 'remove', id: 'f2' }])
    expect(doc.block.f1).not.toHaveProperty('next')
  })
})

describe('update', () => {
  it('sets fields, and null removes an optional one', () => {
    const styled = step(base, [{ op: 'update', id: 't1', set: { role: 'h1', style: { color: 'blue', size: 'l' } } }]).doc
    expect(styled.block.t1).toMatchObject({ role: 'h1', style: { color: 'blue', size: 'l' } })
    const plain = step(styled, [{ op: 'update', id: 't1', set: { style: null } }]).doc
    expect(plain.block.t1).not.toHaveProperty('style')
  })

  it('updates a page and the document itself', () => {
    expect(step(base, [{ op: 'update', id: 'p1', set: { bg: 'grid' } }]).doc.page.p1!.bg).toBe('grid')
    const doc = step(base, [{ op: 'update', id: 'd1', set: { title: 'Lecture 4', rules: [] } }]).doc
    expect(doc).toMatchObject({ title: 'Lecture 4', rules: [] })
  })

  it('clears the cached math value when the formula changes', () => {
    const solved = apply(base, [{ op: 'update', id: 'm1', set: { tex: '3 \\cdot 4', value: '12' } }]).doc
    const { doc } = step(solved, [{ op: 'update', id: 'm1', set: { tex: '3 \\cdot 5' } }])
    expect(doc.block.m1).not.toHaveProperty('value')
  })

  it('ticks to-do items, and only those', () => {
    const todo = { id: 't3', r: 0, type: 'text', parent: 'f1', role: 'todo', indent: 0, md: 'Revise' } as Block
    const listed = step(base, [{ op: 'add', block: todo }]).doc
    const ticked = step(listed, [{ op: 'update', id: 't3', set: { done: true } }]).doc
    expect(ticked.block.t3).toMatchObject({ done: true })
    expectError(() => apply(base, [{ op: 'update', id: 't2', set: { done: true } }]), 'bad_shape', /only for to-do items/)
    // A to-do that becomes a paragraph loses its tick; undo brings both back.
    const plain = step(ticked, [{ op: 'update', id: 't3', set: { role: 'p' } }]).doc
    expect(plain.block.t3).not.toHaveProperty('done')
  })

  it('says which operation to use for fields it cannot set', () => {
    expectError(() => apply(base, [{ op: 'update', id: 'g1', set: { x: 0 } }]), 'bad_field', /Use move/)
    expectError(() => apply(base, [{ op: 'update', id: 'k1', set: { strokes: [] } }]), 'bad_field', /Use stroke/)
    expectError(() => apply(base, [{ op: 'update', id: 't1', set: { w: 10 } }]), 'bad_field', /Fields you can set: role, indent, md, style/)
    expectError(() => apply(base, [{ op: 'update', id: 'd1', set: { pages: [] } }]), 'bad_field', /Use page/)
  })

  it('refuses invalid values and unsafe keys', () => {
    expectError(() => apply(base, [{ op: 'update', id: 't1', set: { role: 'h9' } }]), 'bad_shape', /role/)
    expectError(() => apply(base, [{ op: 'update', id: 'd1', set: { title: null } }]), 'bad_shape', /title/)
    const sneaky = JSON.parse('{"op":"update","id":"t1","set":{"__proto__":{"md":"x"}}}') as Op
    expectError(() => apply(base, [sneaky]), 'bad_field')
  })

  it('keeps continuation frames a simple chain', () => {
    const two = apply(base, [
      { op: 'page', add: blankPage('p2') },
      { op: 'add', block: frame('f2', 'p2') },
      { op: 'add', block: frame('f3', 'p2', 9000) },
    ]).doc
    expectError(() => apply(two, [{ op: 'update', id: 'f1', set: { next: 'f1' } }]), 'bad_ref', /itself/)
    expectError(() => apply(two, [{ op: 'update', id: 'f1', set: { next: 'g1' } }]), 'bad_ref', /not frame/)
    const chain = step(two, [
      { op: 'update', id: 'f1', set: { next: 'f2' } },
      { op: 'update', id: 'f2', set: { next: 'f3' } },
    ]).doc
    expectError(() => apply(chain, [{ op: 'update', id: 'f3', set: { next: 'f1' } }]), 'bad_ref', /loop/)
    expectError(() => apply(chain, [{ op: 'update', id: 'f3', set: { next: 'f2' } }]), 'bad_ref', /already continues/)
  })
})

describe('move', () => {
  it('reorders a child within its frame', () => {
    expect(step(base, [{ op: 'move', id: 'm1', to: { parent: 'f1', at: 0 } }]).doc.block.f1).toMatchObject({
      kids: ['m1', 't1', 't2'],
    })
  })

  it('takes a formula out of a frame onto the page, and back', () => {
    const out = step(base, [{ op: 'move', id: 'm1', to: { page: 'p1', x: 3000, y: 24000, w: 5000, h: 1500 } }]).doc
    expect(out.block.m1).toEqual({ id: 'm1', r: 13, type: 'math', page: 'p1', x: 3000, y: 24000, w: 5000, h: 1500, tex: 'F = ma' })
    const back = step(out, [{ op: 'move', id: 'm1', to: { parent: 'f1', at: 1 } }]).doc
    expect(back.block.m1).toEqual({ id: 'm1', r: 14, type: 'math', parent: 'f1', tex: 'F = ma' })
  })

  it('keeps the stacking order when moving on the same page', () => {
    const { doc } = step(base, [{ op: 'move', id: 'g1', to: { page: 'p1', x: 0, y: 0 } }])
    expect(doc.page.p1!.free).toEqual(['f1', 'g1', 'k1'])
    expect(doc.block.g1).toMatchObject({ x: 0, y: 0, w: 8000, h: 6000 })
  })

  it('moves blocks to another page', () => {
    const two = apply(base, [{ op: 'page', add: blankPage('p2') }]).doc
    const { doc } = step(two, [{ op: 'move', id: 'f1', to: { page: 'p2', x: 2000, y: 2000 } }])
    expect(doc.page.p2!.free).toEqual(['f1'])
    expect(doc.block.t1).toMatchObject({ parent: 'f1' })
  })

  it('keeps each block type in the places it belongs', () => {
    expectError(() => apply(base, [{ op: 'move', id: 't1', to: { page: 'p1', x: 0, y: 0, w: 1, h: 1 } }]), 'wrong_type', /sits inside a frame/)
    expectError(() => apply(base, [{ op: 'move', id: 'k1', to: { parent: 'f1', at: 0 } }]), 'wrong_type', /placed on a page/)
    expectError(() => apply(base, [{ op: 'move', id: 'm1', to: { page: 'p1', x: 0, y: 0 } }]), 'bad_shape', /give its size/)
  })
})

describe('splice', () => {
  it('replaces a range of text', () => {
    const { doc, inverse } = step(base, [{ op: 'splice', id: 't1', field: 'md', at: 0, del: 6, ins: 'Kepler' }])
    expect(doc.block.t1).toMatchObject({ md: "Kepler's laws" })
    expect(inverse).toEqual([{ op: 'splice', id: 't1', field: 'md', at: 0, del: 6, ins: 'Newton' }])
  })

  it('edits the document title', () => {
    expect(step(base, [{ op: 'splice', id: 'd1', field: 'title', at: 0, del: 7, ins: 'Maths' }]).doc.title).toBe('Maths lecture 4')
  })

  it('refuses the wrong field, an out-of-range span, or half an emoji', () => {
    expectError(() => apply(base, [{ op: 'splice', id: 'm1', field: 'md', at: 0, del: 0, ins: 'x' }]), 'wrong_type', /splice its tex/)
    expectError(() => apply(base, [{ op: 'splice', id: 't1', field: 'md', at: 10, del: 9, ins: '' }]), 'bad_range', /13 long/)
    const emoji = apply(base, [{ op: 'splice', id: 't1', field: 'md', at: 0, del: 0, ins: '🍎' }]).doc
    expectError(() => apply(emoji, [{ op: 'splice', id: 't1', field: 'md', at: 1, del: 0, ins: 'x' }]), 'bad_range', /in two/)
    expectError(() => apply(base, [{ op: 'splice', id: 't1', field: 'md', at: 0, del: 0, ins: '\ud83c' }]), 'bad_shape', /half of an emoji/)
  })
})

describe('stroke', () => {
  const line = { pts: [0, 0, 100, 3000, 0, 120], color: 'blue' as const, width: 's' as const }

  it('adds and removes strokes in an ink block', () => {
    const added = step(base, [{ op: 'stroke', id: 'k1', at: 1, add: line }]).doc
    expect((added.block.k1 as { strokes: unknown[] }).strokes).toHaveLength(2)
    const removed = step(added, [{ op: 'stroke', id: 'k1', at: 0, remove: true }]).doc
    expect((removed.block.k1 as { strokes: unknown[] }).strokes).toEqual([line])
  })

  it('works only on ink, at an existing index', () => {
    expectError(() => apply(base, [{ op: 'stroke', id: 't1', at: 0, add: line }]), 'wrong_type', /only ink/)
    expectError(() => apply(base, [{ op: 'stroke', id: 'k1', at: 5, remove: true }]), 'bad_range')
    expectError(() => apply(base, [{ op: 'stroke', id: 'k1', at: 0 } as Op]), 'bad_shape', /either add/)
  })
})

describe('page', () => {
  it('adds, reorders and removes pages', () => {
    const two = step(base, [{ op: 'page', add: blankPage('p2'), at: 0 }]).doc
    expect(two.pages).toEqual(['p2', 'p1'])
    expect(step(two, [{ op: 'page', move: 'p2', to: 1 }]).doc.pages).toEqual(['p1', 'p2'])
    expect(step(two, [{ op: 'page', remove: 'p2' }]).doc.pages).toEqual(['p1'])
  })

  it('removes a page with everything on it, and undo restores it all, links included', () => {
    const linked = apply(base, [
      { op: 'page', add: blankPage('p2') },
      { op: 'add', block: frame('f2', 'p2') },
      { op: 'add', block: text('t5', 'continued', 'f2') },
      { op: 'add', block: frame('f3', 'p2', 9000) },
      { op: 'update', id: 'f1', set: { next: 'f2' } },
      { op: 'update', id: 'f2', set: { next: 'f3' } },
    ]).doc
    const { doc } = step(linked, [{ op: 'page', remove: 'p2' }])
    expect(doc.block.f2).toBeUndefined()
    expect(doc.block.t5).toBeUndefined()
    expect(doc.block.f1).not.toHaveProperty('next')
  })

  it("takes a video's marks on a removed page with it, and undo puts them back", () => {
    const lecture = { id: 'vid00001', kind: 'youtube' as const, video: 'dQw4w9WgXcQ', title: 'A lecture' }
    const mark = (id: string, page: string) => ({ id, media: 'vid00001', from: 7500, to: 7900, page, x: 2000, y: 3000 })
    const marked = (clips: ReturnType<typeof mark>[]): Doc =>
      apply(base, [
        { op: 'page', add: blankPage('p2') },
        { op: 'update', id: base.id, set: { media: [lecture], clips } },
      ]).doc
    expect(step(marked([mark('clp00001', 'p1'), mark('clp00002', 'p2')]), [{ op: 'page', remove: 'p2' }]).doc.clips).toEqual([mark('clp00001', 'p1')])
    // The only mark gone, the note has none.
    expect(step(marked([mark('clp00002', 'p2')]), [{ op: 'page', remove: 'p2' }]).doc).not.toHaveProperty('clips')
  })

  it('keeps at least one page, and pages are added empty', () => {
    expectError(() => apply(base, [{ op: 'page', remove: 'p1' }]), 'last_page')
    expectError(() => apply(base, [{ op: 'page', add: { ...blankPage('p2'), free: ['g1'] } }]), 'not_empty')
  })
})

describe('asset', () => {
  const meta = { mime: 'image/jpeg', w: 800, h: 600, bytes: 52000 }

  it('adds and removes asset entries', () => {
    const added = step(base, [{ op: 'asset', hash: 'c0ffee', meta }]).doc
    expect(added.asset.c0ffee).toEqual(meta)
    expect(step(added, [{ op: 'asset', hash: 'c0ffee', meta: null }]).doc.asset).not.toHaveProperty('c0ffee')
  })

  it('refuses to remove an asset an image still uses', () => {
    expectError(() => apply(base, [{ op: 'asset', hash: 'a91f', meta: null }]), 'in_use', /Image g1/)
  })
})

describe('transactions', () => {
  it('apply all operations or none, and say which one failed', () => {
    const error = expectError(
      () =>
        apply(base, [
          { op: 'update', id: 't1', set: { role: 'h1' } },
          { op: 'remove', id: 'nope' },
        ]),
      'unknown_id',
    )
    expect(error.details.op).toBe(1)
    expect(base.block.t1).toMatchObject({ role: 'h2' })
  })

  it('raise rev by one, however many operations they hold', () => {
    const { doc } = step(base, [
      { op: 'update', id: 't1', set: { role: 'h1' } },
      { op: 'add', block: text('t3', 'more') },
      { op: 'move', id: 't3', to: { parent: 'f1', at: 0 } },
      { op: 'splice', id: 't3', field: 'md', at: 4, del: 0, ins: ' text' },
    ])
    expect(doc.rev).toBe(13)
    expect(doc.block.f1).toMatchObject({ kids: ['t3', 't1', 't2', 'm1'] })
  })

  it('leave the document alone when empty', () => {
    expect(apply(base, []).doc).toBe(base)
  })

  it('share unchanged blocks with the previous document', () => {
    const { doc } = apply(base, [{ op: 'update', id: 't1', set: { role: 'h1' } }])
    expect(doc.block.k1).toBe(base.block.k1)
    expect(doc.block.t1).not.toBe(base.block.t1)
  })
})

describe('edits from outside (AI and MCP)', () => {
  it('are refused as stale when a block they touch changed after their base rev', () => {
    expect(() => apply(base, [{ op: 'update', id: 't1', set: { role: 'h1' } }], { baseRev: 5 })).not.toThrow()
    const error = expectError(
      () => apply(base, [{ op: 'stroke', id: 'k1', at: 0, remove: true }], { baseRev: 5 }),
      'stale',
      /Read it again/,
    )
    expect(error.details.ids).toEqual(['k1'])
  })

  it('pass content checks supplied by the host', () => {
    const validators = { md: (md: string) => (md.includes('<') ? 'No HTML. Use **bold** or *italic*.' : null) }
    const ok: Op = { op: 'splice', id: 't2', field: 'md', at: 0, del: 0, ins: 'Note: ' }
    expect(() => apply(base, [ok], { validators })).not.toThrow()
    const bad: Op = { op: 'splice', id: 't2', field: 'md', at: 0, del: 0, ins: '<b>Note</b> ' }
    expectError(() => apply(base, [bad], { validators }), 'content', /Block t2: No HTML/)
  })
})

describe('the teaching error format', () => {
  it('serialises as { error, ...details, hint }', () => {
    const error = expectError(() => apply(base, [{ op: 'remove', id: 'zz' }]), 'unknown_id')
    expect(JSON.parse(JSON.stringify(error))).toEqual({ error: 'unknown_id', got: 'zz', hint: 'There is no block zz.' })
  })

  it('names unknown operations', () => {
    expectError(() => apply(base, [{ op: 'paint' } as unknown as Op]), 'bad_shape', /Unknown operation "paint"/)
  })
})
