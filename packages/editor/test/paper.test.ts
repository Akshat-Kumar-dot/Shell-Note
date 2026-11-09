// The paper a page is drawn on, chosen from the toolbar.
import { apply, createDoc } from '@shellnote/core'
import { describe, expect, it } from 'vitest'
import { MIXED } from '../../core/test/fixtures/index.js'
import { paperOps, PAPERS } from '../src/index.js'

describe('paper', () => {
  it('offers the four kinds the document has', () => {
    expect(PAPERS.map(([paper]) => paper)).toEqual(['blank', 'ruled', 'grid', 'dots'])
  })

  it('changes the pages given, as one step that undo takes back, and leaves pages already on that paper alone', () => {
    const ops = paperOps(MIXED, MIXED.pages, 'grid')
    const done = apply(MIXED, ops)
    expect(MIXED.pages.map((id) => done.doc.page[id]!.bg)).toEqual(['grid', 'grid', 'grid'])
    expect(MIXED.pages.map((id) => apply(done.doc, done.inverse).doc.page[id]!.bg)).toEqual(MIXED.pages.map((id) => MIXED.page[id]!.bg))
    const fresh = createDoc()
    expect(paperOps(fresh, fresh.pages, 'blank')).toEqual([])
    expect(paperOps(fresh, ['nope'], 'dots')).toEqual([])
  })
})
