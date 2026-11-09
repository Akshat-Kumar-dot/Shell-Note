// Tables: a block of rows of cells, written and read as Markdown pipe tables.
import { describe, expect, it } from 'vitest'
import { apply, checkInline, columnShares, createDoc, equalShares, frameOps, outline, parsePipeTable, pipeTable, toMarkdown, toText, type Block, type ChildDraft, type Doc, type Frame } from '../src/index.js'
import { blockLine } from '../src/ai/context.js'
import { expectError } from './helpers.js'

/** A new note whose frame holds one table. */
function withTable(table: Record<string, unknown> = {}): { doc: Doc; frame: string } {
  const doc = createDoc()
  const frame = doc.page[doc.pages[0]!]!.free[0]!
  const block = { id: 'tb', r: 0, type: 'table', parent: frame, rows: [['Name', 'Age'], ['Ann', '31']], head: true, ...table } as Block
  return { doc: apply(doc, [{ op: 'add', block }]).doc, frame }
}

describe('reading a Markdown pipe table', () => {
  it('takes the line of dashes as the mark of a header row', () => {
    expect(parsePipeTable('| Name | Age |\n| --- | :-: |\n| Ann | 31 |\n| Bo | 4 |')).toEqual({
      rows: [
        ['Name', 'Age'],
        ['Ann', '31'],
        ['Bo', '4'],
      ],
      head: true,
    })
    // The outer pipes may be left out when there is a header line.
    expect(parsePipeTable('a | b\n--|--\n1 | 2')).toEqual({ rows: [['a', 'b'], ['1', '2']], head: true })
  })

  it('reads a table without a header when every line starts and ends with a pipe', () => {
    expect(parsePipeTable('| a | b |\n| c | d |')).toEqual({ rows: [['a', 'b'], ['c', 'd']], head: false })
  })

  it('keeps formatting and escaped pipes in cells, and pads short rows', () => {
    expect(parsePipeTable('| **x** | `a\\|b` |\n|---|---|\n| y |')).toEqual({ rows: [['**x**', '`a|b`'], ['y', '']], head: true })
  })

  it('is not fooled by text that merely holds a pipe', () => {
    expect(parsePipeTable('either | or')).toBeUndefined()
    expect(parsePipeTable('a | b\nc | d')).toBeUndefined()
    expect(parsePipeTable('| one line |')).toBeUndefined()
    expect(parsePipeTable('| a |\n\n| b |')).toBeUndefined()
  })
})

describe('writing a pipe table', () => {
  it('reads back as written', () => {
    const rows = [
      ['Name', 'a|b'],
      ['**Ann**', ''],
    ]
    expect(pipeTable(rows, true)).toBe('| Name | a\\|b |\n| --- | --- |\n| **Ann** |  |')
    expect(parsePipeTable(pipeTable(rows, true))).toEqual({ rows, head: true })
  })

  it('gives a table without a header an empty one, since Markdown needs one', () => {
    expect(pipeTable([['a', 'b']], false)).toBe('|  |  |\n| --- | --- |\n| a | b |')
  })
})

describe('a table block', () => {
  it('sits in a frame, with rows of equal length, each cell on one line', () => {
    const { doc, frame } = withTable()
    expect((doc.block[frame] as Frame).kids).toEqual(['tb'])
    const page = doc.pages[0]!
    const loose = { id: 't2', r: 0, type: 'table', page, x: 0, y: 0, w: 100, h: 100, rows: [['a']] } as unknown as Block
    expectError(() => apply(doc, [{ op: 'add', block: loose }]), 'bad_shape', /sit inside a frame/)
    expectError(() => apply(doc, [{ op: 'update', id: 'tb', set: { rows: [['a', 'b'], ['c']] } }]), 'bad_shape', /same number of cells/)
    expectError(() => apply(doc, [{ op: 'update', id: 'tb', set: { rows: [['a\nb']] } }]), 'bad_shape', /no line breaks/)
    expectError(() => apply(doc, [{ op: 'update', id: 'tb', set: { rows: [] } }]), 'bad_shape', /at least one row/)
  })

  it('has its cells checked like a text block, naming the cell', () => {
    const { doc } = withTable()
    expectError(
      () => apply(doc, [{ op: 'update', id: 'tb', set: { rows: [['ok', '# no']] } }], { validators: { md: checkInline } }),
      'content',
      /row 1, cell 2: Headings are a block role/,
    )
  })

  it('takes a caption by splices, and undo puts the cells back', () => {
    const { doc } = withTable()
    const edited = apply(doc, [
      { op: 'update', id: 'tb', set: { rows: [['Name', 'Age'], ['Ann', '32']], head: null } },
      { op: 'splice', id: 'tb', field: 'caption', at: 0, del: 0, ins: 'Ages in **2026**' },
    ])
    expect(edited.doc.block.tb).toMatchObject({ rows: [['Name', 'Age'], ['Ann', '32']], caption: 'Ages in **2026**' })
    expect(edited.doc.block.tb).not.toHaveProperty('head')
    // Undo is a change of its own, so only r differs.
    expect(apply(edited.doc, edited.inverse).doc.block.tb).toEqual({ ...doc.block.tb, r: expect.any(Number) })
  })

  it('comes from an editor as an update of its cells and header, and a splice of its caption', () => {
    const { doc, frame } = withTable()
    const typed: ChildDraft = { id: 'tb', type: 'table', rows: [['Name', 'Age'], ['Ann', '31'], ['', '']], caption: 'People' }
    expect(frameOps(doc, frame, [typed])).toEqual([
      { op: 'update', id: 'tb', set: { rows: typed.rows, head: null } },
      { op: 'splice', id: 'tb', field: 'caption', at: 0, del: 0, ins: 'People' },
    ])
    expect(frameOps(doc, frame, [{ id: 'tb', type: 'table', rows: [['Name', 'Age'], ['Ann', '31']], head: true }])).toEqual([])
  })
})

