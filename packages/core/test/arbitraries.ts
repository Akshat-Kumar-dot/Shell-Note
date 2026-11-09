// Random but valid operations, for property tests. fast-check generates plain
// numbers ("seeds"); planOp() turns a seed into an operation that is valid for
// the document as it is at that moment. Ids are counted, not random, so a
// failing case replays and shrinks the same way every time.
import fc from 'fast-check'
import { apply, idTaken, type Block, type Doc, type Op } from '../src/index.js'
import { has, splitsCharacter } from '../src/util.js'

export interface Seed {
  kind: number
  a: number
  b: number
  c: number
  d: number
  flag: boolean
  text: string
}

export const seed: fc.Arbitrary<Seed> = fc.record({
  kind: fc.nat(),
  a: fc.nat(),
  b: fc.nat(),
  c: fc.nat(),
  d: fc.nat(),
  flag: fc.boolean(),
  // Whole characters, emoji included, so every string is valid UTF-16.
  text: fc.string({ unit: 'grapheme', maxLength: 12 }),
})

/** A list of transactions, each a list of 1 to 4 seeds. */
export const transactions = fc.array(fc.array(seed, { minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 20 })

const ROLES = ['p', 'h1', 'h2', 'h3', 'li', 'oli', 'todo', 'quote'] as const
const COLORS = ['ink', 'gray', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const
const SIZES = ['s', 'm', 'l', 'xl'] as const
const BGS = ['blank', 'ruled', 'grid', 'dots'] as const

function pick<T>(list: readonly T[], n: number): T | undefined {
  return list.length === 0 ? undefined : list[n % list.length]
}

/** Hands out ids and hashes that are new to the document. */
export class Namer {
  private count = 0

  id(doc: Doc): string {
    for (;;) {
      const id = `z${this.count++}`
      if (!idTaken(doc, id)) return id
    }
  }

  hash(doc: Doc): string {
    for (;;) {
      const hash = (0xab000 + this.count++).toString(16)
      if (!has(doc.asset, hash)) return hash
    }
  }
}

const pos = (n: number) => (n % 31000) - 1000
const len = (n: number) => n % 20000
const strokeFrom = (s: Seed) => ({
  pts: [pos(s.a), pos(s.b), s.c % 256, pos(s.d), pos(s.a + 7), (s.c + 1) % 256],
  // Version 3: a colour code, five widths, a pen kind, tilt and a shape.
  color: s.c % 5 === 0 ? `#${(s.a % 0xffffff).toString(16).padStart(6, '0')}` : pick(COLORS, s.d)!,
  width: pick(['xs', 's', 'm', 'l', 'xl'] as const, s.b)!,
  ...(s.d % 4 === 1 ? { tool: pick(['pencil', 'fountain', 'marker', 'highlighter'] as const, s.c)!, tilt: [s.a % 91, s.b % 91] } : {}),
  ...(s.flag ? { straight: true as const, shape: { kind: 'line' as const, key: [pos(s.a), pos(s.b), pos(s.d), pos(s.a + 7)] } } : {}),
})

/** Positions in `text` that do not cut a character in two. */
function boundaries(text: string): number[] {
  const out: number[] = []
  for (let i = 0; i <= text.length; i++) if (!splitsCharacter(text, i)) out.push(i)
  return out
}

/** Turn a seed into an operation that is valid for `doc`, or undefined when none fits. */
export function planOp(namer: Namer, doc: Doc, s: Seed): Op | undefined {
  const blocks = Object.values(doc.block)
  const frames = blocks.filter((b) => b.type === 'frame')
  const pages = doc.pages.map((id) => doc.page[id]!)
  const assets = Object.keys(doc.asset)
  const freePlace = () => {
    const page = pick(pages, s.a)!
    return { page: page.id, x: pos(s.b), y: pos(s.c), w: len(s.d), h: len(s.d + s.a) }
  }

  switch (s.kind % 15) {
    case 0: {
      const frame = pick(frames, s.a)
      if (!frame) return undefined
      const role = pick(ROLES, s.b)!
      const done = role === 'todo' && s.flag ? { done: true } : {}
      const block = { id: namer.id(doc), r: 0, type: 'text', parent: frame.id, role, indent: s.c % 9, md: s.text, ...done } as Block
      return { op: 'add', block, at: s.d % (frame.kids.length + 1) }
    }
    case 1: {
      const type = pick(['math', 'image', 'diagram', 'table'] as const, s.b)!
      const content =
        type === 'math'
          ? { tex: s.text }
          : type === 'diagram'
            ? { lang: 'mermaid', src: s.text }
            : type === 'table'
              ? { rows: cellsFrom(s), ...(s.flag ? { head: true } : {}) }
              : assets.length > 0
                ? { asset: pick(assets, s.c)!, ...(s.flag ? { alt: s.text } : {}) }
                : undefined
      if (!content) return undefined
      const frame = pick(frames, s.a)
      // A table sits only in a frame.
      if (type === 'table' && !frame) return undefined
      if (frame && (s.d % 2 === 0 || type === 'table')) {
        const block = { id: namer.id(doc), r: 0, type, parent: frame.id, ...content } as Block
        return { op: 'add', block, at: s.c % (frame.kids.length + 1) }
      }
      return { op: 'add', block: { id: namer.id(doc), r: 0, type, ...freePlace(), ...content } as Block }
    }
    case 2:
      return { op: 'add', block: { id: namer.id(doc), r: 0, type: 'frame', ...freePlace(), kids: [] } as Block }
    case 3: {
      const strokes = s.flag ? [strokeFrom(s)] : []
      return { op: 'add', block: { id: namer.id(doc), r: 0, type: 'ink', ...freePlace(), strokes } as Block }
    }
    case 4: {
      const block = pick(blocks, s.a)
      return block && { op: 'remove', id: block.id }
    }
    case 5: {
      const block = pick(blocks, s.a)
      if (!block) return undefined
      const set = pick(fieldsFor(block, s, assets), s.b)
      return set && { op: 'update', id: block.id, set }
    }
    case 6: {
      const page = pick(pages, s.a)!
      const set = pick([{ bg: pick(BGS, s.c)! }, { w: 1 + len(s.c) }, { h: 1 + len(s.d) }], s.b)!
      return { op: 'update', id: page.id, set }
    }
    case 7:
      return { op: 'update', id: doc.id, set: s.flag ? { title: s.text } : { rules: s.text ? [s.text] : [] } }
    case 8: {
      const block = pick(
        blocks.filter((b) => b.type !== 'frame' && b.type !== 'ink'),
        s.a,
      )
      const frame = pick(frames, s.b)
      if (!block || !frame) return undefined
      const room = frame.kids.length - ('parent' in block && block.parent === frame.id ? 1 : 0)
      return { op: 'move', id: block.id, to: { parent: frame.id, at: s.c % (room + 1) } }
    }
    case 9: {
      const block = pick(
        blocks.filter((b) => b.type !== 'text' && b.type !== 'table'),
        s.a,
      )
      const page = pick(pages, s.b)!
      if (!block) return undefined
      const room = page.free.length - ('page' in block && block.page === page.id ? 1 : 0)
      const size = 'parent' in block || s.flag ? { w: len(s.c), h: len(s.d) } : {}
      const at = s.d % 3 === 0 ? {} : { at: s.d % (room + 1) }
      return { op: 'move', id: block.id, to: { page: page.id, x: pos(s.c), y: pos(s.d), ...size, ...at } }
    }
    case 10: {
      const targets: { id: string; field: 'md' | 'tex' | 'src' | 'caption' | 'title'; text: string }[] = [
        { id: doc.id, field: 'title', text: doc.title },
      ]
      for (const b of blocks) {
        if (b.type === 'text') targets.push({ id: b.id, field: 'md', text: b.md })
        if (b.type === 'math') targets.push({ id: b.id, field: 'tex', text: b.tex })
        if (b.type === 'diagram') targets.push({ id: b.id, field: 'src', text: b.src })
        if (b.type === 'image' || b.type === 'table') targets.push({ id: b.id, field: 'caption', text: b.caption ?? '' })
      }
      const target = pick(targets, s.a)!
      const ends = boundaries(target.text)
      const at = pick(ends, s.b)!
      const end = pick(
        ends.filter((i) => i >= at),
        s.c,
      )!
      return { op: 'splice', id: target.id, field: target.field, at, del: end - at, ins: s.text }
    }
    case 11: {
      const ink = pick(
        blocks.filter((b) => b.type === 'ink'),
        s.a,
      )
      if (!ink || ink.type !== 'ink') return undefined
      if (s.flag && ink.strokes.length > 0) return { op: 'stroke', id: ink.id, at: s.c % ink.strokes.length, remove: true }
      return { op: 'stroke', id: ink.id, at: s.c % (ink.strokes.length + 1), add: strokeFrom(s) }
    }
    case 12: {
      const page = pick(pages, s.a)!
      switch (s.b % 3) {
        case 0: {
          const added = { id: namer.id(doc), w: 21000, h: 29700, bg: pick(BGS, s.c)!, free: [] }
          return { op: 'page', add: added, at: s.d % (pages.length + 1) }
        }
        case 1:
          return pages.length > 1 ? { op: 'page', remove: page.id } : undefined
        default:
          return { op: 'page', move: page.id, to: s.c % pages.length }
      }
    }
    case 13: {
      const unused = assets.filter((hash) => !blocks.some((b) => b.type === 'image' && b.asset === hash))
      if (s.flag && unused.length > 0) return { op: 'asset', hash: pick(unused, s.a)!, meta: null }
      return { op: 'asset', hash: namer.hash(doc), meta: { mime: 'image/png', w: 1 + len(s.c), h: 1 + len(s.d), bytes: s.a } }
    }
    default: {
      const frame = pick(frames, s.a)
      if (!frame || frame.type !== 'frame') return undefined
      if (frame.next !== undefined && s.flag) return { op: 'update', id: frame.id, set: { next: null } }
      const target = pick(
        frames.filter((f) => canContinue(doc, frame.id, f.id)),
        s.b,
      )
      return target && { op: 'update', id: frame.id, set: { next: target.id } }
    }
  }
}

/** True when frame `from` may continue in frame `to`: not itself, not already a continuation, no loop. */
function canContinue(doc: Doc, from: string, to: string): boolean {
  if (from === to) return false
  if (Object.values(doc.block).some((b) => b.type === 'frame' && b.id !== from && b.next === to)) return false
  for (let at = doc.block[to]; at?.type === 'frame' && at.next !== undefined; at = doc.block[at.next]) {
    if (at.next === from) return false
  }
  return true
}

function fieldsFor(block: Block, s: Seed, assets: string[]): Record<string, unknown>[] {
  const size = 'page' in block ? [{ w: len(s.c) }, { h: len(s.d) }] : []
  const optional = (value: string) => (s.flag ? null : value)
  switch (block.type) {
    case 'frame':
      return size
    case 'text':
      return [
        { role: pick(ROLES, s.c) },
        { indent: s.c % 9 },
        { md: s.text },
        { style: s.flag ? null : { color: pick(COLORS, s.c), size: pick(SIZES, s.d) } },
        // Only a to-do can be ticked.
        ...(block.role === 'todo' ? [{ done: s.flag ? null : true }] : []),
      ]
    case 'math':
      return [...size, { tex: s.text }, { value: optional(s.text) }, { tex: s.text, value: '1' }]
    case 'image':
      return [...size, { alt: optional(s.text) }, { asset: pick(assets, s.c) }]
    case 'diagram':
      return [...size, { src: s.text }]
    case 'ink':
      return [...size, { text: optional(s.text) }]
    case 'table':
      return [{ rows: cellsFrom(s) }, { head: s.flag ? null : true }, { alt: optional(s.text) }, { caption: optional(s.text) }]
  }
}

/** Table cells from a seed: one to three rows of one to three cells, each on one line. */
function cellsFrom(s: Seed): string[][] {
  const cell = s.text.replace(/[\r\n]/gu, ' ')
  const width = 1 + (s.c % 3)
  return Array.from({ length: 1 + (s.d % 3) }, (_, r) => Array.from({ length: width }, (_, c) => ((r + c) % 2 === 0 ? cell : '')))
}

/**
 * Plan a transaction: each seed becomes an operation that is valid after the
 * ones before it. Returns the ops and the document they lead to.
 */
export function planTransaction(namer: Namer, doc: Doc, seeds: Seed[]): { ops: Op[]; after: Doc } {
  const ops: Op[] = []
  let after = doc
  for (const s of seeds) {
    const op = planOp(namer, after, s)
    if (!op) continue
    after = apply(after, [op]).doc
    ops.push(op)
  }
  return { ops, after }
}
