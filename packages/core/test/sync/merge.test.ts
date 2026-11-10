// Two devices change one note apart, and the merge keeps what both wrote.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { apply, become, createDoc, merge, mergeList, mergeText, sameContent, validateDoc, type Block, type Doc, type Op, type TextBlock } from '../../src/index.js'
import { Namer, planTransaction, transactions } from '../arbitraries.js'
import { FIXTURES } from '../fixtures/index.js'
import { content } from '../helpers.js'

/** A note with a frame holding paragraphs a, b and c. */
function note(): { doc: Doc; frame: string; page: string } {
  const start = createDoc({ title: 'Trip' })
  const frame = Object.keys(start.block)[0]!
  const ops: Op[] = [
    ['a', 'Pack the tent and the stove.'],
    ['b', 'Leave on Friday morning.'],
    ['c', 'Back by Sunday night.'],
  ].map(([id, md]) => ({ op: 'add', block: { id: id!, r: 0, type: 'text', parent: frame, role: 'p', indent: 0, md: md! } }))
  return { doc: apply(start, ops).doc, frame, page: start.pages[0]! }
}

const edit = (doc: Doc, ...ops: Op[]): Doc => apply(doc, ops).doc
const md = (doc: Doc, id: string): string => (doc.block[id] as TextBlock).md
const kidsOf = (doc: Doc, frame: string): string[] => (doc.block[frame] as Extract<Block, { type: 'frame' }>).kids
const text = (id: string, parent: string, words: string): Op => ({ op: 'add', block: { id, r: 0, type: 'text', parent, role: 'p', indent: 0, md: words } })

/** The merge as each device does it, checked: both get the same note, and each reaches it through apply(). */
function both(base: Doc | undefined, laptop: Doc, phone: Doc, since: { laptop?: number; phone?: number } = {}): Doc {
  const options = { ...(base ? { base } : {}) }
  const onLaptop = merge(laptop, phone, { ...options, first: 'mine', ...(since.laptop !== undefined ? { mineSince: since.laptop } : {}), ...(since.phone !== undefined ? { theirsSince: since.phone } : {}) })
  const onPhone = merge(phone, laptop, { ...options, first: 'theirs', ...(since.phone !== undefined ? { mineSince: since.phone } : {}), ...(since.laptop !== undefined ? { theirsSince: since.laptop } : {}) })
  expect(content(onPhone.doc)).toEqual(content({ ...onLaptop.doc, rev: onPhone.doc.rev }))
  const reached = become(laptop, onLaptop.doc).doc
  validateDoc(reached)
  validateDoc(become(phone, onPhone.doc).doc)
  expect(sameContent(reached, onLaptop.doc)).toBe(true)
  return reached
}

describe('mergeText', () => {
  it('keeps a word corrected on one device and a sentence added on the other', () => {
    expect(mergeText('Leave on Friday morning.', 'Leave on Saturday morning.', 'Leave on Friday morning. Bring maps.')).toBe('Leave on Saturday morning. Bring maps.')
  })

  it('refuses when both changed the same words', () => {
    expect(mergeText('Leave on Friday.', 'Leave on Saturday.', 'Leave on Sunday.')).toBeUndefined()
  })

  it('takes a change both made alike once', () => {
    expect(mergeText('one two', 'one 2', 'one 2')).toBe('one 2')
    expect(mergeList(['a', 'b'], ['a', 'x', 'b'], ['a', 'x', 'b'])).toEqual(['a', 'x', 'b'])
  })

  it('never cuts an emoji in two', () => {
    expect(mergeText('a 😀 b', 'a 😀 b c', 'z a 😀 b')).toBe('z a 😀 b c')
  })
})

