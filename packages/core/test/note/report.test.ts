// The change report (note control, step 1, 21 October 2026): after a block of lines, what changed in the note, so
// the model sees what its lines did, rather than predicting it.
import { describe, expect, it } from 'vitest'
import { apply } from '../../src/apply.js'
import { changeReport } from '../../src/note/report.js'
import { MIXED } from '../fixtures/index.js'

describe('the change report', () => {
  it('says nothing when nothing changed', () => {
    expect(changeReport(MIXED, MIXED)).toBeUndefined()
  })

  it('names a new block by what it is, its first words and where it went, and a removed one', () => {
    const after = apply(MIXED, [
      { op: 'add', block: { id: 'hn', r: 0, type: 'text', parent: 'fa', role: 'h2', indent: 0, md: 'Summary of the waves chapter' }, at: 3 },
      { op: 'remove', id: 'tk' },
    ]).doc
    const report = changeReport(MIXED, after)!
    expect(report).toContain('hn new: heading, level 2 “Summary of the waves chapter”, page 1, in the left column')
    expect(report).toContain('tk removed')
    expect(report.startsWith('changed: ')).toBe(true)
  })

  it('says what a change did to its words, and what the page did to other blocks: pushed down, onto the next page', () => {
    const after = apply(MIXED, [{ op: 'update', id: 'p2', set: { md: 'The lab kit is free this year.' } }]).doc
    const drawnBefore = new Map([
      ['qt', { x: 2000, y: 10600, w: 8250, h: 560, page: MIXED.pages[0]! }],
      ['tk', { x: 2000, y: 9980, w: 8250, h: 560, page: MIXED.pages[0]! }],
    ])
    const drawnAfter = new Map([
      ['qt', { x: 2000, y: 12400, w: 8250, h: 560, page: MIXED.pages[0]! }],
      ['tk', { x: 2000, y: 2000, w: 8250, h: 560, page: MIXED.pages[1]! }],
    ])
    const report = changeReport(MIXED, after, drawnBefore, drawnAfter)!
    expect(report).toContain('p2 changed: “The lab kit is free this year.”')
    expect(report).toContain('qt pushed down 18 mm')
    expect(report).toContain('tk now on page 2')
  })

  it('warns of a new overlap, and says when one is gone', () => {
    const page = MIXED.pages[0]!
    const mf = MIXED.block.mf as unknown as { x: number; y: number }
    const over = apply(MIXED, [{ op: 'add', block: { id: 'zz', r: 0, type: 'math', page, x: mf.x, y: mf.y, w: 3000, h: 1000, tex: 'E = mc^2' } }]).doc
    expect(changeReport(MIXED, over)).toContain('⚠ mf overlaps zz now')
    expect(changeReport(over, MIXED)).toContain('mf no longer overlaps zz')
  })
})
