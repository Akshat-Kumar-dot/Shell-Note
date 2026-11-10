// Two versions of one note, changed apart on two devices, merged block by
// block so that nothing either device wrote is lost. Nothing here knows how
// the versions travelled (a synced folder, a drive, a service of the app's
// own): it is given the two notes and what is known of their past, and gives
// back the note both become. The caller brings its own note there through
// apply() (diff.ts), so the result is checked like any other edit.
//
// What decides, for each block:
// - changed on one side only: that side's block;
// - there on one side only: kept when that side made or changed it, gone when
//   the other side took it away (an edit always stands against a removal);
// - changed on both: field by field. Text changed in different words is
//   merged (text.ts); words that cannot be merged are kept twice, as a copy
//   of the block after it; a small thing (a place, a size, a style) is taken
//   from the side named `first`.
// Which side is `first` must be the same on every device, so the same two
// versions merge into the same note wherever it is done.
import type { Block, Doc, Frame, Id, Page } from '../schema/doc.js'
import { has } from '../util.js'
import { same, sameBlock, stable } from './diff.js'
import { mergeList, mergeText } from './text.js'

export interface MergeOptions {
  /** A version both sides come from, when one is known: the last one this device had in step with the others. */
  base?: Doc
  /**
   * Blocks of `mine` whose `r` is above this changed after `theirs` last took
   * `mine` in; the others it has seen. Left out, a block counts as changed when it differs from `base`'s, or always
   * when there is no base.
   */
  mineSince?: number
  /** The same for `theirs`, counted in its own revs. */
  theirsSince?: number
  /** The side that stands when both changed the same small thing. The other device names the other side. */
  first: 'mine' | 'theirs'
}

export interface Merged {
  /** The note both versions become: its content. Its `rev` and each `r` are `mine`'s to count (see become() in diff.ts). */
  doc: Doc
  /** Blocks kept twice because both sides changed the same words: the ids of the copies. */
  twice: Id[]
}

type Fields = Record<string, unknown>

/** Fields whose words are merged, word by word. */
const TEXT = new Set(['md', 'caption', 'text'])
/** Fields that hold what a person wrote or chose to show: never dropped, so a block is kept twice when both changed one. */
const CONTENT = new Set(['md', 'caption', 'text', 'tex', 'src', 'asset', 'alt', 'rows'])
/** Where a block is. */
const PLACE = ['page', 'x', 'y', 'parent'] as const
const SIZE = ['w', 'h'] as const
const SKIPPED = new Set(['id', 'r', 'type', 'kids', 'strokes', ...PLACE, ...SIZE])

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/** An id made from a text, the same on every device: for the copy of a block kept twice. */
function idFrom(text: string): Id {
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    a = Math.imul(a ^ code, 0x01000193) >>> 0
    b = Math.imul(b ^ code, 0x85ebca6b) >>> 0
  }
  let id = ''
  for (let i = 0; i < 4; i++) {
    id += ALPHABET.charAt(a % 62) + ALPHABET.charAt(b % 62)
    a = Math.floor(a / 62)
    b = Math.floor(b / 62)
  }
  return id
}

/** One value from three: what only one side changed, or `undefined` in `clash` when both did, differently. */
function three<T>(first: T, second: T, base: T | undefined, known: boolean): { value: T; clash: boolean } {
  if (same(first, second)) return { value: first, clash: false }
  if (known && same(first, base)) return { value: second, clash: false }
  if (known && same(second, base)) return { value: first, clash: false }
  return { value: first, clash: true }
}

/**
 * Two orders of one list, merged: the order of the side that changed it (the
 * first side's, when both or neither did), with what only the other side has
 * put after what comes before it there. Only `members` are kept.
 */
