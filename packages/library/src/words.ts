// The words of a note, for the library's search of the words inside notes: its title and what its blocks say, in
// lower case, at most 200,000 characters. Kept on the device beside the library, and made again as a note is saved.
// And its first words, as the library's list shows them under its name.
import { linearise, parseInline, plainText, type Doc } from '@shellnote/core'

/** The most of a note's words kept for the search. */
export const MOST_WORDS = 200_000

/** The most of a note's first words a line of the library's list holds. */
export const SNIP_LENGTH = 140

const words = (md: string): string => plainText(parseInline(md))

/** A note's first words: what its blocks say in reading order, on one line, without its title. */
export function noteSnip(doc: Doc): string {
  let snip = ''
  for (const { block } of linearise(doc)) {
    const said = block.type === 'text' ? words(block.md) : block.type === 'ink' ? (block.text ?? '') : block.type === 'table' ? block.rows.flat().map(words).join(' ') : ''
    if (said.trim() === '') continue
    snip = `${snip} ${said}`.replace(/\s+/gu, ' ').trim()
    if (snip.length >= SNIP_LENGTH) break
  }
  return snip.slice(0, SNIP_LENGTH)
}

/** A note's words, in lower case. */
export function noteWords(doc: Doc): string {
  const parts: string[] = [doc.title]
  for (const block of Object.values(doc.block)) {
    if (block.type === 'text') parts.push(words(block.md))
    else if (block.type === 'table') {
      for (const row of block.rows) parts.push(row.map(words).join(' '))
      if (block.caption) parts.push(words(block.caption))
    } else if (block.type === 'image') {
      if (block.alt) parts.push(block.alt)
      if (block.caption) parts.push(words(block.caption))
    } else if (block.type === 'ink') {
      if (block.text) parts.push(block.text)
    } else if (block.type === 'math') parts.push(block.tex)
    else if (block.type === 'diagram') parts.push(block.src)
  }
  return parts.join('\n').toLowerCase().replace(/[ \t]+/gu, ' ').slice(0, MOST_WORDS)
}

/** Whether a note's words hold every word of a search, in any order. */
export function holdsWords(noteWordsText: string, search: string): boolean {
  const wanted = search.toLowerCase().split(/\s+/u).filter((word) => word !== '')
  return wanted.length > 0 && wanted.every((word) => noteWordsText.includes(word))
}
