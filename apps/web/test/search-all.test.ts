// Search in every note's words: single words in small letters, in any order, and the words written in quotes kept
// side by side as a phrase.
import { describe, expect, it } from 'vitest'
import { termsOf } from '../src/library/searchAll.js'

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
