// The AI protocol: the operations a model may return.
//
// Every field is a pick from a short list. Ids are per-request aliases (a, b,
// c), which code maps back to real ids. Long content never travels inside the
// JSON: a second, plain-text call (the content step) writes it, except for
// models allowed to send it inline.
//
// The reply schema is built per request, so the id fields list only the
// aliases that exist in that request: under constrained decoding a model
// cannot even produce an unknown id.
//
// `style` and `mark` send their changes as an order-free list,
// "set":[{"color":"blue"},{"size":"l"}]. Constrained decoding makes optional
// fields come in schema order, so with flat fields a model that writes
// "color" first can no longer add "size".
// The flat shape is kept as a benchmark variant.
import { z } from 'zod'
import { AnyColor, Color, Role } from './doc.js'

export const SIZES = ['s', 'm', 'l', 'xl'] as const
export const FONTS = ['sans', 'serif', 'mono', 'hand'] as const
export const ALIGNS = ['left', 'center', 'right'] as const
export const KINDS = ['text', 'math', 'diagram', 'table'] as const
export const INTO = ['list', 'steps', 'paragraph', 'diagram', 'math', 'table'] as const
export const ACTIONS = ['simplify', 'solve', 'expand', 'factor', 'derive', 'check'] as const

/** A small model chooses better from a shorter list (operation sets). */
export const OP_SETS = {
  small: ['style', 'mark', 'rewrite', 'insert', 'delete', 'move', 'none'],
  full: ['style', 'mark', 'rewrite', 'insert', 'delete', 'move', 'none', 'convert', 'calc'],
} as const
export type OpSet = keyof typeof OP_SETS
export type AiOpName = (typeof OP_SETS.full)[number]

/** How style and mark carry their changes: an order-free list, or flat fields. */
export type Shape = 'list' | 'flat'

/** The changes `style` can make to whole blocks. */
export const STYLE_FIELDS = {
  size: z.enum(SIZES),
  color: Color,
  font: z.enum(FONTS),
  align: z.enum(ALIGNS),
  role: Role,
  indent: z.enum(['in', 'out']),
  done: z.boolean(),
}

/** The changes `mark` can make to the selected words. Underline, sub and sup from protocol v1.1. */
export const MARK_FIELDS = {
  bold: z.boolean(),
  italic: z.boolean(),
  strike: z.boolean(),
  code: z.boolean(),
  highlight: z.boolean(),
  underline: z.boolean(),
  sub: z.boolean(),
  sup: z.boolean(),
  color: Color,
  link: z.boolean(),
}

/** Word changes that only `mark` makes, or `style` in the merged shape. */
const WORD_FIELDS = {
  bold: MARK_FIELDS.bold,
  italic: MARK_FIELDS.italic,
  strike: MARK_FIELDS.strike,
  code: MARK_FIELDS.code,
  highlight: MARK_FIELDS.highlight,
  underline: MARK_FIELDS.underline,
  sub: MARK_FIELDS.sub,
  sup: MARK_FIELDS.sup,
  link: MARK_FIELDS.link,
}

/** What one request allows. */
export interface Scope {
  set: OpSet
  /** Aliases of what is selected, whole blocks and words (v1.1): only these may be changed. */
  selected: readonly string[]
  /**
   * Aliases of the whole selected blocks, which move, convert and calc need.
   * The same as `selected` when missing: no words are selected.
   */
  blocks?: readonly string[]
  /** Aliases a `ref` may name: the selected blocks and their neighbours. */
  refs: readonly string[]
  /** A region was dragged, so `insert` may use at: "here". */
  here: boolean
  /** The place is a Select box (v1.1): new things go only "here", into it. */
  box?: boolean
  /** Most operations in one reply: 1 for small models, up to 8 for large ones. */
  maxOps: number
  /** The model may send long content inline instead of in a second call. */
  inline: boolean
  shape: Shape
  /**
   * One formatting operation: style also takes the word changes (bold, italic…)
   * and code applies them to the selected words, so mark is not offered.
   * A benchmark variant; small models mix up style and mark.
   */
  merged?: boolean
  /** Only this operation: the second step of a split choice (first the operation, then its fields). */
  only?: AiOpName
  /**
   * Colour codes the request itself gives, such as #e0563a (v1.1): a colour
   * may be one of them as well as one of the eight names.
   */
  colors?: readonly string[]
  /** The server holds the schema to Anthropic's strict mode, so it has no `maxItems` or `maxLength` (Caps.strictSchema). */
  strict?: boolean
}

