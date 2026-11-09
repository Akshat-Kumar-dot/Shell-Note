// A person's own colours and fonts: any #rrggbb, on whole blocks and on
// words, and the fonts of the library bundled with the app. The AI keeps to
// the named colours and the four font styles (its operations are unchanged),
// and a note holds both.
import { describe, expect, it } from 'vitest'
import { apply, checkInline, FONT_LIBRARY, fontStyleOf, markRange, parseInline, serializeInline, toMarkdown } from '../src/index.js'
import { PHYSICS } from './fixtures/index.js'
import { expectError } from './helpers.js'

describe('a colour code in words', () => {
  it('is read in any case and written in lowercase', () => {
    const nodes = parseInline('A [warm]{color=#E0563A} word')
    expect(nodes).toEqual([
      { t: 'text', v: 'A ' },
      { t: 'color', color: '#e0563a', c: [{ t: 'text', v: 'warm' }] },
      { t: 'text', v: ' word' },
    ])
    expect(serializeInline(nodes)).toBe('A [warm]{color=#e0563a} word')
  })

  it('passes the content check in lowercase, and a malformed one does not', () => {
    expect(checkInline('A [warm]{color=#e0563a} word')).toBeNull()
    expect(checkInline('A [warm]{color=#E0563A} word')).toMatch(/Coloured words/)
    expect(checkInline('A [warm]{color=#e0563} word')).toMatch(/Coloured words/)
    expect(checkInline('A [warm]{color=teal} word')).toMatch(/Coloured words/)
  })

  it('is set on a range of words like a named colour', () => {
    expect(markRange('one two three', 4, 7, { color: '#2a9d8f' })).toBe('one [two]{color=#2a9d8f} three')
    expect(markRange('one [two]{color=#2a9d8f} three', 4, 7, { color: 'ink' })).toBe('one two three')
  })

  it('leaves no colour in a Markdown export, like a named colour', () => {
    const doc = apply(PHYSICS, [{ op: 'update', id: 't1', set: { md: 'Newton [laws]{color=#2a9d8f}' } }]).doc
    expect(toMarkdown(doc, { title: false }).markdown).toContain('## Newton laws')
  })
})

describe('a colour code on a block', () => {
  it('is a style colour, in lowercase only', () => {
    const doc = apply(PHYSICS, [{ op: 'update', id: 't2', set: { style: { color: '#2a9d8f' } } }]).doc
    expect(doc.block.t2).toMatchObject({ style: { color: '#2a9d8f' } })
    expectError(() => apply(PHYSICS, [{ op: 'update', id: 't2', set: { style: { color: '#2A9D8F' } } }]), 'bad_shape', /color/)
    expectError(() => apply(PHYSICS, [{ op: 'update', id: 't2', set: { style: { color: 'teal' } } }]), 'bad_shape', /color/)
  })
})

describe('fonts', () => {
  it('fall back to the style a library font resembles, or sans for one this app does not have', () => {
    expect(fontStyleOf('lora')).toBe('serif')
    expect(fontStyleOf('caveat')).toBe('hand')
    expect(fontStyleOf('mono')).toBe('mono')
    expect(fontStyleOf('a-font-from-the-future')).toBe('sans')
    expect(fontStyleOf(undefined)).toBe('sans')
  })

  it('are a style or a library id on a block; an unknown id is kept, so a newer note still opens', () => {
    const doc = apply(PHYSICS, [{ op: 'update', id: 't2', set: { style: { font: 'lora' } } }]).doc
    expect(doc.block.t2).toMatchObject({ style: { font: 'lora' } })
    expect(() => apply(PHYSICS, [{ op: 'update', id: 't2', set: { style: { font: 'a-font-from-the-future' } } }])).not.toThrow()
    expectError(() => apply(PHYSICS, [{ op: 'update', id: 't2', set: { style: { font: 'Comic Sans' } } }]), 'bad_shape', /font/)
    expect(FONT_LIBRARY.map((font) => font.id)).toHaveLength(15)
  })
})
