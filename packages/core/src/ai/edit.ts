// One AI edit, step by step:
//
// 1. Resolve the selection: "all headings" becomes a selection.
// 2. Tier 0: a command code understands completely. No model, zero tokens.
// 3. Tier 1: the model chooses operations, constrained to the reply schema.
// 4. The content step, only for operations that need words, LaTeX or Mermaid.
// 5. Compile, check and apply as one transaction, so it is one undo step.
// 6. On a teaching error, one retry. If that fails too, the error goes to the person.
import { apply, type Applied } from '../apply.js'
import { checkInline } from '../markdown/inline.js'
import type { Block, Doc, Id, Role } from '../schema/doc.js'
import type { LogEntry } from '../schema/log.js'
import type { Op } from '../schema/ops.js'
import { allowedOps, opChoiceJsonSchema, replyJsonSchema, type AiOp, type AiOpName, type AiOpOf, type Scope, type Shape } from '../schema/protocol.js'
import { meansEvery, singlesOut } from '../select/kind.js'
import type { Selection, WordRange } from '../select/selection.js'
import type { ContentValidators } from '../validate/content.js'
import { ValidationError } from '../validate/errors.js'
import { boxAnchor, inBox, makeAliases, type Aliases } from './alias.js'
import { compile } from './compile.js'
import { parsePipeTable } from '../markdown/table.js'
import { cleanContent, colourIn, contentTask, linkIn, type ContentKind } from './content.js'
import { chooseByKind, freshIds, instantEdit } from './instant.js'
import { diagramHint, diagramKind } from './mermaid.js'
import { outsideScope } from './scope.js'
import { prefixFor, systemPrompt, userPrompt } from './context.js'
import type { CompleteRequest, CompleteResult, Message, Model, Progress, StepProgress, StopSignal } from './model.js'
import { parseReply } from './parse.js'
import { RULEBOOK } from './rulebook.generated.js'

export interface EditRequest {
  doc: Doc
  selection: Selection
  instruction: string
  /** The model that chooses the operation (tier 1). */
  model: Model
  /** A larger model that writes content (tier 2). Defaults to `model`. */
  writer?: Model
  /** How style and mark carry their changes. Default "list". */
  shape?: Shape
  /** Worked examples in the prefix. Default true. */
  examples?: boolean
  /** One formatting operation instead of style plus mark (a benchmark variant). */
  merged?: boolean
  /** Choose the operation first, then its fields, in two calls (a benchmark variant). */
  split?: boolean
  /** Let tier 0 answer without a model. Default true; the benchmark turns it off to measure models. */
  tier0?: boolean
  /**
   * The person took the ⚡ suggestion the prompt box showed (instantPreview):
   * a request the router read only as likely (ai/intent.ts) runs at once too.
   */
  acceptSuggestion?: boolean
  /** Content checks. Default: the inline Markdown check. */
  validators?: ContentValidators
  /**
   * Checks that need the platform and may take a moment, run on written
   * content before it is applied: in a browser, Mermaid parsing a diagram.
   * Each gives null when the content is fine, or a hint for its one rewrite.
   */
  checks?: { mermaid?: (src: string) => Promise<string | null> }
  /** Recent AI edits as short lines (logLine), for requests that refer back. */
  recent?: readonly string[]
  source?: LogEntry['source']
  newId?: () => Id
  now?: () => number
  /** The person's Stop: the call in progress ends, and the note stays as it was. */
  signal?: StopSignal
  /** Told as the content is written, for a person waiting on it: the reply itself is the same. */
  progress?: (progress: StepProgress) => void
  /**
   * A picture's bytes as a data URL, for the vision request: turning a
   * picture into a table or text, or writing next to it. Core keeps no
   * bytes, so the caller reads them; undefined when it has none.
   */
  picture?: (asset: string) => Promise<string | undefined>
  /**
   * A picture the person sent with the request, as a data URL, such as a
   * photo of a table to copy into the box. Only the call that writes content
   * reads it, as it reads a chosen picture; it is not put in the note.
   */
  attachment?: string
}

type ImageBlock = Extract<Block, { type: 'image' }>

/** What a request about a picture is told when the model cannot see pictures. */
export const NO_VISION ='This model cannot see pictures. Choose one that can in Settings, under AI.'
/** What a request about a picture is told when its file is missing. */
export const NO_PICTURE = 'The picture\'s file is missing, so it cannot be read.'

