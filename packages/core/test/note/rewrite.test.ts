// Rewriting by diff (note control, step 2, piece 5): only what changed changes; the words that stayed keep
// their marks, the blocks that stayed their ids.
import { describe, expect, it } from 'vitest'
import { apply } from '../../src/apply.js'
import { idTaken } from '../../src/ids.js'
import { parseInline, plainText } from '../../src/markdown/inline.js'
import { rewriteBlocks, rewriteMd } from '../../src/note/rewrite.js'
import type { Doc } from '../../src/schema/doc.js'
import { MIXED, PHYSICS } from '../fixtures/index.js'

describe("a block's words rewritten", () => {
  it('keeps the marks of the words that stayed, and the block byte for byte when nothing changed', () => {
    expect(rewriteMd('**The lab kit** costs $5, or $10 with the stand.', 'The lab kit costs $6, or $12 with the stand.')).toBe('**The lab kit** costs $6, or $12 with the stand.')
    const same = 'A *wave* carries **energy**, not matter.'
    expect(rewriteMd(same, 'A wave carries energy, not matter.')).toBe(same)
  })

  it('gives a word changed inside a marked phrase the phrase\'s marks, and a word written with marks its own', () => {
    expect(rewriteMd('A **very big wave** here', 'A very large wave here')).toBe('A **very large wave** here')
    expect(rewriteMd('plain words', 'plain **words**')).toBe('plain **words**')
    // At a phrase's edge a new word stays plain: the words on its two sides do not agree.
    expect(rewriteMd('**Bold** end', 'Bold new end')).toBe('**Bold** new end')
  })

  it('leaves every text block of the two sample notes as it was, given its own words in plain', () => {
    for (const doc of [MIXED, PHYSICS]) {
      for (const block of Object.values(doc.block)) {
        if (block.type !== 'text') continue
        expect(rewriteMd(block.md, plainText(parseInline(block.md))), `${block.id}: ${block.md}`).toBe(block.md)
      }
    }
  })

  it('never gives new words or spaces the marks of words far away (Gemma 4 E4B, the note check of 24 October 2026)', () => {
    const p1 = MIXED.block.p1
    const old = p1?.type === 'text' ? p1.md : ''
    const md = rewriteMd(old, 'Waves carry energy, not matter. The relationship between period (T) and frequency (f) is f=1/T, and speed (v), frequency, and wavelength ($\\lambda$) are related by v = f$\\lambda$.')
    // Only "energy" was a marked word that stayed: no link, colour or code is left on anything else.
    expect(md).toBe('Waves carry *energy*, not matter. The relationship between period (T) and frequency (f) is f=1/T, and speed (v), frequency, and wavelength ($\\lambda$) are related by v = f$\\lambda$.')
  })

  it('keeps a formula as it was', () => {
    const md = rewriteMd('Area $\\pi r^2$ grows', 'Area $\\pi r^2$ grows fast')
    expect(md).toBe('Area $\\pi r^2$ grows fast')
  })
})

describe('blocks rewritten together', () => {
  const list = ['l1', 'l2', 'l3']
  const run = (parts: string[]): { doc: Doc; result: ReturnType<typeof rewriteBlocks> } => {
    const result = rewriteBlocks(MIXED, list, parts, (id) => idTaken(MIXED, id))
    return { doc: apply(MIXED, result.ops).doc, result }
  }
  /** The frame's list items (role li), in order. */
  const items = (doc: Doc): string[] =>
    (doc.block.fa as { kids: string[] }).kids.map((id) => doc.block[id] as { role?: string; md?: string }).filter((block) => block.role === 'li').map((block) => block.md!)

  it('keeps those that stayed, changes one that changed, by its id', () => {
    const { doc, result } = run(['Transverse waves', 'Sound', 'Longitudinal waves'])
    expect(result).toMatchObject({ kept: ['l1', 'l3'], changed: ['l2'], removed: [], made: [] })
    expect(result.ops).toEqual([{ op: 'update', id: 'l2', set: { md: 'Sound' } }])
    expect((doc.block.l2 as { md: string }).md).toBe('Sound')
  })

  it('adds a new one after the one before it, with its role and indent, and removes one that went', () => {
    const added = run(['Transverse waves', 'Light', 'Surface waves', 'Longitudinal waves'])
    expect(added.result.made).toHaveLength(1)
    // After "Light", an item one level in: the new one is too.
    expect(added.doc.block[added.result.made[0]!]).toMatchObject({ type: 'text', role: 'li', indent: 1, md: 'Surface waves', parent: 'fa' })
    expect(items(added.doc)).toEqual(['Transverse waves', 'Light', 'Surface waves', 'Longitudinal waves'])
    const removed = run(['Transverse waves', 'Longitudinal waves'])
    expect(removed.result).toMatchObject({ kept: ['l1', 'l3'], removed: ['l2'] })
    expect(removed.doc.block.l2).toBeUndefined()
  })

  it('puts a new first one where the first was, even when that one went', () => {
    const { doc, result } = run(['Longitudinal waves', 'Transverse waves', 'Light'])
    expect(result.removed).toEqual(['l3'])
    expect(items(doc)).toEqual(['Longitudinal waves', 'Transverse waves', 'Light', 'Wavelength λ'].slice(0, 3))
    const replaced = rewriteBlocks(MIXED, ['l1'], ['Standing waves', 'Travelling waves'], (id) => idTaken(MIXED, id))
    const after = apply(MIXED, replaced.ops).doc
    expect(replaced.changed).toEqual(['l1'])
    expect((after.block.fa as { kids: string[] }).kids.indexOf(replaced.made[0]!)).toBe((after.block.fa as { kids: string[] }).kids.indexOf('l1') + 1)
  })

  it('changes a role or an indent given for a part, the words the same', () => {
    const result = rewriteBlocks(MIXED, list, ['Transverse waves', 'Light', 'Longitudinal waves'], (id) => idTaken(MIXED, id), (() => ({ role: 'li', indent: 0 })))
    // "Light" was one level in: now level with the others.
    expect(result.ops).toEqual([{ op: 'update', id: 'l2', set: { indent: 0 } }])
  })

  it('refuses blocks that are not text, or not in one frame', () => {
    expect(() => rewriteBlocks(MIXED, ['mc'], ['x'], () => false)).toThrow('Only text blocks are rewritten')
    expect(() => rewriteBlocks(MIXED, ['l1', 'b1'], ['x', 'y'], () => false)).toThrow('in one text frame')
  })
})