describe('merge, with the version both came from', () => {
  it('keeps the edits of two devices to different paragraphs', () => {
    const { doc: base } = note()
    const laptop = edit(base, { op: 'update', id: 'a', set: { md: 'Pack the tent, the stove and a lamp.' } })
    const phone = edit(base, { op: 'update', id: 'c', set: { md: 'Back by Monday.' } })
    const merged = both(base, laptop, phone)
    expect(md(merged, 'a')).toBe('Pack the tent, the stove and a lamp.')
    expect(md(merged, 'c')).toBe('Back by Monday.')
    expect(md(merged, 'b')).toBe('Leave on Friday morning.')
  })

  it('merges two edits to different words of one paragraph', () => {
    const { doc: base } = note()
    const laptop = edit(base, { op: 'update', id: 'b', set: { md: 'Leave on Saturday morning.' } })
    const phone = edit(base, { op: 'update', id: 'b', set: { md: 'Leave on Friday morning. Bring maps.' } })
    expect(md(both(base, laptop, phone), 'b')).toBe('Leave on Saturday morning. Bring maps.')
  })

  it('keeps both paragraphs, one after the other, when both changed the same words', () => {
    const { doc: base, frame } = note()
    const laptop = edit(base, { op: 'update', id: 'b', set: { md: 'Leave on Saturday.' } })
    const phone = edit(base, { op: 'update', id: 'b', set: { md: 'Leave on Sunday.' } })
    const made = merge(laptop, phone, { base, first: 'mine' })
    expect(made.twice).toHaveLength(1)
    const merged = both(base, laptop, phone)
    const kids = kidsOf(merged, frame)
    expect(kids).toEqual(['a', 'b', made.twice[0], 'c'])
    expect(kids.map((id) => md(merged, id))).toEqual(['Pack the tent and the stove.', 'Leave on Saturday.', 'Leave on Sunday.', 'Back by Sunday night.'])
    // Merged again with either device's version, nothing is kept a third time.
    expect(sameContent(merge(merged, phone, { base, first: 'mine' }).doc, merged)).toBe(true)
  })

  it('keeps an edit against a removal, and takes a removal of what the other left alone', () => {
    const { doc: base, frame } = note()
    const laptop = edit(base, { op: 'remove', id: 'a' }, { op: 'remove', id: 'b' })
    const phone = edit(base, { op: 'update', id: 'a', set: { md: 'Pack the tent, the stove and the dog.' } })
    const merged = both(base, laptop, phone)
    expect(kidsOf(merged, frame)).toEqual(['a', 'c'])
    expect(md(merged, 'a')).toBe('Pack the tent, the stove and the dog.')
  })

  it('keeps what both added, each where it was put', () => {
    const { doc: base, frame } = note()
    const laptop = edit(base, { ...text('l1', frame, 'From the laptop.'), at: 1 } as Op)
    const phone = edit(base, text('p1', frame, 'From the phone.'))
    expect(kidsOf(both(base, laptop, phone), frame)).toEqual(['a', 'l1', 'b', 'c', 'p1'])
  })

  it('keeps a frame the other side removed when a paragraph was added to it', () => {
    const { doc: base, frame, page } = note()
    const laptop = edit(base, { op: 'add', block: { id: 'f2', r: 0, type: 'frame', page, x: 0, y: 0, w: 100, h: 100, kids: [] } }, { op: 'remove', id: frame })
    const phone = edit(base, text('p1', frame, 'One more thing.'))
    const merged = both(base, laptop, phone)
    expect(kidsOf(merged, frame)).toEqual(['p1'])
    expect(merged.page[page]!.free).toContain('f2')
  })

  it('takes a move from one device and an edit from the other', () => {
    const { doc: base, frame } = note()
    const laptop = edit(base, { op: 'move', id: 'c', to: { parent: frame, at: 0 } })
    const phone = edit(base, { op: 'update', id: 'c', set: { md: 'Back by Monday.' } }, { op: 'update', id: base.id, set: { title: 'The trip' } })
    const merged = both(base, laptop, phone)
    expect(kidsOf(merged, frame)).toEqual(['c', 'a', 'b'])
    expect(md(merged, 'c')).toBe('Back by Monday.')
    expect(merged.title).toBe('The trip')
  })

  it('keeps every stroke two devices drew in one block of ink', () => {
    const start = createDoc()
    const page = start.pages[0]!
    const stroke = (x: number) => ({ pts: [x, 0, 128, x + 10, 10, 128], color: 'ink' as const, width: 'm' as const })
    const base = edit(start, { op: 'add', block: { id: 'ink', r: 0, type: 'ink', page, x: 0, y: 0, w: 100, h: 100, strokes: [stroke(1)] } })
    const laptop = edit(base, { op: 'stroke', id: 'ink', at: 1, add: stroke(2) })
    const phone = edit(base, { op: 'stroke', id: 'ink', at: 1, add: stroke(3) })
    const merged = both(base, laptop, phone)
    expect((merged.block.ink as Extract<Block, { type: 'ink' }>).strokes).toEqual([stroke(1), stroke(2), stroke(3)])
  })

  it('takes the first side for a small thing both changed, and loses no words for it', () => {
    const { doc: base } = note()
    const laptop = edit(base, { op: 'update', id: base.id, set: { title: 'Camping' } }, { op: 'update', id: 'a', set: { role: 'h1' } })
    const phone = edit(base, { op: 'update', id: base.id, set: { title: 'Holiday' } }, { op: 'update', id: 'a', set: { role: 'h2', md: 'Pack the tent and the stove. And a lamp.' } })
    const merged = both(base, laptop, phone)
    expect(merged.title).toBe('Camping')
    expect(merged.block.a).toMatchObject({ role: 'h1', md: 'Pack the tent and the stove. And a lamp.' })
  })

  it('keeps pages and pictures from both', () => {
    const { doc: base, page } = note()
    const laptop = edit(base, { op: 'page', add: { id: 'p2', w: 21000, h: 29700, bg: 'ruled', free: [] } })
    const phone = edit(base, { op: 'asset', hash: 'abcd12', meta: { mime: 'image/png', bytes: 10 } }, { op: 'add', block: { id: 'pic', r: 0, type: 'image', page, x: 0, y: 0, w: 100, h: 100, asset: 'abcd12' } })
    const merged = both(base, laptop, phone)
    expect(merged.pages).toEqual([page, 'p2'])
    expect(merged.asset).toHaveProperty('abcd12')
    expect(merged.block.pic).toBeDefined()
  })
})

