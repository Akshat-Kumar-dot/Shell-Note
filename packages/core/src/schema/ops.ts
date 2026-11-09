// Internal operations. Every change to a document, whether by
// the user, the AI, undo or MCP, is a list of these, applied by apply(). Each
// one has an exact inverse, which is all undo needs.
import { z } from 'zod'
import { isRecord } from '../util.js'
import { ValidationError } from '../validate/errors.js'
import { checkBlock, parseWith } from '../validate/shape.js'
import { Asset, Block, Hash, Id, Page, Stroke } from './doc.js'

const Index = z.int().nonnegative()

/** Where `move` puts a block: into a frame at an index, or onto a page at a position. */
export const MoveTo = z.union([
  z.strictObject({ parent: Id, at: Index }),
  z.strictObject({
    page: Id,
    x: z.int(),
    y: z.int(),
    /** Needed when the block comes out of a frame, since children have no size. */
    w: Index.optional(),
    h: Index.optional(),
    /** Index in the page's free list (back to front). Default: unchanged on the same page, else the front. */
    at: Index.optional(),
  }),
])
export type MoveTo = z.infer<typeof MoveTo>

export const Op = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('add'),
    /** The whole block. A frame is added with empty kids, then each child with its own add. apply sets `r`. */
    block: Block,
    /** Index in the parent frame's kids, or in the page's free list. Default: the end. */
    at: Index.optional(),
  }),
  z.strictObject({
    op: z.literal('remove'),
    /** The block to remove. A frame's children go with it. */
    id: Id,
  }),
  z.strictObject({
    op: z.literal('update'),
    /** A block, a page, or the document itself. */
    id: Id,
    /** New values for one or more fields. null removes an optional field. */
    set: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({
    op: z.literal('move'),
    id: Id,
    to: MoveTo,
  }),
  z.strictObject({
    op: z.literal('splice'),
    /** A block, or the document itself for its title. */
    id: Id,
    field: z.enum(['md', 'tex', 'src', 'caption', 'title']),
    /** Replace `del` characters at `at` with `ins`. Positions count UTF-16 code units. */
    at: Index,
    del: Index,
    ins: z.string(),
  }),
  z
    .strictObject({
      op: z.literal('stroke'),
      id: Id,
      at: Index,
      /** Insert this stroke at `at`... */
      add: Stroke.optional(),
      /** ...or remove the stroke at `at`. */
      remove: z.literal(true).optional(),
    })
    .refine((op) => (op.add === undefined) !== (op.remove === undefined), {
      error: 'stroke takes either add (a stroke) or remove: true.',
    }),
  z
    .strictObject({
      op: z.literal('page'),
      /** Add this page (with an empty free list) at index `at`, default the end... */
      add: Page.optional(),
      at: Index.optional(),
      /** ...or remove this page and everything on it... */
      remove: Id.optional(),
      /** ...or move this page to index `to`. */
      move: Id.optional(),
      to: Index.optional(),
    })
    .refine(
      (op) =>
        [op.add, op.remove, op.move].filter((x) => x !== undefined).length === 1 &&
        (op.move === undefined) === (op.to === undefined) &&
        (op.at === undefined || op.add !== undefined),
      { error: 'page takes one of: { add, at? }, { remove }, or { move, to }.' },
    ),
  z.strictObject({
    op: z.literal('asset'),
    hash: Hash,
    /** The metadata to store, or null to remove the entry. */
    meta: Asset.nullable(),
  }),
])
export type Op = z.infer<typeof Op>
export type OpName = Op['op']
export type OpOf<K extends OpName> = Extract<Op, { op: K }>

const OP_NAMES: readonly OpName[] = ['add', 'remove', 'update', 'move', 'splice', 'stroke', 'page', 'asset']

/** Check the shape of one operation, with a hint that says how to fix it. */
export function checkOp(value: unknown): Op {
  const name = isRecord(value) ? value.op : undefined
  if (typeof name !== 'string' || !OP_NAMES.includes(name as OpName)) {
    throw new ValidationError('bad_shape', `Unknown operation ${JSON.stringify(name)}. Use one of: ${OP_NAMES.join(', ')}.`)
  }
  // A block gets the block checker's clearer hints before the operation as a whole is checked.
  if (name === 'add') checkBlock((value as Record<string, unknown>).block)
  parseWith(Op, value, `Operation ${name}`)
  return value as Op
}
