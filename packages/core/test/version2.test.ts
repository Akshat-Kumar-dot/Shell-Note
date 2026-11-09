// The file format's version 2: words may be underlined, written small below or
// above the line, or given their own size or font, in Pandoc's span form.
// Version 1 files open with every word reading as it did; text that only looks
// like a new span stays text. Older apps refuse version 2 files with "Update
// the app".
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  apply,
  checkInline,
  exportMarkdown,
  markRange,
  migrate,
  pack,
  parseDoc,
  parseInline,
  plainText,
  SCHEMA_VERSION,
  serializeInline,
  toMarkdown,
  toText,
  unpack,
  type Block,
  type Doc,
} from '../src/index.js'
import { upgradeMd } from '../src/schema/migrate.js'
import { Namer, planTransaction, transactions } from './arbitraries.js'
import { FIXTURES, PHYSICS } from './fixtures/index.js'
import { expectError } from './helpers.js'

describe('words in version 2', () => {
  it('read and write underline, subscript, superscript, and a size or font on words', () => {
    const cases: [string, unknown][] = [
      ['[words]{.underline}', [{ t: 'u', c: [{ t: 'text', v: 'words' }] }]],
      ['H[2]{.sub}O', [{ t: 'text', v: 'H' }, { t: 'sub', c: [{ t: 'text', v: '2' }] }, { t: 'text', v: 'O' }]],
      ['x[2]{.sup}', [{ t: 'text', v: 'x' }, { t: 'sup', c: [{ t: 'text', v: '2' }] }]],
      ['[big]{size=l}', [{ t: 'size', size: 'l', c: [{ t: 'text', v: 'big' }] }]],
      ['[nice]{font=lora}', [{ t: 'font', font: 'lora', c: [{ t: 'text', v: 'nice' }] }]],
    ]
    for (const [md, tree] of cases) {
      expect(parseInline(md)).toEqual(tree)
      expect(serializeInline(parseInline(md))).toBe(md)
    }
    // Marks nest inside the new spans, and the other way round.
    expect(serializeInline(parseInline('[**bold**]{.underline}'))).toBe('**[bold]{.underline}**')
    expect(serializeInline(parseInline('[[x]{.sub}]{color=red}'))).toBe('[[x]{.sub}]{color=red}')
  })

  it('are plain text to the grammar of version 1, as an app of version 1 read them', () => {
    expect(parseInline('[words]{.underline}', { version: 1 })).toEqual([{ t: 'text', v: '[words]{.underline}' }])
    expect(parseInline('[big]{size=l}', { version: 1 })).toEqual([{ t: 'text', v: '[big]{size=l}' }])
    // The spans version 1 knew read the same in both.
    expect(parseInline('[x]{.b} [y]{color=red}', { version: 1 })).toEqual(parseInline('[x]{.b} [y]{color=red}'))
  })

  it('a size or font has to be one a block could take; anything else stays text', () => {
    expect(plainText(parseInline('[x]{size=huge}'))).toBe('[x]{size=huge}')
    expect(plainText(parseInline('[x]{font=Not A Font}'))).toBe('[x]{font=Not A Font}')
  })

  it('are put on and taken off a range of words; subscript and superscript exclude each other, as in Word', () => {
    expect(markRange('one two three', 4, 7, { underline: true })).toBe('one [two]{.underline} three')
    expect(markRange('H2O', 1, 2, { sub: true })).toBe('H[2]{.sub}O')
    expect(markRange('H[2]{.sub}O', 1, 2, { sup: true })).toBe('H[2]{.sup}O')
    expect(markRange('one two', 4, 7, { size: 'xl' })).toBe('one [two]{size=xl}')
    expect(markRange('one [two]{size=xl}', 4, 7, { size: null })).toBe('one two')
    expect(markRange('one two', 0, 3, { font: 'serif' })).toBe('[one]{font=serif} two')
  })

  it('pass the content check, which still refuses spans it does not know', () => {
    for (const md of ['[a]{.underline}', 'H[2]{.sub}O', 'x[2]{.sup}', '[a]{size=s}', '[a]{font=fira-code}']) expect(checkInline(md)).toBeNull()
    expect(checkInline('[a]{.blink}')).not.toBeNull()
    expect(checkInline('[a]{size=huge}')).not.toBeNull()
  })
})

describe('exports of the new marks', () => {
  it('Markdown writes <u>, <sub> and <sup>, and keeps the words of sizes, fonts and colours', () => {
    expect(exportMarkdown('one [two]{.underline} three')).toBe('one <u>two</u> three')
    expect(exportMarkdown('H[2]{.sub}O and x[2]{.sup}')).toBe('H<sub>2</sub>O and x<sup>2</sup>')
    expect(exportMarkdown('[big]{size=l} [nice]{font=lora} [red]{color=red}')).toBe('big nice red')
    expect(exportMarkdown('[**bold**]{.underline}')).toBe('**<u>bold</u>**')
    // An HTML-like word typed in the text stays text.
    expect(exportMarkdown('[a <u> tag]{.underline}')).toBe('<u>a \\<u> tag</u>')
  })

  it('plain text writes the words alone', () => {
    const doc = apply(PHYSICS, [{ op: 'update', id: 't2', set: { md: 'H[2]{.sub}O is [water]{.underline}, [big]{size=l}' } }]).doc
    expect(toText(doc)).toContain('H2O is water, big')
    expect(toMarkdown(doc).markdown).toContain('H<sub>2</sub>O is <u>water</u>, big')
  })
})

