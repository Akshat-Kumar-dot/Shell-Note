// apply(): the only way to change a document. The
// editor, the AI, undo and MCP all go through it, which is what makes every AI
// edit checkable and undoable with no extra code.
import { Draft } from './draft.js'
import { idTaken } from './ids.js'
import { BLOCK_SHAPES, DocFields, MAX_BLOCKS, type Block, type BlockType, type Doc, type Frame, type Id } from './schema/doc.js'
import { checkOp, type MoveTo, type Op, type OpOf } from './schema/ops.js'
import { has, isWellFormed, splitsCharacter } from './util.js'
import { CONTENT_FIELDS, checkContent, type ContentField, type ContentValidators } from './validate/content.js'
import { ValidationError, type ErrorCode } from './validate/errors.js'
import { checkBlock, checkPage, parseWith } from './validate/shape.js'

export interface ApplyOptions {
  /** For AI and MCP edits: the rev the edit was prepared against. Touching a block changed since is `stale`. */
  baseRev?: number
  /** Layer 3 checks for Markdown, LaTeX and Mermaid, supplied by the host. */
  validators?: ContentValidators
}

export interface Applied {
  /** The new document. The input document is never modified. */
  doc: Doc
  /** Operations that undo this transaction, in the order to apply them. */
  inverse: Op[]
  /** Ids of the blocks and pages that changed, plus the document id for document-level changes. */
  changed: Id[]
}

/**
 * Apply a transaction: a list of operations applied together. Either all of
 * them succeed or none do, and the document's `rev` goes up by one. Throws a
 * ValidationError with a hint. The input must be a valid document (see
 * validateDoc); the output always is.
 */
export function apply(doc: Doc, ops: readonly Op[], options: ApplyOptions = {}): Applied {
  if (ops.length === 0) return { doc, inverse: [], changed: [] }
  // All or nothing comes from here: every change goes into this copy (draft.ts), and a throw simply leaves it behind.
  const draft = new Draft(doc, options.baseRev)
  const undo: Op[][] = []
  ops.forEach((op, index) => {
    try {
      checkOp(op)
      undo.push(run(draft, op))
    } catch (error) {
      throw error instanceof ValidationError && ops.length > 1 ? error.inOp(index) : error
    }
  })
  // Last, and once: the fields set anywhere in the transaction are checked as they finally stand.
  if (options.validators) checkContent(draft.doc, draft.edited, options.validators)
  // The last operation undone first: each inverse assumes the document as its own operation left it.
  return { doc: draft.doc, inverse: undo.reverse().flat(), changed: [...draft.changed] }
}

/** Apply one operation to the draft. Returns the operations that undo it. */
function run(draft: Draft, op: Op): Op[] {
  switch (op.op) {
    case 'add':
      return add(draft, op)
    case 'remove': {
      const back = removeBlock(draft, op.id)
      return [...back.readd, ...back.relink]
    }
    case 'update':
      return update(draft, op)
    case 'move':
      return move(draft, op)
    case 'splice':
      return splice(draft, op)
    case 'stroke':
      return stroke(draft, op)
    case 'page':
      return page(draft, op)
    case 'asset':
      return asset(draft, op)
  }
}

// ----- add and remove -------------------------------------------------------

/** Whether a note holds as many blocks as it may: counted no further than that. */
function full(doc: Doc): boolean {
  let count = 0
  for (const id in doc.block) if (has(doc.block, id) && ++count >= MAX_BLOCKS) return true
  return false
}

function add(draft: Draft, op: OpOf<'add'>): Op[] {
  const block = op.block
  if (idTaken(draft.doc, block.id)) {
    fail('duplicate_id', `The id ${block.id} is already used in this document. Choose a new id.`, { got: block.id })
  }
  // A note never grows past what its own file may hold (MAX_BLOCKS): it could be saved, and never opened again.
  if (full(draft.doc)) fail('bad_doc', `A note holds at most ${MAX_BLOCKS.toLocaleString('en')} blocks, and this one is full. Start another note for more.`)
  if (block.type === 'frame') {
    if (block.kids.length > 0) {
      fail('not_empty', `Frame ${block.id}: add a frame with empty kids, then add each child with its own add.`)
    }
    if (block.next !== undefined) checkContinuation(draft, block.id, block.next)
  }
  if (block.type === 'image' && !draft.asset(block.asset)) {
    fail('bad_ref', `Image ${block.id}: asset ${block.asset} does not exist. Add it with an asset operation first.`)
  }
  if ('parent' in block) {
    const frame = needFrame(draft, block.parent)
    const at = op.at ?? frame.kids.length
    checkIndex(at, frame.kids.length, `Frame ${frame.id}`)
    draft.putBlock({ ...frame, kids: inserted(frame.kids, at, block.id) })
  } else {
    const page = draft.page(block.page) ?? missing('page', block.page)
    const at = op.at ?? page.free.length
    checkIndex(at, page.free.length, `Page ${page.id}`)
    draft.putPage({ ...page, free: inserted(page.free, at, block.id) })
  }
  draft.putBlock(block)
  for (const field of CONTENT_FIELDS) if (has(block, field)) draft.markEdited(block.id, field)
  return [{ op: 'remove', id: block.id }]
}

