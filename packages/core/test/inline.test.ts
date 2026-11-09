import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { checkInline, normalize, parseInline, plainText, serializeInline, type Inline } from '../src/index.js'

const text = (v: string): Inline => ({ t: 'text', v })

describe('reading md', () => {
  it('reads every construct of the subset', () => {
    expect(parseInline('**a** *b* `c` ~~d~~ ==e== [f](https://x.org) $g$ [h]{color=red}')).toEqual([
      { t: 'b', c: [text('a')] },
      text(' '),
      { t: 'i', c: [text('b')] },
      text(' '),
      { t: 'code', v: 'c' },
      text(' '),
      { t: 's', c: [text('d')] },
      text(' '),
      { t: 'hl', c: [text('e')] },
      text(' '),
      { t: 'link', href: 'https://x.org', c: [text('f')] },
      text(' '),
      { t: 'math', v: 'g' },
      text(' '),
      { t: 'color', color: 'red', c: [text('h')] },
    ])
  })

  it('leaves prices alone: "$5 or $10" is text, not math', () => {
    expect(parseInline('The kit costs $5, or $10 with the stand.')).toEqual([text('The kit costs $5, or $10 with the stand.')])
    expect(parseInline('$5-$10')).toEqual([text('$5-$10')])
    expect(parseInline('$x$5')).toEqual([text('$x$5')])
  })

  it('reads math with a $ inside it, and the \\( \\) form', () => {
    expect(parseInline('$a \\$ b$')).toEqual([{ t: 'math', v: 'a \\$ b' }])
    expect(parseInline('\\(x\\)5')).toEqual([{ t: 'math', v: 'x' }, text('5')])
  })

  it('keeps underscores inside words', () => {
    expect(parseInline('snake_case and _italic_')).toEqual([text('snake_case and '), { t: 'i', c: [text('italic')] }])
  })

  it('reads escapes, code with backticks, nesting and links with parentheses', () => {
    expect(parseInline('\\*not italic\\*')).toEqual([text('*not italic*')])
    expect(parseInline('``a`b``')).toEqual([{ t: 'code', v: 'a`b' }])
    expect(parseInline('**bold *and italic***')).toEqual([
      { t: 'b', c: [text('bold '), { t: 'i', c: [text('and italic')] }] },
    ])
    expect(parseInline('[wave](https://en.wikipedia.org/wiki/Wave_(physics))')).toEqual([
      { t: 'link', href: 'https://en.wikipedia.org/wiki/Wave_(physics)', c: [text('wave')] },
    ])
  })

  it('treats anything unmatched as text', () => {
    expect(parseInline('**open [half](link ` and $ alone')).toEqual([text('**open [half](link ` and $ alone')])
    expect(parseInline('[x]{color=pink}')).toEqual([text('[x]{color=pink}')])
  })
})

describe('writing md', () => {
  const roundTrips = [
    '**a** *b* `c` ~~d~~ ==e== [f](https://x.org) $g$ [h]{color=red}',
    'The kit costs $5, or $10 with the stand.',
    'snake_case and *italic*',
    'Its period $T$ and frequency $f$ satisfy $f = 1/T$.',
  ]
  for (const md of roundTrips) {
    it(`writes "${md}" back unchanged`, () => {
      expect(serializeInline(parseInline(md))).toBe(md)
    })
  }

  it('escapes text that would otherwise read as markup', () => {
    expect(serializeInline([text('2 * 3 = [6]')])).toBe('2 \\* 3 = \\[6\\]')
  })

  it('uses \\( \\) for math the $ rule cannot express', () => {
    expect(serializeInline([{ t: 'math', v: 'x' }, text('5')])).toBe('\\(x\\)5')
    expect(serializeInline([{ t: 'math', v: ' x ' }])).toBe('\\( x \\)')
  })

  it('moves spaces out of a mark, where they could not be written', () => {
    expect(serializeInline([text('a'), { t: 'b', c: [text(' bold ')] }, text('b')])).toBe('a **bold** b')
  })
})