/** The longest reason a `none` gives, in characters, where the server takes maxLength. */
export const MAX_WHY = 80

type Alias = z.ZodType<string>
type Fields = Record<string, z.ZodType>

const optional = (fields: Fields): Fields => Object.fromEntries(Object.entries(fields).map(([key, schema]) => [key, schema.optional()]))

/** A list of single changes, in any order: [{"color":"blue"},{"size":"l"}]. */
function changeList(fields: Fields): z.ZodType {
  const items = Object.entries(fields).map(([key, schema]) => z.strictObject({ [key]: schema }))
  return z.array(z.union(items as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]])).min(1)
}

/**
 * The operation shapes, built from the aliases and options they accept. A
 * list of aliases may be empty in a request (nothing selected, a place marked
 * "here"): then the field is left out, because an empty enum is not valid
 * JSON Schema for the server, and allowedOps() leaves out the operations that need it.
 */
function shapes(
  selected: Alias | undefined,
  blocks: Alias | undefined,
  ref: Alias | undefined,
  at: z.ZodType<'after' | 'before' | 'here'>,
  inline: boolean,
  shape: Shape,
  merged: boolean,
  color: z.ZodType = Color,
) {
  const content = inline ? { content: z.string().optional() } : {}
  const style = { ...STYLE_FIELDS, color }
  const marks = { ...MARK_FIELDS, color }
  const one = selected ?? z.string()
  const ids = z.array(one).min(1)
  // Move, convert and calc act on whole blocks, never on words.
  const block = blocks ?? z.string()
  const changes = (fields: Fields): Fields => (shape === 'list' ? { set: changeList(fields) } : optional(fields))
  return {
    style: z.strictObject({ op: z.literal('style'), ids, ...changes(merged ? { ...style, ...WORD_FIELDS } : style) }),
    mark: z.strictObject({ op: z.literal('mark'), id: one, ...changes(marks) }),
    rewrite: z.strictObject({ op: z.literal('rewrite'), id: one, ...content }),
    insert: z.strictObject({ op: z.literal('insert'), at, ref: (ref ?? z.string()).optional(), kind: z.enum(KINDS), role: Role.optional(), ...content }),
    delete: z.strictObject({ op: z.literal('delete'), ids }),
    move: z.strictObject({ op: z.literal('move'), id: block, at: z.enum(['after', 'before']), ref: ref ?? z.string() }),
    none: z.strictObject({ op: z.literal('none'), why: z.string() }),
    convert: z.strictObject({ op: z.literal('convert'), ids: z.array(block).min(1), into: z.enum(INTO), ...content }),
    calc: z.strictObject({ op: z.literal('calc'), id: block, action: z.enum(ACTIONS) }),
  }
}

// The flat form code works with. Style accepts the word changes too, so replies
// in the merged shape, and from models that send them anyway, can be read.
// A colour code reads too: parseReply checks it is one the request gave.
const FLAT = shapes(z.string(), z.string(), z.string(), z.enum(['after', 'before', 'here']), true, 'flat', true, AnyColor)

/** Each operation's flat schema, for checking one operation with a precise hint. */
export const AI_OP_SHAPES: Record<AiOpName, z.ZodType> = FLAT

/**
 * One AI operation as code works with it: flat fields, ids still aliases.
 * Replies in the list shape are flattened into this when read.
 */
export const AiOp = z.union([
  FLAT.style,
  FLAT.mark,
  FLAT.rewrite,
  FLAT.insert,
  FLAT.delete,
  FLAT.move,
  FLAT.none,
  FLAT.convert,
  FLAT.calc,
])