/**
 * Remove a block; a frame takes its children with it. Returns the operations
 * that put everything back: `readd` re-adds the blocks, then `relink` restores
 * continuation links (`next`), which can only point at frames that exist.
 */
function removeBlock(draft: Draft, id: Id): { readd: Op[]; relink: Op[] } {
  const block = needBlock(draft, id)
  draft.checkFresh(id)
  const at = indexIn(draft, block)
  detach(draft, block)
  draft.dropBlock(id)
  if (block.type !== 'frame') return { readd: [{ op: 'add', block, at }], relink: [] }

  const { next, ...frame } = block
  const readd: Op[] = [{ op: 'add', block: { ...frame, kids: [] }, at }]
  const relink: Op[] = []
  block.kids.forEach((kidId, index) => {
    // A child changed since the edit was prepared stops the whole removal too.
    draft.checkFresh(kidId)
    readd.push({ op: 'add', block: needBlock(draft, kidId), at: index })
    draft.dropBlock(kidId)
  })
  if (next !== undefined) relink.push({ op: 'update', id, set: { next } })
  // A frame that continued in this one now ends where it is.
  for (const other of Object.values(draft.doc.block)) {
    if (other.type === 'frame' && other.next === id) {
      const ended: Record<string, unknown> = { ...other }
      delete ended.next
      draft.putBlock(ended as Frame)
      relink.push({ op: 'update', id: other.id, set: { next: id } })
    }
  }
  return { readd, relink }
}

// ----- update ---------------------------------------------------------------

const BLOCK_FIELDS: Record<BlockType, readonly string[]> = {
  frame: ['next'],
  text: ['role', 'indent', 'md', 'style', 'done'],
  math: ['tex', 'value'],
  image: ['asset', 'alt', 'caption'],
  diagram: ['src'],
  ink: ['text'],
  table: ['rows', 'head', 'alt', 'caption', 'cols', 'width', 'look'],
}
const PAGE_FIELDS = ['w', 'h', 'bg']
const DOC_FIELDS = ['title', 'rules', 'pen', 'media', 'clips', 'programs']

const MOVED = 'Use move to change where a block is.'
const BLOCK_ELSEWHERE: Record<string, string> = {
  page: MOVED,
  parent: MOVED,
  x: MOVED,
  y: MOVED,
  kids: "Use add, remove and move to change a frame's children.",
  strokes: 'Use stroke to add or remove strokes.',
  id: 'Ids never change.',
  type: 'A type never changes: remove the block and add a new one.',
  r: 'apply sets r.',
}
const PAGE_ELSEWHERE: Record<string, string> = {
  id: 'Ids never change.',
  free: 'Use add, remove and move to change what is on a page.',
}
const DOC_ELSEWHERE: Record<string, string> = {
  v: 'The version changes only through migrations.',
  id: 'Ids never change.',
  rev: 'apply sets rev.',
  pages: 'Use page to add, remove or reorder pages.',
  page: 'Use page to add, remove or reorder pages.',
  block: 'Use the block operations: add, remove, update, move, splice, stroke.',
  asset: 'Use asset to add or remove assets.',
}

