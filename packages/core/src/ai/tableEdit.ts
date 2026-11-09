// Table changes done by code before any model, when the request spells them out
//: "add a row Green, 5,000.00, UK, Qtr 2", "add a column
// called Bonus", "delete the rows with Smith", "delete the last row", "delete
// the column Country", "sort by Sales". Asked of a model, "add a row" took 4.4
// s on gemma-4-e4b and 7.8 s on gemma-4-e2b, and six of the seven benchmark
// models made a second, half-copied table instead of changing this one.
// Anything less plain, such as "add a row for Mars, which has 2 moons" or "add
// a column for rings", goes on to the model.
import { parseInline, plainText, serializeInline } from '../markdown/inline.js'
import type { Doc } from '../schema/doc.js'
import type { Op } from '../schema/ops.js'
import { columnShares } from '../shares.js'
import type { Aliases } from './alias.js'
import type { Swap } from './swap.js'

type Rows = string[][]
/** A table as a change leaves it: its rows, and its column widths when they change. */
type Change = { rows: Rows; cols?: number[] }

/** Polite words before the request, and the punctuation after it. */
const LEAD = /^(?:(?:please|pls|kindly|now|just|can\s+you|could\s+you)\s+)+/iu
/** Words that make a value a sentence, for the model to read: "Mars, which has 2 moons". */
const SENTENCE = /\b(?:which|that|who|whose|where|has|have|had|is|are|was|were|should|would|equal|equals|times|plus|minus|percent|of\s+the)\b|%|=/iu
/** The words for positions in a table. */
const ORDINAL: Readonly<Record<string, number>> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 }

/**
 * The operations for a table change the request spells out, on the one table
 * chosen, or undefined to hand the request on.
 */
export function tableEditOps(instruction: string, input: { doc: Doc; aliases: Aliases }): Swap | undefined {
  const { doc, aliases } = input
  if (aliases.selected.length !== 1 || aliases.selected[0]!.words !== undefined) return undefined
  const { alias, id } = aliases.selected[0]!
  const table = doc.block[id]
  if (table?.type !== 'table') return undefined
  const text = instruction.trim().replace(/[.!]+$/u, '').replace(/\s+/gu, ' ').replace(LEAD, '')
  const head = table.head === true
  const width = table.rows[0]?.length ?? 0
  const result = addRow(text, table.rows, head, width) ?? addColumn(text, table.rows, head, table.cols) ?? deleteRows(text, table.rows, head) ?? deleteColumn(text, table.rows, head, table.cols) ?? sortRows(text, table.rows, head)
  if (!result || JSON.stringify(result.rows) === JSON.stringify(table.rows)) return undefined
  const set: Record<string, unknown> = { rows: result.rows }
  if (result.cols !== undefined) set.cols = result.cols
  return { ops: [{ op: 'update', id, set } as Op], ai: [{ op: 'rewrite', id: alias }] }
}

/** "add a row Green, 5,000.00, UK, Qtr 2", "add a row at the top: a | b", "add an empty row". */
function addRow(text: string, rows: Rows, head: boolean, width: number): Change | undefined {
  const m = /^(?:add|append|insert)\s+(?:a\s+|an\s+|one\s+|another\s+|new\s+|empty\s+|blank\s+)*row\b(.*)$/iu.exec(text)
  if (!m) return undefined
  // Where it goes, said right after "row" or at the very end: "at the top", "to the end".
  const PLACE = /(?:at|to)\s+(?:the\s+)?(top|start|beginning|end|bottom)\b/iu
  let rest = m[1]!.trim()
  let top = false
  for (const at of [new RegExp(`^${PLACE.source}`, 'iu').exec(rest), new RegExp(`${PLACE.source}$`, 'iu').exec(rest)]) {
    if (!at) continue
    top = /top|start|beginning/iu.test(at[1]!)
    rest = (rest.slice(0, at.index) + rest.slice(at.index + at[0].length)).trim()
    break
  }
  rest = rest.replace(/^(?:for|with|of|containing)\s+/iu, '').replace(/^[:\-–]\s*/u, '').trim()
  // No values: an empty row. Values that read as a sentence are the model's.
  const cells = rest === '' ? Array<string>(width).fill('') : SENTENCE.test(rest) ? undefined : valuesOf(rest, width)
  if (!cells) return undefined
  const row = cells.map(literal)
  const at0 = top ? (head ? 1 : 0) : rows.length
  return { rows: [...rows.slice(0, at0), row, ...rows.slice(at0)] }
}