function orderOf(first: readonly Id[], second: readonly Id[], base: readonly Id[] | undefined, members: ReadonlySet<Id>): Id[] {
  if (first === second || same(first, second)) return first.filter((id) => members.has(id))
  let lead = first
  let rest = second
  if (base) {
    const both = new Set(first.filter((id) => members.has(id) && second.includes(id) && base.includes(id)))
    const order = (list: readonly Id[]): Id[] => list.filter((id) => both.has(id))
    if (same(order(first), order(base)) && !same(order(second), order(base))) {
      lead = second
      rest = first
    }
  }
  const out = lead.filter((id) => members.has(id))
  const placed = new Set(out)
  let after: Id | undefined
  for (const id of rest) {
    if (placed.has(id)) after = id
    else if (members.has(id)) {
      out.splice(after === undefined ? 0 : out.indexOf(after) + 1, 0, id)
      placed.add(id)
      after = id
    }
  }
  return out
}

/** A list of things with ids (videos, marks, programs), merged: one a side took away goes, one a side added or changed stays. */
function byId<T extends { id: Id }>(first: readonly T[] | undefined, second: readonly T[] | undefined, base: readonly T[] | undefined, both: (a: T, b: T, base: T | undefined) => T): T[] {
  const out: T[] = []
  const inBase = (id: Id): T | undefined => base?.find((item) => item.id === id)
  for (const item of first ?? []) {
    const other = second?.find((it) => it.id === item.id)
    if (other) out.push(same(item, other) ? item : both(item, other, inBase(item.id)))
    else if (!base || !same(item, inBase(item.id))) out.push(item)
  }
  for (const item of second ?? []) {
    if (first?.some((it) => it.id === item.id)) continue
    if (!base || !same(item, inBase(item.id))) out.push(item)
  }
  return out
}

/**
 * Merge two versions of one note. Both must be valid, and hold the same
 * note. The result's content is the same whichever is called `mine`, as long
 * as `first` names the same version.
 */