describe('plain text and checks', () => {
  it('drops markup but keeps math recognisable', () => {
    expect(plainText(parseInline('A **force** of $F = ma$ [here](https://x.org)'))).toBe('A force of $F = ma$ here')
  })

  it('flag what does not belong in a text block, with a hint', () => {
    expect(checkInline('A **fine** paragraph with $x^2$ and [a link](https://x.org).')).toBeNull()
    expect(checkInline('# Title')).toMatch(/role to h1/)
    expect(checkInline('- item')).toMatch(/role to li/)
    expect(checkInline('<b>bold</b>')).toMatch(/No HTML/)
    expect(checkInline('a <span style="color:red">red</span> word')).toMatch(/No HTML/)
    expect(checkInline('<img src=x onerror=alert(1)>')).toMatch(/No HTML/)
    // Words in angle brackets are text, as in program code.
    expect(checkInline('`#include <iostream>` and std::vector<int> a <b, then x < y > z')).toBeNull()
    expect(checkInline('see ![pic](https://x.org/a.png)')).toMatch(/image block/)
    expect(checkInline('$$x$$')).toMatch(/math block/)
    expect(checkInline('[x]{color=pink}')).toMatch(/one of: ink, gray/)
    expect(checkInline('[x](javascript:alert)')).toMatch(/https/)
    expect(checkInline('one\n\ntwo')).toMatch(/two blocks/)
  })
})

// ----- properties ------------------------------------------------------------

// Pieces heavy in syntax, so random strings hit the awkward cases often.
const PIECES = [
  '*', '**', '_', '~', '~~', '=', '==', '`', '``', '$', '\\', '\\(', '\\)', '[', ']', '(', ')', '{', '}',
  '{color=red}', '{.b}', '{.i}', '](https://a.org)', ' ', '  ', 'a', 'b', 'x y', '1', '42', 'λ', '🍎', '\n', '.', ':',
]
const piecesString = fc.array(fc.constantFrom(...PIECES), { maxLength: 14 }).map((parts) => parts.join(''))

const { node } = fc.letrec<{ node: Inline }>((tie) => ({
  node: fc.oneof(
    { maxDepth: 4 },
    fc.record({ t: fc.constant('text' as const), v: piecesString }),
    fc.record({ t: fc.constant('code' as const), v: piecesString }),
    // Math holding "\)" right before a digit cannot be written in any form; leave that case out.
    fc.record({ t: fc.constant('math' as const), v: piecesString.filter((v) => !v.includes('\\)')) }),
    fc.record({ t: fc.constantFrom('b' as const, 'i' as const, 's' as const, 'hl' as const), c: fc.array(tie('node'), { maxLength: 3 }) }),
    fc.record({
      t: fc.constant('link' as const),
      href: fc.constantFrom('https://a.org', 'https://a.org/x_(y)', 'mailto:a@b.org', 'a b', ')(', ''),
      c: fc.array(tie('node'), { maxLength: 3 }),
    }),
    fc.record({ t: fc.constant('color' as const), color: fc.constantFrom('red' as const, 'blue' as const), c: fc.array(tie('node'), { maxLength: 3 }) }),
  ),
}))
const tree = fc.array(node, { maxLength: 5 })

describe('reading and writing md, on random input', () => {
  it('any string reads without error, and writing what was read reads back the same', () => {
    fc.assert(
      fc.property(piecesString, (md) => {
        const read = parseInline(md)
        expect(parseInline(serializeInline(read))).toEqual(read)
      }),
      { numRuns: 3000 },
    )
  })

  it('any tree, once written, reads back as its canonical form', () => {
    fc.assert(
      fc.property(tree, (nodes) => {
        expect(parseInline(serializeInline(nodes))).toEqual(normalize(nodes))
      }),
      { numRuns: 3000 },
    )
  })

  it('the canonical form is stable', () => {
    fc.assert(
      fc.property(tree, (nodes) => {
        expect(normalize(normalize(nodes))).toEqual(normalize(nodes))
      }),
      { numRuns: 1000 },
    )
  })
})
