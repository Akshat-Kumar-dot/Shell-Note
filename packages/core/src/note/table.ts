// Tables in note control (step 3;, 24 October 2026): a table is written under its line as a Markdown pipe table,
// the form models write one in, and its words are changed as text's are: the model writes the whole table again,
// and code keeps what did not change (each cell's marks, the column widths, the look, the caption). Rows and
// columns are added and removed by commands, named by number or by their words ("the row Sound", "the column
// Speed"), never by an offset.
import { parseInline, plainText } from '../markdown/inline.js'
import { parsePipeTable } from '../markdown/table.js'
import type { Block } from '../schema/doc.js'
import { common, rewriteMd } from './rewrite.js'

type Table = Extract<Block, { type: 'table' }>

/** The most a table the agent writes may hold: more is surely a mistake, and would be slow to draw. */
const MOST_ROWS = 500
const MOST_COLUMNS = 30
/** Shares are in thousandths (schema/doc.ts). */
const SHARES = 1000

const HOW = 'Write the table as a Markdown table on the lines under the line, then end: a row a line, the cells between | signs, a line of dashes under the header row.'

/** A pipe not escaped with a backslash. */
const PIPE = /(?<!\\)\|/u

/**
 * A table written under a line: a Markdown pipe table; lines with | between their cells and none at their ends are
 * read too, as are cells parted by tabs. `head` is true when a line of dashes follows the first row, else undefined:
 * the table did not say (a rewrite then keeps the header row it had).
 */
export function tableOf(words: string): { rows: string[][]; head?: true } {
  const lines = words.split('\n').map((line) => line.trim()).filter((line) => line !== '')
  if (lines.length === 0) throw new Error(`No table: ${HOW}`)
  const tabbed = lines.every((line) => !PIPE.test(line)) && lines.some((line) => line.includes('\t'))
  const piped = tabbed ? lines.map((line) => `| ${line.split('\t').map((cell) => cell.trim()).join(' | ')} |`) : lines
  if (piped.some((line) => !PIPE.test(line))) {
    // One column: a cell a line, when no line has a pipe at all.
    if (piped.every((line) => !PIPE.test(line))) return { rows: piped.map((line) => [line]) }
    throw new Error(`Some lines have no | between cells. ${HOW}`)
  }
  // Each line given its outer pipes, so a table written without them reads as one with them.
  const whole = piped.map((line) => `${line.startsWith('|') ? '' : '| '}${line}${line.endsWith('|') && !line.endsWith('\\|') ? '' : ' |'}`)
  const table = parsePipeTable(whole.length === 1 ? `${whole[0]}\n${whole[0]}` : whole.join('\n'))
  if (!table) throw new Error(HOW)
  const rows = whole.length === 1 ? table.rows.slice(0, 1) : table.rows
  if (rows.length > MOST_ROWS || rows[0]!.length > MOST_COLUMNS) throw new Error(`That table has ${rows.length} rows and ${rows[0]!.length} columns: at most ${MOST_ROWS} rows and ${MOST_COLUMNS} columns.`)
  return { rows, ...(table.head ? { head: true as const } : {}) }
}

/** A cell's words for comparing: its plain text, spaces made one, any case. */
const plainCell = (md: string): string => plainText(parseInline(md)).replace(/\s+/gu, ' ').trim().toLowerCase()

/** Whole numbers adding up to 1000, each at least 1, in the proportions given. */
export function sharesOf(weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  const raw = weights.map((weight) => (sum > 0 ? (weight / sum) * SHARES : SHARES / weights.length))
  const out = raw.map((share) => Math.max(1, Math.floor(share)))
  // What rounding down left over goes to the largest remainders, one each; what the floor of 1 added is taken back.
  let left = SHARES - out.reduce((a, b) => a + b, 0)
  const order = raw.map((share, i) => ({ i, rest: share - Math.floor(share) })).sort((a, b) => b.rest - a.rest)
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k]!.i] = out[order[k]!.i]! + 1
  for (let k = 0; left < 0; k = (k + 1) % out.length) {
    if (out[k]! > 1) {
      out[k] = out[k]! - 1
      left++
    }
  }
  return out
}