export function merge(mine: Doc, theirs: Doc, options: MergeOptions): Merged {
  const { base } = options
  const mineFirst = options.first === 'mine'
  // W, the side that stands in a clash, and L, the other: from here on nothing depends on which is `mine`.
  const W = mineFirst ? mine : theirs
  const L = mineFirst ? theirs : mine
  const sinceW = mineFirst ? options.mineSince : options.theirsSince
  const sinceL = mineFirst ? options.theirsSince : options.mineSince
  const changed = (block: Block, since: number | undefined): boolean => (since !== undefined ? block.r > since : base ? !sameBlock(base.block[block.id], block) : true)

  const block: Record<Id, Block> = {}
  /** Copies of blocks kept twice, each after the block it is a copy of. */
  const copies: { after: Id; copy: Block }[] = []

  const both = (w: Block, l: Block): Block => {
    if (w.type !== l.type) return w
    const b = base && has(base.block, w.id) && base.block[w.id]!.type === w.type ? (base.block[w.id] as Block & Fields) : undefined
    const fw = w as Block & Fields
    const fl = l as Block & Fields
    const out: Fields = { ...w }
    let twice = false

    // Where it is: a block moved on one side goes there; moved on both, where the first side put it.
    const place = (side: Fields): unknown[] => PLACE.map((key) => side[key])
    const moved = three(place(fw), place(fl), b && place(b), b !== undefined)
    const from = moved.clash || same(moved.value, place(fw)) ? fw : fl
    for (const key of [...PLACE, ...SIZE]) delete out[key]
    for (const key of PLACE) if (from[key] !== undefined) out[key] = from[key]
    if ('page' in from) {
      const size = (side: Fields): unknown[] => SIZE.map((key) => side[key])
      const sized = 'page' in fw && 'page' in fl ? three(size(fw), size(fl), b && 'page' in b ? size(b) : undefined, b !== undefined && 'page' in b).value : size(from)
      SIZE.forEach((key, i) => (out[key] = sized[i]))
    }

    if (w.type === 'ink' && l.type === 'ink' && w.strokes !== l.strokes) {
      // Ink is never dropped: where both changed the same strokes, every stroke of both stays.
      const keys = new Map<string, unknown>()
      const key = (stroke: unknown): string => {
        const text = stable(stroke)
        keys.set(text, stroke)
        return text
      }
      const mineKeys = w.strokes.map(key)
      const theirKeys = l.strokes.map(key)
      const before = b as Block | undefined
      const merged = (before?.type === 'ink' ? mergeList(before.strokes.map(key), mineKeys, theirKeys) : undefined) ?? [...mineKeys, ...theirKeys.filter((text) => !mineKeys.includes(text))]
      out.strokes = merged.map((text) => keys.get(text))
    }

    for (const key of new Set([...Object.keys(fw), ...Object.keys(fl)])) {
      if (SKIPPED.has(key)) continue
      const chosen = three(fw[key], fl[key], b?.[key], b !== undefined)
      if (!chosen.clash) {
        if (chosen.value === undefined) delete out[key]
        else out[key] = chosen.value
        continue
      }
      if (TEXT.has(key) && b) {
        const text = mergeText((b[key] as string | undefined) ?? '', (fw[key] as string | undefined) ?? '', (fl[key] as string | undefined) ?? '')
        if (text !== undefined) {
          if (text === '' && key !== 'md') delete out[key]
          else out[key] = text
          continue
        }
      }
      if (key === 'rows' && b) {
        const cells = mergeRows(b.rows as string[][], fw.rows as string[][], fl.rows as string[][])
        if (cells) {
          out.rows = cells
          continue
        }
      }
      if (CONTENT.has(key)) twice = true
    }

    // What follows from another field follows the merge too.
    if (out.type === 'text' && out.role !== 'todo') delete out.done
    if (out.type === 'math') {
      if (out.tex === fw.tex && fw.value !== undefined) out.value = fw.value
      else if (out.tex === fl.tex && fl.value !== undefined) out.value = fl.value
      else delete out.value
    }
    if (out.type === 'table' && Array.isArray(out.cols) && out.cols.length !== (out.rows as string[][])[0]?.length) delete out.cols

    if (twice && l.type !== 'frame' && l.type !== 'ink') {
      const id = idFrom(stable({ ...l, r: 0 }))
      if (!has(W.block, id) && !has(L.block, id) && !copies.some((made) => made.copy.id === id)) {
        const copy: Fields = { ...l, id }
        for (const key of [...PLACE, ...SIZE]) delete copy[key]
        if ('parent' in out) copy.parent = out.parent
        else Object.assign(copy, { page: out.page, x: (out.x as number) + COPY_STEP, y: (out.y as number) + COPY_STEP, w: fl.w ?? out.w, h: fl.h ?? out.h })
        copies.push({ after: w.id, copy: copy as Block })
      }
    }
    return out as Block
  }

  for (const id of new Set([...Object.keys(W.block), ...Object.keys(L.block)])) {
    const w = has(W.block, id) ? W.block[id] : undefined
    const l = has(L.block, id) ? L.block[id] : undefined
    if (w && l) {
      if (sameBlock(w, l)) block[id] = w
      else {
        const cw = changed(w, sinceW)
        const cl = changed(l, sinceL)
        block[id] = cw && !cl ? w : cl && !cw ? l : both(w, l)
      }
    } else if (w ? changed(w, sinceW) : changed(l!, sinceL)) block[id] = (w ?? l)!
  }
  for (const { copy } of copies) block[copy.id] = copy
  // A block that stays keeps its frame, even one the other side took away.
  for (const kept of Object.values(block)) {
    if (!('parent' in kept) || has(block, kept.parent)) continue
    const frame = has(W.block, kept.parent) ? W.block[kept.parent] : has(L.block, kept.parent) ? L.block[kept.parent] : undefined
    if (frame?.type === 'frame') block[frame.id] = frame
    else delete block[kept.id]
  }

  // Pages: one only one side has stays when that side made it, or something on it stays.
  const used = new Set<Id>()
  for (const kept of Object.values(block)) if ('page' in kept) used.add(kept.page)
  const page: Record<Id, Page> = {}
  const keepPage = (id: Id, side: Doc): boolean => used.has(id) || !(base ? has(base.page, id) : Object.values(side.block).some((b) => 'page' in b && b.page === id))
  for (const id of new Set([...W.pages, ...L.pages])) {
    const w = has(W.page, id) ? W.page[id] : undefined
    const l = has(L.page, id) ? L.page[id] : undefined
    if (w && l) {
      const b = base && has(base.page, id) ? base.page[id] : undefined
      page[id] = { id, w: three(w.w, l.w, b?.w, b !== undefined).value, h: three(w.h, l.h, b?.h, b !== undefined).value, bg: three(w.bg, l.bg, b?.bg, b !== undefined).value, free: [] }
    } else if (keepPage(id, w ? W : L)) page[id] = { ...(w ?? l)!, free: [] }
  }
  // A note keeps a page: the first side's first, should every page have gone.
  if (Object.keys(page).length === 0) page[W.pages[0]!] = { ...W.page[W.pages[0]!]!, free: [] }
  const pages = orderOf(W.pages, L.pages, base?.pages, new Set(Object.keys(page)))

  // What lies on each page and sits in each frame, in order, with each copy after its block.
  const withCopies = (list: Id[]): Id[] => {
    for (const { after, copy } of copies) {
      const at = list.indexOf(after)
      if (at >= 0 && !list.includes(copy.id)) list.splice(at + 1, 0, copy.id)
    }
    return list
  }
  const onPage = new Map<Id, Set<Id>>()
  const inFrame = new Map<Id, Set<Id>>()
  for (const kept of Object.values(block)) {
    const [map, key] = 'parent' in kept ? [inFrame, kept.parent] : [onPage, kept.page]
    if (!map.has(key)) map.set(key, new Set())
    map.get(key)!.add(kept.id)
  }
  const frameOf = (doc: Doc | undefined, id: Id): Frame | undefined => {
    const found = doc && has(doc.block, id) ? doc.block[id] : undefined
    return found?.type === 'frame' ? found : undefined
  }
  for (const id of pages) {
    const members = onPage.get(id) ?? new Set<Id>()
    const list = withCopies(orderOf(W.page[id]?.free ?? [], L.page[id]?.free ?? [], base?.page[id]?.free, members))
    // A block moved here from a page neither list of this one names goes on top.
    page[id] = { ...page[id]!, free: [...list, ...[...members].filter((member) => !list.includes(member))] }
  }
  for (const kept of Object.values(block)) {
    if (kept.type !== 'frame') continue
    const members = inFrame.get(kept.id) ?? new Set<Id>()
    const list = withCopies(orderOf(frameOf(W, kept.id)?.kids ?? [], frameOf(L, kept.id)?.kids ?? [], frameOf(base, kept.id)?.kids, members))
    const kids = [...list, ...[...members].filter((member) => !list.includes(member))]
    if (!same(kids, kept.kids)) block[kept.id] = { ...kept, kids }
  }

  // A frame continues in one frame that is there, and no chain of them closes on itself.
  const continued = new Set<Id>()
  for (const id of Object.keys(block).sort()) {
    const frame = block[id]!
    if (frame.type !== 'frame' || frame.next === undefined) continue
    const target = block[frame.next]
    let ok = frame.next !== id && target?.type === 'frame' && !continued.has(frame.next)
    const seen = new Set<Id>([id])
    for (let at = ok ? target : undefined; ok && at?.type === 'frame' && at.next !== undefined; at = block[at.next]) {
      if (seen.has(at.id)) ok = false
      seen.add(at.id)
      if (at.next === id) ok = false
    }
    if (ok) continued.add(frame.next)
    else {
      const ended: Fields = { ...frame }
      delete ended.next
      block[id] = ended as Block
    }
  }

  // The note's own fields.
  const known = base !== undefined
  const title = three(W.title, L.title, base?.title, known).value
  const rules = (base && mergeList(base.rules, W.rules, L.rules)) ?? [...W.rules, ...L.rules.filter((rule) => !W.rules.includes(rule))]
  const pen: Fields = {}
  for (const key of new Set([...Object.keys(W.pen ?? {}), ...Object.keys(L.pen ?? {})])) {
    const value = three((W.pen as Fields | undefined)?.[key], (L.pen as Fields | undefined)?.[key], (base?.pen as Fields | undefined)?.[key], known).value
    if (value !== undefined) pen[key] = value
  }
  const whole = <T>(w: T, l: T, b: T | undefined): T => three(w, l, b, b !== undefined).value
  const media = byId(W.media, L.media, base?.media, whole)
  const programs = byId(W.programs, L.programs, base?.programs, (w, l, b) => {
    const chosen = whole(w, l, b)
    // The words of each place seen, from both sides.
    const places = [...(w.places ?? []), ...(l.places ?? []).filter((seen) => !(w.places ?? []).some((have) => same(have.place, seen.place)))]
    return places.length > 0 ? { ...chosen, places } : chosen
  })
  // A line written beside a program keeps that program.
  for (const kept of Object.values(block)) {
    if (kept.type !== 'ink') continue
    for (const stroke of kept.strokes) {
      if (!stroke.pm || programs.some((source) => source.id === stroke.pm!.m)) continue
      const source = W.programs?.find((s) => s.id === stroke.pm!.m) ?? L.programs?.find((s) => s.id === stroke.pm!.m)
      if (source) programs.push(source)
    }
  }
  const clips = byId(W.clips, L.clips, base?.clips, whole).filter((clip) => has(page, clip.page) && media.some((m) => m.id === clip.media))

  // Pictures are named by what they hold, so the same name is the same picture: every one still shown stays.
  const shown = new Set<string>()
  for (const kept of Object.values(block)) {
    if (kept.type === 'image') shown.add(kept.asset)
    if (kept.type === 'ink') for (const stroke of kept.strokes) if (stroke.pm?.pic !== undefined) shown.add(stroke.pm.pic)
  }
  for (const item of media) if (item.kind === 'file') shown.add(item.asset)
  const asset: Doc['asset'] = {}
  for (const hash of new Set([...Object.keys(W.asset), ...Object.keys(L.asset)])) {
    const w = has(W.asset, hash) ? W.asset[hash] : undefined
    const l = has(L.asset, hash) ? L.asset[hash] : undefined
    // One only one side lists, and nothing shows: kept when that side added it, gone when the other side let it go.
    if ((w && l) || shown.has(hash) || (base !== undefined && !has(base.asset, hash))) asset[hash] = (w ?? l)!
  }

  const doc: Doc = {
    v: mine.v,
    id: mine.id,
    title,
    rev: mine.rev,
    pages,
    page,
    block,
    asset,
    rules,
    ...(Object.keys(pen).length > 0 ? { pen: pen as NonNullable<Doc['pen']> } : {}),
    ...(media.length > 0 ? { media } : {}),
    ...(clips.length > 0 ? { clips } : {}),
    ...(programs.length > 0 ? { programs } : {}),
  }
  return { doc, twice: copies.map((made) => made.copy.id) }
}

/** How far down and right the copy of a block on a page lies from it: 5 mm, in units of 0.01 mm. */
const COPY_STEP = 500

/** A table changed on both sides, cell by cell, when it kept its shape; undefined when a cell cannot be merged. */
function mergeRows(base: string[][], first: string[][], second: string[][]): string[][] | undefined {
  const shape = (rows: string[][]): string => `${rows.length}x${rows[0]?.length ?? 0}`
  if (shape(base) !== shape(first) || shape(base) !== shape(second)) return undefined
  const out: string[][] = []
  for (let r = 0; r < base.length; r++) {
    const row: string[] = []
    for (let c = 0; c < base[r]!.length; c++) {
      const cell = mergeText(base[r]![c]!, first[r]![c]!, second[r]![c]!)
      if (cell === undefined || /[\r\n]/u.test(cell)) return undefined
      row.push(cell)
    }
    out.push(row)
  }
  return out
}
