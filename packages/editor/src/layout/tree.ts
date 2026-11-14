// The workspace's layout: the notes, the video and the side panel docked like
// Obsidian's panes, in a tree of splits, or floating, or one of them in full view. Pure: each change returns a new
// layout, and `placesOf` works out where each shown panel goes, so moving a panel only moves it, never makes it again
// (a playing video plays on). A closed panel keeps its place in the tree, and comes back there.

// The fourth, 'program', holds another program's own window (stage 2 of other programs inside ShellNote, 25 October
// 2026): in the app on Windows only.
export type PanelId = 'notes' | 'video' | 'side' | 'program'
export const PANELS: readonly PanelId[] = ['notes', 'video', 'side', 'program']
export type Side = 'left' | 'right' | 'top' | 'bottom'
export type Dir = 'row' | 'column'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
export interface Leaf {
  kind: 'panel'
  id: PanelId
}
export interface Split {
  kind: 'split'
  dir: Dir
  /** Each kid's share of the split, adding up to 1. */
  sizes: number[]
  kids: Node[]
}
export type Node = Leaf | Split

export interface Layout {
  root: Node
  /** Floating panels: where and how big, from the area's top left, in CSS pixels. */
  floating: Partial<Record<PanelId, Rect>>
 /** One panel filling the area (the person's full view). */
  full?: PanelId | undefined
}

export const leaf = (id: PanelId): Leaf => ({ kind: 'panel', id })
const split = (dir: Dir, kids: Node[], sizes: number[]): Split => ({ kind: 'split', dir, kids, sizes: normal(sizes) })

/**
 * How the workspace starts: the notes, and on their right the panel beside them (the AI, or Beside), about 340 pixels
 * of a laptop's window. The video and a program are kept inside Beside until the person takes them out (state.ts):
 * then the video goes above the panel, and a program right of them all. While one is not shown, its room is the
 * others', so the start is unchanged.
 */
export const DEFAULT_LAYOUT: Layout = {
  root: split('row', [leaf('notes'), split('column', [leaf('video'), leaf('side')], [0.55, 0.45]), leaf('program')], [0.69, 0.31, 0.4]),
  floating: {},
}

/**
 * The smallest a panel may be, in CSS pixels: YouTube's player at 200 by 200 under its bar; room to write; the panel
 * beside the notes with a video inside it, 200 wide between its margins; a program still usable (320 by 240 under the
 * bar: to be checked with PowerPoint's ribbon).
 */
export const PANEL_LEAST: Record<PanelId, { w: number; h: number }> = { notes: { w: 240, h: 200 }, video: { w: 204, h: 240 }, side: { w: 224, h: 160 }, program: { w: 320, h: 272 } }

/** The step the edges between panels fall on, in CSS pixels. */
const STEP = 4

const dirOf = (side: Side): Dir => (side === 'left' || side === 'right' ? 'row' : 'column')
const first = (side: Side): boolean => side === 'left' || side === 'top'

function normal(sizes: readonly number[]): number[] {
  const total = sizes.reduce((sum, s) => sum + Math.max(0, s), 0)
  return total > 0 ? sizes.map((s) => Math.max(0, s) / total) : sizes.map(() => 1 / sizes.length)
}

export function contains(node: Node, id: PanelId): boolean {
  return node.kind === 'panel' ? node.id === id : node.kids.some((kid) => contains(kid, id))
}

/** The tree without the panel; a split left with one kid becomes that kid. */
export function without(node: Node, id: PanelId): Node | undefined {
  if (node.kind === 'panel') return node.id === id ? undefined : node
  const kept: Node[] = []
  const sizes: number[] = []
  node.kids.forEach((kid, i) => {
    const next = without(kid, id)
    if (next) {
      kept.push(next)
      sizes.push(node.sizes[i] ?? 0)
    }
  })
  if (kept.length === 0) return undefined
  if (kept.length === 1) return kept[0]
  // A split inside a split of the same way joins it.
  const kids: Node[] = []
  const shares: number[] = []
  normal(sizes).forEach((share, i) => {
    const kid = kept[i]!
    if (kid.kind === 'split' && kid.dir === node.dir) {
      kid.kids.forEach((inner, j) => {
        kids.push(inner)
        shares.push(share * kid.sizes[j]!)
      })
    } else {
      kids.push(kid)
      shares.push(share)
    }
  })
  return split(node.dir, kids, shares)
}