export interface EditOutcome {
  /** The note after the edit. Unchanged when the model declined, nothing changed, or the edit failed. */
  doc: Doc
  /** Operations that undo the edit. */
  inverse: Op[]
  /** What was chosen, in alias terms. */
  ops: AiOp[]
  /** The internal operations applied. */
  applied: Op[]
  /** 0 when code handled the request alone. */
  tier: 0 | 1
  /** The model's reason, when it declined with none. */
  declined?: string
  /** What went wrong, when the edit failed after its retry. */
  error?: string
  /** The person pressed Stop: the note is as it was. */
  stopped?: true
  calls: number
  retries: number
  tokensIn: number
  tokensOut: number
  /** Of tokensOut, the tokens spent thinking, as far as the server said. */
  thinking: number
  /** What the calls cost, in US dollars, when the server said (OpenRouter does). */
  cost?: number
  /** Each call's reply, as the model wrote it, in order: the benchmark keeps them so the app can replay them. */
  replies: string[]
  ms: number
  log: LogEntry
}

/**
 * Ends an edit early with an outcome already made: Stop, or code declining
 * on the model's behalf (a model that cannot see the picture asked about).
 */
class Ended extends Error {
  constructor(readonly outcome: EditOutcome) {
    super('ended')
  }
}

/**
 * One AI edit, from request to outcome, and the only way into this file's steps. It changes nothing by itself: the new
 * note comes back in the outcome's `doc`, with `inverse` to undo it, for the caller to keep. What goes wrong with the
 * model's reply is an outcome too (`error`, `declined`, `stopped`); only a fault of the call itself, such as a server
 * that cannot be reached, is thrown.
 */
export async function runEdit(request: EditRequest): Promise<EditOutcome> {
  try {
    return await edit(request)
  } catch (error) {
    if (error instanceof Ended) return error.outcome
    throw error
  }
}

/**
 * The steps at the top of this file, in order; any step that settles the edit returns at once. It is one long function
 * because its helpers share one request's state (the aliases, the tally, the replies so far):
 *
 * - `call`: every model call goes through it, so Stop is honoured and every token counted in one place;
 * - `finish`: makes the outcome and its log entry, whichever step ended the edit;
 * - `applyAll` (step 5): compiles the operations, checks them and applies them as one transaction;
 * - `settle`: what code decides after the model has chosen;
 * - `write` (step 4): the content step.
 *
 * The loop at the end tries again only while no step has spent a retry (`tally.retries`), so a bad reply costs one more
 * call, not a chain of them.
 */