/** A version 1 document: the same blocks, with version 1's number. */
function asVersion1(doc: Doc, md: (block: Block) => string | undefined): Record<string, unknown> {
  const raw = structuredClone(doc) as unknown as Record<string, unknown> & { block: Record<string, Record<string, unknown>> }
  raw.v = 1
  for (const block of Object.values(raw.block)) {
    const words = md(block as unknown as Block)
    if (words === undefined) continue
    if (block.type === 'text') block.md = words
    if (block.type === 'image' || block.type === 'table') block.caption = words
    if (block.type === 'table') block.rows = (block.rows as string[][]).map((row) => row.map(() => words))
  }
  return raw
}

/** Pieces of text a version 1 file may hold: spans version 1 knew, look-alikes of version 2's, escapes and plain words. */
const piece = fc.constantFrom(
  '[words]{.underline}',
  '[2]{.sup}',
  'H[2]{.sub}O',
  '[big]{size=l}',
  '[nice]{font=lora}',
  '[bold]{.b}',
  '**b**',
  '[c]{color=red}',
  '\\[esc\\]{.sub}',
  ' $x$ ',
  '`code`',
  'plain words ',
)
const v1Text = fc.array(fc.oneof(piece, fc.string({ unit: 'grapheme', maxLength: 6 })), { maxLength: 6 }).map((parts) => parts.join(''))

describe('a version 1 file in version 2', () => {
  it('opens with every word as it read before: look-alikes stay text, and other text keeps its form', () => {
    const raw = asVersion1(PHYSICS, (block) => (block.type === 'text' ? 'see [words]{.underline}, [2]{.sup} and [x]{.b}' : undefined))
    const doc = parseDoc(raw)
    expect(doc.v).toBe(SCHEMA_VERSION)
    const md = (doc.block.t2 as { md: string }).md
    expect(plainText(parseInline(md))).toBe('see [words]{.underline}, [2]{.sup} and x')
    expect(parseInline(md)).toEqual(parseInline('see [words]{.underline}, [2]{.sup} and [x]{.b}', { version: 1 }))
    // Text with no look-alike keeps its own form, even one version 2 would write another way.
    expect(upgradeMd('[x]{.b} and **y**')).toBe('[x]{.b} and **y**')
  })

  it('random version 1 text reads the same in version 2', () => {
    fc.assert(
      fc.property(v1Text, (md) => {
        const upgraded = upgradeMd(md) as string
        expect(parseInline(upgraded)).toEqual(parseInline(md, { version: 1 }))
        // Moved once, it is version 2 text: moving it again changes nothing.
        expect(upgradeMd(upgraded)).toBe(upgraded)
      }),
      { numRuns: 400 },
    )
  })

  it('random version 1 documents move to version 2 and read back unchanged', () => {
    fc.assert(
      fc.property(fc.constantFrom(...Object.values(FIXTURES)), transactions, v1Text, (start, plan, words) => {
        const namer = new Namer()
        let doc = start
        for (const seeds of plan) {
          const { ops } = planTransaction(namer, doc, seeds)
          if (ops.length > 0) doc = apply(doc, ops).doc
        }
        const raw = asVersion1(doc, () => words)
        const moved = parseDoc(raw)
        const v1Words = parseInline(words, { version: 1 })
        for (const [id, block] of Object.entries(moved.block)) {
          const was = (raw.block as Record<string, Record<string, unknown>>)[id]!
          if (block.type === 'text') expect(parseInline(block.md)).toEqual(v1Words)
          if ((block.type === 'image' || block.type === 'table') && block.caption !== undefined) expect(parseInline(block.caption)).toEqual(v1Words)
          if (block.type === 'table') for (const row of block.rows) for (const cell of row) expect(parseInline(cell)).toEqual(v1Words)
          // Everything else is exactly as it was.
          const rest = (b: Record<string, unknown>): Record<string, unknown> => {
            const copy = { ...b }
            delete copy.md
            delete copy.caption
            delete copy.rows
            return copy
          }
          expect(rest(block as unknown as Record<string, unknown>)).toEqual(rest(was))
        }
        expect({ ...moved, block: undefined, v: undefined }).toEqual({ ...raw, block: undefined, v: undefined })
      }),
      { numRuns: 120 },
    )
  })

  it('an older app refuses a version 2 file with "Update the app"', () => {
    // What an app of version 1 does with a file of version 2, here one version on.
    expectError(() => migrate({ ...structuredClone(PHYSICS), v: SCHEMA_VERSION + 1 }), 'too_new', /Update the app/)
  })
})

describe('version 2 save and open', () => {
  const v2Words = fc
    .array(fc.constantFrom('[u]{.underline}', 'H[2]{.sub}O', 'x[2]{.sup}', '[big]{size=xl}', '[nice]{font=lora}', '[**b**]{.underline}', 'words ', '[r]{color=#e0563a}'), { maxLength: 5 })
    .map((parts) => serializeInline(parseInline(parts.join(''))))

  it('gives back randomly edited documents with the new marks exactly', () => {
    fc.assert(
      fc.property(fc.constantFrom(...Object.values(FIXTURES)), transactions, v2Words, (start, plan, words) => {
        const namer = new Namer()
        let doc = start
        for (const seeds of plan) {
          const { ops } = planTransaction(namer, doc, seeds)
          if (ops.length > 0) doc = apply(doc, ops).doc
        }
        const texts = Object.values(doc.block).filter((b) => b.type === 'text')
        if (texts.length > 0) doc = apply(doc, texts.map((b) => ({ op: 'update' as const, id: b.id, set: { md: words } }))).doc
        const images = Object.fromEntries(Object.keys(doc.asset).map((hash, i) => [hash, new Uint8Array([i, hash.length])]))
        expect(unpack(pack(doc, images)).doc).toStrictEqual(doc)
      }),
      { numRuns: 150 },
    )
  })
})