/** The column widths after columns change: each kept column its share, a new one the mean of those kept. `from[i]`: the old column new column i was, if any. */
function colsAfter(table: Table, from: readonly (number | undefined)[]): number[] | null | undefined {
  if (table.cols === undefined) return undefined
  const kept = from.filter((old): old is number => old !== undefined).map((old) => table.cols![old]!)
  if (kept.length === 0) return null
  const mean = kept.reduce((a, b) => a + b, 0) / kept.length
  return sharesOf(from.map((old) => (old === undefined ? mean : table.cols![old]!)))
}

/**
 * A table rewritten whole: the new rows against the old, so a row whose words stayed is the old row, byte for
 * byte, and in a changed row each cell keeps its marks where its words did (rewriteMd). Columns are paired by
 * position when there are as many as before, else by their header's words. What to set, or undefined when nothing
 * changed.
 */
export function rewriteTable(table: Table, written: { rows: string[][]; head?: true }): Record<string, unknown> | undefined {
  const old = table.rows
  const rows = written.rows
  const width = rows[0]!.length
  const oldWidth = old[0]!.length
  // Which old column each new one is.
  let from: (number | undefined)[]
  if (width === oldWidth) from = rows[0]!.map((_, i) => i)
  else {
    from = Array<number | undefined>(width).fill(undefined)
    for (const [i, j] of common(old[0]!.map(plainCell), rows[0]!.map(plainCell))) from[j] = i
  }
  // Which old row each new one is: equal rows first, then the rows between them paired in order.
  const key = (row: readonly string[]): string => row.map(plainCell).join(' | ')
  const pairs = common(old.map(key), rows.map(key))
  const rowFrom: (number | undefined)[] = Array<number | undefined>(rows.length).fill(undefined)
  let i = 0
  let j = 0
  for (const [oi, nj] of [...pairs, [old.length, rows.length] as [number, number]]) {
    for (let k = 0; k < Math.min(oi - i, nj - j); k++) rowFrom[j + k] = i + k
    if (nj < rows.length) rowFrom[nj] = oi
    i = oi + 1
    j = nj + 1
  }
  const out = rows.map((row, r) => {
    const was = rowFrom[r]
    return row.map((cell, c) => {
      const before = was === undefined || from[c] === undefined ? undefined : old[was]![from[c]!]
      return before === undefined ? cell : rewriteMd(before, cell)
    })
  })
  const set: Record<string, unknown> = {}
  if (JSON.stringify(out) !== JSON.stringify(old)) set.rows = out
  if (written.head && !table.head) set.head = true
  // The header row left out, and no line of dashes to say another is one: the table has no header now (Gemma 4 E4B,
  // asked for no header row, wrote the table without it; round 1 of the note test, 25 October 2026).
  if (table.head && !written.head && !rows.some((row) => key(row) === key(old[0]!))) set.head = null
  const sameColumns = width === oldWidth && from.every((old, k) => old === k)
  if (!sameColumns) {
    const cols = colsAfter(table, from)
    if (cols !== undefined) set.cols = cols
  }
  return Object.keys(set).length > 0 ? set : undefined
}

const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 }

/**
 * A row or a column named as the model says it: its number from 1 (the header row is row 1), first, last, "the
 * second row", or its words: a row by its first cell, a column by its header's (else its first row's) cell, all or how
 * they start. Its index, or an Error saying what the table has.
 */
