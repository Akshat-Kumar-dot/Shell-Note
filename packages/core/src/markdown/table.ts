// Tables as Markdown pipe tables: how a model writes a table, how a pasted one
// is read, and how the Markdown export writes one. A table block holds `rows`,
// each cell inline Markdown on one line; code turns one
// form into the other, so a model never has to write the rows as JSON.
//
//   | Name | Age |
//   | ---- | --- |
//   | Ann  | 31  |
//
// The line of dashes makes the first row a header (head). It may be left out
// when every line starts and ends with a pipe; then no row is a header.

export interface PipeTable {
  rows: string[][]
  head: boolean
}

/** A pipe not escaped with a backslash. */
const PIPE = /(?<!\\)\|/u
/** The line under a header: dashes, with optional colons for alignment, between pipes. */
const RULE = /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?$/u

/** A Markdown pipe table as rows of cells, all rows as long as the longest; undefined when the text is not one. */
export function parsePipeTable(text: string): PipeTable | undefined {
  const lines = text.trim().split(/\r?\n/u).map((line) => line.trim())
  if (lines.length < 2 || lines.some((line) => !PIPE.test(line))) return undefined
  const head = RULE.test(lines[1]!)
  if (!head && !lines.every((line) => line.startsWith('|') && line.endsWith('|') && line.length > 1)) return undefined
  const rows = (head ? [lines[0]!, ...lines.slice(2)] : lines).map(cellsOf)
  const width = Math.max(...rows.map((row) => row.length))
  return { rows: rows.map((row) => [...row, ...Array<string>(width - row.length).fill('')]), head }
}

/** The cells of one line: the outer pipes dropped, split at the others, each trimmed, with \| read as |. */
function cellsOf(line: string): string[] {
  let inner = line
  if (inner.startsWith('|')) inner = inner.slice(1)
  if (inner.endsWith('|') && !inner.endsWith('\\|')) inner = inner.slice(0, -1)
  return inner.split(PIPE).map((cell) => cell.trim().replaceAll('\\|', '|'))
}

/**
 * Rows as a Markdown pipe table, a pipe in a cell written as \|. Markdown
 * needs a header, so a table without one gets an empty header line.
 */
export function pipeTable(rows: readonly (readonly string[])[], head: boolean): string {
  const width = rows[0]?.length ?? 0
  const line = (cells: readonly string[]): string => `| ${cells.map((cell) => cell.replace(/(?<!\\)\|/gu, '\\|')).join(' | ')} |`
  const rule = `| ${Array<string>(width).fill('---').join(' | ')} |`
  const body = rows.map(line)
  return (head ? [body[0]!, rule, ...body.slice(1)] : [line(Array<string>(width).fill('')), rule, ...body]).join('\n')
}