async function edit(request: EditRequest): Promise<EditOutcome> {
  const clock = request.now ?? Date.now
  const started = clock()
  const { doc, model } = request
  const writer = request.writer ?? model
  const validators = request.validators ?? { md: checkInline }
  const newId = request.newId ?? freshIds(doc)
  const tally = { calls: 0, retries: 0, tokensIn: 0, tokensOut: 0 }
  let thinking = 0
  let cost: number | undefined
  const replies: string[] = []
  const stop = request.signal
  const call = async (target: Model, req: CompleteRequest): Promise<CompleteResult> => {
    // Stop ends the call in progress, and no other starts; nothing is applied.
    if (stop?.aborted) throw new Ended(finish(1, model.name, [], { ops: [] }, { stopped: true }))
    let result: CompleteResult
    try {
      result = await target.complete({ ...req, ...(stop ? { signal: stop } : {}) })
    } catch (error) {
      if (stop?.aborted) throw new Ended(finish(1, model.name, [], { ops: [] }, { stopped: true }))
      throw error
    }
    if (stop?.aborted) throw new Ended(finish(1, model.name, [], { ops: [] }, { stopped: true }))
    tally.calls++
    tally.tokensIn += result.tokensIn
    tally.tokensOut += result.tokensOut
    thinking += result.thinkingTokens ?? 0
    if (result.cost !== undefined) cost = (cost ?? 0) + result.cost
    replies.push(result.text)
    return result
  }

  // 1. "all headings" and the like become the selection.
  const { selection, instruction, byKind } = chooseByKind(doc, request.selection, request.instruction)
  const aliases = makeAliases(doc, selection)
  const href = linkIn(request.instruction)

  const finish = (tier: 0 | 1, by: string, ops: AiOp[], applied: { result?: Applied; ops: Op[] }, extra: { declined?: string; error?: string; stopped?: true } = {}): EditOutcome => {
    const result = applied.result
    const log: LogEntry = {
      at: started,
      source: request.source ?? 'app',
      model: by,
      rulebook: RULEBOOK.version,
      instruction: request.instruction,
      // The selected blocks, and the blocks words were chosen in.
      targets: [...new Set(aliases.selected.map((s) => s.id))],
      ops: ops.map((op) => withRealIds(op, aliases)),
      result: extra.stopped ? 'stopped' : extra.error !== undefined ? 'failed' : extra.declined !== undefined ? 'declined' : result ? 'applied' : 'unchanged',
      ...(extra.error === undefined ? {} : { error: extra.error }),
      tier,
      ...tally,
      ...(thinking > 0 ? { thinking } : {}),
      ...(cost === undefined ? {} : { cost }),
      ms: Math.max(0, Math.round(clock() - started)),
    }
    return {
      doc: result?.doc ?? doc,
      inverse: result?.inverse ?? [],
      ops,
      applied: applied.ops,
      tier,
      ...extra,
      ...tally,
      thinking,
      ...(cost === undefined ? {} : { cost }),
      replies: [...replies],
      ms: log.ms,
      log,
    }
  }
  const applyAll = (ops: AiOp[], contents: (string | undefined)[], links: (string | undefined)[]): { result?: Applied; ops: Op[] } => {
    // Each operation is compiled against the note as the ones before it left it,
    // then all of them are applied together: one transaction, one undo step.
    let scratch = doc
    const compiled: Op[] = []
    // Where each item of words is as the operations change the text around it.
    const places = new Map<string, WordRange>(aliases.selected.flatMap((s) => (s.words ? [[s.alias, s.words] as const] : [])))
    ops.forEach((op, i) => {
      const content = (op as { content?: string }).content ?? contents[i]
      const link = href ?? links[i]
      const step = compile(op, { doc: scratch, aliases, selection, newId, places, ...(content === undefined ? {} : { content }), ...(link === undefined ? {} : { href: link }) })
      if (step.length === 0) return
      scratch = apply(scratch, step).doc
      compiled.push(...step)
    })
    if (compiled.length === 0) return { ops: [] }
    const result = apply(doc, compiled, { baseRev: doc.rev, validators })
    // The scope rule, on the whole note, whatever the model was told.
    const outside = outsideScope(doc, result.doc, selection, aliases)
    if (outside !== null) throw new ValidationError('scope', outside)
    return { result, ops: compiled }
  }
  // What code settles after the model has chosen:
  // - "every paragraph": a style or delete applies to all the blocks code selected,
  //   and "make these blue" a style to every selected block, even if the model named fewer;
  // - in a Select box, a change to some of its words is a change to all of them, the box
  //   being what the person chose, unless the request picks some out ("only the first");
  // - a new line of text next to a list item continues the list, unless the model chose a role;
  // - the same operation twice counts once.
  const everyBlock = byKind !== undefined && byKind.selection.blocks.length > 0
  const everySelected = aliases.selected.length > 1 && meansEvery(request.instruction)
  const everyPiece = inBox(selection) && aliases.pieces.length > 1 && !singlesOut(request.instruction)
  const settle = (ops: AiOp[]): AiOp[] => {
    const all = aliases.selected.map((s) => s.alias)
    const isPiece = (alias: string): boolean => aliases.pieces.includes(alias)
    const settled = ops.flatMap((op): AiOp[] => {
      if (op.op === 'style' && (everyBlock || everySelected)) {
        // Words take only a colour, so a change of size, font, alignment or role goes to the whole blocks.
        const wordsToo = (['size', 'font', 'align', 'role', 'indent', 'done'] as const).every((key) => op[key] === undefined)
        return [{ ...op, ids: wordsToo ? all : aliases.blocks.length > 0 ? aliases.blocks : op.ids }]
      }
      if (op.op === 'delete' && everyBlock) return [{ ...op, ids: all }]
      if (everyPiece && (op.op === 'style' || op.op === 'delete') && op.ids.some(isPiece)) return [{ ...op, ids: [...new Set([...op.ids, ...aliases.pieces])] }]
      if (everyPiece && (op.op === 'mark' || op.op === 'rewrite') && isPiece(op.id)) {
        // Content written inline belongs to the words it was written for; the others get their own.
        return aliases.pieces.map((id): AiOp => {
          if (id === op.id) return op
          const other: Record<string, unknown> = { ...op, id }
          delete other.content
          return other as AiOp
        })
      }
      if (op.op === 'insert' && op.kind === 'text' && op.role === undefined) {
        const role = listRole(doc, neighbourOf(doc, op, aliases, selection))
        if (role) return [{ ...op, role }]
      }
      return [op]
    })
    return settled.filter((op, i) => settled.findIndex((other) => JSON.stringify(other) === JSON.stringify(op)) === i)
  }

  // Graphs of equations need the math of phase 4: code says so, with no model call
  // (the benchmark, which turns tier 0 off, measures the model saying it).
  if (request.tier0 !== false && plotsEquation(request.instruction)) {
    return finish(0, 'tier0', [{ op: 'none', why: GRAPHS_LATER }], { ops: [] }, { declined: GRAPHS_LATER })
  }

  // 2. Tier 0, with no model (ai/instant.ts): find and replace ("change Smith to Akshat"), a table change spelled
  // out ("add a row Green, 5,000.00, UK, Qtr 2"), the words of look ("make it blue"), and the same said any way
  // ("his name is actually Akshat, please fix it"). A reading that is only likely runs when the person took it.
  if (request.tier0 !== false) {
    const instant = instantEdit({ doc, selection, aliases, instruction, validators, newId })
    if (instant && (instant.band !== 'likely' || request.acceptSuggestion === true)) {
      return finish(0, 'tier0', instant.ai, { ...(instant.result ? { result: instant.result } : {}), ops: instant.ops })
    }
  }

  // 3. Tier 1.
  let scope: Scope = {
    set: model.caps.opSet,
    selected: aliases.selected.map((s) => s.alias),
    blocks: aliases.blocks,
    refs: aliases.refs,
    colors: [colourIn(request.instruction)].filter((code): code is string => code !== undefined),
    here: selection.here !== undefined,
    box: inBox(selection),
    maxOps: model.caps.opSet === 'small' ? 1 : 8,
    inline: model.caps.inlineContent,
    shape: request.shape ?? 'list',
    ...(request.merged ? { merged: true } : {}),
    ...(model.caps.strictSchema ? { strict: true } : {}),
    // A picture sent into an empty place: nothing is chosen to change, so the one choice is the kind of block to make
    // of it. Offered none as well, gemma-4-e4b declined every such request (found in testing).
    ...(request.attachment !== undefined && aliases.selected.length === 0 && selection.here !== undefined ? { only: 'insert' as const } : {}),
  }
  const messages: Message[] = [
    { role: 'system', content: systemPrompt(prefixFor(scope, request.examples !== false)) },
    { role: 'user', content: userPrompt({ doc, selection, aliases, instruction: request.instruction, ...(request.recent ? { recent: request.recent } : {}), ...(request.attachment !== undefined ? { picture: true } : {}) }) },
  ]
  // A split choice (a benchmark variant): first the operation's name alone, then its
  // fields, with only that operation offered. The prefix stays the same, so it stays cached.
  const ask = messages[1]!.content
  if (request.split && model.caps.jsonSchema) {
    const pick = await call(model, { messages: [messages[0]!, { role: 'user', content: `${ask}\nFirst, choose the operation only.` }], schema: opChoiceJsonSchema(scope), maxTokens: 20 })
    const name = nameIn(pick.text)
    if (name !== undefined && allowedOps(scope).includes(name)) {
      scope = { ...scope, only: name }
      messages[1] = { role: 'user', content: `${ask}\nOPERATION ${name}` }
    }
  }
  let schema = model.caps.jsonSchema ? replyJsonSchema(scope) : undefined

  // 4. The content step.
  const write = async (ops: AiOp[], hint?: string): Promise<{ contents: (string | undefined)[]; links: (string | undefined)[] }> => {
    const contents: (string | undefined)[] = []
    const links: (string | undefined)[] = []
    for (const op of ops) {
      const task = (op as { content?: string }).content === undefined ? contentTask({ doc, op, aliases, selection, instruction: request.instruction, ...(href ? { href } : {}) }) : undefined
      if (!task) {
        contents.push(undefined)
        links.push(undefined)
        continue
      }
      // The vision request: the picture goes with this call only, to a model that can see it:
      // the one the content is about, or else the one the person sent with the request.
      const picture = pictureOf(op)
      let url: string | undefined
      if (picture || request.attachment !== undefined) {
        if (!writer.caps.vision) throw new Ended(finish(1, model.name, ops, { ops: [] }, { declined: NO_VISION }))
        url = picture ? await request.picture?.(picture.asset) : request.attachment
        if (url === undefined) throw new Ended(finish(1, model.name, ops, { ops: [] }, { declined: NO_PICTURE }))
      }
      const system = url === undefined ? task.prompt.system : `${task.prompt.system}\n- The picture is attached: write what it shows.`
      // What was written is checked before anything is applied; a refusal gets one rewrite, told why.
      let refused = hint
      let text = ''
      for (let round = 0; round < 2; round++) {
        const user = refused ? `${task.prompt.user}\nYour last answer was refused: ${refused} Write it again.` : task.prompt.user
        const reply = await call(writer, {
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: url === undefined ? user : [{ type: 'text', text: `${user}\nPICTURE (attached)` }, { type: 'image_url', image_url: { url } }] },
          ],
          // Room for a whole table or diagram, such as one copied from a picture: a limit, not what is used.
          maxTokens: task.kind === 'diagram' || task.kind === 'table' ? 1600 : 400,
          ...(request.progress ? { onProgress: (progress: Progress) => request.progress!({ step: 'write', ...progress }) } : {}),
        })
        text = cleanContent(task.kind, reply.text)
        const problem = await refusal(task.kind, text, op)
        if (problem === null) break
        if (round > 0 || hint !== undefined) throw new ValidationError('content', problem)
        refused = problem
        tally.retries++
      }
      contents.push(task.kind === 'link' ? undefined : text)
      links.push(task.kind === 'link' ? text : undefined)
    }
    return { contents, links }
  }

  /** The picture a content step reads: one being converted, or one that new things go next to (in a box, the one it ends with). */
  function pictureOf(op: AiOp): ImageBlock | undefined {
    const image = (alias: string | undefined): ImageBlock | undefined => {
      const block = alias === undefined ? undefined : doc.block[aliases.id(alias)]
      return block?.type === 'image' ? block : undefined
    }
    if (op.op === 'convert') return op.ids.map(image).find((block) => block !== undefined)
    if (op.op !== 'insert') return undefined
    if (op.ref !== undefined) return image(op.ref)
    return op.at === 'here' && inBox(selection) ? image(boxAnchor(doc, aliases)?.alias) : undefined
  }

  /** Why written content cannot be used, or null when it can: empty, a diagram of another kind or that does not parse, a table that is not one. */
  async function refusal(kind: ContentKind, text: string, op: AiOp): Promise<string | null> {
    if (text === '') return 'The reply was empty. Write the content.'
    if (kind === 'diagram') {
      // A diagram being changed may keep the kind it has.
      const changing = op.op === 'rewrite' ? doc.block[aliases.id(op.id)] : undefined
      const kept = changing?.type === 'diagram' ? diagramKind(changing.src) : undefined
      return diagramHint(text, kept) ?? (request.checks?.mermaid ? await request.checks.mermaid(text) : null)
    }
    if (kind === 'table' && !parsePipeTable(text)) return 'Write the table as a Markdown pipe table: one row per line, the cells between | signs, a line of dashes under the header.'
    return null
  }

  let ops: AiOp[] = []
  let failure: ValidationError | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    // Content written inline (a diagram, say) needs room; operations alone are short.
    const reply = await call(model, { messages, ...(schema ? { schema } : {}), maxTokens: scope.inline ? 1200 : 300 })
    try {
      ops = settle(parseReply(reply.text, scope))
      const declined = ops.find((op): op is Extract<AiOp, { op: 'none' }> => op.op === 'none')
      ops = ops.filter((op) => op.op !== 'none')
      if (ops.length === 0) return finish(1, model.name, declined ? [declined] : [], { ops: [] }, { declined: declined?.why ?? '' })
      let written = await write(ops)
      try {
        const applied = applyAll(ops, written.contents, written.links)
        // A style, mark or move that changes nothing is most likely a misreading ("smaller" as
        // the size it already has): ask once more. If the model says it again, it stands.
        if (!applied.result && attempt === 0 && tally.retries === 0 && ops.some((op) => op.op === 'style' || op.op === 'mark' || op.op === 'move')) {
          throw new ValidationError('no_change', 'That changes nothing: the note already looks like that. Choose the change the request asks for, or reply with none if it is already done.')
        }
        return finish(1, model.name, ops, applied)
      } catch (error) {
        // Content refused (say, a "#" heading inside text): rewrite the content once.
        if (!(error instanceof ValidationError) || error.code !== 'content' || tally.retries > 0) throw error
        tally.retries++
        // Content the model wrote inline is written again by the content step.
        ops = ops.map((op) => {
          const rest: Record<string, unknown> = { ...op }
          delete rest.content
          return rest as AiOp
        })
        // The writer knows no block ids, so the hint goes without its "Block t2:" prefix.
        written = await write(ops, error.hint.replace(/^Block [^:]+: /u, ''))
        return finish(1, model.name, ops, applyAll(ops, written.contents, written.links))
      }
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error
      failure = error
      if (attempt > 0 || tally.retries > 0) break
      // 6. One retry, told exactly what was wrong, in the aliases the model knows.
      tally.retries++
      if (scope.only !== undefined) {
        // After a split choice, the retry may choose another operation, or none.
        const every: Scope = { ...scope }
        delete every.only
        scope = every
        schema = model.caps.jsonSchema ? replyJsonSchema(scope) : undefined
        messages[1] = { role: 'user', content: ask }
      }
      messages.push({ role: 'assistant', content: reply.text }, { role: 'user', content: `${JSON.stringify(inAliasTerms(error, aliases))}\nReply again with the corrected JSON.` })
    }
  }
  return finish(1, model.name, ops, { ops: [] }, { error: failure ? `${failure.code}: ${failure.hint}` : 'unknown error' })
}

