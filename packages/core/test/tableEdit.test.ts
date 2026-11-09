// Table changes done by code when the request spells them out (
// 2026): rows and columns added and deleted, and rows sorted, on the one table
// chosen, with no model; anything less plain goes to the model, as before.
import { describe, expect, it } from 'vitest'
import { apply, createDoc, runEdit, type Block, type Doc, type Model } from '../src/index.js'

/** A model that fails the test if it is asked anything. */
const NO_MODEL: Model = {
  name: 'none',
  caps: { jsonSchema: true, inlineContent: false, vision: false, opSet: 'small' },
  complete: () => Promise.reject(new Error('the model was asked')),
}

const ROWS = [
  ['Last Name', 'Sales', 'Country', 'Quarter'],
  ['Smith', '16,753.00', 'UK', 'Qtr 3'],
  ['Johnson', '14,808.00', 'US', 'Qtr 4'],
  ['Williams', '10,644.00', 'UK', 'Qtr 2'],
  ['Smith', '18,919.00', 'US', 'Qtr 3'],
  ['Brown', '$4,865.00', 'US', 'Qtr 4'],
]

/** A new note with the table `tb`, chosen. */
function withTable(extra: Record<string, unknown> = {}): Doc {
  const doc = createDoc()
  const frame = doc.page[doc.pages[0]!]!.free[0]!
  return apply(doc, [{ op: 'add', block: { id: 'tb', r: 0, parent: frame, type: 'table', head: true, rows: ROWS, ...extra } as Block }]).doc
}

const rowsOf = (doc: Doc): string[][] => (doc.block.tb as unknown as { rows: string[][] }).rows
const colsOf = (doc: Doc): number[] | undefined => (doc.block.tb as unknown as { cols?: number[] }).cols
const edit = (doc: Doc, instruction: string, model: Model = NO_MODEL) => runEdit({ doc, selection: { blocks: ['tb'] }, instruction, model })

/** A model that declines, counting how often it is asked. */
function counting(): Model & { asked: number } {
  const model = { ...NO_MODEL, asked: 0, complete: async () => (model.asked++, { text: '{"ops":[{"op":"none","why":"No."}]}', tokensIn: 1, tokensOut: 1, ms: 1 }) }
  return model
}

describe('rows added by code', () => {
  it('adds the values given, split at commas with a space, so a comma inside a number stays, as one undo step', async () => {
    const doc = withTable()
    const out = await edit(doc, 'add a row for Green, 5,000.00, UK, Qtr 2')
    expect(out).toMatchObject({ tier: 0, calls: 0 })
    expect(rowsOf(out.doc).at(-1)).toEqual(['Green', '5,000.00', 'UK', 'Qtr 2'])
    expect(rowsOf(apply(out.doc, out.inverse).doc)).toEqual(ROWS)
  })

  it('at the top, below the header; with | between values; and an empty row', async () => {
    const top = await edit(withTable(), 'please add a row at the top: Green | 5,000.00 | UK | Qtr 2')
    expect(rowsOf(top.doc)[1]).toEqual(['Green', '5,000.00', 'UK', 'Qtr 2'])
    const empty = await edit(withTable(), 'add an empty row')
    expect(rowsOf(empty.doc).at(-1)).toEqual(['', '', '', ''])
  })

  it('leaves to the model values that read as a sentence, or that do not fit the columns', async () => {
    for (const ask of ['add a row for Mars, which has 2 moons', 'add a row Green, 5,000.00, UK', 'add a row for the total of the sales']) {
      const model = counting()
      await edit(withTable(), ask, model)
      expect(model.asked, ask).toBe(1)
    }
  })
})

