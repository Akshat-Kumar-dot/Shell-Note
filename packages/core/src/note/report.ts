// The change report (the design 2, note control's step 1): after a block of lines, the note before and after
// compared, page by page, so the model sees what its lines did (new, removed, changed, moved to another page, pushed
// down, now overlapping) and decides about it rather than predicting it. Code does every position, so the report
// says how far a block was pushed, never asks the model for a place.
import type { Doc } from '../schema/doc.js'
import { pageFacts, type Drawn, type PageFacts, type Placed } from './picture.js'

/** A move worth saying: 2 mm, in the note's units. */
const MOVED = 200

const everyPage = (doc: Doc, drawn: ReadonlyMap<string, Drawn> | undefined): PageFacts[] => doc.pages.map((_, i) => pageFacts(doc, i + 1, drawn))
const byId = (pages: readonly PageFacts[]): Map<string, Placed> => new Map(pages.flatMap((page) => page.blocks.map((one) => [one.id, one] as const)))
const pairs = (pages: readonly PageFacts[]): Set<string> => new Set(pages.flatMap((page) => page.overlaps.map(([a, b]) => `${a} overlaps ${b}`)))
const mm = (units: number): string => String(Math.round(units / 100))

/** What changed from one note to the other, in a line; none when nothing the person would see did. */
export function changeReport(before: Doc, after: Doc, drawnBefore?: ReadonlyMap<string, Drawn>, drawnAfter?: ReadonlyMap<string, Drawn>): string | undefined {
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
