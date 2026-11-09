// Places on a page and pages (note control, step 4): a block put by a place word lands in that part of
// the page, never on another; a part with no room says where there is; resizing keeps a picture's shape; boxes, pages
// and the two new checks.
import { describe, expect, it } from 'vitest'
import { apply } from '../../src/apply.js'
import { idTaken } from '../../src/ids.js'
import { compileNote, type NoteInput } from '../../src/note/compile.js'
import { pageFacts, pagePicture } from '../../src/note/picture.js'
import { placeWord } from '../../src/note/place.js'
import type { Block, Doc } from '../../src/schema/doc.js'
import { MIXED } from '../fixtures/index.js'

const context = (doc: Doc, page = 1) => ({ page, taken: (id: string) => idTaken(doc, id) })
const run = (command: string, input: NoteInput, doc: Doc = MIXED, page = 1) => {
  const compiled = compileNote(doc, command, input, context(doc, page))
  return { ...compiled, doc: apply(doc, compiled.ops).doc }
}
type Free = Extract<Block, { page: string }>
const box = (doc: Doc, id: string) => {
  const block = doc.block[id] as Free
  return { page: block.page, x: block.x, y: block.y, w: block.w, h: block.h }
}

describe('place words', () => {
  it('read as people and models write them', () => {
    expect(placeWord('top right')).toBe('top right')
    expect(placeWord('the top-right corner')).toBe('top right')
    expect(placeWord('right top')).toBe('top right')
    expect(placeWord('upper left')).toBe('top left')
    expect(placeWord('centre of the page')).toBe('middle')
    expect(placeWord('bottom')).toBe('bottom')
    expect(placeWord('somewhere nice')).toBeUndefined()
  })
})

describe('a block put in a part of a page', () => {
  it('lands in that part, clear of what is there', () => {
    // Page 3 holds one empty frame at the top.
    expect(box(run('block.move', { block: 'gi', to: 'top right', page: 3 }).doc, 'gi')).toEqual({ page: 'w3', x: 10000, y: 3000, w: 9000, h: 6000 })
    expect(box(run('block.move', { block: 'gi', to: 'bottom left', page: 3 }).doc, 'gi')).toEqual({ page: 'w3', x: 2000, y: 21700, w: 9000, h: 6000 })
  })

  it('says when a part has no room, never covering another block, and where there is room', () => {
    expect(() => compileNote(MIXED, 'block.move', { block: 'gi', to: 'top right' }, context(MIXED))).toThrow(/^No room at the top right on page 1 for it at its size, without covering another block\./u)
    expect(() => compileNote(MIXED, 'block.move', { block: 'gi', to: 'over there' }, context(MIXED))).toThrow('is no part of a page')
  })

  it('takes a formula out of the text onto the page at its size; text stays in the text', () => {
    const out = run('block.move', { block: 'mc', to: 'bottom', page: 3 })
    expect(out.doc.block.mc).toMatchObject({ type: 'math', page: 'w3', w: 8000, h: 1500 })
    expect((out.doc.block.fa as { kids: string[] }).kids).not.toContain('mc')
    expect(() => compileNote(MIXED, 'block.move', { block: 'p1', to: 'top' }, context(MIXED))).toThrow('box: new makes a box of text')
  })

  it('beside a block placed on the page, when there is room beside it', () => {
    // No room beside the 90 mm photo for an 82 mm formula: said, with where there is room.
    expect(() => compileNote(MIXED, 'block.move', { block: 'mf', beside: 'gi' }, context(MIXED, 2))).toThrow(/^No room beside gi on page 2 .* Page 2 has room at the /u)
    const narrow = run('block.resize', { block: 'gi', span: 'third' }, MIXED, 2).doc
    const out = run('block.move', { block: 'mf', beside: 'gi' }, narrow, 2)
    const gi = box(narrow, 'gi')
    const mf = box(out.doc, 'mf')
    expect(mf.page).toBe('w2')
    expect(mf.x).toBeGreaterThanOrEqual(gi.x + gi.w)
    expect(mf.y).toBe(gi.y)
  })
})