function lineOf(table: Table, written: string | number, what: 'row' | 'column'): number {
  const count = what === 'row' ? table.rows.length : table.rows[0]!.length
  const label = (index: number): string => {
    const cell = what === 'row' ? table.rows[index]![0]! : table.rows[0]![index]!
    return `${what} ${index + 1}${plainCell(cell) ? ` “${plainText(parseInline(cell)).trim()}”` : ''}`
  }
  const all = (): string => Array.from({ length: Math.min(count, 12) }, (_, k) => label(k)).join(', ')
  const said = String(written).trim().toLowerCase().replace(/^(?:the\s+)?/u, '').replace(/[.,;:!?]+$/u, '')
  const nameless = said.replace(new RegExp(`^${what}\\s+|\\s+${what}$`, 'u'), '').trim()
  let index: number | undefined
  if (/^\d+$/u.test(nameless)) index = Number(nameless) - 1
  else if (nameless === 'last' || said === `last ${what}`) index = count - 1
  else if (nameless === 'header' || nameless === 'heading' || nameless === 'header row') index = what === 'row' ? 0 : undefined
  else if (ORDINALS[nameless] !== undefined) index = ORDINALS[nameless]! - 1
  else if (/^(?:second|third)\s+(?:to\s+)?last$/u.test(nameless)) index = count - (nameless.startsWith('second') ? 2 : 3)
  if (index !== undefined) {
    if (index < 0 || index >= count) throw new Error(`The table has ${count} ${what}s: ${all()}.`)
    return index
  }
  // By its words: a row's first cell, a column's header.
  const wanted = plainCell(String(written)).replace(new RegExp(`^(?:the\\s+)?${what}\\s+|\\s+${what}$`, 'u'), '').replace(/^(?:called|named|of|for)\s+/u, '').trim()
  const cells = Array.from({ length: count }, (_, k) => plainCell(what === 'row' ? table.rows[k]![0]! : table.rows[0]![k]!))
  const whole = cells.flatMap((cell, k) => (cell === wanted ? [k] : []))
  const starting = wanted.length >= 2 ? cells.flatMap((cell, k) => (cell.startsWith(wanted) ? [k] : [])) : []
  const fits = whole.length > 0 ? whole : starting
  if (fits.length === 1) return fits[0]!
  if (fits.length > 1) throw new Error(`${fits.length} ${what}s fit "${String(written)}": ${fits.map(label).join(', ')}. Say which by its number.`)
  throw new Error(`No ${what} of the table is "${String(written)}". Its ${what}s: ${all()}.`)
}

export const rowOf = (table: Table, written: string | number): number => lineOf(table, written, 'row')
export const columnOf = (table: Table, written: string | number): number => lineOf(table, written, 'column')

/** Rows added after the row at `after` (left out: at the end), each made as wide as the table. What to set. */
export function addRows(table: Table, cells: readonly string[][], after?: number): Record<string, unknown> {
  const width = table.rows[0]!.length
  const wide = cells.find((row) => row.length > width)
  if (wide) throw new Error(`The table has ${width} columns, and a new row has ${wide.length} cells: write ${width}, or add a column first (table: add column).`)
  const made = cells.map((row) => [...row, ...Array<string>(width - row.length).fill('')])
  const at = after === undefined ? table.rows.length : after + 1
  return { rows: [...table.rows.slice(0, at), ...made, ...table.rows.slice(at)] }
}

/** A column added after the column at `after` (left out: at the end): its cells top to bottom, the rest left empty. */
export function addColumn(table: Table, cells: readonly string[], after?: number): Record<string, unknown> {
  if (cells.length > table.rows.length) throw new Error(`The table has ${table.rows.length} rows, and the new column ${cells.length} cells: write one a row, the header's first.`)
  const at = after === undefined ? table.rows[0]!.length : after + 1
  const rows = table.rows.map((row, r) => [...row.slice(0, at), cells[r] ?? '', ...row.slice(at)])
  const width = rows[0]!.length
  const from = Array.from({ length: width }, (_, k): number | undefined => (k < at ? k : k === at ? undefined : k - 1))
  const cols = colsAfter(table, from)
  return { rows, ...(cols !== undefined ? { cols } : {}) }
}

/** The row at `index` taken out; the header row taken out leaves the next a plain row. */
export function removeRow(table: Table, index: number): Record<string, unknown> {
  if (table.rows.length === 1) throw new Error('The table has one row left: block: remove takes the whole table away.')
  return { rows: table.rows.filter((_, r) => r !== index), ...(index === 0 && table.head ? { head: null } : {}) }
}

/** The column at `index` taken out, the others keeping their widths between them. */
export function removeColumn(table: Table, index: number): Record<string, unknown> {
  if (table.rows[0]!.length === 1) throw new Error('The table has one column left: block: remove takes the whole table away.')
  const rows = table.rows.map((row) => row.filter((_, c) => c !== index))
  const from = Array.from({ length: rows[0]!.length }, (_, k) => (k < index ? k : k + 1))
  const cols = colsAfter(table, from)
  return { rows, ...(cols !== undefined ? { cols } : {}) }
}

/** A table's whole words, as the model rewrites it: a Markdown pipe table, a line of dashes under a header row. */
export function tableWords(table: Table): string {
  const line = (cells: readonly string[]): string => `| ${cells.map((cell) => cell.replace(/(?<!\\)\|/gu, '\\|')).join(' | ')} |`
  const body = table.rows.map(line)
  return (table.head ? [body[0]!, `| ${table.rows[0]!.map(() => '---').join(' | ')} |`, ...body.slice(1)] : body).join('\n')
}
