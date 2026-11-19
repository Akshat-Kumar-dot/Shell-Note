// Search in every note: every word looked for, in any order and anywhere in a word ("photo" finds "photosynthesis"),
// and words in "quotes" side by side as written. The notes that may hold them come from the words each note keeps
// (the library's findWords, made as each note is saved), so a search reads only those notes, for their lines.
import { linearise, parseInline, plainText, type Doc, type NoteKind } from '@shellnote/core'
import { Shared } from '@shellnote/editor'
import type { Library, LibraryStore } from '@shellnote/library'
import { folderPath, hidden } from '@shellnote/library/tree'

/** What is looked for: single words, and the phrases written in quotes, all in small letters. */
export interface Terms {
  words: string[]
  phrases: string[]
}

export function termsOf(search: string): Terms {
  const phrases: string[] = []
  const rest = search.replace(/"([^"]*)"/gu, (_, phrase: string) => {
    const found = phrase.trim().toLowerCase().replace(/\s+/gu, ' ')
    if (found !== '') phrases.push(found)
    return ' '
  })
  const words = rest
    .toLowerCase()
    .replace(/"/gu, ' ')
    .split(/\s+/u)
    .filter((word) => word !== '')
  return { words, phrases }
}

/** A line of a note that holds what is looked for: its block (and the frame that holds it), its words, and where the words looked for are in them. */
export interface HitLine {
  block: string
  frame?: string
  text: string
  /** Each from where to where, in `text`. */
  spans: [number, number][]
  /** Cut at its start or end, to show the words looked for. */
  cutBefore: boolean
  cutAfter: boolean
}

/** A note that holds the words: its first lines that do, and how many lines do. */
export interface Hit {
  id: string
  title: string
  kind: NoteKind
  where: string
  lines: HitLine[]
  count: number
}

/** What a search found, as the column shows it. */
export interface Found {
  words: string
  hits: Hit[]
  /** Notes that hold the words past the first read, left for a narrower search. */
  more: number
  busy: boolean
}

/** The last search, as the column shows it; none before one is made. */
export const found = new Shared<Found | undefined>(undefined)

/** The lines of a note, in reading order: each block's words as they read, a table's rows, a picture's words, ink's recognised words, a formula, a diagram, a board's step. */
export function linesOf(doc: Doc): { block: string; frame?: string; text: string }[] {
  const out: { block: string; frame?: string; text: string }[] = []
  const read = (md: string): string => plainText(parseInline(md))
  for (const { block } of linearise(doc)) {
    let text = ''
    if (block.type === 'text' || block.type === 'node') text = read(block.md)
    else if (block.type === 'table') text = block.rows.map((row) => row.map(read).join(' · ')).join(' / ')
    else if (block.type === 'ink') text = block.text ?? ''
    else if (block.type === 'image') text = [block.alt ?? '', block.caption ? read(block.caption) : ''].filter(Boolean).join(' ')
    else if (block.type === 'math') text = block.tex
    else if (block.type === 'diagram') text = block.src
    if (text.trim() === '') continue
    out.push({ block: block.id, ...(block.type === 'text' && block.parent ? { frame: block.parent } : {}), text })
  }
  return out
}

/** Where in a line the words looked for are: each place any of them is, joined where they touch. */
function spansIn(line: string, terms: Terms): [number, number][] {
  const lower = line.toLowerCase()
  const spans: [number, number][] = []
  for (const term of [...terms.phrases, ...terms.words]) {
    let at = lower.indexOf(term)
    while (at >= 0 && term !== '') {
      spans.push([at, at + term.length])
      at = lower.indexOf(term, at + term.length)
    }
  }
  spans.sort((a, b) => a[0] - b[0])
  const joined: [number, number][] = []
  for (const span of spans) {
    const last = joined.at(-1)
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1])
    else joined.push([span[0], span[1]])
  }
  return joined
}

/** A long line cut round the first words looked for, so they show; the spans moved with it. */
const SHOWN = 160
function clipped(line: { block: string; frame?: string; text: string }, spans: [number, number][]): HitLine {
  const first = spans[0]?.[0] ?? 0
  const from = line.text.length <= SHOWN ? 0 : Math.max(0, Math.min(first - 40, line.text.length - SHOWN))
  const to = Math.min(line.text.length, from + SHOWN)
  return {
    block: line.block,
    ...(line.frame ? { frame: line.frame } : {}),
    text: line.text.slice(from, to),
    spans: spans.filter(([a]) => a >= from && a < to).map(([a, b]) => [a - from, Math.min(b, to) - from]),
    cutBefore: from > 0,
    cutAfter: to < line.text.length,
  }
}

/** The notes read for one search at most: a search that finds more is narrowed with more words. */
const MOST = 60

/**
 * Search every note for some words: the notes whose words list holds every one are read, newest first, and each note
 * that holds them all (a phrase as written) is given with its first three lines that hold any.
 */
export async function searchAll(store: LibraryStore, library: Library, search: string): Promise<Omit<Found, 'busy'>> {
  const terms = termsOf(search)
  const asked = [...terms.words, ...terms.phrases]
  if (asked.length === 0) return { words: search, hits: [], more: 0 }
  // The notes that may hold them, from their words: a phrase's words each.
  const may = new Set(await (store.findWords?.([...terms.words, ...terms.phrases.flatMap((phrase) => phrase.split(' '))].join(' ')) ?? Promise.resolve([])))
  const notes = library.notes.filter((entry) => may.has(entry.id) && !hidden(library, entry)).sort((a, b) => b.edited - a.edited)
  const hits: Hit[] = []
  for (const entry of notes.slice(0, MOST)) {
    let doc: Doc
    try {
      doc = await (store.read ? store.read(entry.id) : store.open(entry.id).then((opened) => opened.doc))
    } catch {
      continue
    }
    const lines = linesOf(doc)
    const whole = [doc.title, ...lines.map((line) => line.text)].join('\n').toLowerCase()
    // Every word somewhere in the note, and each phrase as written.
    if (!asked.every((term) => whole.includes(term))) continue
    const holding = lines.map((line) => ({ line, spans: spansIn(line.text, terms) })).filter(({ spans }) => spans.length > 0)
    hits.push({
      id: entry.id,
      title: entry.title || 'Untitled',
      kind: entry.kind ?? 'mixed',
      where: entry.folder === null ? 'Library' : folderPath(library, entry.folder).map((folder) => folder.name).join(' › '),
      lines: holding.slice(0, 3).map(({ line, spans }) => clipped(line, spans)),
      count: holding.length,
    })
  }
  return { words: search, hits, more: Math.max(0, notes.length - MOST) }
}

/** What a search found, in words, for whoever asked with a command: the notes, each with its first line. */
export function foundLine(result: Omit<Found, 'busy'>): string {
  if (result.hits.length === 0) return `no note holds "${result.words}"`
  const notes = result.hits.map((hit) => `"${hit.title}" (${hit.id}${hit.lines[0] ? `): ${hit.lines[0].cutBefore ? '…' : ''}${hit.lines[0].text}${hit.lines[0].cutAfter ? '…' : ''}` : ')'}`)
  return `${result.hits.length} ${result.hits.length === 1 ? 'note holds' : 'notes hold'} "${result.words}": ${notes.join('; ')}${result.more > 0 ? `; ${result.more} more past these: narrow the words` : ''}`
}