describe('merge, by what each side has seen of the other', () => {
  it('takes away what the other side removed after seeing it, and keeps what it never saw', () => {
    const { doc: seen, frame } = note()
    // The phone took the laptop's note at this rev, then removed b; the laptop has since added d.
    const phone = edit(seen, { op: 'remove', id: 'b' })
    const laptop = edit(seen, text('d', frame, 'Written after the phone looked.'))
    const merged = both(undefined, laptop, phone, { laptop: seen.rev, phone: seen.rev })
    expect(kidsOf(merged, frame)).toEqual(['a', 'c', 'd'])
  })

  it('keeps both paragraphs when both changed one and no earlier version is at hand', () => {
    const { doc: seen, frame } = note()
    const laptop = edit(seen, { op: 'update', id: 'a', set: { md: 'Pack the tent.' } })
    const phone = edit(seen, { op: 'update', id: 'a', set: { md: 'Pack the stove.' } })
    const merged = both(undefined, laptop, phone, { laptop: seen.rev, phone: seen.rev })
    expect(kidsOf(merged, frame).map((id) => md(merged, id))).toEqual(['Pack the tent.', 'Pack the stove.', 'Leave on Friday morning.', 'Back by Sunday night.'])
  })

  it('keeps everything when nothing is known of the past', () => {
    const { doc: seen, frame } = note()
    const laptop = edit(seen, { op: 'remove', id: 'b' })
    const phone = edit(seen, text('d', frame, 'New.'))
    expect(kidsOf(both(undefined, laptop, phone), frame)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('merge, on random changes', () => {
  const fixture = fc.constantFrom(...Object.values(FIXTURES))
  const run = (namer: Namer, start: Doc, plan: Parameters<typeof planTransaction>[2][]): Doc => {
    let doc = start
    for (const seeds of plan) {
      const { ops } = planTransaction(namer, doc, seeds)
      if (ops.length > 0) doc = apply(doc, ops).doc
    }
    return doc
  }

  it('gives a valid note, the same on both devices, and each side alone when only it changed', () => {
    fc.assert(
      fc.property(fixture, transactions, transactions, fc.boolean(), (base, first, second, withBase) => {
        const laptop = run(new Namer(), base, first)
        const phone = run(new Namer('y'), base, second)
        both(withBase ? base : undefined, laptop, phone, withBase ? {} : { laptop: base.rev, phone: base.rev })
        expect(sameContent(merge(laptop, base, { base, first: 'mine' }).doc, laptop)).toBe(true)
        expect(sameContent(merge(base, phone, { base, first: 'mine' }).doc, { ...phone, rev: base.rev })).toBe(true)
        expect(sameContent(merge(laptop, laptop, { first: 'theirs' }).doc, laptop)).toBe(true)
      }),
      { numRuns: 300 },
    )
  })

  it('loses no words: every paragraph either side wrote or changed is in the merged note', () => {
    fc.assert(
      fc.property(fixture, transactions, transactions, (base, first, second) => {
        const laptop = run(new Namer(), base, first)
        const phone = run(new Namer('y'), base, second)
        const merged = merge(laptop, phone, { base, first: 'mine' }).doc
        const words = new Set(Object.values(merged.block).flatMap((block) => (block.type === 'text' ? [block.md] : [])))
        for (const side of [laptop, phone]) {
          for (const block of Object.values(side.block)) {
            if (block.type !== 'text') continue
            const before = base.block[block.id]
            if (before?.type === 'text' && before.md === block.md) continue
            const now = merged.block[block.id]
            // Its words are there as written, or merged with the other side's into the same paragraph.
            expect(words.has(block.md) || (now?.type === 'text' && before?.type === 'text')).toBe(true)
          }
        }
      }),
      { numRuns: 300 },
    )
  })
})