/** What a request for a graph of an equation is told until math arrives (phase 4). */
export const GRAPHS_LATER = 'Graphs of equations come with math, in a later step.'

/**
 * Whether a request asks for a graph of an equation: a word for drawing one,
 * then something only an equation has ("y =", "f(x) =", "x^2", "x²", sin…).
 * A flowchart or a bar chart of numbers is not one.
 */
export function plotsEquation(instruction: string): boolean {
  return /\b(?:graph|plot|draw|sketch|chart)\b[^.?!]*?(?:\by\s*=|\bf\s*\(\s*x\s*\)\s*=|\bx\s*\^|x²|x³|\b(?:sin|cos|tan|log|ln|sqrt|exp)\s*\(?\s*x\b|\bparabola\b|\bhyperbola\b)/iu.test(instruction)
}

/**
 * A teaching error as the model should see it: real block ids, which it has
 * never seen, replaced by their aliases, and ids of blocks it never saw dropped.
 */
function inAliasTerms(error: ValidationError, aliases: Aliases): Record<string, unknown> {
  const swap = (text: string): string =>
    text.replace(/\b[A-Za-z0-9][A-Za-z0-9_-]{0,31}\b/gu, (word) => aliases.alias(word) ?? word).replace(/^Block [A-Za-z0-9_-]{8}: /u, '')
  const json = error.toJSON()
  return Object.fromEntries(
    Object.entries(json).map(([key, value]) => [
      key,
      typeof value === 'string' ? swap(value) : Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? (aliases.alias(v) ?? v) : v)) : value,
    ]),
  )
}

