// The change report (the design 2, note control's step 1): after a block of lines, the note before and after
// compared, page by page, so the model sees what its lines did (new, removed, changed, moved to another page, pushed
// down, now overlapping) and decides about it rather than predicting it. Code does every position, so the report
// says how far a block was pushed, never asks the model for a place.
import { waysOut } from '../board/lines.js'
import { parseInline, plainText } from '../markdown/inline.js'
import type { Block, Doc } from '../schema/doc.js'
import { pageFacts, quoted, type Drawn, type PageFacts, type Placed } from './picture.js'

/** A move worth saying: 2 mm, in the note's units. */
const MOVED = 200

const everyPage = (doc: Doc, drawn: ReadonlyMap<string, Drawn> | undefined): PageFacts[] => doc.pages.map((_, i) => pageFacts(doc, i + 1, drawn))
const byId = (pages: readonly PageFacts[]): Map<string, Placed> => new Map(pages.flatMap((page) => page.blocks.map((one) => [one.id, one] as const)))
const pairs = (pages: readonly PageFacts[]): Set<string> => new Set(pages.flatMap((page) => page.overlaps.map(([a, b]) => `${a} overlaps ${b}`)))
const mm = (units: number): string => String(Math.round(units / 100))

/** What changed from one note to the other, in a line; none when nothing the person would see did. */
export function changeReport(before: Doc, after: Doc, drawnBefore?: ReadonlyMap<string, Drawn>, drawnAfter?: ReadonlyMap<string, Drawn>): string | undefined {
  // A board has no pages to read top to bottom: its steps and blocks, by id.
  if (after.kind === 'board') return boardReport(before, after)
  const old = everyPage(before, drawnBefore)
  const now = everyPage(after, drawnAfter)
  const was = byId(old)
  const is = byId(now)
  const said: string[] = []
  for (const [id, one] of is) {
    const prior = was.get(id)
    if (!prior) {
      said.push(`${id} new: ${one.kind}${one.level ? `, level ${one.level}` : ''}${one.words ? ` ${one.words}` : ''}, page ${one.page}, ${one.where}`)
      continue
    }
    if (prior.page !== one.page) said.push(`${id} now on page ${one.page}`)
    else if (prior.where !== one.where) said.push(`${id} now ${one.where}`)
    else if (prior.box && one.box && Math.abs(one.box.y - prior.box.y) >= MOVED) said.push(`${id} ${one.box.y > prior.box.y ? 'pushed down' : 'moved up'} ${mm(Math.abs(one.box.y - prior.box.y))} mm`)
    if (one.r !== prior.r) said.push(`${id} changed${one.words && one.words !== prior.words ? `: ${one.words}` : ''}`)
  }
  for (const id of was.keys()) if (!is.has(id) && !after.block[id]) said.push(`${id} removed`)
  if (after.pages.length !== before.pages.length) said.push(`the note has ${after.pages.length} ${after.pages.length === 1 ? 'page' : 'pages'} now`)
  const overlapsBefore = pairs(old)
  const overlapsNow = pairs(now)
  for (const pair of overlapsNow) if (!overlapsBefore.has(pair)) said.push(`⚠ ${pair} now`)
  for (const pair of overlapsBefore) if (!overlapsNow.has(pair)) said.push(`${pair.replace(' overlaps ', ' no longer overlaps ')}`)
  const crowdedBefore = new Set(old.flatMap((page) => page.crowded.map(([a, b]) => `${a} crowds ${b}`)))
  for (const page of now) for (const [a, b] of page.crowded) if (!crowdedBefore.has(`${a} crowds ${b}`)) said.push(`⚠ ${a} crowds ${b} now`)
  const stylesBefore = new Set(old.flatMap((page) => page.styles.map((line) => `${page.page}: ${line}`)))
  for (const page of now) for (const line of page.styles) if (!stylesBefore.has(`${page.page}: ${line}`)) said.push(`⚠ page ${page.page}: ${line}`)
  const offBefore = new Set(old.flatMap((page) => page.off))
  for (const page of now) for (const id of page.off) if (!offBefore.has(id)) said.push(`⚠ ${id} runs off page ${page.page} now`)
  return said.length > 0 ? `changed: ${said.join(' · ')}` : undefined
}

/** A block of a board as the report names it: a step with its shape, words and ways out; anything else by its kind. */
function boardThing(block: Block): string {
  if (block.type === 'node') return `step, ${block.shape}${block.md === '' ? '' : ` ${quoted(plainText(parseInline(block.md)))}`}${waysOut(block)}`
  if (block.type === 'ink') return block.on === undefined ? 'handwriting' : `handwriting on ${block.on}`
  if (block.type === 'frame') return 'text box'
  return block.type === 'text' ? 'words' : block.type
}

/**
 * What changed on a board, in a line: steps and blocks new, removed, moved, their words, shape or links changed. A
 * board has no pages and no edges, so nothing is pushed off one.
 */
function boardReport(before: Doc, after: Doc): string | undefined {
  const said: string[] = []
  for (const block of Object.values(after.block)) {
    const prior = before.block[block.id]
    if (!prior) {
      if (!('parent' in block)) said.push(`${block.id} new: ${boardThing(block)}`)
      continue
    }
    if (prior.r === block.r) continue
    if (block.type === 'node' && prior.type === 'node') {
      const what: string[] = []
      if (prior.md !== block.md) what.push(`words ${quoted(plainText(parseInline(block.md)))}`)
      if (prior.shape !== block.shape) what.push(`a ${block.shape}`)
      if (prior.color !== block.color) what.push(block.color === undefined ? 'no colour' : `colour ${block.color}`)
      if (JSON.stringify(prior.to ?? []) !== JSON.stringify(block.to ?? [])) what.push(block.to === undefined ? 'leads nowhere' : `leads${waysOut(block)}`)
      if (prior.x !== block.x || prior.y !== block.y) what.push(`moved ${mm(Math.hypot(block.x - prior.x, block.y - prior.y))} mm`)
      if (what.length > 0) said.push(`${block.id}: ${what.join(', ')}`)
    } else if ('page' in block && 'page' in prior && (prior.x !== block.x || prior.y !== block.y)) said.push(`${block.id} moved ${mm(Math.hypot(block.x - prior.x, block.y - prior.y))} mm`)
    else said.push(`${block.id} changed`)
  }
  for (const id of Object.keys(before.block)) if (!after.block[id] && !('parent' in before.block[id]!)) said.push(`${id} removed`)
  return said.length > 0 ? `changed: ${said.join(' · ')}` : undefined
}