function update(draft: Draft, op: OpOf<'update'>): Op[] {
  // Checked here rather than in the schema: Zod's copy of `set` silently drops a
  // "__proto__" key, which checkFields must see in order to reject it.
  if (Object.keys(op.set).length === 0) fail('bad_shape', `update ${op.id}: set needs at least one field.`)
  if (op.id === draft.doc.id) {
    checkFields(op.set, DOC_FIELDS, DOC_ELSEWHERE, 'The document')
    // Fields it lacks are left out, not passed as undefined: `patch` would count them as there, and its undo could
    // not remove them again.
    const { title, rules, pen, media, clips, programs } = draft.doc
    const { next, undo } = patch({ title, rules, ...(pen ? { pen } : {}), ...(media ? { media } : {}), ...(clips ? { clips } : {}), ...(programs ? { programs } : {}) }, op.set)
    const fields = parseWith(DocFields, next, 'The document')
    checkMedia(draft, fields.media ?? [], fields.clips ?? [])
    draft.setDocFields({ title: fields.title, rules: fields.rules, pen: fields.pen ?? null, media: fields.media ?? null, clips: fields.clips ?? null, programs: fields.programs ?? null })
    return [{ op: 'update', id: op.id, set: undo }]
  }

  const page = draft.page(op.id)
  if (page) {
    checkFields(op.set, PAGE_FIELDS, PAGE_ELSEWHERE, `Page ${page.id}`)
    const { next, undo } = patch(page, op.set)
    draft.putPage(checkPage(next))
    return [{ op: 'update', id: page.id, set: undo }]
  }

  const block = needBlock(draft, op.id)
  draft.checkFresh(block.id)
  const allowed = [...BLOCK_FIELDS[block.type], ...('page' in block ? ['w', 'h'] : [])]
  checkFields(op.set, allowed, BLOCK_ELSEWHERE, `Block ${block.id} (${block.type})`)
  const set = { ...op.set }
  // `value` caches the result of `tex`, so a new tex clears it unless a value comes with it.
  if (block.type === 'math' && has(set, 'tex') && !has(set, 'value') && block.value !== undefined) set.value = null
  // Only to-do items can be ticked, so a block that stops being one loses its tick.
  if (block.type === 'text' && block.done && has(set, 'role') && set.role !== 'todo' && !has(set, 'done')) set.done = null
  const { next, undo } = patch(block, set)
  // An ink block can hold thousands of strokes, which update cannot change: skip re-checking each point.
  checkBlock(block.type === 'ink' ? { ...next, strokes: [] } : next)
  const updated = next as Block
  if (updated.type === 'frame' && updated.next !== undefined && has(set, 'next')) {
    checkContinuation(draft, updated.id, updated.next)
  }
  if (updated.type === 'image' && !draft.asset(updated.asset)) {
    fail('bad_ref', `Asset ${updated.asset} does not exist. Add it with an asset operation first.`)
  }
  draft.putBlock(updated)
  for (const field of CONTENT_FIELDS) if (has(set, field) && set[field] !== null) draft.markEdited(block.id, field)
  return [{ op: 'update', id: block.id, set: undo }]
}

function checkFields(
  set: Record<string, unknown>,
  allowed: readonly string[],
  elsewhere: Record<string, string>,
  where: string,
): void {
  for (const [key, value] of Object.entries(set)) {
    if (!allowed.includes(key)) {
      const why = has(elsewhere, key) ? elsewhere[key] : `There is no field "${key}".`
      fail('bad_field', `${where}: cannot set ${key}. ${why} Fields you can set: ${allowed.join(', ')}.`, {
        got: key,
        valid: allowed,
      })
    }
    if (value === undefined) fail('bad_shape', `${where}: ${key} is undefined. Use null to remove a field.`)
  }
}

/** Apply `set` to a copy of `target`: null removes a field. Also returns the `set` that undoes it. */
function patch(target: object, set: Record<string, unknown>): { next: Record<string, unknown>; undo: Record<string, unknown> } {
  const before = target as Record<string, unknown>
  const next: Record<string, unknown> = { ...before }
  const undo: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(set)) {
    undo[key] = has(before, key) ? before[key] : null
    if (value === null) delete next[key]
    else next[key] = value
  }
  return { next, undo }
}

// ----- move -----------------------------------------------------------------

