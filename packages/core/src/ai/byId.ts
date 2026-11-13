// An edit that names blocks by their real ids and carries its content: what
// a program outside the app sends (an assistant, through the MCP server),
// where a model inside the app sends aliases and has its content written in a
// second step. They are the same operations (schema/protocol.ts), read by the
// same reader, compiled by the same code, and held to the same scope: only
// the blocks an edit names may change, and new blocks stand only next to them.
//
// Differences from a model's reply in the app, all of them in what is sent:
//
// - ids are the note's own, as the outline shows them;
// - `rewrite`, `insert` and `convert` carry "content"; `mark` with a link
//   carries "href";
// - `insert` with "at":"here" names a text column in "ref" (a frame's id):
//   the new block goes at its end. That is how an empty note is written in.
import { apply, type Applied } from '../apply.js'
import { linearise } from '../linearise.js'
import { checkInline } from '../markdown/inline.js'
import { parsePipeTable } from '../markdown/table.js'
import type { Doc, Id } from '../schema/doc.js'
import type { Op } from '../schema/ops.js'
import { OP_SETS, type AiOp, type Scope } from '../schema/protocol.js'
import type { Selection } from '../select/selection.js'
import { isRecord } from '../util.js'
import type { ContentValidators } from '../validate/content.js'
import { ValidationError, type ErrorCode } from '../validate/errors.js'
import type { Aliases } from './alias.js'
import { compile } from './compile.js'
import { cleanContent, type ContentKind } from './content.js'
import { freshIds } from './instant.js'
import { diagramHint, diagramKind } from './mermaid.js'
import { parseReply } from './parse.js'
import { outsideScope } from './scope.js'

/** The most operations one edit may hold, and the most characters one piece of content. */
export const MAX_EDIT_OPS = 20
export const MAX_EDIT_CONTENT = 20_000

export interface IdEdit {
  doc: Doc
  /** The operations as sent: a list, {"ops":[…]} or one operation. */
  ops: unknown
  /** The `rev` of the note when it was read: a block changed since then is not touched (`stale`). */
  baseRev: number
  validators?: ContentValidators
  /** A check that a diagram's source draws, where the caller has one: null, or what is wrong with it. */
  mermaid?: (src: string) => string | null
  newId?: () => Id
}

export interface IdEdited {
  /** The note after the edit; absent when the operations change nothing. */
  result?: Applied
  /** The internal operations applied. */
  ops: Op[]
  /** The operations as read, their content tidied. */
  ai: AiOp[]
  /** The blocks the edit names to change. */
  targets: Id[]
}

const COLOUR_CODE = /^#[0-9a-f]{6}$/u
/** The operations an edit may hold, and those that name several blocks. */
const OPS = OP_SETS.full.filter((name) => name !== 'none')
const MANY: readonly string[] = ['style', 'delete', 'convert']
const NEEDS_ID = 'Use a block id that the outline of this note gives.'

/**
 * Check an edit and apply it as one change: all of it, or none. Throws a
 * ValidationError that says what to fix, in words an assistant can act on.
 */
