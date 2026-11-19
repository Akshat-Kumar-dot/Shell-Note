// Plain-text export: the same walk as Markdown, text only.
// Inline math keeps its $ signs and math blocks are written as LaTeX.
// A board's flowchart is its steps, a line each in the order it runs, each with where it leads when that is not
// simply the next line.
import { parseInline, plainText } from '../markdown/inline.js'
import type { Doc, NodeBlock, TextBlock } from '../schema/doc.js'
import { blocksInOrder, captionBlock, chartsOnce, joinChunks, titleToShow, type Chunk } from './common.js'

export function toText(doc: Doc, options: { title?: boolean } = {}): string {
  const blocks = blocksInOrder(doc)
  const chartAt = chartsOnce(doc)
  const chunks: Chunk[] = []
  const title = options.title === false ? undefined : titleToShow(doc, blocks)
  if (title !== undefined) chunks.push({ text: title, run: 0 })
  for (const { block, level, number, run } of blocks) {
    switch (block.type) {
      case 'text':
        chunks.push({ text: textBlock(block, level, number), run })
        break
      case 'math':
        if (block.tex.trim() !== '') chunks.push({ text: block.tex, run })
        break
      case 'image':
        chunks.push({ text: block.alt ? `[image: ${block.alt}]` : '[image]', run })
        if (block.caption) chunks.push({ text: textBlock(captionBlock(block.caption), 0, 0), run })
        break
      case 'diagram':
        chunks.push({ text: '[diagram]', run })
        break
      case 'table':
        chunks.push({ text: textTable(block.rows, block.head === true), run })
        if (block.caption) chunks.push({ text: textBlock(captionBlock(block.caption), 0, 0), run })
        break
      case 'ink':
        if (block.text !== undefined && block.text.trim() !== '') chunks.push({ text: `[handwriting: ${block.text.trim()}]`, run })
        break
      case 'node': {
        const chart = chartAt(block.id)
        if (chart) chunks.push({ text: steps(chart), run })
        break
      }
    }
  }
  return joinChunks(chunks)
}

/**
 * A flowchart as lines: each step's words, and where it leads unless that is only the next line, its link's words in
 * brackets: "Passed? → Publish (yes), Write the draft (no)".
 */
function steps(chart: readonly NodeBlock[]): string {
  const words = (node: NodeBlock): string => plainText(parseInline(node.md)).replace(/\s+/gu, ' ').trim() || '(an empty step)'
  const byId = new Map(chart.map((node) => [node.id, node]))
  return chart
    .map((node, i) => {
      const ways = (node.to ?? []).filter((link) => byId.has(link.node))
      const onlyNext = ways.length === 1 && ways[0]!.label === undefined && ways[0]!.node === chart[i + 1]?.id
      if (ways.length === 0 || onlyNext) return words(node)
      return `${words(node)} → ${ways.map((link) => `${words(byId.get(link.node)!)}${link.label === undefined ? '' : ` (${link.label})`}`).join(', ')}`
    })
    .join('\n')
}

function textBlock(block: TextBlock, level: number, number: number): string {
  const lines = plainText(parseInline(block.md))
    .split('\n')
    .filter((line) => line.trim() !== '')
  const indent = '  '.repeat(level)
  const marker =
    block.role === 'li'
      ? '- '
      : block.role === 'oli'
        ? `${number}. `
        : block.role === 'todo'
          ? `[${block.done ? 'x' : ' '}] `
          : block.role === 'quote'
            ? '> '
            : ''
  const first = block.role === 'quote' ? marker : indent + marker
  const rest = block.role === 'quote' ? marker : indent + ' '.repeat(marker.length)
  return lines.map((line, i) => (i === 0 ? first : rest) + line).join('\n')
}

/** A table as lines of plain text, its columns lined up with spaces, and a rule under a header. */
function textTable(rows: readonly (readonly string[])[], head: boolean): string {
  const cells = rows.map((row) => row.map((md) => plainText(parseInline(md))))
  const widths = cells[0]!.map((_, col) => Math.max(1, ...cells.map((row) => row[col]!.length)))
  const line = (row: readonly string[]): string => row.map((cell, col) => cell.padEnd(widths[col]!)).join('  ').trimEnd()
  const lines = cells.map(line)
  if (head) lines.splice(1, 0, line(widths.map((width) => '-'.repeat(width))))
  return lines.join('\n')
}