function move(draft: Draft, op: OpOf<'move'>): Op[] {
  const block = needBlock(draft, op.id)
  draft.checkFresh(block.id)
  const before = placeOf(draft, block)
  const index = indexIn(draft, block)
  const shapes = BLOCK_SHAPES[block.type]
  const to = op.to

  if ('parent' in to) {
    if (!shapes.child) {
      fail('wrong_type', `Block ${block.id} has type ${block.type}, which is placed on a page. Move it with { page, x, y }.`)
    }
    needFrame(draft, to.parent)
    detach(draft, block)
    const frame = needFrame(draft, to.parent) // read again: detaching may have changed it
    // `to.at` counts in the list without the block, as it now stands.
    checkIndex(to.at, frame.kids.length, `Frame ${frame.id}`)
    draft.putBlock({ ...frame, kids: inserted(frame.kids, to.at, block.id) })
    draft.putBlock(placed(block, { parent: to.parent }))
  } else {
    if (!shapes.free) {
      fail('wrong_type', `Block ${block.id} has type ${block.type}, which sits inside a frame. Move it with { parent, at }.`)
    }
    const w = to.w ?? ('w' in block ? block.w : undefined)
    const h = to.h ?? ('h' in block ? block.h : undefined)
    if (w === undefined || h === undefined) {
      fail('bad_shape', `Block ${block.id} comes out of a frame, so give its size too: { page, x, y, w, h }.`)
    }
    if (!draft.page(to.page)) missing('page', to.page)
    detach(draft, block)
    const page = draft.page(to.page)!
    const samePage = 'page' in block && block.page === to.page
    // On the same page a block keeps its place in the stacking order unless told otherwise.
    const at = to.at ?? (samePage ? index : page.free.length)
    checkIndex(at, page.free.length, `Page ${page.id}`)
    draft.putPage({ ...page, free: inserted(page.free, at, block.id) })
    draft.putBlock(placed(block, { page: to.page, x: to.x, y: to.y, w, h }))
  }
  return [{ op: 'move', id: block.id, to: before }]
}

const PLACEMENT = new Set(['id', 'r', 'type', 'page', 'x', 'y', 'w', 'h', 'parent'])

/** The block at a new place, keeping its fields in the order id, r, type, placement, content. */
function placed(block: Block, place: { parent: Id } | { page: Id; x: number; y: number; w: number; h: number }): Block {
  const content: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(block)) if (!PLACEMENT.has(key)) content[key] = value
  return { id: block.id, r: block.r, type: block.type, ...place, ...content } as Block
}

/** Where a block is now, in the form `move` takes, so a move can be undone exactly. */
function placeOf(draft: Draft, block: Block): MoveTo {
  const at = indexIn(draft, block)
  if ('parent' in block) return { parent: block.parent, at }
  return { page: block.page, x: block.x, y: block.y, w: block.w, h: block.h, at }
}

/** A block's index in its frame's kids, or in its page's free list. */
function indexIn(draft: Draft, block: Block): number {
  if ('parent' in block) return needFrame(draft, block.parent).kids.indexOf(block.id)
  return (draft.page(block.page) ?? missing('page', block.page)).free.indexOf(block.id)
}

/** Take a block out of its frame's kids or its page's free list. */
function detach(draft: Draft, block: Block): void {
  if ('parent' in block) {
    const frame = needFrame(draft, block.parent)
    draft.putBlock({ ...frame, kids: frame.kids.filter((kid) => kid !== block.id) })
  } else {
    const page = draft.page(block.page) ?? missing('page', block.page)
    draft.putPage({ ...page, free: page.free.filter((id) => id !== block.id) })
  }
}

// ----- splice and stroke ----------------------------------------------------

/** The text fields a splice can edit, by block type. A caption may be missing: it reads as empty. */
const TEXT_FIELDS: Partial<Record<BlockType, readonly ContentField[]>> = { text: ['md'], math: ['tex'], diagram: ['src'], image: ['caption'], table: ['caption'] }

