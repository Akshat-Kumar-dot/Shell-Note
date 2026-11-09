// The outline: one short line per block, in reading order. It is what the MCP
// tool get_outline returns and what the AI sees of the blocks around a
// selection, so it is kept compact: id, kind, then the first few words.
import { linearise, type Item } from './linearise.js'
import { parseInline, plainText } from './markdown/inline.js'
import type { Block, Doc, Id } from './schema/doc.js'

export interface OutlineOptions {
  /** Only this page. */
  page?: Id
  /** Words of text shown per block. Default 12. */
  words?: number
}

/**
 * For example:
 *
 *   Physics lecture 4
 *   page 1/1 p1
 *   f1 frame
 *     t1 h2 Newton's laws
 *     t2 p An object at rest stays at rest unless a force acts on it.
 */
export function outline(doc: Doc, options: OutlineOptions = {}): string {
  const words = options.words ?? 12
  const lines = [preview(doc.title, words) || '(untitled)']
  let page: Id | undefined
  for (const item of linearise(doc, options.page === undefined ? {} : { page: options.page })) {
    if (item.page !== page) {
      page = item.page
      lines.push(`page ${doc.pages.indexOf(page) + 1}/${doc.pages.length} ${page}`)
    }
    lines.push(line(item, words))
  }
  return lines.join('\n')
}

/** One outline line for a block. */
export function line(item: Item, words = 12): string {
  const indent = item.depth === 1 ? '  ' : ''
  return `${indent}${item.block.id} ${describe(item.block, words)}`
}

function describe(block: Block, words: number): string {
  switch (block.type) {
    case 'frame': {
      const parts = ['frame']
      if (block.kids.length === 0) parts.push('(empty)')
      if (block.next !== undefined) parts.push(`continues in ${block.next}`)
      return parts.join(' ')
    }
    case 'text': {
      const role = block.indent > 0 ? `${block.role}+${block.indent}` : block.role
      const tick = block.role === 'todo' ? (block.done ? ' [x]' : ' [ ]') : ''
      return `${role}${tick} ${preview(plainText(parseInline(block.md)), words) || '(empty)'}`
    }
    case 'math':
      return `math ${preview(block.tex, words) || '(empty)'}${block.value === undefined ? '' : ` = ${block.value}`}`
    case 'image':
      return `image ${preview(block.alt ?? '', words) || '(no description)'}`
    case 'diagram':
      return `diagram ${preview(block.src, words) || '(empty)'}`
    case 'ink': {
      const n = block.strokes.length
      return `ink ${block.text === undefined ? `(${n} stroke${n === 1 ? '' : 's'})` : `"${preview(block.text, words)}"`}`
    }
    case 'table': {
      // Its size, then the first row, which is usually the header.
      const first = block.rows[0]!.map((md) => plainText(parseInline(md))).join(' | ')
      return `table ${block.rows.length}x${block.rows[0]!.length} ${preview(first, words) || '(empty)'}`
    }
  }
}

/** The first `words` words on one line, with … when there were more. */
function preview(text: string, words: number): string {
  const all = text.trim().split(/\s+/u).filter(Boolean)
  return all.length > words ? `${all.slice(0, words).join(' ')}…` : all.join(' ')
}
