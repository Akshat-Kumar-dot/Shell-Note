// Validation layer 3: content. The checks themselves are
// passed in, so core needs no DOM: the editor supplies browser versions and
// the MCP server supplies Node versions.
import type { Doc, Id } from '../schema/doc.js'
import { ValidationError } from './errors.js'

/** Text fields that have their own syntax: Markdown (a text block's words, a caption, a table's cells), LaTeX and Mermaid. */
export type ContentField = 'md' | 'tex' | 'src' | 'caption' | 'rows'
export const CONTENT_FIELDS: readonly ContentField[] = ['md', 'tex', 'src', 'caption', 'rows']

/** Each check returns null when the content is fine, or a hint that says what to fix. */
export interface ContentValidators {
  md?: (md: string) => string | null
  tex?: (tex: string) => string | null
  mermaid?: (src: string) => string | null
}

/** Run the checks on the fields a transaction changed, using their final values. */
export function checkContent(
  doc: Doc,
  edited: ReadonlyMap<Id, ReadonlySet<ContentField>>,
  validators: ContentValidators,
): void {
  for (const [id, fields] of edited) {
    const block = doc.block[id] as Record<string, unknown> | undefined
    if (!block) continue
    for (const field of fields) {
      if (field === 'rows') {
        checkCells(id, block.rows, validators.md)
        continue
      }
      const check = field === 'md' || field === 'caption' ? validators.md : field === 'tex' ? validators.tex : validators.mermaid
      const value = block[field]
      if (!check || typeof value !== 'string') continue
      const hint = check(value)
      if (hint !== null) throw new ValidationError('content', `Block ${id}: ${hint}`, { id, field })
    }
  }
}

/** Each cell of a table is inline Markdown, checked like a text block's words. */
function checkCells(id: Id, rows: unknown, check: ContentValidators['md']): void {
  if (!check || !Array.isArray(rows)) return
  rows.forEach((row: unknown, r) => {
    if (!Array.isArray(row)) return
    row.forEach((cell: unknown, c) => {
      const hint = typeof cell === 'string' ? check(cell) : null
      if (hint !== null) throw new ValidationError('content', `Block ${id}, row ${r + 1}, cell ${c + 1}: ${hint}`, { id, field: 'rows', row: r, cell: c })
    })
  })
}