describe("a table's size and look (file format version 2)", () => {
  it('keeps column shares in thousandths, one for each column, adding up to 1000', () => {
    const { doc } = withTable()
    const sized = apply(doc, [{ op: 'update', id: 'tb', set: { cols: [700, 300], width: 600, look: 'banded' } }]).doc
    expect(sized.block.tb).toMatchObject({ cols: [700, 300], width: 600, look: 'banded' })
    expectError(() => apply(doc, [{ op: 'update', id: 'tb', set: { cols: [700, 200] } }]), 'bad_shape', /adding up to 1000/)
    expectError(() => apply(doc, [{ op: 'update', id: 'tb', set: { cols: [1000] } }]), 'bad_shape', /one share for each column/)
    expectError(() => apply(doc, [{ op: 'update', id: 'tb', set: { cols: [700.5, 299.5] } }]), 'bad_shape')
    expectError(() => apply(doc, [{ op: 'update', id: 'tb', set: { width: 150 } }]), 'bad_shape')
    expectError(() => apply(doc, [{ op: 'update', id: 'tb', set: { look: 'grid' } }]), 'bad_shape')
    // A column taken away takes its share along, in the same update.
    expectError(() => apply(sized, [{ op: 'update', id: 'tb', set: { rows: [['Name'], ['Ann']] } }]), 'bad_shape', /one share for each column/)
    expect(apply(sized, [{ op: 'update', id: 'tb', set: { rows: [['Name'], ['Ann']], cols: [1000] } }]).doc.block.tb).toMatchObject({ cols: [1000] })
  })

  it('comes from an editor in the same update as its cells, and goes back to the defaults with null', () => {
    const { doc, frame } = withTable({ cols: [500, 500] })
    const wider: ChildDraft = { id: 'tb', type: 'table', rows: [['Name', 'Age', ''], ['Ann', '31', '']], head: true, cols: [400, 300, 300], width: 800, look: 'lines' }
    expect(frameOps(doc, frame, [wider])).toEqual([{ op: 'update', id: 'tb', set: { rows: wider.rows, cols: [400, 300, 300], width: 800, look: 'lines' } }])
    const plain: ChildDraft = { id: 'tb', type: 'table', rows: [['Name', 'Age'], ['Ann', '31']], head: true }
    expect(frameOps(doc, frame, [plain])).toEqual([{ op: 'update', id: 'tb', set: { cols: null } }])
  })

  it('moves to another frame, on another page too, keeping its size and look, and undo puts it back', () => {
    const { doc: one, frame } = withTable({ cols: [700, 300], width: 600, look: 'header' })
    const doc = apply(one, [
      { op: 'page', add: { id: 'p2', w: 21000, h: 29700, bg: 'blank', free: [] } },
      { op: 'add', block: { id: 'f2', r: 0, type: 'frame', page: 'p2', x: 2000, y: 2000, w: 17000, h: 0, kids: [] } as Block },
    ]).doc
    const moved = apply(doc, [{ op: 'move', id: 'tb', to: { parent: 'f2', at: 0 } }])
    expect(moved.doc.block.tb).toMatchObject({ parent: 'f2', cols: [700, 300], width: 600, look: 'header' })
    expect((moved.doc.block[frame] as Frame).kids).toEqual([])
    expect(apply(moved.doc, moved.inverse).doc.block.tb).toMatchObject({ parent: frame, cols: [700, 300] })
  })
})

describe('column shares', () => {
  it('add up to 1000 exactly, in whole thousandths', () => {
    expect(columnShares([1, 1, 1])).toEqual([334, 333, 333])
    expect(columnShares([2, 1, 1])).toEqual([500, 250, 250])
    expect(columnShares([700, 300])).toEqual([700, 300])
    expect(equalShares(7).reduce((sum, share) => sum + share, 0)).toBe(1000)
    expect(equalShares(0)).toEqual([])
  })

  it('give a column just added, which has no width yet, the average of the others', () => {
    expect(columnShares([600, null, 400])).toEqual([400, 333, 267])
    expect(columnShares([null, null])).toEqual([500, 500])
  })

  it('keep every column at least one thousandth wide', () => {
    const shares = columnShares([100000, 1, 1])
    expect(Math.min(...shares)).toBe(1)
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(1000)
  })
})

describe('a table in the exports and the outline', () => {
  const { doc } = withTable({ rows: [['Name', 'Age'], ['**Ann** [red]{color=red}', '31']], caption: 'Ages' })

  it('is a pipe table in Markdown, with its caption under it', () => {
    expect(toMarkdown(doc, { title: false }).markdown).toBe('| Name | Age |\n| --- | --- |\n| **Ann** red | 31 |\n\nAges\n')
  })

  it('is columns of plain text, with a rule under the header', () => {
    expect(toText(doc, { title: false })).toBe('Name     Age\n-------  ---\nAnn red  31\n\nAges\n')
  })

  it('shows its size and first row in the outline, and the whole table to the AI', () => {
    expect(outline(doc)).toContain('tb table 2x2 Name | Age')
    expect(blockLine(doc.block.tb!, 200)).toBe('table | Name | Age | / | --- | --- | / | **Ann** [red]{color=red} | 31 |')
  })
})
