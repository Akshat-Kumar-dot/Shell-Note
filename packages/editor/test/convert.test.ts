// A frame through the editor and back: opening a frame and reading it again
// must change nothing, so typing in one block never touches the others.
import { apply, frameOps, type ChildBlock, type ChildDraft, type Doc } from '@shellnote/core'
import { getSchema } from '@tiptap/core'
import { EditorState, TextSelection, type Command } from '@tiptap/pm/state'
import { addColumnAfter, deleteColumn } from '@tiptap/pm/tables'
import { describe, expect, it } from 'vitest'
import { FIXTURES, MIXED, PHYSICS } from '../../core/test/fixtures/index.js'
import { blockJSON, draftsOf, frameJSON, keepForms } from '../src/frame/convert.js'
import { frameExtensions } from '../src/frame/schema.js'

const schema = getSchema(frameExtensions({ takenElsewhere: () => false, newId: () => 'unused', assetUrl: () => undefined, asset: () => undefined }))

describe('a frame in the editor', () => {
  for (const [name, doc] of Object.entries(FIXTURES)) {
    it(`reads back as exactly what core holds: ${name}`, () => {
      for (const block of Object.values(doc.block)) {
        if (block.type !== 'frame') continue
        const editor = schema.nodeFromJSON(frameJSON(doc, block.id))
        expect(frameOps(doc, block.id, keepForms(draftsOf(editor), doc)), block.id).toEqual([])
      }
    })
  }

  it('draws a link a note may not hold as plain words, and keeps its address in the note as written', () => {
    const md = '[run](javascript:alert(1)) and [read](https://example.com/page)'
    const doc: Doc = { ...PHYSICS, block: { ...PHYSICS.block, t1: { ...(PHYSICS.block.t1 as ChildBlock), md } as ChildBlock } }
    const editor = schema.nodeFromJSON(frameJSON(doc, 'f1'))
    expect(draftsOf(editor)[0]).toMatchObject({ md })
    const drawn = (href: string) => schema.marks.link!.spec.toDOM!(schema.marks.link!.create({ href }), true)
    expect(drawn('javascript:alert(1)')).toEqual(['span', 0])
    expect(drawn('data:text/html,<b>x</b>')).toEqual(['span', 0])
    expect(drawn('https://example.com/page')).toEqual(['a', { href: 'https://example.com/page', target: '_blank', rel: 'noopener noreferrer' }, 0])
  })

  it('reads the marks of file format version 2 back exactly: underline, subscript, superscript, ink, size and font', () => {
    const md = 'H[2]{.sub}O, x[2]{.sup}, [under]{.underline}, [big]{size=l} [serif]{font=serif} [lora]{font=lora} [ink]{color=ink} [**all**]{size=xl}'
    const doc: Doc = { ...PHYSICS, block: { ...PHYSICS.block, t1: { ...(PHYSICS.block.t1 as ChildBlock), md } as ChildBlock } }
    const editor = schema.nodeFromJSON(frameJSON(doc, 'f1'))
    expect(draftsOf(editor)[0]).toMatchObject({ md })
    expect(frameOps(doc, 'f1', keepForms(draftsOf(editor), doc))).toEqual([])
  })

  it("keeps core's words for a block that looks the same, and takes the editor's once it changes", () => {
    const doc: Doc = { ...PHYSICS, block: { ...PHYSICS.block, t1: { ...(PHYSICS.block.t1 as ChildBlock), md: 'A [span]{.b} form' } as ChildBlock } }
    const read = draftsOf(schema.nodeFromJSON(frameJSON(doc, 'f1')))
    // The editor writes **span**, but the block looks the same, so core's form stays.
    expect(read[0]).toMatchObject({ md: 'A **span** form' })
    expect(keepForms(read, doc)[0]).toMatchObject({ md: 'A [span]{.b} form' })
    const changed = draftsOf(schema.nodeFromJSON({ type: 'doc', content: [blockJSON({ ...(doc.block.t1 as ChildBlock), md: 'A **spans** form' } as ChildBlock)] }))
    expect(keepForms(changed, doc)[0]).toMatchObject({ md: 'A **spans** form' })
  })

  it("reads a table back as written, header and caption too, keeping core's form of each cell", () => {
    const table = { id: 'tb', r: 0, type: 'table', parent: 'f1', rows: [['A', '[b]{.b}'], ['1', '']], head: true, caption: 'Ages' } as ChildBlock
    const doc = apply(PHYSICS, [{ op: 'add', block: table }]).doc
    const read = draftsOf(schema.nodeFromJSON(frameJSON(doc, 'f1')))
    expect(read.at(-1)).toEqual({ id: 'tb', type: 'table', rows: [['A', '**b**'], ['1', '']], head: true, caption: 'Ages' })
    expect(frameOps(doc, 'f1', keepForms(read, doc))).toEqual([])
  })

  it("reads a table's column widths, width and look back as written", () => {
    const table = { id: 'tb', r: 0, type: 'table', parent: 'f1', rows: [['A', 'B'], ['1', '2']], cols: [700, 300], width: 600, look: 'banded' } as ChildBlock
    const doc = apply(PHYSICS, [{ op: 'add', block: table }]).doc
    const read = draftsOf(schema.nodeFromJSON(frameJSON(doc, 'f1')))
    expect(read.at(-1)).toEqual({ id: 'tb', type: 'table', rows: [['A', 'B'], ['1', '2']], cols: [700, 300], width: 600, look: 'banded' })
    expect(frameOps(doc, 'f1', keepForms(read, doc))).toEqual([])
  })

  it('keeps the other columns’ widths when a column is added or taken away, the new one getting the average', () => {
    const table = { id: 'tb', r: 0, type: 'table', parent: 'f1', rows: [['A', 'B'], ['1', '2']], cols: [700, 300] } as ChildBlock
    const doc = apply(PHYSICS, [{ op: 'add', block: table }]).doc
    const state = EditorState.create({ doc: schema.nodeFromJSON(frameJSON(doc, 'f1')) })
    let cell = 0
    state.doc.descendants((node, pos) => {
      if (cell === 0 && node.type.name === 'tableCell') cell = pos + 1
    })
    const inA = state.apply(state.tr.setSelection(TextSelection.create(state.doc, cell)))
    const after = (command: Command): ChildDraft | undefined => {
      let next = inA
      command(inA, (tr) => (next = inA.apply(tr)))
      return draftsOf(next.doc).find((draft) => draft.id === 'tb')
    }
    // 700, then the new column at the average of 700 and 300, then 300: as shares of 1500.
    expect(after(addColumnAfter)).toMatchObject({ rows: [['A', '', 'B'], ['1', '', '2']], cols: [467, 333, 200] })
    expect(after(deleteColumn)).toMatchObject({ rows: [['B'], ['2']], cols: [1000] })
  })

  it("gives a merged cell's words to its first spot, as core keeps one cell per spot", () => {
    const words = (text: string) => [{ type: 'text', text }]
    const pasted = schema.nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'tableBlock',
          attrs: { id: 'tb' },
          content: [
            {
              type: 'table',
              content: [
                { type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 2 }, content: words('wide') }] },
                { type: 'tableRow', content: [{ type: 'tableCell', content: words('a') }, { type: 'tableCell', content: words('b') }] },
              ],
            },
            { type: 'tableCaption' },
          ],
        },
      ],
    })
    expect(draftsOf(pasted)).toEqual([{ id: 'tb', type: 'table', rows: [['wide', ''], ['a', 'b']] }])
  })

  it("reads a picture's caption back as written, keeping core's form of it", () => {
    const doc: Doc = { ...MIXED, block: { ...MIXED.block, ic: { ...(MIXED.block.ic as ChildBlock), caption: 'One [period]{.b}' } as ChildBlock } }
    const read = draftsOf(schema.nodeFromJSON(frameJSON(doc, 'fa')))
    expect(read.find((draft) => draft.id === 'ic')).toMatchObject({ type: 'image', alt: 'Sine wave with the period marked', caption: 'One **period**' })
    expect(frameOps(doc, 'fa', keepForms(read, doc))).toEqual([])
  })
})
