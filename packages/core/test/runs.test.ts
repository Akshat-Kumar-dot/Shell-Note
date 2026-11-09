// Between inline Markdown and an editor's runs of marked text.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { fromRuns, sameRuns, toRuns, type Marks, type Run } from '../src/index.js'

const TEXTS = [
  'Plain words only.',
  'An object at rest stays at rest unless a **force** acts on it.',
  'Mixed: **bold**, *italic*, ~~struck~~, `code`, ==highlight== and [a link](https://example.com/a).',
  'Nested: **bold with *italic* inside** and *italic with **bold** inside*.',
  'Energy $E = mc^2$ and momentum $p = mv$ in one line.',
  'The lab kit costs $5, or $10 with the stand.',
  'Some [coloured words]{color=red} and [more]{color=blue} here.',
  'A link with **bold** inside: [see **this** page](https://example.com/b).',
  'Math before a digit: \\(x\\)2 and a span [mark]{.b}.',
  'Unicode: café, 日本語, नमस्ते, and emoji 🍎.',
]

describe('runs', () => {
  it('flatten marks onto each piece of text', () => {
    expect(toRuns('a **b *c*** $x$')).toEqual([
      { text: 'a ', marks: {} },
      { text: 'b ', marks: { b: true } },
      { text: 'c', marks: { b: true, i: true } },
      { text: ' ', marks: {} },
      { math: 'x', marks: {} },
    ])
  })

  it('come back to md with the same formatting, and settle after one pass', () => {
    for (const md of TEXTS) {
      const once = fromRuns(toRuns(md))
      expect(sameRuns(toRuns(once), toRuns(md)), md).toBe(true)
      expect(fromRuns(toRuns(once)), md).toBe(once)
    }
    // The outer mark is the one that runs furthest, so both nestings survive as written.
    expect(fromRuns(toRuns('*italic with **bold** inside*'))).toBe('*italic with **bold** inside*')
    expect(fromRuns(toRuns('**bold with *italic* inside**'))).toBe('**bold with *italic* inside**')
  })

  it('keep every character and settle, whatever the formatting', () => {
    const marks: fc.Arbitrary<Marks> = fc.record(
      {
        b: fc.constant(true as const),
        i: fc.constant(true as const),
        s: fc.constant(true as const),
        hl: fc.constant(true as const),
        u: fc.constant(true as const),
        sub: fc.constant(true as const),
        sup: fc.constant(true as const),
        code: fc.constant(true as const),
        link: fc.constantFrom('https://example.com/a', 'https://example.com/b'),
        color: fc.constantFrom('red' as const, 'blue' as const),
        size: fc.constantFrom('s' as const, 'xl' as const),
        font: fc.constantFrom('serif', 'lora'),
      },
      { requiredKeys: [] },
    )
    const run: fc.Arbitrary<Run> = fc.oneof(
      fc.record({ text: fc.string({ unit: 'grapheme', minLength: 1, maxLength: 6 }), marks }),
      fc.record({ math: fc.constantFrom('x', 'E = mc^2', '\\frac{1}{2}'), marks }),
    )
    // Every character of text in order, with each formula as one placeholder.
    const letters = (runs: readonly Run[]): string => runs.map((r) => ('text' in r ? r.text : '\u0000')).join('')
    const formulas = (runs: readonly Run[]): string[] => runs.flatMap((r) => ('math' in r ? [r.math] : []))
    fc.assert(
      fc.property(fc.array(run, { maxLength: 8 }), (runs) => {
        const md = fromRuns(runs)
        const back = toRuns(md)
        expect(letters(back)).toBe(letters(runs))
        expect(formulas(back)).toEqual(formulas(runs))
        expect(fromRuns(back)).toBe(md)
      }),
      { numRuns: 400 },
    )
    // Random text with every mark nested deeply is slow to write; typical text takes about 0.1 ms.
  }, 30_000)
})
