// Validation layer 2 for a whole document: every reference points at the right
// thing, and every block sits in exactly one place. apply() keeps these rules
// one operation at a time; this checks a document read from outside (a file,
// another program) and backs the property tests.
import type { Block, Doc } from '../schema/doc.js'
import { has } from '../util.js'

const MAX_PROBLEMS = 50

/** Every structural problem in `doc`, as short sentences. Empty means consistent. */
export function structureProblems(doc: Doc): string[] {
  const problems: string[] = []
  const problem = (text: string): void => {
    if (problems.length < MAX_PROBLEMS) problems.push(text)
  }

  // Keys match ids, and ids are unique across the document, its pages and blocks.
  if (has(doc.page, doc.id) || has(doc.block, doc.id)) problem(`the document id ${doc.id} is also used inside it`)
  for (const [key, page] of Object.entries(doc.page)) {
    if (page.id !== key) problem(`page key ${key} holds page ${page.id}`)
  }
  for (const [key, block] of Object.entries(doc.block)) {
    if (block.id !== key) problem(`block key ${key} holds block ${block.id}`)
    if (has(doc.page, key)) problem(`id ${key} is used by a page and a block`)
    if (block.r > doc.rev) problem(`block ${key} has r ${block.r}, later than the document rev ${doc.rev}`)
  }

  // The page order lists every page exactly once.
  if (doc.pages.length === 0) problem('a document has at least one page')
  const listed = new Set<string>()
  for (const id of doc.pages) {
    if (!has(doc.page, id)) problem(`pages lists ${id}, which does not exist`)
    if (listed.has(id)) problem(`pages lists ${id} twice`)
    listed.add(id)
  }
  for (const id of Object.keys(doc.page)) {
    if (!listed.has(id)) problem(`page ${id} is missing from pages`)
  }

  // Count where each block is listed: free blocks in page.free, children in frame.kids.
  const listedFree = new Map<string, number>()
  for (const page of Object.values(doc.page)) {
    for (const id of page.free) {
      const block = doc.block[id]
      if (!block) problem(`page ${page.id} lists ${id}, which does not exist`)
      else if (!('page' in block)) problem(`page ${page.id} lists ${id}, which sits in a frame`)
      else if (block.page !== page.id) problem(`page ${page.id} lists ${id}, which is on page ${block.page}`)
      listedFree.set(id, (listedFree.get(id) ?? 0) + 1)
    }
  }
  const listedKid = new Map<string, number>()
  for (const frame of Object.values(doc.block)) {
    if (frame.type !== 'frame') continue
    for (const id of frame.kids) {
      const kid = doc.block[id]
      if (!kid) problem(`frame ${frame.id} lists ${id}, which does not exist`)
      else if (!('parent' in kid)) problem(`frame ${frame.id} lists ${id}, which is placed on a page`)
      else if (kid.parent !== frame.id) problem(`frame ${frame.id} lists ${id}, whose frame is ${kid.parent}`)
      listedKid.set(id, (listedKid.get(id) ?? 0) + 1)
    }
  }

  for (const block of Object.values(doc.block)) {
    if ('page' in block) {
      if (!has(doc.page, block.page)) problem(`block ${block.id} is on page ${block.page}, which does not exist`)
      const n = listedFree.get(block.id) ?? 0
      if (n !== 1) problem(`block ${block.id} is listed ${n} times in its page's free list`)
    } else {
      const parent = doc.block[block.parent]
      if (parent?.type !== 'frame') problem(`block ${block.id} names ${block.parent} as its frame, which is not a frame`)
      const n = listedKid.get(block.id) ?? 0
      if (n !== 1) problem(`block ${block.id} is listed ${n} times in its frame's kids`)
    }
    if (block.type === 'image' && !has(doc.asset, block.asset)) {
      problem(`image ${block.id} uses asset ${block.asset}, which does not exist`)
    }
  }

  // The note's videos and their marks, and the programs written beside (version 4): ids new to the document, a file's
  // asset there, a mark on a video and a page.
  const mediaIds = new Set<string>()
  for (const item of [...(doc.media ?? []), ...(doc.clips ?? []), ...(doc.programs ?? [])]) {
    if (mediaIds.has(item.id) || item.id === doc.id || has(doc.page, item.id) || has(doc.block, item.id)) problem(`the id ${item.id} of a video, a mark or a program is used twice`)
    mediaIds.add(item.id)
  }
  for (const item of doc.media ?? []) {
    if (item.kind === 'file' && !has(doc.asset, item.asset)) problem(`video ${item.id} uses asset ${item.asset}, which does not exist`)
  }
  for (const clip of doc.clips ?? []) {
    if (!(doc.media ?? []).some((m) => m.id === clip.media)) problem(`mark ${clip.id} is of video ${clip.media}, which the note does not have`)
    if (!has(doc.page, clip.page)) problem(`mark ${clip.id} is on page ${clip.page}, which does not exist`)
  }

  // A line written beside a program: its program there, and its picture.
  for (const block of Object.values(doc.block)) {
    if (block.type !== 'ink') continue
    for (const stroke of block.strokes) {
      if (!stroke.pm) continue
      if (!(doc.programs ?? []).some((source) => source.id === stroke.pm!.m)) problem(`a stroke of block ${block.id} was written beside program ${stroke.pm.m}, which the note does not have`)
      if (stroke.pm.pic !== undefined && !has(doc.asset, stroke.pm.pic)) problem(`a stroke of block ${block.id} keeps asset ${stroke.pm.pic} as its picture, which does not exist`)
    }
  }

  // Continuation frames (`next`) form simple chains: no branches, no loops.
  const continuedFrom = new Set<string>()
  for (const frame of Object.values(doc.block)) {
    if (frame.type !== 'frame' || frame.next === undefined) continue
    const target = doc.block[frame.next]
    if (frame.next === frame.id) problem(`frame ${frame.id} continues in itself`)
    else if (target?.type !== 'frame') problem(`frame ${frame.id} continues in ${frame.next}, which is not a frame`)
    if (continuedFrom.has(frame.next)) problem(`two frames continue in ${frame.next}`)
    continuedFrom.add(frame.next)
  }
  const looped = new Set<string>()
  for (const start of Object.values(doc.block)) {
    if (start.type !== 'frame' || looped.has(start.id)) continue
    const seen = new Set<string>()
    let at: Block | undefined = start
    while (at?.type === 'frame' && at.next !== undefined) {
      if (seen.has(at.id)) {
        problem(`frames continue in a loop through ${at.id}`)
        for (const id of seen) looped.add(id)
        break
      }
      seen.add(at.id)
      at = doc.block[at.next]
    }
  }

  return problems
}