export function editById(input: IdEdit): IdEdited {
  const { doc } = input
  if (!Number.isInteger(input.baseRev) || input.baseRev < 0 || input.baseRev > doc.rev) {
    throw teach('bad_value', `"rev" is the rev a read of this note gave. The note is at rev ${doc.rev} now: read it again.`, { got: input.baseRev })
  }
  const list = Array.isArray(input.ops) ? input.ops : isRecord(input.ops) && Array.isArray(input.ops.ops) ? input.ops.ops : isRecord(input.ops) && 'op' in input.ops ? [input.ops] : undefined
  if (!list || list.length === 0) throw teach('no_ops', 'Give "ops": a list of operations, like [{"op":"style","ids":["t1"],"set":[{"color":"blue"}]}].')
  if (list.length > MAX_EDIT_OPS) throw teach('too_many', `One edit holds at most ${MAX_EDIT_OPS} operations. Send the rest in another edit.`, { got: list.length })

  /** An error that says which operation it is about, when there are several. */
  const at = (error: ValidationError, index: number): ValidationError => (list.length > 1 ? error.inOp(index) : error)

  // What the operations name: the blocks to change, the blocks to stand next to, and one place in a text column.
  const targets = new Set<Id>()
  const refs = new Set<Id>()
  const colors = new Set<string>()
  const hrefs: (string | undefined)[] = []
  let here: { parent: Id; at: number } | undefined
  const block = (id: unknown, index: number): Doc['block'][string] => {
    const found = typeof id === 'string' && Object.hasOwn(doc.block, id) ? doc.block[id] : undefined
    if (!found) throw at(teach('unknown_id', `There is no block ${JSON.stringify(typeof id === 'string' ? id.slice(0, 80) : id)} in this note. ${NEEDS_ID}`, { got: id }), index)
    return found
  }
  const cleaned = list.map((raw: unknown, index): Record<string, unknown> => {
    if (!isRecord(raw)) throw at(teach('bad_value', 'Each operation is an object, like {"op":"delete","ids":["t1"]}.'), index)
    const op: Record<string, unknown> = { ...raw }
    const name = op.op
    if (typeof name !== 'string' || !(OPS as readonly string[]).includes(name)) throw at(teach('unknown_op', `"op" must be one of: ${OPS.join(', ')}.`, { got: name ?? null, valid: OPS }), index)
    const named = [...(Array.isArray(op.ids) ? (op.ids as unknown[]) : []), ...(op.id === undefined ? [] : [op.id])]
    if (name !== 'insert' && name !== 'none' && named.length === 0) throw at(teach('bad_value', `${name} needs the block it changes: add ${MANY.includes(name) ? '"ids", a list of block ids' : '"id", a block id'}.`), index)
    for (const id of named) {
      const found = block(id, index)
      if (found.type === 'frame') throw at(teach('wrong_type', `${found.id} is a text column (a frame): it holds blocks and has no words of its own. Name the blocks in it.`, { got: found.id }), index)
      if (name === 'rewrite' && found.type === 'ink') throw at(teach('wrong_type', `${found.id} is handwriting: what it says is read by ShellNote itself, and is not rewritten.`, { got: found.id }), index)
      targets.add(found.id)
    }
    if ((name === 'insert' && op.at !== 'here') || name === 'move') {
      if (op.ref === undefined) throw at(teach('bad_value', name === 'move' ? 'move needs "ref": the block it goes next to.' : 'Say which block the new one goes next to: add "ref", a block id. In an empty text column, use "at":"here" with the id of the column as "ref".'), index)
      if (name === 'move' && op.ref === op.id) throw at(teach('bad_value', 'A block cannot move next to itself. Choose another block as "ref".'), index)
    }
    if (name === 'insert' && op.at === 'here') {
      const column = op.ref === undefined ? undefined : block(op.ref, index)
      if (column?.type !== 'frame') throw at(teach('bad_value', 'With "at":"here", "ref" names a text column (a frame id from the outline): the new block goes at its end.'), index)
      if (here && here.parent !== column.id) throw at(teach('bad_value', 'One edit adds at the end of one text column only. Send the other column\'s blocks in another edit.'), index)
      here ??= { parent: column.id, at: column.kids.length }
      delete op.ref
    } else if (op.ref !== undefined) refs.add(block(op.ref, index).id)
    if (name === 'mark' && op.href !== undefined) {
      if (typeof op.href !== 'string' || op.href.length > 2000 || /\s/u.test(op.href)) throw at(teach('bad_value', '"href" is one web address, such as "https://example.com".'), index)
      hrefs[index] = op.href
      delete op.href
    }
    // A colour may be one of the eight names, or a colour code: the one sending the edit speaks for the person.
    for (const change of [op, ...(Array.isArray(op.set) ? (op.set as unknown[]) : [])]) {
      if (isRecord(change) && typeof change.color === 'string' && COLOUR_CODE.test(change.color)) colors.add(change.color)
    }
    return op
  })

  const order = linearise(doc).map((item) => item.block.id)
  const inOrder = (ids: Iterable<Id>): Id[] => [...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b))
  const selected = inOrder(targets)
  const scope: Scope = {
    set: 'full',
    selected,
    blocks: selected,
    refs: [...new Set([...selected, ...refs])],
    here: here !== undefined,
    maxOps: MAX_EDIT_OPS,
    inline: true,
    shape: 'list',
    colors: [...colors],
  }
  const read = parseReply(JSON.stringify(cleaned), scope)

  // What each operation writes is tidied and checked before anything is compiled.
  const ai: AiOp[] = []
  const links: (string | undefined)[] = []
  read.forEach((op, index) => {
    if (op.op === 'none') return
    if (op.op === 'calc') throw at(teach('not_ready', 'Math actions (calc) are not ready yet: they arrive with math in a later version.'), index)
    if (op.op === 'mark' && op.link === true && hrefs[index] === undefined) throw at(teach('bad_value', 'A link needs its address: add "href":"https://…" to the mark operation.'), index)
    const kind = contentKind(doc, op)
    if (kind === undefined) {
      ai.push(op)
      links.push(hrefs[index])
      return
    }
    const sent = (op as { content?: unknown }).content
    if (typeof sent !== 'string' || sent.trim() === '') throw at(teach('bad_value', `${op.op} needs what to write: add "content".`), index)
    if (sent.length > MAX_EDIT_CONTENT) throw at(teach('bad_value', `"content" holds at most ${MAX_EDIT_CONTENT} characters. Write it as several blocks.`), index)
    if ((kind === 'text' || kind === 'alt') && /\n\s*\n/u.test(sent.trim())) throw at(new ValidationError('content', 'One paragraph for each block. Send each paragraph as an insert of its own.'), index)
    const content = cleanContent(kind, sent)
    const problem = contentProblem(doc, op, kind, content, input.mermaid)
    if (problem !== null) throw at(new ValidationError('content', problem), index)
    ai.push({ ...op, content } as AiOp)
    links.push(undefined)
  })
  if (ai.length === 0) return { ops: [], ai, targets: selected }

  // Here an id is its own alias. A block named only as a place is a neighbour: new blocks may stand next to it.
  const near = inOrder([...refs].filter((id) => !targets.has(id)))
  const aliases: Aliases = {
    selected: selected.map((id) => ({ alias: id, id })),
    near: near.map((id) => ({ alias: id, id, side: 'after' })),
    refs: scope.refs as string[],
    blocks: selected,
    pieces: [],
    id: (alias) => alias,
    alias: (id) => id,
    words: () => undefined,
  }
  const selection: Selection = { blocks: selected, ...(here ? { here } : {}) }
  const newId = input.newId ?? freshIds(doc)

  // Each operation is compiled against the note as the ones before it left it, then all are applied together.
  let scratch = doc
  let end = here?.at ?? 0
  const compiled: Op[] = []
  ai.forEach((op, index) => {
    const atEnd = here !== undefined && op.op === 'insert' && op.at === 'here'
    const content = (op as { content?: string }).content
    const link = links[index]
    let step: Op[]
    try {
      step = compile(op, {
        doc: scratch,
        aliases,
        selection: atEnd ? { ...selection, here: { parent: here!.parent, at: end } } : selection,
        newId,
        ...(content === undefined ? {} : { content }),
        ...(link === undefined ? {} : { href: link }),
      })
      if (step.length > 0) scratch = apply(scratch, step).doc
    } catch (error) {
      throw error instanceof ValidationError && ai.length > 1 ? error.inOp(index) : error
    }
    compiled.push(...step)
    // The next block for this column goes after the one just added.
    if (atEnd && step.length > 0) end++
  })
  if (compiled.length === 0) return { ops: [], ai, targets: selected }
  const result = apply(doc, compiled, { baseRev: input.baseRev, validators: input.validators ?? { md: checkInline } })
  // The scope rule, on the whole note, whatever was sent.
  const outside = outsideScope(doc, result.doc, selection, aliases)
  if (outside !== null) throw new ValidationError('scope', outside)
  return { result, ops: compiled, ai, targets: selected }
}

