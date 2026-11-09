// The finder's standard form of words: roots, filler, order, typos.
import { describe, expect, it } from 'vitest'
import { keyOf, letterOverlap, spelled, stem, tokens, wordOverlap } from '../../src/command/words.js'

describe('the standard form of a request', () => {
  it('reads words, numbers and stand-ins, and splits hyphens', () => {
    expect(tokens("Zoom to 150% on the note's full-screen {kind}")).toEqual(['zoom', 'to', '150', 'on', 'the', 'note', 'full', 'screen', '{kind}'])
  })

  it('gives every form of a word one root, never shorter than three letters', () => {
    for (const forms of [
      ['close', 'closes', 'closed', 'closing'],
      ['note', 'notes'],
      ['set', 'setting', 'settings'],
      ['delete', 'deleted', 'deleting', 'deletes'],
      ['file', 'files'],
      ['stop', 'stopped', 'stops'],
      ['use', 'uses', 'used', 'using'],
      ['add', 'added', 'adding'],
    ]) {
      expect(new Set(forms.map(stem)).size, forms.join(' ')).toBe(1)
    }
    expect(stem('class')).toBe('class')
    expect(stem('full')).toBe('full')
    expect(stem('us')).toBe('us')
  })

  it('makes word order, filler and endings not matter', () => {
    expect(keyOf(tokens('Closes the Note'))).toBe(keyOf(tokens('note close')))
    expect(keyOf(tokens('please close my current note now'))).toBe(keyOf(tokens('close note')))
    expect(keyOf(tokens('zoom in'))).not.toBe(keyOf(tokens('zoom out')))
  })

  it('scores overlap from 0 to 1', () => {
    expect(wordOverlap(['clos', 'not'], ['clos', 'not'])).toBe(1)
    expect(wordOverlap(['clos', 'not'], ['open', 'not'])).toBe(0.5)
    expect(wordOverlap([], ['not'])).toBe(0)
    expect(letterOverlap(['pencil'], ['pencil'])).toBe(1)
    expect(letterOverlap(['pencel'], ['pencil'])).toBe(0.5)
    expect(letterOverlap(['library'], ['zoom'])).toBe(0)
  })

  it('corrects a typo to the vocabulary, never a short word', () => {
    const vocabulary = new Set(['close', 'pencil', 'highlighter', 'open', 'pen'])
    expect(spelled('clsoe', vocabulary)).toBe('close')
    expect(spelled('pencel', vocabulary)).toBe('pencil')
    expect(spelled('higlighter', vocabulary)).toBe('highlighter')
    expect(spelled('opn', vocabulary)).toBeUndefined()
    expect(spelled('banana', vocabulary)).toBeUndefined()
  })
})
