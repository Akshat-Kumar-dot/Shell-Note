// Instant edits: what code does with no model and no tokens (tier 0). One entry
// point, used by runEdit and by the prompt box's ⚡ line, so that what the box
// says will happen is what happens.
//
// First the short commands the instant functions read as they stand: find
// and replace (ai/swap.ts), a table change spelled out (ai/tableEdit.ts), a
// change of look (ai/tier0.ts). Then the router (ai/intent.ts), which reads a
// longer request as such commands; each still runs through those functions.
import { apply, type Applied } from '../apply.js'
import { idTaken, newId as randomId } from '../ids.js'
import { checkInline } from '../markdown/inline.js'
import type { Doc, Id, Role } from '../schema/doc.js'
import type { Op } from '../schema/ops.js'
import type { AiOp } from '../schema/protocol.js'
import { selectByKind, type ByKind } from '../select/kind.js'
import type { Selection, WordRange } from '../select/selection.js'
import type { ContentValidators } from '../validate/content.js'
import { ValidationError } from '../validate/errors.js'
import { makeAliases, type Aliases } from './alias.js'
import { compile } from './compile.js'
import { chosenTexts, occurrences, readRequest, type Band } from './intent.js'
import { outsideScope } from './scope.js'
import { swapOf, swapOps } from './swap.js'
import { tableEditOps } from './tableEdit.js'
import { tier0 } from './tier0.js'

export interface Instant {
  /** What was done, in alias terms, for the edit log. */
  ai: AiOp[]
  /** The internal operations. */
  ops: Op[]
  /** The note after them; missing when nothing needed to change. */
  result?: Applied
  /** exact: a short command as typed; sure or likely: read from a longer request (ai/intent.ts). */
  band: 'exact' | Band
  /** What it does, in a few words: "replace 2 × “Smith” with “Akshat”". */
  summary: string
}

export interface InstantInput {
  doc: Doc
  selection: Selection
  aliases: Aliases
  instruction: string
  validators?: ContentValidators
  newId?: () => Id
}

/** New ids that clash neither with the document nor with each other. */
export function freshIds(doc: Doc): () => Id {
  const used = new Set<Id>()
  return () => {
    const id = randomId((candidate) => idTaken(doc, candidate) || used.has(candidate))
    used.add(id)
    return id
  }
}

/**
 * What a request acts on: "all headings" and the like become the selection,
 * and the request loses those words. Every request starts
 * here, the model's too.
 */
export function chooseByKind(doc: Doc, selection: Selection, instruction: string): { selection: Selection; instruction: string; byKind: ByKind | undefined } {
  const byKind = selectByKind(doc, selection, instruction)
  if (!byKind || byKind.selection.blocks.length === 0) return { selection, instruction, byKind }
  return { selection: byKind.selection, instruction: byKind.rest === '' ? instruction : byKind.rest, byKind }
}

/** The instant edit for a request, or undefined when it needs the model. Nothing is changed: the caller applies `result`. */
export function instantEdit(input: InstantInput): Instant | undefined {
  return run([input.instruction], input, 'exact') ?? read(input)
}

function read(input: InstantInput): Instant | undefined {
  const reading = readRequest(input.instruction, input)
  // Several commands over chosen words would each move the others' places: one at a time, or the model.
  if (!reading || (reading.commands.length > 1 && input.aliases.pieces.length > 0)) return undefined
  return run(reading.commands, input, reading.band)
}