/** What an operation writes, by the block it writes to or makes; undefined when it writes nothing. */
function contentKind(doc: Doc, op: AiOp): ContentKind | undefined {
  switch (op.op) {
    case 'rewrite': {
      const block = doc.block[op.id]
      if (!block || block.type === 'frame') return undefined
      return block.type === 'image' ? 'alt' : block.type === 'ink' ? 'text' : block.type
    }
    case 'insert':
      return op.kind
    case 'convert':
      return op.into === 'list' || op.into === 'steps' ? 'items' : op.into === 'paragraph' ? 'text' : op.into
    default:
      return undefined
  }
}

/** Why written content cannot be used, or null when it can: nothing left of it, a diagram of a kind not taken or that does not draw, a table that is not one. */
function contentProblem(doc: Doc, op: AiOp, kind: ContentKind, text: string, mermaid: IdEdit['mermaid']): string | null {
  if (text === '') return 'The content is empty once tidied. Write the content itself.'
  if (kind === 'diagram') {
    // A diagram being changed may keep the kind it has.
    const changing = op.op === 'rewrite' ? doc.block[op.id] : undefined
    return diagramHint(text, changing?.type === 'diagram' ? diagramKind(changing.src) : undefined) ?? mermaid?.(text) ?? null
  }
  if (kind === 'table' && !parsePipeTable(text)) return 'Write the table as a Markdown pipe table: one row per line, the cells between | signs, a line of dashes under the header.'
  return null
}

function teach(code: ErrorCode, hint: string, details: Record<string, unknown> = {}): ValidationError {
  return new ValidationError(code, hint, details)
}
