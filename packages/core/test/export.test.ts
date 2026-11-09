// Markdown and plain-text export. The snapshot files in __snapshots__/ were
// read and checked by hand.
import { describe, expect, it } from 'vitest'
import { apply, listNumbering, toMarkdown, toText, type Block, type Doc, type Op } from '../src/index.js'
import { EMPTY, FIXTURES, PHYSICS } from './fixtures/index.js'

const text = (id: string, role: string, md: string, indent = 0): Op => ({
  op: 'add',
  block: { id, r: 0, type: 'text', parent: 'e3', role, indent, md } as Block,
})
/** An empty document holding the given text blocks in its one frame. */
const doc = (...ops: Op[]): Doc => apply(EMPTY, ops).doc

describe('Markdown export', () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    it(`of ${name}`, async () => {
      await expect(toMarkdown(fixture).markdown).toMatchFileSnapshot(`./__snapshots__/export.${name}.md`)
    })
  }

  it('lists the image files the Markdown links to', () => {
    expect(toMarkdown(PHYSICS).files).toEqual({ 'assets/a91f.png': 'a91f' })
  })

  it('numbers ordered lists, and restarts after other blocks', () => {
    const md = toMarkdown(
      doc(text('a', 'oli', 'one'), text('b', 'oli', 'two'), text('c', 'oli', 'inner', 1), text('d', 'oli', 'three'), text('e', 'p', 'break'), text('f', 'oli', 'again')),
      { title: false },
    ).markdown
    expect(md).toBe('1. one\n2. two\n    1. inner\n3. three\n\nbreak\n\n1. again\n')
  })

  it('never starts a list deeper than one level below what came before', () => {
    // Four spaces before "-" after a paragraph would be read as a code block.
    expect(toMarkdown(doc(text('a', 'p', 'intro'), text('b', 'li', 'deep', 3)), { title: false }).markdown).toBe('intro\n\n- deep\n')
  })

  it('escapes text that would turn into a heading, list or quote', () => {
    const md = toMarkdown(doc(text('a', 'p', '# not a heading'), text('b', 'p', '1. not a list'), text('c', 'p', '> not a quote')), {
      title: false,
    }).markdown
    expect(md).toBe('\\# not a heading\n\n1\\. not a list\n\n\\> not a quote\n')
  })

  it('keeps prices, drops colours, and keeps line breaks inside a block', () => {
    expect(toMarkdown(doc(text('a', 'p', 'It costs $5 or $10, [really]{color=red}.')), { title: false }).markdown).toBe(
      'It costs $5 or $10, really.\n',
    )
    expect(toMarkdown(doc(text('a', 'li', 'first\nsecond')), { title: false }).markdown).toBe('- first\\\n  second\n')
  })
})

describe('list numbering, shared with the editor', () => {
  it('numbers as the exports do, block by block', () => {
    const numbering = listNumbering()
    const blocks = apply(EMPTY, [text('a', 'oli', 'one'), text('b', 'oli', 'inner', 1), text('c', 'oli', 'two'), text('d', 'li', 'bullet'), text('e', 'p', 'break')]).doc.block
    expect(['a', 'b', 'c', 'd', 'e'].map((id) => numbering.next(blocks[id]!))).toEqual([
      { kind: 'ordered', level: 0, number: 1, starts: true },
      { kind: 'ordered', level: 1, number: 1, starts: false },
      { kind: 'ordered', level: 0, number: 2, starts: false },
      // A switch from numbers to bullets starts a new list.
      { kind: 'bullet', level: 0, number: 0, starts: true },
      { kind: '', level: 0, number: 0, starts: false },
    ])
  })

  it('counts on through items at the same indent, however deep', () => {
    // Tab, then a numbered list: both items sit at indent 1 with nothing above them.
    const numbering = listNumbering()
    const blocks = apply(EMPTY, [text('a', 'oli', 'first', 1), text('b', 'oli', 'second', 1), text('c', 'oli', 'deeper', 3), text('d', 'oli', 'back', 2), text('e', 'oli', 'third', 1)]).doc.block
    expect(['a', 'b', 'c', 'd', 'e'].map((id) => numbering.next(blocks[id]!)).map(({ level, number }) => [level, number])).toEqual([
      [0, 1],
      [0, 2],
      // Deeper by two indents, but one level: never more than one at a time.
      [1, 1],
      // A different indent at that level is a new list there.
      [1, 1],
      [0, 3],
    ])
  })
})

describe('plain-text export', () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    it(`of ${name}`, async () => {
      await expect(toText(fixture)).toMatchFileSnapshot(`./__snapshots__/export.${name}.txt`)
    })
  }

  it('drops markup but keeps math recognisable', () => {
    expect(toText(doc(text('a', 'p', 'A **force** of $F = ma$.')), { title: false })).toBe('A force of $F = ma$.\n')
  })
})