/** Put `id` beside `target` in the tree, on its `side`, taking half of its room. */
function besides(node: Node, target: PanelId, id: PanelId, side: Side): Node {
  if (node.kind === 'panel') {
    if (node.id !== target) return node
    return split(dirOf(side), first(side) ? [leaf(id), node] : [node, leaf(id)], [0.5, 0.5])
  }
  const at = node.kids.findIndex((kid) => kid.kind === 'panel' && kid.id === target)
  if (at >= 0 && node.dir === dirOf(side)) {
    const kids = [...node.kids]
    const sizes = [...node.sizes]
    const half = sizes[at]! / 2
    sizes[at] = half
    const where = first(side) ? at : at + 1
    kids.splice(where, 0, leaf(id))
    sizes.splice(where, 0, half)
    return split(node.dir, kids, sizes)
  }
  return { ...node, kids: node.kids.map((kid) => besides(kid, target, id, side)) }
}

/**
 * Dock `id` at a side of `target`: another panel, or the whole area. From wherever it was: docked elsewhere, floating,
 * or in full view.
 */
export function dock(layout: Layout, id: PanelId, target: PanelId | 'area', side: Side): Layout {
  if (target === id) return layout
  const floating = { ...layout.floating }
  delete floating[id]
  // Its room back where it took it from first (the notes, mostly), so moving a panel about never wears the notes away.
  const rest = layout.root.kind === 'panel' && layout.root.id === id ? undefined : giveBack(layout, id).root
  if (!rest) return { root: leaf(id), floating, full: undefined }
  let root: Node
  if (target === 'area' || !contains(rest, target)) {
    const share = 0.35
    if (rest.kind === 'split' && rest.dir === dirOf(side)) {
      const sizes = rest.sizes.map((s) => s * (1 - share))
      root = first(side) ? split(rest.dir, [leaf(id), ...rest.kids], [share, ...sizes]) : split(rest.dir, [...rest.kids, leaf(id)], [...sizes, share])
    } else root = split(dirOf(side), first(side) ? [leaf(id), rest] : [rest, leaf(id)], first(side) ? [share, 1 - share] : [1 - share, share])
  } else root = besides(rest, target, id, side)
  return { root, floating, full: undefined }
}

/**
 * `id` out of the tree, its room given back to the neighbour it took it from (the notes, where they are neighbours),
 * not shared out among all as `without` does: a video docked beside the notes and put back inside the Beside panel
 * leaves the notes as wide as before. A split left with one kid becomes that kid.
 */
export function giveBack(layout: Layout, id: PanelId): Layout {
  const take = (node: Node): Node => {
    if (node.kind === 'panel') return node
    const at = node.kids.findIndex((kid) => kid.kind === 'panel' && kid.id === id)
    if (at < 0) return { ...node, kids: node.kids.map(take) }
    const near = [at - 1, at + 1].filter((i) => i >= 0 && i < node.kids.length)
    const to = near.find((i) => contains(node.kids[i]!, 'notes')) ?? near[0]
    if (to === undefined) return node
    const sizes = [...node.sizes]
    sizes[to] = sizes[to]! + sizes[at]!
    sizes.splice(at, 1)
    const kids = node.kids.filter((_, i) => i !== at)
    return kids.length === 1 ? kids[0]! : split(node.dir, kids, sizes)
  }
  const floating = { ...layout.floating }
  delete floating[id]
  return { ...layout, root: layout.root.kind === 'panel' ? layout.root : take(layout.root), floating }
}

/** Float `id` at `rect`, out of the tree. The notes always stay docked. */
export function float(layout: Layout, id: PanelId, rect: Rect): Layout {
  if (id === 'notes') return layout
  const root = layout.root.kind === 'panel' && layout.root.id === id ? leaf('notes') : giveBack(layout, id).root
  return { root, floating: { ...layout.floating, [id]: rect }, full: layout.full === id ? undefined : layout.full }
}

/** The split at `path` (kid indices from the root) with new shares. */
export function withSizes(layout: Layout, path: readonly number[], sizes: readonly number[]): Layout {
  const set = (node: Node, depth: number): Node => {
    if (node.kind === 'panel') return node
    if (depth === path.length) return { ...node, sizes: normal(sizes) }
    const i = path[depth]!
    return { ...node, kids: node.kids.map((kid, k) => (k === i ? set(kid, depth + 1) : kid)) }
  }
  return { ...layout, root: set(layout.root, 0) }
}

