// Markdown export: reading order, roles as Markdown, math
// as $…$ and $$…$$, diagrams as fenced mermaid blocks, tables as pipe tables,
// images as files beside the .md. Coloured words lose their colour: plain
// Markdown has none.
// Ink becomes an image in phase 6; until then only its transcription is kept.
import { exportMarkdown, serializeInline } from '../markdown/inline.js'
import { pipeTable } from '../markdown/table.js'
import type { Doc, Hash, TextBlock } from '../schema/doc.js'
import { blocksInOrder, captionBlock, joinChunks, titleToShow, type Chunk } from './common.js'

export interface MarkdownOptions {
  /** Start with the title as a level-1 heading. Default true. */
  title?: boolean
}

export interface MarkdownExport {
  markdown: string
  /** Files the Markdown links to, to save beside it: relative path → asset hash. */
  files: Record<string, Hash>
}

const EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

export function toMarkdown(doc: Doc, options: MarkdownOptions = {}): MarkdownExport {
  const files: Record<string, Hash> = {}
  const blocks = blocksInOrder(doc)
  const chunks: Chunk[] = []
  const title = options.title === false ? undefined : titleToShow(doc, blocks)
  if (title !== undefined) chunks.push({ text: heading(1, escapeLineStart(serializeInline([{ t: 'text', v: title }]))), run: 0 })
  for (const { block, level, number, run } of blocks) {
    switch (block.type) {
      case 'text':
        chunks.push({ text: textBlock(block, level, number), run })
        break
      case 'math':
        if (block.tex.trim() !== '') chunks.push({ text: `$$\n${block.tex}\n$$`, run })
        break
      case 'image': {
        const ext = EXTENSION[doc.asset[block.asset]?.mime ?? ''] ?? 'bin'
        const path = `assets/${block.asset}.${ext}`
        files[path] = block.asset
        chunks.push({ text: `![${escapeAlt(block.alt ?? '')}](${path})`, run })
        if (block.caption) chunks.push({ text: textBlock(captionBlock(block.caption), 0, 0), run })
        break
      }
      case 'diagram':
        if (block.src.trim() !== '') chunks.push({ text: fenced('mermaid', block.src), run })
        break
      case 'table':
        chunks.push({ text: pipeTable(block.rows.map((row) => row.map(exportInline)), block.head === true), run })
        if (block.caption) chunks.push({ text: textBlock(captionBlock(block.caption), 0, 0), run })
        break
      case 'ink':
        if (block.text !== undefined && block.text.trim() !== '') {
          chunks.push({ text: `*Handwriting:* ${serializeInline([{ t: 'text', v: block.text.trim() }])}`, run })
        }
        break
    }
  }
  return { markdown: joinChunks(chunks), files }
}

/** A text block's md as standard Markdown: underline, subscript and superscript as HTML tags; colours, sizes and fonts become plain words. */
function exportInline(md: string): string {
  return exportMarkdown(md)
}

function textBlock(block: TextBlock, level: number, number: number): string {
  // A newline inside a block is a hard line break.
  const lines = exportInline(block.md)
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map(escapeLineStart)
  const indent = '    '.repeat(level)
  switch (block.role) {
    case 'h1':
    case 'h2':
    case 'h3':
      return heading(Number(block.role[1]), lines.join(' '))
    case 'quote':
      return breakLines(lines, '> ', '> ')
    case 'li':
      return breakLines(lines, `${indent}- `, `${indent}  `)
    case 'todo':
      return breakLines(lines, `${indent}- [${block.done ? 'x' : ' '}] `, `${indent}  `)
    case 'oli': {
      const marker = `${number}. `
      return breakLines(lines, indent + marker, indent + ' '.repeat(marker.length))
    }
    case 'p':
      return breakLines(lines, '', '')
  }
}

function breakLines(lines: string[], first: string, rest: string): string {
  return lines.length === 0 ? first.trimEnd() : lines.map((line, i) => (i === 0 ? first : rest) + line).join('\\\n')
}

function heading(level: number, text: string): string {
  // A run of # at the end of a heading line would be read as its closing marks.
  return `${'#'.repeat(level)} ${text.replace(/(\s)(#+)$/u, '$1\\$2')}`
}

/**
 * Text that starts with a block marker ("# ", "- ", "1. ", "> " and so on)
 * would turn into a heading, list or quote. Escape the marker.
 */
function escapeLineStart(line: string): string {
  const text = line.replace(/^\s+/u, '') // leading spaces mean nothing here, and four would start a code block
  const ordered = /^(\d{1,9})([.)])(\s|$)/u.exec(text)
  if (ordered) return `${ordered[1]}\\${text.slice(ordered[1]!.length)}`
  if (/^(#{1,6}(\s|$)|>|[-+*](\s|$)|(-\s*){3,}$|=+\s*$|`{3,}|~{3,}|\|)/u.test(text)) return `\\${text}`
  return text
}

function escapeAlt(alt: string): string {
  return alt.replace(/[\\[\]]/gu, (ch) => `\\${ch}`).replace(/\s+/gu, ' ')
}

function fenced(info: string, body: string): string {
  const longest = Math.max(2, ...Array.from(body.matchAll(/`+/gu), (m) => m[0].length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}${info}\n${body}\n${fence}`
}
