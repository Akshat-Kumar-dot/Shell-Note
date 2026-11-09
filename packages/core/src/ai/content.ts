// The content step: when an operation needs new words, a
// formula or a diagram, a second, plain-text call writes just that. Small
// models break on escaping long text inside JSON, so content never goes there.
// The topic guide of the rulebook travels with this call.
import { pipeTable } from '../markdown/table.js'
import type { Doc } from '../schema/doc.js'
import type { AiOp } from '../schema/protocol.js'
import type { Selection } from '../select/selection.js'
import { boxAnchor, inBox, type Aliases } from './alias.js'
import { blockLine, textOf, type Prompt } from './context.js'
import { mendFlowchart } from './mermaid.js'
import { RULEBOOK } from './rulebook.generated.js'

/** What a content step writes: text for a block, LaTeX, Mermaid, a pipe table, an image description, list items, or a link. */
export type ContentKind = 'text' | 'math' | 'diagram' | 'table' | 'alt' | 'items' | 'link'

export interface ContentTask {
  kind: ContentKind
  prompt: Prompt
}

const ALT = 'Write a short description of an image for someone who cannot see it. Reply with the description only.'
const ITEMS = `${RULEBOOK.topics.text}\n\nHere, write list items: one item per line, without "-" or "1." at the start.`
const LINK = 'Reply with one web address only, starting with https:// (or mailto: for an email address).'
const INK = 'Write what a piece of handwriting says, as plain text. Reply with the text only.'

/**
 * The content step an operation needs, or undefined when it needs none.
 * `href` is a link address already found in the request, so `mark` with a
 * link needs no call.
 */
export function contentTask(input: {
  doc: Doc
  op: AiOp
  aliases: Aliases
  selection: Selection
  instruction: string
  href?: string
}): ContentTask | undefined {
  const { doc, op, aliases, selection, instruction } = input
  const ask = `ASK\n${instruction.trim()}`
  switch (op.op) {
    case 'rewrite': {
      const block = doc.block[aliases.id(op.id)]!
      switch (block.type) {
        case 'text': {
          // Words chosen inside the block are rewritten alone (protocol v1.1).
          const range = aliases.words(op.id)
          const words = range ? textOf(block).slice(range.start, range.end) : undefined
          return {
            kind: 'text',
            prompt: {
              system: words === undefined ? RULEBOOK.topics.text : `${RULEBOOK.topics.text}\n- Rewrite only the SELECTED TEXT, and reply with its new wording only.`,
              user: `TEXT\n${block.md}\n${words === undefined ? '' : `SELECTED TEXT\n${words}\n`}${ask}`,
            },
          }
        }
        case 'math':
          return { kind: 'math', prompt: { system: RULEBOOK.topics.math, user: `FORMULA\n${block.tex}\n${ask}` } }
        case 'diagram':
          return { kind: 'diagram', prompt: { system: RULEBOOK.topics.diagram, user: `DIAGRAM\n${block.src}\n${ask}` } }
        case 'image':
          return { kind: 'alt', prompt: { system: ALT, user: `DESCRIPTION\n${block.alt ?? ''}\n${ask}` } }
        case 'ink':
          return { kind: 'text', prompt: { system: INK, user: `TRANSCRIPTION\n${block.text ?? ''}\n${ask}` } }
        case 'table':
          // A table is rewritten as a whole pipe table (v1.1); code turns it back into rows.
          return { kind: 'table', prompt: { system: RULEBOOK.topics.table, user: `TABLE\n${pipeTable(block.rows, block.head === true)}\n${ask}` } }
        case 'frame':
          return undefined
      }
      return undefined
    }
    case 'insert': {
      // In a Select box, new things follow what it holds (v1.1); new words join the chosen words' paragraph.
      const anchor = op.at === 'here' && inBox(selection) ? boxAnchor(doc, aliases) : undefined
      if (anchor?.words && op.kind === 'text') {
        const block = doc.block[anchor.id]
        const md = block?.type === 'text' ? block.md : ''
        return {
          kind: 'text',
          prompt: {
            system: `${RULEBOOK.topics.text}\n- Write only the new words: they go right after the CHOSEN WORDS, in the same paragraph.`,
            user: `TEXT\n${md}\nCHOSEN WORDS\n${textOf(block).slice(anchor.words.start, anchor.words.end)}\n${ask}`,
          },
        }
      }
      const around = aliases.near.map((n) => `${n.side}: ${blockLine(doc.block[n.id]!, 200)}`)
      const ref = op.ref !== undefined ? doc.block[aliases.id(op.ref)] : anchor ? doc.block[anchor.id] : undefined
      const context = [...(ref ? [`NEXT TO: ${blockLine(ref, 300)}`] : []), ...around].join('\n')
      return { kind: op.kind, prompt: { system: topic(op.kind), user: `${context ? `${context}\n` : ''}${ask}` } }
    }
    case 'convert': {
      const text = op.ids.map((alias) => blockLine(doc.block[aliases.id(alias)]!, 2000)).join('\n')
      const into = op.into
      const kind: ContentKind = into === 'list' || into === 'steps' ? 'items' : into === 'paragraph' ? 'text' : into
      return { kind, prompt: { system: kind === 'items' ? ITEMS : topic(kind), user: `BLOCKS\n${text}\n${ask}` } }
    }
    case 'mark': {
      if (op.link !== true || input.href !== undefined) return undefined
      const block = doc.block[aliases.id(op.id)]
      const range = aliases.words(op.id)
      const words = range ? textOf(block).slice(range.start, range.end) : textOf(block)
      return { kind: 'link', prompt: { system: LINK, user: `TEXT\n${words}\n${ask}` } }
    }
    default:
      return undefined
  }
}