export type StyleOp = { op: 'style'; ids: string[] } & Partial<{ [K in Exclude<keyof typeof STYLE_FIELDS, 'color'>]: z.infer<(typeof STYLE_FIELDS)[K]> }> &
  Partial<{ [K in keyof typeof WORD_FIELDS]: z.infer<(typeof WORD_FIELDS)[K]> }> & { color?: AnyColor }
export type MarkOp = { op: 'mark'; id: string } & Partial<{ [K in Exclude<keyof typeof MARK_FIELDS, 'color'>]: z.infer<(typeof MARK_FIELDS)[K]> }> & { color?: AnyColor }
export type AiOp =
  | StyleOp
  | MarkOp
  | Exclude<z.infer<typeof AiOp>, { op: 'style' } | { op: 'mark' }>
export type AiOpOf<K extends AiOpName> = Extract<AiOp, { op: K }>

/** The operations that make sense for this request, in the order of OP_SETS. */
export function allowedOps(scope: Scope): AiOpName[] {
  const blocks = scope.blocks ?? scope.selected
  return OP_SETS[scope.set].filter((name) => {
    if (scope.only !== undefined && name !== scope.only) return false
    if (name === 'none') return true
    if (name === 'mark' && scope.merged) return false
    if (name === 'insert') return scope.here || scope.refs.length > 0
    if (name === 'move') return blocks.length > 0 && scope.refs.length > 1
    if (name === 'convert' || name === 'calc') return blocks.length > 0
    return scope.selected.length > 0
  })
}

/** The reply schema for one request: { ops: [...] }, every id a real alias, every value on its list. */
export function replySchema(scope: Scope): z.ZodType {
  const list = (items: readonly string[]): Alias | undefined => (items.length > 0 ? z.enum(items as [string, ...string[]]) : undefined)
  const places: ('after' | 'before' | 'here')[] = [...(scope.refs.length > 0 ? (['after', 'before'] as const) : []), ...(scope.here ? (['here'] as const) : [])]
  const at = z.enum((places.length > 0 ? places : ['after', 'before']) as ['after' | 'before' | 'here', ...('after' | 'before' | 'here')[]])
  const color = scope.colors && scope.colors.length > 0 ? z.enum([...Color.options, ...scope.colors] as [string, ...string[]]) : Color
  const all = shapes(list(scope.selected), list(scope.blocks ?? scope.selected), list(scope.refs), at, scope.inline, scope.shape, scope.merged === true, color)
  // With no block to stand next to, insert has no ref at all; with no "here", it must have one.
  const insert = scope.refs.length === 0 ? all.insert.omit({ ref: true }) : scope.here ? all.insert : all.insert.required({ ref: true })
  // A reason of a few words. Anthropic's strict mode refuses maxLength and maxItems (v1.1); there, reading the reply checks them.
  const none = scope.strict ? all.none : z.strictObject({ op: z.literal('none'), why: z.string().max(MAX_WHY) })
  const options = allowedOps(scope).map((name) => (name === 'insert' ? insert : name === 'none' ? none : all[name]))
  const op = options.length === 1 ? options[0]! : z.union(options as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]])
  const ops = z.array(op).min(1)
  // The schema holds a small model to its one operation, as in v1; without it, small models add a second one from an example.
  return z.strictObject({ ops: scope.strict ? ops : ops.max(scope.maxOps) })
}

/** The same schema as JSON Schema, for constrained decoding. */
export function replyJsonSchema(scope: Scope): Record<string, unknown> {
  return z.toJSONSchema(replySchema(scope)) as Record<string, unknown>
}

/** The first step of a split choice: the operation's name alone, {"op":"style"}. */
export function opChoiceJsonSchema(scope: Scope): Record<string, unknown> {
  return z.toJSONSchema(z.strictObject({ op: z.enum(allowedOps(scope) as [AiOpName, ...AiOpName[]]) })) as Record<string, unknown>
}