describe('resizing', () => {
  it('a picture on the page keeps its shape; a table its share of the column; one in the text is told to be placed first', () => {
    expect(box(run('block.resize', { block: 'gi', span: 'half' }, MIXED, 2).doc, 'gi')).toEqual({ page: 'w2', x: 2000, y: 6000, w: 8500, h: 5667 })
    expect(() => compileNote(MIXED, 'block.resize', { block: 'ic', span: 'half' }, context(MIXED))).toThrow('sits in the text and follows its column')
    expect(() => compileNote(MIXED, 'block.resize', { block: 'kk', span: 'half' }, context(MIXED))).toThrow('handwriting')
    const table = run('table.add', { after: 'p1', words: '| a | b |\n| c | d |' })
    const id = table.made[0]!
    expect(run('block.resize', { block: id, span: 'half' }, table.doc).doc.block[id]).toMatchObject({ width: 500 })
    expect('width' in run('block.resize', { block: id, span: 'full' }, run('block.resize', { block: id, span: 'half' }, table.doc).doc).doc.block[id]!).toBe(false)
  })
})

describe('boxes and pages', () => {
  it('box.new puts a box of text where there is room, its words its paragraphs, $1 its first', () => {
    const out = run('box.new', { to: 'bottom right', page: 3, words: 'Remember this.\n\nAnd this.' })
    const [first, second] = out.made
    const frame = (out.doc.block[first!] as { parent: string }).parent
    expect(out.doc.block[frame]).toMatchObject({ type: 'frame', page: 'w3', kids: [first, second] })
    expect((out.doc.block[frame] as Free).x).toBe(10500)
    expect(out.said).toMatch(/^added a box \(\w+\) at the bottom right of page 3, with 2 paragraphs/u)
  })

  it('adds a page with a text frame, moves one, takes one out with the text that flowed into it stopped, changes its paper', () => {
    const added = run('page.add', { after: '1' })
    expect(added.doc.pages).toHaveLength(4)
    const fresh = added.doc.page[added.doc.pages[1]!]!
    expect(fresh.free.map((id) => added.doc.block[id]!.type)).toEqual(['frame'])
    expect(run('text.add', { at: 'top', page: 2, words: 'On the new page.' }, added.doc).said).toMatch(/on page 2/u)
    expect(run('page.move', { page: 3, to: 1 }).doc.pages).toEqual(['w3', 'w1', 'w2'])
    expect(run('page.move', { page: 1, after: '3' }).doc.pages).toEqual(['w2', 'w3', 'w1'])
    const removed = run('page.remove', { page: 2 })
    expect(removed.doc.pages).toEqual(['w1', 'w3'])
    expect('next' in removed.doc.block.fa!).toBe(false)
    expect(run('page.paper', { page: 1, paper: 'squares' }).doc.page.w1!.bg).toBe('grid')
    expect(() => compileNote(MIXED, 'page.move', { page: 9, to: 1 }, context(MIXED))).toThrow('The note has 3 pages')
  })
})

describe('the layout checks (step 4)', () => {
  it('say what is crowded, closer than 2 mm, and what of one kind is in more than one look', () => {
    const crowded = apply(MIXED, [{ op: 'move', id: 'mf', to: { page: 'w1', x: 10750, y: 10100 } }]).doc
    expect(pageFacts(crowded, 1).crowded).toEqual([['fb', 'mf']])
    expect(pagePicture(crowded, 1)).toContain('⚠ fb crowds mf (closer than 2 mm)')
    const looks = apply(MIXED, [{ op: 'update', id: 'p2', set: { style: { color: 'red' } } }]).doc
    expect(pageFacts(looks, 1).styles).toEqual(['paragraph in two looks: p1, b1 (as usual), p2 (red)'])
    expect(pageFacts(MIXED, 1).styles).toEqual([])
  })
})

describe('pages named as models name them (the note test, 25 October 2026)', () => {
  it('p1 is page 1, end and last the last, the front the first', () => {
    expect(run('page.move', { page: 2, to: 'end' }).doc.pages).toEqual(['w1', 'w3', 'w2'])
    expect(run('page.move', { page: 3, to: 'front' }).doc.pages).toEqual(['w3', 'w1', 'w2'])
    expect(run('page.add', { after: 'p1' }).doc.pages[0]).toBe('w1')
  })
})