describe('columns added and deleted by code', () => {
  it('adds an empty column with the name given, keeping the widths of the others in proportion', async () => {
    const out = await edit(withTable({ cols: [400, 200, 200, 200] }), 'add a column called Bonus')
    expect(rowsOf(out.doc)[0]).toEqual(['Last Name', 'Sales', 'Country', 'Quarter', 'Bonus'])
    expect(rowsOf(out.doc).slice(1).every((row) => row.length === 5 && row[4] === '')).toBe(true)
    expect(colsOf(out.doc)).toEqual([320, 160, 160, 160, 200])
  })

  it('adds an empty column when asked for one by that name, and leaves to the model a column whose contents are asked for', async () => {
    expect(rowsOf((await edit(withTable(), 'add an empty column')).doc)[0]).toEqual(['Last Name', 'Sales', 'Country', 'Quarter', ''])
    for (const ask of ['add a column Bonus that is 10% of the Sales', 'add a column for rings', 'add a column Bonus']) {
      const model = counting()
      await edit(withTable(), ask, model)
      expect(model.asked, ask).toBe(1)
    }
  })

  it('deletes a column by its header, or the last one, and the widths of the rest add up again', async () => {
    const named = await edit(withTable({ cols: [400, 200, 200, 200] }), 'delete the column Country')
    expect(rowsOf(named.doc)[0]).toEqual(['Last Name', 'Sales', 'Quarter'])
    expect(colsOf(named.doc)).toEqual([500, 250, 250])
    expect(rowsOf((await edit(withTable(), 'remove the Quarter column')).doc)[0]).toEqual(['Last Name', 'Sales', 'Country'])
    expect(rowsOf((await edit(withTable(), 'delete the last column')).doc)[0]).toEqual(['Last Name', 'Sales', 'Country'])
  })
})

describe('rows deleted by code', () => {
  it('deletes the rows a word picks out, or a row by its place', async () => {
    expect(rowsOf((await edit(withTable(), 'delete the rows with Smith')).doc).map((row) => row[0])).toEqual(['Last Name', 'Johnson', 'Williams', 'Brown'])
    expect(rowsOf((await edit(withTable(), 'remove the row with Johnson')).doc).map((row) => row[0])).toEqual(['Last Name', 'Smith', 'Williams', 'Smith', 'Brown'])
    expect(rowsOf((await edit(withTable(), 'delete the last row')).doc).at(-1)![0]).toBe('Smith')
    expect(rowsOf((await edit(withTable(), 'delete row 2')).doc).map((row) => row[0])).toEqual(['Last Name', 'Smith', 'Williams', 'Smith', 'Brown'])
  })

  it('leaves to the model "the row" when several match, or none', async () => {
    for (const ask of ['delete the row with Smith', 'delete the row with Green', 'delete row 9']) {
      const model = counting()
      await edit(withTable(), ask, model)
      expect(model.asked, ask).toBe(1)
    }
  })
})

describe('rows sorted by code', () => {
  it('by a column of numbers, money included, or of words, either way, the header staying first', async () => {
    const bySales = await edit(withTable(), 'sort by Sales')
    expect(rowsOf(bySales.doc).map((row) => row[1])).toEqual(['Sales', '$4,865.00', '10,644.00', '14,808.00', '16,753.00', '18,919.00'])
    const down = await edit(withTable(), 'order the table by Sales, largest first')
    expect(rowsOf(down.doc)[1]![1]).toBe('18,919.00')
    const byName = await edit(withTable(), 'sort by Last Name descending')
    expect(rowsOf(byName.doc).map((row) => row[0])).toEqual(['Last Name', 'Williams', 'Smith', 'Smith', 'Johnson', 'Brown'])
  })
})

describe('what is not a table change by code', () => {
  it('needs exactly one table, chosen whole', async () => {
    const doc = withTable()
    const frame = doc.page[doc.pages[0]!]!.free[0]!
    const two = apply(doc, [{ op: 'add', block: { id: 'p1', r: 0, parent: frame, type: 'text', role: 'p', indent: 0, md: 'Sales' } as Block }]).doc
    const model = counting()
    await runEdit({ doc: two, selection: { blocks: ['tb', 'p1'] }, instruction: 'sort by Sales', model })
    expect(model.asked).toBe(1)
  })
})