function splice(draft: Draft, op: OpOf<'splice'>): Op[] {
  let current: string
  let block: Block | undefined
  if (op.field === 'title') {
    if (op.id !== draft.doc.id) fail('wrong_type', `Only the document has a title. Use the document id, ${draft.doc.id}.`)
    current = draft.doc.title
  } else {
    block = needBlock(draft, op.id)
    draft.checkFresh(block.id)
    const fields = TEXT_FIELDS[block.type] ?? []
    if (!fields.includes(op.field as ContentField)) {
      fail(
        'wrong_type',
        fields.length > 0
          ? `Block ${block.id} has type ${block.type}: splice its ${fields.join(' or ')}, not ${op.field}.`
          : `Block ${block.id} has type ${block.type}, which has no text to splice. Use update.`,
      )
    }
    current = ((block as Record<string, unknown>)[op.field] as string | undefined) ?? ''
  }

  const where = block ? `Block ${block.id}` : 'The title'
  // Positions count UTF-16 units, as JavaScript's strings do: which is how a range can cut an emoji in two (below).
  if (op.at + op.del > current.length) {
    fail('bad_range', `${where}: cannot replace ${op.del} characters at ${op.at}; the text is ${current.length} long.`)
  }
  if (splitsCharacter(current, op.at) || splitsCharacter(current, op.at + op.del)) {
    fail('bad_range', `${where}: the range cuts a character in two (such as an emoji). Move its ends by one.`)
  }
  if (!isWellFormed(op.ins)) fail('bad_shape', `${where}: the inserted text has half of an emoji on its own.`)

  const removedText = current.slice(op.at, op.at + op.del)
  const text = current.slice(0, op.at) + op.ins + current.slice(op.at + op.del)
  const inverse: Op[] = [{ op: 'splice', id: op.id, field: op.field, at: op.at, del: op.ins.length, ins: removedText }]
  if (!block) {
    draft.setDocFields({ title: text })
    return inverse
  }
  const next: Record<string, unknown> = { ...block, [op.field]: text }
  // An emptied caption goes, as if it had never been set.
  if (op.field === 'caption' && text === '') delete next.caption
  // `value` caches the result of `tex`, so changing tex clears it.
  if (block.type === 'math' && block.value !== undefined) {
    delete next.value
    inverse.push({ op: 'update', id: block.id, set: { value: block.value } })
  }
  draft.putBlock(next as Block)
  draft.markEdited(block.id, op.field as ContentField)
  return inverse
}

function stroke(draft: Draft, op: OpOf<'stroke'>): Op[] {
  const block = needBlock(draft, op.id)
  if (block.type !== 'ink') fail('wrong_type', `Block ${block.id} has type ${block.type}; only ink blocks have strokes.`)
  draft.checkFresh(block.id)
  if (op.add) {
    checkIndex(op.at, block.strokes.length, `Ink ${block.id}`)
    draft.putBlock({ ...block, strokes: inserted(block.strokes, op.at, op.add) })
    return [{ op: 'stroke', id: block.id, at: op.at, remove: true }]
  }
  const old = block.strokes[op.at] ?? fail('bad_range', `Ink ${block.id} has ${block.strokes.length} strokes; there is no stroke ${op.at}.`)
  draft.putBlock({ ...block, strokes: removed(block.strokes, op.at) })
  return [{ op: 'stroke', id: block.id, at: op.at, add: old }]
}

// ----- pages and assets -----------------------------------------------------

function page(draft: Draft, op: OpOf<'page'>): Op[] {
  const pages = draft.doc.pages
  if (op.add) {
    const added = op.add
    if (idTaken(draft.doc, added.id)) {
      fail('duplicate_id', `The id ${added.id} is already used in this document. Choose a new id.`, { got: added.id })
    }
    if (added.free.length > 0) fail('not_empty', `Page ${added.id}: add a page with an empty free list, then add its blocks.`)
    const at = op.at ?? pages.length
    checkIndex(at, pages.length, 'The page list')
    draft.putPage(added)
    draft.setPages(inserted(pages, at, added.id))
    return [{ op: 'page', remove: added.id }]
  }

  if (op.remove !== undefined) {
    const gone = draft.page(op.remove) ?? missing('page', op.remove)
    if (pages.length === 1) fail('last_page', 'A document keeps at least one page. Add another page before removing this one.')
    const at = pages.indexOf(gone.id)
    const readd: Op[][] = []
    const relink: Op[] = []
    // Remove from the end of the free list, so that re-adding in list order restores every index.
    for (const id of [...gone.free].reverse()) {
      const back = removeBlock(draft, id)
      readd.unshift(back.readd)
      relink.push(...back.relink)
    }
    // A video's marks placed on this page go with it: a mark on a page the note lacks would make the note unreadable.
    const clips = draft.doc.clips ?? []
    const kept = clips.filter((clip) => clip.page !== gone.id)
    const marks: Op[] = kept.length < clips.length ? [{ op: 'update', id: draft.doc.id, set: { clips } }] : []
    if (marks.length > 0) draft.setDocFields({ clips: kept })
    draft.dropPage(gone.id)
    draft.setPages(removed(pages, at))
    // The page first, as its blocks and marks need it; then its blocks, the links (they point at frames that must be
    // back by then), and the marks.
    return [{ op: 'page', add: { ...gone, free: [] }, at }, ...readd.flat(), ...relink, ...marks]
  }

  const id = op.move!
  const to = op.to!
  if (!draft.page(id)) missing('page', id)
  const from = pages.indexOf(id)
  checkIndex(to, pages.length - 1, 'The page list')
  draft.setPages(inserted(removed(pages, from), to, id))
  return [{ op: 'page', move: id, to: from }]
}