/** Run commands one after another, as one transaction; undefined when any is not instant after all. */
function run(commands: readonly string[], input: InstantInput, band: Instant['band']): Instant | undefined {
  const { doc, selection, aliases } = input
  const validators = input.validators ?? { md: checkInline }
  const newId = input.newId ?? freshIds(doc)
  const texts = chosenTexts(doc, aliases)
  const places = new Map<string, WordRange>(aliases.selected.flatMap((s) => (s.words ? [[s.alias, s.words] as const] : [])))
  let scratch = doc
  const ops: Op[] = []
  const ai: AiOp[] = []
  const said: string[] = []
  /** The note after these operations, when it is valid and keeps to what is chosen. */
  const tryOps = (more: Op[]): Doc | undefined => {
    try {
      const next = more.length === 0 ? scratch : apply(scratch, more, { validators }).doc
      return outsideScope(doc, next, selection, aliases) === null ? next : undefined
    } catch (error) {
      if (error instanceof ValidationError) return undefined
      throw error
    }
  }
  for (const command of commands) {
    // Find and replace, or a table change spelled out.
    const swap = swapOps(command, { doc: scratch, aliases }) ?? tableEditOps(command, { doc: scratch, aliases })
    const swapped = swap && tryOps(swap.ops)
    if (swap && swapped) {
      scratch = swapped
      ops.push(...swap.ops)
      ai.push(...swap.ai)
      said.push(swapSummary(command, texts))
      continue
    }
    // A change of look.
    const looks = tier0(command, { doc: scratch, selection, aliases })
    if (!looks) return undefined
    let compiled: Op[]
    try {
      compiled = looks.flatMap((op) => {
        const step = compile(op, { doc: scratch, aliases, selection, newId, places })
        if (step.length > 0) scratch = apply(scratch, step).doc
        return step
      })
    } catch (error) {
      if (error instanceof ValidationError) return undefined
      throw error
    }
    if (outsideScope(doc, scratch, selection, aliases) !== null) return undefined
    ops.push(...compiled)
    ai.push(...looks)
    said.push(...looks.flatMap(describe))
  }
  let result: Applied | undefined
  try {
    result = ops.length === 0 ? undefined : apply(doc, ops, { baseRev: doc.rev, validators })
  } catch (error) {
    if (error instanceof ValidationError) return undefined
    throw error
  }
  return { ai, ops, ...(result ? { result } : {}), band, summary: [...new Set(said)].join(', ') }
}

/** What the ⚡ line in the prompt box says a request will do, or undefined when it needs the model. Changes nothing. */
export function instantPreview(request: { doc: Doc; selection: Selection; instruction: string }): { band: Instant['band']; summary: string } | undefined {
  const { selection, instruction } = chooseByKind(request.doc, request.selection, request.instruction)
  const aliases = makeAliases(request.doc, selection)
  const out = instantEdit({ doc: request.doc, selection, aliases, instruction })
  return out && { band: out.band, summary: out.summary }
}

// ----- in words --------------------------------------------------------------------

function swapSummary(command: string, texts: readonly string[]): string {
  const asked = swapOf(command)
  // A table change spelled out says itself: "sort by Sales descending".
  if (!asked) return command.trim().replace(/^\p{Lu}/u, (ch) => ch.toLowerCase())
  const n = occurrences(texts, asked.find)
  return `replace ${n > 1 ? `${n} × ` : ''}“${asked.find}” with “${asked.put}”`
}

const ROLE_NAMES: Record<Role, string> = { p: 'paragraph', h1: 'heading 1', h2: 'heading 2', h3: 'heading 3', li: 'bullet', oli: 'numbered item', todo: 'to-do', quote: 'quote' }
const MARK_NAMES: Record<string, string> = { bold: 'bold', italic: 'italic', strike: 'strikethrough', code: 'code', highlight: 'highlight', underline: 'underline', sub: 'subscript', sup: 'superscript', link: 'link' }

/** A tier 0 operation in a few words: "blue", "size L", "heading 2", "bold". */
function describe(op: AiOp): string[] {
  if (op.op === 'delete') return ['delete']
  if (op.op === 'move') return [op.at === 'before' ? 'move up' : 'move down']
  if (op.op !== 'style' && op.op !== 'mark') return []
  const out: string[] = []
  const fields = op as Record<string, unknown>
  if (typeof fields.color === 'string') out.push(fields.color === 'ink' ? 'default colour' : fields.color)
  if (typeof fields.size === 'string') out.push(`size ${fields.size.toUpperCase()}`)
  if (typeof fields.font === 'string') out.push(`${fields.font} font`)
  if (typeof fields.align === 'string') out.push(fields.align === 'center' ? 'centred' : `aligned ${fields.align}`)
  if (typeof fields.role === 'string') out.push(ROLE_NAMES[fields.role as Role])
  if (fields.indent !== undefined) out.push(fields.indent === 'in' ? 'indent' : 'outdent')
  if (fields.done !== undefined) out.push(fields.done ? 'ticked' : 'not ticked')
  for (const [key, name] of Object.entries(MARK_NAMES)) if (typeof fields[key] === 'boolean') out.push(fields[key] ? name : `not ${name}`)
  return out
}
