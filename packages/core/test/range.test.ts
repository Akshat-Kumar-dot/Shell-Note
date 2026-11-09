import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { markRange, parseInline, plainText, replaceRange } from '../src/index.js'

const md = 'An object at rest stays at rest unless a **force** acts on it.'
/** The [start, end) of `words` in the plain text of `md`. */
const span = (source: string, words: string): [number, number] => {
  const start = plainText(parseInline(source)).indexOf(words)
  if (start < 0) throw new Error(`"${words}" is not in the text`)
  return [start, start + words.length]
}

describe('formatting selected words', () => {
  it('adds and removes bold', () => {
    expect(markRange(md, ...span(md, 'object'), { bold: true })).toBe('An **object** at rest stays at rest unless a **force** acts on it.')
    expect(markRange(md, ...span(md, 'force'), { bold: false })).toBe('An object at rest stays at rest unless a force acts on it.')
  })

  it('changes part of a formatted word', () => {
    expect(markRange(md, ...span(md, 'for'), { bold: false })).toBe('An object at rest stays at rest unless a for**ce** acts on it.')
  })

  it('colours, links and code', () => {
    const red = markRange(md, ...span(md, 'force'), { color: 'red' })
    expect(red).toBe('An object at rest stays at rest unless a [**force**]{color=red} acts on it.')
    expect(markRange(red, ...span(red, 'force'), { color: 'ink' })).toBe(md)
    expect(markRange(md, ...span(md, 'rest unless'), { link: 'https://example.com' })).toContain('[rest unless](https://example.com)')
    expect(markRange(md, ...span(md, 'object'), { code: true })).toBe('An `object` at rest stays at rest unless a **force** acts on it.')
  })

  it('treats a formula as one unit', () => {
    const math = 'The period $T$ is long.'
    expect(markRange(math, ...span(math, 'T$ is'), { italic: true })).toBe('The period *$T$ is* long.')
  })
})

describe('replacing selected words', () => {
  it('keeps the formatting of what it replaces', () => {
    expect(replaceRange(md, ...span(md, 'force'), 'push')).toBe('An object at rest stays at rest unless a **push** acts on it.')
  })

  it('takes formatting written in the new words too', () => {
    expect(replaceRange(md, ...span(md, 'object'), '*heavy* object')).toBe('An *heavy* object at rest stays at rest unless a **force** acts on it.')
  })

  it('inserts at a point when nothing is selected', () => {
    const end = plainText(parseInline(md)).length
    expect(replaceRange(md, end, end, ' Always.')).toBe(`${md} Always.`)
  })
})

describe('on random text', () => {
  const PIECES = ['a', 'b ', ' ', '**', '*', '`', '$x$', '[k]{color=blue}', '[l](https://a.org)', '~~', '==', '_', 'λ', '🍎']
  const text = fc.array(fc.constantFrom(...PIECES), { maxLength: 12 }).map((parts) => parts.join(''))
  const change = fc.record(
    {
      bold: fc.boolean(),
      italic: fc.boolean(),
      strike: fc.boolean(),
      highlight: fc.boolean(),
      code: fc.boolean(),
      color: fc.constantFrom('ink' as const, 'red' as const, 'blue' as const),
      link: fc.constantFrom(null, 'https://b.org'),
    },
    { requiredKeys: [] },
  )

  it('formatting never changes the words', () => {
    fc.assert(
      fc.property(text, fc.nat(), fc.nat(), change, (source, a, b, delta) => {
        const length = plainText(parseInline(source)).length
        const start = Math.min(a, b) % (length + 1)
        const end = Math.min(Math.max(a, b) % (length + 1) + start, length)
        expect(plainText(parseInline(markRange(source, start, end, delta)))).toBe(plainText(parseInline(source)))
      }),
      { numRuns: 2000 },
    )
  })
})
