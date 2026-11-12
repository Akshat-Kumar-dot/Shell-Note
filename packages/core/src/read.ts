// A block in full, as text: what a reader outside the app is given when the
// outline's first few words are not enough (the MCP tool read_blocks). The
// content is in the form an edit writes it in, so what is read can be sent
// back: a text block's inline Markdown, a formula's LaTeX, a diagram's
// Mermaid, a table as a pipe table, a picture's description, and what
// handwriting says once it has been read. Never the strokes of handwriting,
// nor a picture's bytes.
import { pipeTable } from './markdown/table.js'
import type { Block, Doc, Id } from './schema/doc.js'
import { ValidationError } from './validate/errors.js'

/** A block's own content, as `rewrite` takes it. Empty for a frame, which has none of its own. */
export function blockContent(block: Block): string {
  switch (block.type) {
    case 'text':
      return block.md
    case 'math':
      return block.tex
    case 'diagram':
      return block.src
    case 'table':
      return pipeTable(block.rows, block.head === true)
    case 'image':
      return block.alt ?? ''
    case 'ink':
      return block.text ?? ''
    case 'frame':
      return ''
  }
}

/** What a block is, on one line after its id: its kind, and what its content does not say. */
function about(block: Block): string {
  switch (block.type) {
    case 'text': {
      const role = block.indent > 0 ? `${block.role}+${block.indent}` : block.role
      const tick = block.role === 'todo' ? (block.done ? ' [x]' : ' [ ]') : ''
      const style = Object.entries(block.style ?? {}).map(([key, value]) => ` ${key}=${value}`)
      return `${role}${tick}${style.join('')}`
    }
    case 'math':
      return `math${block.value === undefined ? '' : ` = ${block.value}`}`
    case 'diagram':
      return 'diagram'
    case 'table':
      return `table ${block.rows.length}x${block.rows[0]?.length ?? 0}${block.caption === undefined ? '' : ` caption: ${block.caption}`}`
    case 'image':
      return `image${block.alt === undefined ? ' (no description)' : ''}${block.caption === undefined ? '' : ` caption: ${block.caption}`}`
    case 'ink': {
      const n = block.strokes.length
      return `ink ${n} stroke${n === 1 ? '' : 's'}${block.text === undefined ? ' (not read)' : ''}`
    }
    case 'frame':
      return `frame${block.kids.length === 0 ? ' (empty)' : ` holding ${block.kids.join(', ')}`}${block.next === undefined ? '' : `, continues in ${block.next}`}`
  }
}

/**
 * The blocks named, in full, in the order asked for: each with a line saying
 * what it is, then its content, and an empty line between two. For example:
 *
 *   t1 h2 color=blue
 *   Newton's laws
 *
 *   m1 math
 *   F = ma
 */
export function readBlocks(doc: Doc, ids: readonly Id[]): string {
  return ids
    .map((id) => {
      const block = doc.block[id]
      if (!block) throw new ValidationError('unknown_id', `There is no block ${JSON.stringify(String(id).slice(0, 80))} in this note. Use a block id that the outline of this note gives.`, { got: id })
      const content = blockContent(block)
      return content === '' ? `${block.id} ${about(block)}` : `${block.id} ${about(block)}\n${content}`
    })
    .join('\n\n')
}
