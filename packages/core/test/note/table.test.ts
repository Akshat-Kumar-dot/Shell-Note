// Tables in note control (step 3): a table read from under its line, rewritten whole with what did not change kept, and
// rows and columns named by number or by their words.
import { describe, expect, it } from 'vitest'
import { addColumn, addRows, columnOf, removeColumn, removeRow, rewriteTable, rowOf, sharesOf, tableOf, tableWords } from '../../src/note/table.js'
import type { Block } from '../../src/schema/doc.js'

type Table = Extract<Block, { type: 'table' }>
const TABLE: Table = {
  id: 'tb',
  r: 3,
  type: 'table',
  parent: 'fa',
  rows: [
    ['Wave', 'Speed'],
    ['**Sound**', '343 m/s'],
    ['Light', '[3e8 m/s]{color=red}'],
  ],
  head: true,
  cols: [600, 400],
  look: 'banded',
  caption: 'Speeds',
}
/** The table without some of its optional fields. */
const without = (table: Table, ...fields: ('head' | 'cols')[]): Table => {
  const copy = { ...table }
  for (const field of fields) delete copy[field]
  return copy
}

describe('a table written under a line', () => {
  it('reads a pipe table, its header from the line of dashes', () => {
    expect(tableOf('| Wave | Speed |\n|---|---|\n| Sound | 343 m/s |')).toEqual({ rows: [['Wave', 'Speed'], ['Sound', '343 m/s']], head: true })
  })

  it('reads lines with no pipes at their ends, cells parted by tabs, and one column a line', () => {
    expect(tableOf('Wave | Speed\nSound | 343 m/s')).toEqual({ rows: [['Wave', 'Speed'], ['Sound', '343 m/s']] })
    expect(tableOf('Wave\tSpeed\nSound\t343 m/s')).toEqual({ rows: [['Wave', 'Speed'], ['Sound', '343 m/s']] })
    expect(tableOf('Sound\nLight')).toEqual({ rows: [['Sound'], ['Light']] })
    expect(tableOf('| Sound | 343 |')).toEqual({ rows: [['Sound', '343']] })
  })

  it('fills short rows, and refuses what is no table', () => {
    expect(tableOf('| a | b | c |\n| d |').rows).toEqual([['a', 'b', 'c'], ['d', '', '']])
    expect(() => tableOf('  ')).toThrow('No table')
    expect(() => tableOf('| a | b |\nno pipes here')).toThrow('no | between cells')
  })
})

describe('a table rewritten whole', () => {
  it('keeps every cell whose words stayed as it was, its marks too, and changes the rest', () => {
    const set = rewriteTable(TABLE, tableOf('| Wave | Speed |\n|---|---|\n| Sound | 340 m/s |\n| Light | 3e8 m/s |'))
    expect(set).toEqual({ rows: [['Wave', 'Speed'], ['**Sound**', '340 m/s'], ['Light', '[3e8 m/s]{color=red}']] })
  })

  it('adds and removes rows by their words, the column widths and the look untouched', () => {
    const set = rewriteTable(TABLE, tableOf('| Wave | Speed |\n|---|---|\n| Light | 3e8 m/s |\n| Water | 1480 m/s |'))
    expect(set).toEqual({ rows: [['Wave', 'Speed'], ['Light', '[3e8 m/s]{color=red}'], ['Water', '1480 m/s']] })
  })

  it('pairs columns by their header when there are more or fewer, each kept column keeping its share', () => {
    const set = rewriteTable(TABLE, tableOf('| Wave | Kind | Speed |\n|---|---|---|\n| Sound | longitudinal | 343 m/s |\n| Light | transverse | 3e8 m/s |'))
    expect(set!.rows).toEqual([['Wave', 'Kind', 'Speed'], ['**Sound**', 'longitudinal', '343 m/s'], ['Light', 'transverse', '[3e8 m/s]{color=red}']])
    expect(set!.cols).toEqual([400, 333, 267])
    expect((set!.cols as number[]).reduce((a, b) => a + b, 0)).toBe(1000)
  })

  it('takes the header away when a rewrite leaves the header row out with no line of dashes (round 2 of the note test)', () => {
    expect(rewriteTable(TABLE, tableOf('| Sound | 343 m/s |\n| Light | 3e8 m/s |'))).toMatchObject({ head: null })
  })

  it('says nothing changed when the words are the same, the header kept when the table does not say', () => {
    expect(rewriteTable(TABLE, tableOf('| Wave | Speed |\n| Sound | 343 m/s |\n| Light | 3e8 m/s |'))).toBeUndefined()
    expect(rewriteTable(without(TABLE, 'head'), tableOf(tableWords(TABLE)))).toEqual({ head: true })
  })
})

describe('rows and columns', () => {
  it('are named by number, first or last, an ordinal, or their words', () => {
    expect(rowOf(TABLE, 2)).toBe(1)
    expect(rowOf(TABLE, 'the last row')).toBe(2)
    expect(rowOf(TABLE, 'header')).toBe(0)
    expect(rowOf(TABLE, 'Sound')).toBe(1)
    expect(rowOf(TABLE, 'the row Light')).toBe(2)
    expect(columnOf(TABLE, 'Speed')).toBe(1)
    expect(columnOf(TABLE, 'the second column')).toBe(1)
    expect(() => rowOf(TABLE, 9)).toThrow('The table has 3 rows: row 1 “Wave”, row 2 “Sound”, row 3 “Light”.')
    expect(() => columnOf(TABLE, 'Mass')).toThrow('No column of the table is "Mass"')
  })

  it('are added where asked, as wide as the table, and taken out', () => {
    expect(addRows(TABLE, [['Water', '1480 m/s']], 1).rows).toEqual([['Wave', 'Speed'], ['**Sound**', '343 m/s'], ['Water', '1480 m/s'], ['Light', '[3e8 m/s]{color=red}']])
    expect(addRows(TABLE, [['Water']]).rows).toEqual([...TABLE.rows, ['Water', '']])
    expect(() => addRows(TABLE, [['a', 'b', 'c']])).toThrow('The table has 2 columns')
    const wider = addColumn(TABLE, ['Kind', 'longitudinal'], 0)
    expect(wider.rows).toEqual([['Wave', 'Kind', 'Speed'], ['**Sound**', 'longitudinal', '343 m/s'], ['Light', '', '[3e8 m/s]{color=red}']])
    expect(wider.cols).toEqual([400, 333, 267])
    expect(removeRow(TABLE, 0)).toEqual({ rows: TABLE.rows.slice(1), head: null })
    expect(removeColumn(TABLE, 0)).toEqual({ rows: [['Speed'], ['343 m/s'], ['[3e8 m/s]{color=red}']], cols: [1000] })
    expect(() => removeColumn({ ...without(TABLE, 'cols'), rows: [['a'], ['b']] }, 0)).toThrow('one column left')
  })

  it('shares stay whole numbers that add up to 1000', () => {
    expect(sharesOf([1, 1, 1])).toEqual([334, 333, 333])
    expect(sharesOf([600, 400, 500]).reduce((a, b) => a + b, 0)).toBe(1000)
  })
})