function asset(draft: Draft, op: OpOf<'asset'>): Op[] {
  const old = draft.asset(op.hash)
  if (op.meta === null) {
    if (!old) missing('asset', op.hash)
    const user = Object.values(draft.doc.block).find((b) => b.type === 'image' && b.asset === op.hash)
    if (user) fail('in_use', `Image ${user.id} still uses asset ${op.hash}. Remove that image or give it another asset first.`)
    const video = draft.doc.media?.find((m) => m.kind === 'file' && m.asset === op.hash)
    if (video) fail('in_use', `Video ${video.id} still uses asset ${op.hash}. Remove that video from the note first.`)
    if (Object.values(draft.doc.block).some((b) => b.type === 'ink' && b.strokes.some((stroke) => stroke.pm?.pic === op.hash))) fail('in_use', `A line written beside a program keeps asset ${op.hash} as its picture. Take the places off that line first.`)
    draft.dropAsset(op.hash)
  } else {
    draft.putAsset(op.hash, op.meta)
  }
  return [{ op: 'asset', hash: op.hash, meta: old ?? null }]
}

// ----- shared checks --------------------------------------------------------

/** The note's videos and their marks: ids unique and new to the document, a file's asset there, a mark on a video and a page that exist. */
function checkMedia(draft: Draft, media: readonly { id: Id; kind: string; asset?: string }[], clips: readonly { id: Id; media: Id; page: Id }[]): void {
  const seen = new Set<Id>()
  for (const item of [...media, ...clips]) {
    if (seen.has(item.id) || item.id === draft.doc.id || draft.page(item.id) || draft.block(item.id)) fail('duplicate_id', `The id ${item.id} is used twice.`)
    seen.add(item.id)
  }
  for (const item of media) {
    if (item.kind === 'file' && item.asset !== undefined && !draft.asset(item.asset)) missing('asset', item.asset)
  }
  for (const clip of clips) {
    if (!media.some((m) => m.id === clip.media)) fail('unknown_id', `Clip ${clip.id} is of video ${clip.media}, which the note does not have.`)
    if (!draft.page(clip.page)) missing('page', clip.page)
  }
}

/** A frame may continue in another frame (`next`): never itself, never two into one, never in a loop. */
function checkContinuation(draft: Draft, frameId: Id, nextId: Id): void {
  if (nextId === frameId) fail('bad_ref', `Frame ${frameId} cannot continue in itself.`)
  needFrame(draft, nextId)
  for (const other of Object.values(draft.doc.block)) {
    if (other.type === 'frame' && other.id !== frameId && other.next === nextId) {
      fail('bad_ref', `Frame ${other.id} already continues in ${nextId}; a frame has one continuation at most.`)
    }
  }
  const seen = new Set<Id>()
  // Along the chain from the new target: reaching this frame would close a loop. `seen` stops a chain looping already.
  for (let at = draft.block(nextId); at?.type === 'frame' && at.next !== undefined; at = draft.block(at.next)) {
    if (at.next === frameId || seen.has(at.id)) {
      fail('bad_ref', `Frame ${frameId} cannot continue in ${nextId}: the frames would form a loop.`)
    }
    seen.add(at.id)
  }
}

function needBlock(draft: Draft, id: Id): Block {
  return draft.block(id) ?? missing('block', id)
}

function needFrame(draft: Draft, id: Id): Frame {
  const block = needBlock(draft, id)
  if (block.type !== 'frame') fail('bad_ref', `Block ${id} has type ${block.type}, not frame. Only frames hold other blocks.`)
  return block
}

function checkIndex(at: number, max: number, where: string): void {
  if (at > max) fail('bad_range', `${where}: index ${at} is past the end; the largest allowed is ${max}.`)
}

function inserted<T>(list: readonly T[], at: number, item: T): T[] {
  return [...list.slice(0, at), item, ...list.slice(at)]
}

function removed<T>(list: readonly T[], at: number): T[] {
  return [...list.slice(0, at), ...list.slice(at + 1)]
}

function missing(what: string, id: string): never {
  return fail('unknown_id', `There is no ${what} ${id}.`, { got: id })
}

function fail(code: ErrorCode, hint: string, details?: Record<string, unknown>): never {
  throw new ValidationError(code, hint, details)
}