/** The topic guide for writing one kind of content. */
function topic(kind: ContentKind): string {
  if (kind === 'math' || kind === 'diagram' || kind === 'table') return RULEBOOK.topics[kind]
  return RULEBOOK.topics.text
}

/** A colour code a request gives (#e0563a, or the short #e05), as # and six lowercase hex digits. */
export function colourIn(instruction: string): string | undefined {
  const hex = /#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-z])/iu.exec(instruction)?.[1]?.toLowerCase()
  if (hex === undefined) return undefined
  return `#${hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex}`
}

/** The first web or email address in a request, if it holds one. */
export function linkIn(instruction: string): string | undefined {
  return /(https?:\/\/[^\s"'<>)]+|mailto:[^\s"'<>)]+)/iu.exec(instruction)?.[1]
}

/**
 * Tidy what a small model wrote around its content: code fences, a chatty
 * first line ("Sure! Here is…:"), quotes around the whole reply, and for math
 * the $ signs it was told not to write.
 */
export function cleanContent(kind: ContentKind, reply: string): string {
  let text = reply.replace(/\r\n/gu, '\n').trim()
  const fenced = /^```[\w-]*\n([\s\S]*?)\n?```$/u.exec(text)
  if (fenced) text = fenced[1]!.trim()
  const lines = text.split('\n')
  if (lines.length > 1 && /:\s*$/u.test(lines[0]!) && /^(sure|here|okay|ok|certainly)\b/iu.test(lines[0]!)) text = lines.slice(1).join('\n').trim()
  // A code fence after that first line ("Here is the table:" then ```).
  const fencedAfter = /^```[\w-]*\n([\s\S]*?)\n?```$/u.exec(text)
  if (fencedAfter) text = fencedAfter[1]!.trim()
  const quoted = /^(["“'])([\s\S]*)(["”'])$/u.exec(text)
  if (quoted && kind !== 'math' && kind !== 'diagram') text = quoted[2]!.trim()
  switch (kind) {
    case 'math':
      return text.replace(/^\$\$([\s\S]*)\$\$$/u, '$1').replace(/^\$([\s\S]*)\$$/u, '$1').replace(/^\\\[([\s\S]*)\\\]$/u, '$1').replace(/^\\\(([\s\S]*)\\\)$/u, '$1').trim()
    case 'items':
      return text
        .split('\n')
        .map((line) => line.replace(/^\s*(?:[-*+•]|\d{1,3}[.)])\s+/u, '').trim())
        .filter(Boolean)
        .join('\n')
    case 'link':
      return linkIn(text) ?? text.split(/\s+/u)[0] ?? ''
    case 'text': {
      // "# Subtitle" or "- item" on one line means the words: the block's role does the rest.
      const one = text.replace(/\n{2,}/gu, ' ')
      return one.includes('\n') ? one : one.replace(/^(?:#{1,6}|[-*+]|\d{1,3}[.)]|>)\s+/u, '')
    }
    case 'alt':
      return text.replace(/\n{2,}/gu, ' ')
    case 'diagram':
      // Some models name the language on a line of its own before the diagram, and slip on a flowchart's lines.
      return mendFlowchart(text.replace(/^mermaid[ \t]*\n/iu, '').trim())
    case 'table':
      return text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n')
  }
}