/**
 * The values of a new row, as many as the table has columns: split at |, or
 * at commas followed by a space, so that 5,000.00 stays one value; at any
 * comma only when no comma is followed by a space ("Green,5000,UK,Qtr 2").
 */
function valuesOf(text: string, width: number): string[] | undefined {
  const parts = text.includes('|') ? text.replace(/^\|/u, '').replace(/\|$/u, '').split('|') : /[,;]\s/u.test(text) ? text.split(/\s*[,;]\s+/u) : text.split(/\s*[,;]\s*/u)
  const cells = parts.map((part) => part.trim())
  return cells.length === width && cells.every((cell) => cell.split(/\s+/u).length <= 6) ? cells : undefined
}

/**
 * "add an empty column", "add a column called Bonus": an empty column at the
 * end, its header the name given. Only a column said to be empty, or only
 * named: "add a column for rings" asks for its contents too, for the model.
 */
function addColumn(text: string, rows: Rows, head: boolean, cols: readonly number[] | undefined): Change | undefined {
  const m = /^(?:add|append|insert)\s+(?:a\s+|an\s+|one\s+|another\s+|new\s+)*((?:empty|blank)\s+)?column\b(?:\s+(named|called|titled))?\s*[:\-–]?\s*(.*?)(?:\s+(?:at\s+the\s+)?(?:end|right))?$/iu.exec(text)
  if (!m || (m[1] === undefined && m[2] === undefined)) return undefined
  const name = m[3]!.trim().replace(/^["'“‘]|["'”’]$/gu, '')
  // A name says what the column is called; anything more says what to put in it, for the model.
  if ((m[2] !== undefined && name === '') || name.split(/\s+/u).length > 3 || SENTENCE.test(name) || /\b(?:with|from|by|using|based|for)\b/iu.test(name) || (name !== '' && !head)) return undefined
  const grown = rows.map((row, r) => [...row, r === 0 && head ? literal(name) : ''])
  return { rows: grown, ...(cols ? { cols: columnShares([...cols, null]) } : {}) }
}

/** "delete the row with Smith", "remove the rows with Jones", "delete the last row", "delete row 3". */
function deleteRows(text: string, rows: Rows, head: boolean): Change | undefined {
  const first = head ? 1 : 0
  const data = rows.length - first
  const at = /^(?:delete|remove|drop|erase)\s+(?:the\s+)?(?:(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|\d+(?:st|nd|rd|th))\s+row|row\s+(\d+))$/iu.exec(text)
  if (at) {
    const word = (at[1] ?? at[2]!).toLowerCase()
    const n = word === 'last' ? data : (ORDINAL[word] ?? Number.parseInt(word, 10))
    if (!(n >= 1 && n <= data)) return undefined
    return { rows: rows.filter((_, r) => r !== first + n - 1) }
  }
  const m = /^(?:delete|remove|drop|erase)\s+(?:the\s+|all\s+(?:the\s+)?)?(rows?|lines?|entr(?:y|ies)|records?)\s+(?:with|for|containing|that\s+(?:has|have|contains?)|where|of|named|called)\s+(.+)$/iu.exec(text)
  if (!m) return undefined
  const plural = /s$|ies$/iu.test(m[1]!)
  const find = m[2]!.trim().replace(/^["'“‘]|["'”’]$/gu, '').toLowerCase()
  const cell = (md: string): string => plainText(parseInline(md)).trim().toLowerCase()
  const word = new RegExp(`(?<![\\p{L}\\p{N}_])${find.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?![\\p{L}\\p{N}_])`, 'iu')
  // Whole cells first, then words inside cells.
  let hits = rows.flatMap((row, r) => (r >= first && row.some((md) => cell(md) === find) ? [r] : []))
  if (hits.length === 0) hits = rows.flatMap((row, r) => (r >= first && row.some((md) => word.test(cell(md))) ? [r] : []))
  // "the row" when several match: the model, or later a question back, decides which.
  if (hits.length === 0 || (!plural && hits.length > 1)) return undefined
  return { rows: rows.filter((_, r) => !hits.includes(r)) }
}

/** "delete the column Country", "remove the Quarter column", "delete the last column". */
function deleteColumn(text: string, rows: Rows, head: boolean, cols: readonly number[] | undefined): Change | undefined {
  const m = /^(?:delete|remove|drop|erase)\s+(?:the\s+)?(?:column\s+(?:named\s+|called\s+)?(.+)|(.+?)\s+column)$/iu.exec(text)
  if (!m) return undefined
  const name = (m[1] ?? m[2]!).trim().replace(/^["'“‘]|["'”’]$/gu, '').toLowerCase()
  const width = rows[0]?.length ?? 0
  const position = name === 'last' ? width - 1 : name === 'first' ? 0 : -1
  const index = position >= 0 ? position : head ? (rows[0] ?? []).findIndex((md) => plainText(parseInline(md)).trim().toLowerCase() === name) : -1
  if (index < 0 || width < 2) return undefined
  const kept = cols ? cols.filter((_, c) => c !== index) : undefined
  return { rows: rows.map((row) => row.filter((_, c) => c !== index)), ...(kept ? { cols: columnShares(kept) } : {}) }
}

/** "sort by Sales", "sort the table by Last Name descending", "order by Sales, largest first". */
function sortRows(text: string, rows: Rows, head: boolean): Change | undefined {
  const m = /^(?:sort|order|arrange)\s+(?:the\s+)?(?:table\s+|rows\s+)?by\s+(?:the\s+)?(.+?)(?:\s+column)?(?:[,\s]+(?:in\s+)?(ascending|descending|asc|desc|a\s*(?:-|to)\s*z|z\s*(?:-|to)\s*a|(?:smallest|lowest|least)\s+first|(?:largest|biggest|highest|most)\s+first|high\s+to\s+low|low\s+to\s+high)(?:\s+order)?)?$/iu.exec(text)
  if (!m || !head) return undefined
  const name = m[1]!.trim().replace(/^["'“‘]|["'”’]$/gu, '').toLowerCase()
  const index = (rows[0] ?? []).findIndex((md) => plainText(parseInline(md)).trim().toLowerCase() === name)
  if (index < 0) return undefined
  const down = m[2] !== undefined && /desc|z\s*(?:-|to)\s*a|largest|biggest|highest|most|high\s+to\s+low/iu.test(m[2])
  const value = (md: string): string => plainText(parseInline(md)).trim()
  const number = (cell: string): number => Number(cell.replace(/[\s,$€£₹%]/gu, ''))
  const body = rows.slice(1)
  const numeric = body.every((row) => value(row[index] ?? '') === '' || Number.isFinite(number(value(row[index] ?? ''))))
  const sorted = body
    .map((row, i) => ({ row, i, cell: value(row[index] ?? '') }))
    .sort((a, b) => {
      // Empty cells go last either way; equal ones keep their order.
      if (a.cell === '' || b.cell === '') return a.cell === b.cell ? a.i - b.i : a.cell === '' ? 1 : -1
      const order = numeric ? number(a.cell) - number(b.cell) : a.cell.localeCompare(b.cell, undefined, { sensitivity: 'base', numeric: true })
      return (down ? -order : order) || a.i - b.i
    })
    .map(({ row }) => row)
  return { rows: [rows[0]!, ...sorted] }
}

/** Words to put in a cell as they were typed, not read as Markdown. */
function literal(text: string): string {
  return text === '' ? '' : serializeInline([{ t: 'text', v: text }])
}
