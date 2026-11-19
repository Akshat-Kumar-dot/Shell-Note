// Search in every note's words: single words in small letters, in any order, and the words written in quotes kept
// side by side as a phrase.
import { describe, expect, it } from 'vitest'
import { BOARD } from '../../../packages/core/test/fixtures/index.js'
import { linesOf, termsOf } from '../src/library/searchAll.js'

describe('the lines search in every note reads', () => {
  it('of a board: its steps along their links, the ink with no words left out, then its box of text', () => {
    expect(linesOf(BOARD)).toEqual([
      { block: 'n1', text: 'Start' },
      { block: 'n2', text: 'Write the draft' },
      { block: 'n3', text: 'Passed?' },
      { block: 'n4', text: 'Publish' },
      { block: 't1', frame: 'f1', text: 'Remember the deadline' },
    ])
  })
})

describe('the words search in every note looks for', () => {
  it('single words, in small letters', () => {
    expect(termsOf('Newton  LAW')).toEqual({ words: ['newton', 'law'], phrases: [] })
  })

  it('words in quotes kept side by side, as one phrase', () => {
    expect(termsOf('"Second   law" newton')).toEqual({ words: ['newton'], phrases: ['second law'] })
  })

  it('nothing from empty quotes, or a quote left open', () => {
    expect(termsOf('"" "')).toEqual({ words: [], phrases: [] })
  })
})