/** The edge between two neighbouring kids of a split, which drags. */
export interface Splitter {
  /** The split's path from the root. */
  path: number[]
  /** The kids either side, by their index in the split. */
  a: number
  b: number
  dir: Dir
  /** Where the edge is: a line the width of the split. */
  at: Rect
  /** Where each kid is, to work out new shares. */
  before: Rect
  after: Rect
  /** The split's shares as they are. */
  sizes: number[]
}

export interface Places {
  /** Where each shown panel goes, docked or floating. */
  rects: Partial<Record<PanelId, Rect>>
  floating: PanelId[]
  splitters: Splitter[]
}

/** The smallest a part of the tree may be, as its shown panels add up; `least`, each panel's smallest now. */
export function leastOf(node: Node, shown: (id: PanelId) => boolean, least: Record<PanelId, { w: number; h: number }> = PANEL_LEAST): { w: number; h: number } {
  if (node.kind === 'panel') return shown(node.id) ? least[node.id] : { w: 0, h: 0 }
  const kids = node.kids.map((kid) => leastOf(kid, shown, least))
  return node.dir === 'row'
    ? { w: kids.reduce((sum, k) => sum + k.w, 0), h: Math.max(0, ...kids.map((k) => k.h)) }
    : { w: Math.max(0, ...kids.map((k) => k.w)), h: kids.reduce((sum, k) => sum + k.h, 0) }
}

const visible = (node: Node, shown: (id: PanelId) => boolean): boolean => (node.kind === 'panel' ? shown(node.id) : node.kids.some((kid) => visible(kid, shown)))

/**
 * Shares of `length` with each kid at least its least, taken from those with room to spare, each in proportion. As they
 * were when all fit, or when there is no room to take from.
 */
function heldToLeast(shares: readonly number[], least: readonly number[], length: number): readonly number[] {
  const sizes = shares.map((share) => share * length)
  const need = sizes.reduce((sum, size, i) => sum + Math.max(0, least[i]! - size), 0)
  const room = sizes.reduce((sum, size, i) => sum + Math.max(0, size - least[i]!), 0)
  if (need <= 0 || room <= 0 || length <= 0) return shares
  const taken = Math.min(1, need / room)
  return sizes.map((size, i) => (size < least[i]! ? least[i]! : size - (size - least[i]!) * taken) / length)
}

/**
 * Where each shown panel goes in `area`; a hidden one's room goes to the others. Panels side by side that cannot all have
 * their least width (a phone upright: the video at 40% of 390 pixels is 156, and YouTube's player plays at no less than
 * 200) go one above another instead, and each is given at least its least where there is room. The edges between panels fall on
 * 4-pixel steps from the area's corner, so a panel starts on a whole screen pixel at 100, 125, 150, 175 and 200 %,
 * where the pen's live line and the page's match.
 */
export function placesOf(layout: Layout, area: Rect, shown: (id: PanelId) => boolean, least: Record<PanelId, { w: number; h: number }> = PANEL_LEAST): Places {
  const rects: Partial<Record<PanelId, Rect>> = {}
  const splitters: Splitter[] = []
  const floating = PANELS.filter((id) => id !== 'notes' && layout.floating[id] && shown(id))
  if (layout.full && shown(layout.full)) {
    rects[layout.full] = area
    return { rects, floating: floating.includes(layout.full) ? [layout.full] : [], splitters }
  }
  const walk = (node: Node, rect: Rect, path: number[]): void => {
    if (node.kind === 'panel') {
      if (shown(node.id)) rects[node.id] = rect
      return
    }
    const kids = node.kids.map((kid, i) => ({ kid, i })).filter(({ kid }) => visible(kid, shown))
    const leasts = kids.map(({ kid }) => leastOf(kid, shown, least))
    const across = node.dir === 'row' && (rect.w <= 0 || leasts.reduce((sum, least) => sum + least.w, 0) <= rect.w)
    const length = across ? rect.w : rect.h
    const shares = heldToLeast(normal(kids.map(({ i }) => node.sizes[i] ?? 0)), leasts.map((least) => (across ? least.w : least.h)), length)
    let start = across ? rect.x : rect.y
    let previous: { i: number; rect: Rect } | undefined
    kids.forEach(({ kid, i }, k) => {
      const end = k === kids.length - 1 ? (across ? rect.x + rect.w : rect.y + rect.h) : Math.round((start + shares[k]! * length) / STEP) * STEP
      const own = across ? { x: start, y: rect.y, w: end - start, h: rect.h } : { x: rect.x, y: start, w: rect.w, h: end - start }
      if (previous) {
        const at = across ? { x: start, y: rect.y, w: 0, h: rect.h } : { x: rect.x, y: start, w: rect.w, h: 0 }
        splitters.push({ path, a: previous.i, b: i, dir: across ? 'row' : 'column', at, before: previous.rect, after: own, sizes: node.sizes })
      }
      walk(kid, own, [...path, i])
      previous = { i, rect: own }
      start = end
    })
  }
  walk(layout.root, area, [])
  for (const id of floating) {
    const f = layout.floating[id]!
    const smallest = least[id]
    const w = Math.max(smallest.w, Math.min(f.w, area.w))
    const h = Math.max(smallest.h, Math.min(f.h, area.h))
    rects[id] = { x: area.x + Math.max(0, Math.min(area.w - w, f.x)), y: area.y + Math.max(0, Math.min(area.h - h, f.y)), w, h }
  }
  return { rects, floating, splitters }
}