/** The operation named in a reply like {"op":"style"}, if any. */
function nameIn(text: string): AiOpName | undefined {
  try {
    const op = (JSON.parse(text) as { op?: unknown }).op
    return typeof op === 'string' ? (op as AiOpName) : undefined
  } catch {
    return undefined
  }
}

/** The block a new block will stand next to: the one it goes after or before, or the one before "here". */
function neighbourOf(doc: Doc, op: AiOpOf<'insert'>, aliases: Aliases, selection: Selection): Id | undefined {
  if (op.at !== 'here') return op.ref === undefined ? undefined : aliases.id(op.ref)
  const here = selection.here
  if (!here || !('parent' in here)) return undefined
  const frame = doc.block[here.parent]
  return frame?.type === 'frame' ? (frame.kids[here.at - 1] ?? frame.kids[here.at]) : undefined
}

/** The role of a list item (bullet, numbered or to-do), so a new line can continue its list. */
function listRole(doc: Doc, id: Id | undefined): Role | undefined {
  const block = id === undefined ? undefined : doc.block[id]
  return block?.type === 'text' && (block.role === 'li' || block.role === 'oli' || block.role === 'todo') ? block.role : undefined
}

/** An operation with real ids in place of aliases, and without long content, for the log. */
function withRealIds(op: AiOp, aliases: Aliases): Record<string, unknown> {
  const out: Record<string, unknown> = { ...op }
  delete out.content
  const real = (alias: unknown): unknown => {
    try {
      return aliases.id(alias as string)
    } catch {
      return alias
    }
  }
  // Words stand for their block, so two pieces of one paragraph name it once.
  if (Array.isArray(out.ids)) out.ids = [...new Set(out.ids.map(real))]
  if (out.id !== undefined) out.id = real(out.id)
  if (out.ref !== undefined) out.ref = real(out.ref)
  return out
}
