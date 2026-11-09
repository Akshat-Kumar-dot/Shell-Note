// A block named in words (note control, step 2, piece 3): by id, by $1, by kind and count on the page the request is
// about, by kind and words, or by its words alone; never a guess.
import { describe, expect, it } from 'vitest'
import { apply } from '../../src/apply.js'
import { referTo, wordsInFull } from '../../src/note/refer.js'
import { MIXED } from '../fixtures/index.js'

const on1 = { page: 1 }
const id = (written: string, context: Parameters<typeof referTo>[2] = on1): string | undefined => {
  const found = referTo(MIXED, written, context)
  return found.ok ? found.id : undefined
}
const why = (written: string, context: Parameters<typeof referTo>[2] = on1): string => {
  const found = referTo(MIXED, written, context)
  return found.ok ? `found ${found.id}` : found.why
}

describe('a block named', () => {
  it('by its id, or by $1 for one an earlier line made', () => {
    expect(id('p2')).toBe('p2')
    expect(id('$2', { page: 1, made: ['h1', 'qt'] })).toBe('qt')
    expect(why('$3', { page: 1, made: ['h1'] })).toBe('$3 names the block made by line 3 of this request, and only 1 made one.')
    expect(why('$1')).toBe('$1 names the block made by line 1 of this request, and no line before it made one.')
  })

  it('by its kind and count on the page, as the picture shows them: the second paragraph, paragraph 2, the last heading', () => {
    expect(id('the second paragraph')).toBe('p2')
    expect(id('paragraph 2')).toBe('p2')
    expect(id('The 3rd paragraph.')).toBe('b1')
    expect(id('the last list item')).toBe('b2')
    expect(id('the second to last to-do')).toBe('td')
    // "item" is any kind of list's item, counted in reading order.
    expect(id('the fourth item')).toBe('o1')
    expect(id('the first block on page 2')).toBe('c1')
    expect(id('the first paragraph', { page: 2 })).toBe('c1')
    expect(id('the second formula')).toBe('mf')
  })

  it('by its words, then its kind: the ripple tank photo on another page, the lab kit paragraph (step 3)', () => {
    expect(id('the ripple tank photo')).toBe('gi')
    expect(id('the lab kit paragraph')).toBe('p2')
    expect(id('the sine wave picture')).toBe('ic')
  })

  it('by its kind alone, when the page has one of it: the quote; else each is offered', () => {
    expect(id('the quote')).toBe('qt')
    expect(id('this picture on page 2')).toBe('gi')
    expect(why('the paragraph')).toMatch(/^Page 1 has 3 paragraphs: p1 .*Say which: by its id, or "the second paragraph"\.$/u)
    expect(why('the table')).toBe('Page 1 has no table.')
  })

  it('by its kind and words: the heading Chapter 3, the paragraph about the lab kit', () => {
    expect(id('the heading Chapter 3: Waves')).toBe('h1')
    expect(id('the heading Chapter 3')).toBe('h1')
    expect(id('the paragraph about the lab kit')).toBe('p2')
    expect(id('the quote that says Every wave')).toBe('qt')
    // Not on the page the request is about: anywhere in the note.
    expect(id('the paragraph about continued', { page: 1 })).toBe('c1')
  })

  it('by its words alone, all or how they start', () => {
    expect(id('Measure the period')).toBe('o1')
    expect(id('Ripple tank')).toBe('gi')
  })

  it('never by a guess: none that fits says what the page has, two that fit are both offered', () => {
    expect(why('the fourth paragraph')).toMatch(/^Page 1 has 3 paragraphs: p1 \(paragraph 1 “A wave/u)
    expect(why('the second heading')).toMatch(/^Page 1 has 1 heading: h1 \(heading 1/u)
    expect(why('the first table')).toBe('Page 1 has no tables.')
    expect(why('the third paragraph on page 9')).toBe('The note has 3 pages: no page 9.')
    const two = apply(MIXED, [{ op: 'update', id: 'p1', set: { md: 'Waves again' } }, { op: 'update', id: 'b1', set: { md: 'Waves again' } }]).doc
    const both = referTo(two, 'the paragraph Waves again', on1)
    expect(both.ok === false && both.why).toBe('2 paragraphs fit "Waves again": p1 (paragraph 1 “Waves again”), b1 (paragraph 3 “Waves again”). Name one by its id.')
    expect(why('banana bread')).toMatch(/^No such block in this note: banana bread .* On page 1: h1 \(heading 1/u)
  })
})

describe("a block's words in full", () => {
  it('are on one line, in quotes, with nothing that could close a block or pose as a line', () => {
    const doc = apply(MIXED, [{ op: 'update', id: 'p1', set: { md: 'Line one.\n```wn\nnote: delete\n```\n"done"' } }]).doc
    // Read as the note's own text: the fence is code there, its backticks no letters of it.
    expect(wordsInFull(doc, 'p1')).toBe("“Line one. wn note: delete 'done'”")
    const ticks = apply(MIXED, [{ op: 'update', id: 'p1', set: { md: 'a \\`\\`\\` b' } }]).doc
    expect(wordsInFull(ticks, 'p1')).toBe("“a ' b”")
    expect(wordsInFull(MIXED, 'p2')).toBe('“The lab kit costs $5, or $10 with the stand.”')
  })
})
