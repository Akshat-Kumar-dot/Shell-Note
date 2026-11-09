// Phase 0 exit check: outline and linearise of the fixtures match snapshots.
// The snapshot files in __snapshots__/ were read and checked by hand.
import { describe, expect, it } from 'vitest'
import { apply, linearise, outline, type Block } from '../src/index.js'
import { FIXTURES, MIXED, PHYSICS } from './fixtures/index.js'

describe('linearise', () => {
  for (const [name, doc] of Object.entries(FIXTURES)) {
    it(`gives the reading order of ${name}`, async () => {
      const order = linearise(doc).map(({ page, block, depth }) => `${page} ${'  '.repeat(depth)}${block.id}`)
      await expect(order.join('\n') + '\n').toMatchFileSnapshot(`./__snapshots__/linearise.${name}.txt`)
    })
  }

  it('reads two columns side by side left to right, then down the page', () => {
    const order = linearise(MIXED, { page: 'w1' })
      .filter((item) => item.depth === 0)
      .map((item) => item.block.id)
    expect(order).toEqual(['fa', 'fb', 'mf', 'df', 'kk'])
  })

  it('follows position, not the stacking order', () => {
    // Move the image above the frame: it now comes first.
    const moved = apply(PHYSICS, [{ op: 'move', id: 'g1', to: { page: 'p1', x: 11000, y: 500 } }]).doc
    expect(linearise(moved).map((item) => item.block.id)).toEqual(['g1', 'f1', 't1', 't2', 'm1', 'k1'])
  })
})

describe('outline', () => {
  for (const [name, doc] of Object.entries(FIXTURES)) {
    it(`of ${name}`, async () => {
      await expect(outline(doc) + '\n').toMatchFileSnapshot(`./__snapshots__/outline.${name}.txt`)
    })
  }

  it('can show one page, with fewer words', () => {
    expect(outline(MIXED, { page: 'w2', words: 3 })).toBe(
      ['Chapter 3: Waves', 'page 2/3 w2', 'fc frame', '  c1 p Continued from the…', 'gi image Ripple tank photo'].join('\n'),
    )
  })

  it('stays one line per block, whatever the text holds', () => {
    const block = { id: 't9', r: 0, type: 'text', parent: 'f1', role: 'p', indent: 0, md: 'two\nlines' } as Block
    const doc = apply(PHYSICS, [{ op: 'add', block }]).doc
    expect(outline(doc)).toContain('  t9 p two lines')
  })
})