/**
 * New shares for a split when the edge between kids `a` and `b` is dragged to `to` (a position along the split): the
 * two share what they had between them, each at least its smallest.
 */
export function dragged(splitter: Splitter, to: number, least: { a: number; b: number }): number[] {
  const across = splitter.dir === 'row'
  const from = across ? splitter.before.x : splitter.before.y
  const both = across ? splitter.before.w + splitter.after.w : splitter.before.h + splitter.after.h
  const a = Math.max(least.a, Math.min(both - least.b, to - from))
  const sizes = [...splitter.sizes]
  const shared = sizes[splitter.a]! + sizes[splitter.b]!
  sizes[splitter.a] = both > 0 ? (shared * a) / both : shared / 2
  sizes[splitter.b] = shared - sizes[splitter.a]!
  return sizes
}

/** A layout read back from storage, or the default when it is not one. */
export function layoutFrom(value: unknown): Layout {
  const isRect = (r: unknown): r is Rect => typeof r === 'object' && r !== null && ['x', 'y', 'w', 'h'].every((k) => typeof (r as Record<string, unknown>)[k] === 'number')
  const nodeOf = (n: unknown): Node | undefined => {
    if (typeof n !== 'object' || n === null) return undefined
    const o = n as Record<string, unknown>
    if (o.kind === 'panel') return PANELS.includes(o.id as PanelId) ? leaf(o.id as PanelId) : undefined
    if (o.kind !== 'split' || (o.dir !== 'row' && o.dir !== 'column') || !Array.isArray(o.kids) || !Array.isArray(o.sizes) || o.kids.length !== o.sizes.length || o.kids.length < 2) return undefined
    const kids = o.kids.map(nodeOf)
    if (kids.some((k) => !k) || !o.sizes.every((s) => typeof s === 'number')) return undefined
    return split(o.dir, kids as Node[], o.sizes as number[])
  }
  if (typeof value !== 'object' || value === null) return DEFAULT_LAYOUT
  const o = value as Record<string, unknown>
  const root = nodeOf(o.root)
  if (!root || !contains(root, 'notes')) return DEFAULT_LAYOUT
  // Each panel once: docked, or floating.
  const ids: PanelId[] = []
  const collect = (n: Node): void => (n.kind === 'panel' ? void ids.push(n.id) : n.kids.forEach(collect))
  collect(root)
  if (new Set(ids).size !== ids.length) return DEFAULT_LAYOUT
  const floating: Partial<Record<PanelId, Rect>> = {}
  const f = (typeof o.floating === 'object' && o.floating !== null ? o.floating : {}) as Record<string, unknown>
  for (const id of PANELS) if (id !== 'notes' && !ids.includes(id) && isRect(f[id])) floating[id] = f[id]
  // A panel in neither place goes back to the side the default has it on: the right of the notes. The program goes at
  // the right of the whole area, its room taken from every panel alike: while it is not shown, a layout kept before
  // it existed is as it was (beside the notes, it would take half of theirs, and the notes would narrow in the browser
  // too, where it never shows).
  let layout: Layout = { root, floating }
  for (const id of PANELS) if (!ids.includes(id) && !floating[id]) layout = id === 'program' ? dock(layout, id, 'area', 'right') : dock(layout, id, 'notes', 'right')
  return layout
}
