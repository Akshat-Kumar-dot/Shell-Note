// Reading a model's reply. Lenient about the wrapper,
// strict about what matters: a real mistake comes back as a teaching error,
// which a small model can act on in its one retry without rereading the rules.
import { AI_OP_SHAPES, allowedOps, MARK_FIELDS, STYLE_FIELDS, type AiOp, type AiOpName, type Scope } from '../schema/protocol.js'
import { has, isRecord } from '../util.js'
import { ValidationError, zodHint, type ErrorCode } from '../validate/errors.js'

/** Operations that name one block (`id`) and those that name several (`ids`). */
const ONE = new Set(['mark', 'rewrite', 'move', 'calc'])
const MANY = new Set(['style', 'delete', 'convert'])

/**
 * Read a reply into operations, flat fields and aliases intact. Accepts
 * {"ops":[…]}, a bare list or a single operation, inside code fences or not.
 * Throws a ValidationError whose toJSON() is the teaching error to send back.
 */
export function parseReply(text: string, scope: Scope): AiOp[] {
  const value = readJson(text)
  const list = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.ops)
      ? value.ops
      : isRecord(value) && 'op' in value
        ? [value]
        : undefined
  if (!list || list.length === 0) throw teach('no_ops', 'Reply with {"ops":[ ... ]} holding one operation.')
  if (list.length > scope.maxOps) {
    throw teach('too_many', `Reply with at most ${scope.maxOps} operation${scope.maxOps === 1 ? '' : 's'}.`, { got: list.length })
  }
  return list.map((raw) => readOp(raw, scope))
}

function readJson(text: string): unknown {
  const body = text.trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '')
  const start = body.search(/[[{]/u)
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'))
  const fail = (): ValidationError => teach('not_json', 'Reply with JSON only, like {"ops":[{"op":"none","why":"Which block?"}]}.')
  if (start === -1 || end < start) throw fail()
  try {
    return JSON.parse(body.slice(start, end + 1))
  } catch {
    throw fail()
  }
}

function readOp(raw: unknown, scope: Scope): AiOp {
  if (!isRecord(raw)) throw teach('bad_value', 'Each operation is an object, like {"op":"delete","ids":["a"]}.')
  const allowed = allowedOps(scope)
  const name = raw.op
  if (typeof name !== 'string' || !(allowed as string[]).includes(name)) {
    throw teach('unknown_op', `"op" must be one of: ${allowed.join(', ')}.`, { got: name ?? null, valid: allowed })
  }
  const op: Record<string, unknown> = { ...raw }

  // An id where a list was expected, or a one-item list where one id was, means the same.
  if (MANY.has(name) && op.ids === undefined && typeof op.id === 'string') {
    op.ids = [op.id]
    delete op.id
  }
  if (ONE.has(name) && op.id === undefined && Array.isArray(op.ids) && op.ids.length === 1) {
    op.id = op.ids[0]
    delete op.ids
  }

  // The list shape becomes flat fields.
  if ((name === 'style' || name === 'mark') && op.set !== undefined) {
    // Style also reads word changes: the merged shape sends them, and code knows where they go.
    const fields = name === 'style' ? { ...STYLE_FIELDS, ...MARK_FIELDS } : MARK_FIELDS
    const valid = Object.keys(fields)
    if (!Array.isArray(op.set)) throw teach('bad_value', '"set" is a list of changes, like [{"color":"blue"}].')
    for (const change of op.set) {
      const entries = isRecord(change) ? Object.entries(change) : []
      if (entries.length !== 1) throw teach('bad_value', 'Each item of "set" holds one change, like {"color":"blue"}.', { got: change })
      const [key, value] = entries[0]!
      if (!has(fields, key)) throw teach('bad_value', `"${key}" is not a ${name} change. Use one of: ${valid.join(', ')}.`, { got: key, valid })
      op[key] = value
    }
    delete op.set
  }

  // Only the selected blocks may change. A ref may also name a neighbour.
  const named = [...(Array.isArray(op.ids) ? op.ids : []), ...(op.id === undefined ? [] : [op.id])]
  for (const alias of named) {
    if (!scope.selected.includes(alias as string)) {
      throw teach('unknown_id', 'Use an id listed under SELECTED.', { got: alias, valid: scope.selected })
    }
  }
  // Move, convert and calc act on whole blocks, never on words.
  const blocks = scope.blocks ?? scope.selected
  if (name === 'move' || name === 'convert' || name === 'calc') {
    for (const alias of named) {
      if (!blocks.includes(alias as string)) throw teach('unknown_id', `${name} acts on whole blocks: choose a block listed under SELECTED, not words.`, { got: alias, valid: blocks })
    }
  }
  if (op.ref !== undefined && !scope.refs.includes(op.ref as string)) {
    if (scope.box && name === 'insert') throw teach('unknown_id', 'Inside the box, new things go only "here": give "at":"here" and no "ref".', { got: op.ref })
    throw teach('unknown_id', 'Use an id listed under SELECTED or NEAR.', { got: op.ref, valid: scope.refs })
  }
  if (name === 'insert') {
    if (op.at === 'here' && !scope.here) throw teach('bad_value', 'No place was marked as "here". Insert after or before a block.', { got: 'here', valid: ['after', 'before'] })
    if (op.at !== 'here' && op.ref === undefined) throw teach('bad_value', 'Say which block to insert next to: add "ref".')
  }
  if (!scope.inline) delete op.content

  const parsed = AI_OP_SHAPES[name as AiOpName].safeParse(op)
  if (!parsed.success) throw teach('bad_value', `${name}: ${zodHint(parsed.error)}`)
  // A colour code only when the request gave it (v1.1).
  const color = (parsed.data as { color?: string }).color
  const codes = scope.colors ?? []
  if (color?.startsWith('#') && !codes.includes(color)) {
    throw teach('bad_value', `Use a colour from the list${codes.length > 0 ? `, or ${codes.join(', ')}` : ''}.`, { got: color })
  }
  if ((name === 'style' || name === 'mark') && Object.keys(op).every((key) => key === 'op' || key === 'id' || key === 'ids')) {
    throw teach('bad_value', `Say what to change: give "set" at least one change, like [{"color":"blue"}].`)
  }
  return parsed.data as AiOp
}

function teach(code: ErrorCode, hint: string, details: Record<string, unknown> = {}): ValidationError {
  return new ValidationError(code, hint, details)
}
