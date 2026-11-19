// A note's words for the library's search, and its first words for the list (library/words.ts).
import { apply, createDoc, type Doc } from '@shellnote/core'
import { describe, expect, it } from 'vitest'
import { BOARD, MIXED } from '../../core/test/fixtures/index.js'
import { holdsWords, MOST_WORDS, noteSnip, noteWords, SNIP_LENGTH } from '../src/words.js'

/** A note of one page with a frame of text for each text given, top to bottom in that order. */
function noteOf(texts: readonly string[], title = 'Waves'): Doc {
  let doc = createDoc({ title })
  const page = doc.pages[0]!
  // Added bottom first, so the reading order is the frames' places, not the order they came in.
  for (let i = texts.length - 1; i >= 0; i--) {
    doc = apply(doc, [
      { op: 'add', block: { id: `wf${i}`, r: 0, type: 'frame', page, x: 2000, y: 4000 + i * 2000, w: 17000, h: 1500, kids: [] } },
      { op: 'add', block: { id: `wt${i}`, r: 0, type: 'text', parent: `wf${i}`, role: 'p', indent: 0, md: texts[i]! }, at: 0 },
    ]).doc
  }
  return doc
}

describe("a note's words", () => {
  it('hold its title and what its blocks say, in lower case, without the marks of Markdown', () => {
    const words = noteWords(noteOf(['**Energy** moves', 'as a *wave*']))
    expect(words).toContain('waves')
    expect(words).toContain('energy moves')
    expect(words).toContain('as a wave')
    expect(words).not.toMatch(/[*A-Z]/u)
  })

  it('are found by every word of a search, in any order, and never by an empty one', () => {
    const words = noteWords(noteOf(['Light bends at the boundary']))
    expect(holdsWords(words, 'boundary light')).toBe(true)
    expect(holdsWords(words, 'LIGHT')).toBe(true)
    expect(holdsWords(words, 'light sound')).toBe(false)
    expect(holdsWords(words, '   ')).toBe(false)
  })

  it("hold a board's steps and the words on their links", () => {
    const words = noteWords(BOARD)
    expect(words).toContain('write the draft')
    expect(words).toContain('passed? yes no')
    expect(holdsWords(words, 'publish deadline')).toBe(true)
  })

  it('are kept to a most', () => {
    expect(noteWords(noteOf(['word '.repeat(25_000), 'more '.repeat(25_000)])).length).toBe(MOST_WORDS)
  })
})

describe("a note's first words", () => {
  it('follow the reading order, on one line, without the title', () => {
    expect(noteSnip(noteOf(['First line', 'second  line\nand more'], 'Title'))).toBe('First line second line and more')
  })

  it('are cut to a line of the list, and empty for a note with no words', () => {
    expect(noteSnip(noteOf(['long '.repeat(100)])).length).toBe(SNIP_LENGTH)
    expect(noteSnip(createDoc({ title: 'Empty' }))).toBe('')
  })

  it("come from a real note's blocks", () => {
    expect(noteSnip(MIXED).length).toBeGreaterThan(0)
  })

  it('of a board follow its flowchart along its links, then what lies beside it', () => {
    expect(noteSnip(BOARD)).toBe('Start Write the draft Passed? Publish Remember the deadline')
  })
})
