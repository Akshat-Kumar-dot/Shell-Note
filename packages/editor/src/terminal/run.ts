// Running the terminal's lines: each
// line goes where its first word says (core's terminal.ts reads it), through
// the same door as a click: find and do to the finder, a command to the door,
// op to the open note's own operations, look and block to the readers. A block's
// lines are all read first, and none runs when one cannot be read;
// then it stops at the first line that fails, and everything printed goes back.
import { APP_LIMITS, areaNames, changeReport, checkInput, checkOp, describeCommand, exampleLine, Finder, idTaken, MEANING_CUTOFF, MEANING_GAP, newId, pagePicture, parseLine, POSITIONAL, route, typed, valuesOf, COMMANDS, type Candidate, type Doc, type Drawn, type Embedder, type FindResult, type Line, type Meaning, type StopSignal, type TerminalStep } from '@shellnote/core'
import type { Commands } from '../commands/run.js'
import { drawnBoxes } from '../commands/view.js'

/** One line run, and what it printed. */
export interface Output {
  line: string
  ok: boolean
  text: string
  /** The line was done: the model says the request is finished. */
  end?: true
  /** It ran and changed nothing: what it set was so already. */
  same?: true
}

/**
 * The commands whose effect the app's state shows: one of these that leaves the state as it was set what was so
 * already (the small models' page says so). Turning a page, saving or opening Settings leave the state as it was
 * whatever they do, so they are not here.
 */
const SHOWN = new Set([
  'tool.choose', 'pen.set', 'highlighter.set', 'eraser.set', 'screen.zoom', 'screen.fullscreen', 'panel.show', 'panel.hide', 'panel.full',
  'bar.place', 'bar.float', 'layout.reset', 'timer.start', 'timer.pause', 'timer.stop', 'timer.countdown', 'timer.stopwatch',
  'video.show', 'video.hide', 'video.times', 'ai.open', 'ai.close', 'chat.choose', 'library.sort', 'note.rename',
])

/** Asks the person to allow something that cannot be undone. */
export type Ask = (question: string) => Promise<boolean>

let finderMade: Finder | undefined
/**
 * The finder over the app's commands, shared by every terminal. Made the first time a line needs it, not as the app
 * starts: with the router's table (core's router.ts) it was a quarter of the script run before the first paint, for what
 * many sessions never open. Measured 6 November 2026: script 80 ms to 61 ms, first paint at a phone's speed 570 to 460 ms.
 */
export const finder = (): Finder => (finderMade ??= new Finder(COMMANDS, APP_LIMITS))

/** A command's inputs in a few words: kind (pen|pencil|…), note? for one that may be left out. */
function inputsLine(command: string): string {
  const spec = finder().spec(command)
  if (!spec) return ''
  const schema = describeCommand(spec).input as { properties?: Record<string, { enum?: string[]; anyOf?: { enum?: string[] }[]; type?: string }>; required?: string[] }
  const required = new Set(schema.required ?? [])
  const fields = Object.entries(schema.properties ?? {}).map(([field, about]) => {
    const values = about.enum ?? about.anyOf?.flatMap((part) => part.enum ?? [])
    return `${field}${required.has(field) ? '' : '?'}${values && values.length > 0 ? ` (${values.join('|')})` : about.type ? ` (${about.type})` : ''}`
  })
  return fields.length > 0 ? fields.join(', ') : 'no inputs'
}

/**
 * Where values that did not fit one command do fit: "marker fits pen.set's
 * kind: write pen.set kind=marker". A model once kept trying marker as a
 * tool, when it is a kind of pen (19 October 2026).
 */
function elsewhere(values: readonly unknown[], except: string): string[] {
  const hints: string[] = []
  for (const value of values.flat()) {
    if (typeof value !== 'string') continue
    for (const spec of COMMANDS) {
      if (spec.name === except) continue
      const field = Object.entries(spec.input.shape as Record<string, Parameters<typeof valuesOf>[0]>).find(([, schema]) => valuesOf(schema)?.includes(value))?.[0]
      if (field !== undefined) {
        hints.push(`"${value}" fits ${spec.name}'s ${field}: write ${spec.name} ${field}=${value}`)
        break
      }
    }
  }
  return hints
}

const candidate = (c: Candidate): string => ('command' in c ? `${c.command} (${c.score}): ${c.does} · inputs: ${inputsLine(c.command)}` : `cannot (${c.score}): ${c.limit}`)

/** What the finder found, as the terminal prints it. */
function found(result: FindResult): string {
  if (result.kind === 'impossible') return `cannot: ${result.why}`
  if (result.kind === 'unclear') return `not sure; the closest:\n${result.closest.map((c) => `  ${candidate(c)}`).join('\n')}`
  const spec = finder().spec(result.command)!
  const read = Object.keys(result.input).length > 0 ? ` ${Object.entries(result.input).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')}` : ''
  return `${result.command}${read}: ${spec.does} · inputs: ${inputsLine(result.command)}${result.missing.length > 0 ? ` · still needs: ${result.missing.join(', ')}` : ''}`
}

/** A few commands offered, each with what it does, its inputs and how to write it. */
function offered(names: readonly string[]): string {
  return names
    .map((name) => {
      const spec = finder().spec(name)!
      return `  ${name}: ${spec.does} · inputs: ${inputsLine(name)} · write it as ${exampleLine(spec)}`
    })
    .join('\n')
}

/**
 * Run a block's lines: each read and checked first, and none run when any cannot be read, every one that cannot said
 * at once (a model told one problem at a time spent a call on each, and a block half run left the app half changed).
 * Then in order, stopping at the first that fails. Lines after done never run. A step may carry the words written
 * under its line (stepsOf): its command takes them as words.
 */
export async function runLines(given: readonly (string | TerminalStep)[], context: { commands: Commands; ask: Ask; signal?: StopSignal; meaning?: Embedder | Meaning | undefined }): Promise<Output[]> {
  const { commands, ask, meaning } = context
  const steps = given.map((one): TerminalStep => (typeof one === 'string' ? { line: one } : one))
  const last = steps.findIndex((step) => step.words === undefined && parseLine(step.line).kind === 'done')
  const kept = last >= 0 ? steps.slice(0, last + 1) : steps
  const block = kept.map((step) => step.line)
  const ready: Ready[] = []
  for (const step of kept) {
    if (context.signal?.aborted) return [{ line: step.line, ok: false, text: 'stopped' }]
    ready.push(await readyLine(step.line, step.words, commands, ask, meaning))
  }
  const wrong: Output[] = block.flatMap((line, i) => {
    const one = ready[i]!
    return one.ok ? [] : [{ line, ok: false, text: one.why }]
  })
  if (wrong.length > 0) {
    if (block.length > 1) {
      const end = wrong.length === 1 ? 'this line cannot be read. Write the whole block again, every line, this one mended.' : `these ${wrong.length} lines cannot be read. Write the whole block again, every line, these mended.`
      wrong[wrong.length - 1] = { ...wrong.at(-1)!, text: `${wrong.at(-1)!.text}\nNothing in this block ran: ${end}` }
    }
    return wrong
  }
  const outputs: Output[] = []
  for (const [i, line] of block.entries()) {
    if (context.signal?.aborted) {
      outputs.push({ line, ok: false, text: 'stopped' })
      break
    }
    const one = ready[i]!
    const output = one.ok ? await one.run() : { line, ok: false, text: one.why }
    outputs.push(output)
    if (!output.ok || output.end) break
  }
  return outputs
}

/** A line read and checked, before any line of its block runs: how to run it, or why it cannot be read. */
type Ready = { ok: true; run: () => Promise<Output> } | { ok: false; why: string }

/** The mark a command under high review carries in the terminal, each time it runs. */
const watched = (ran: { review?: string }): string => (ran.review ? ' [high review]' : '')

/** A value written as the page lists a field's values, more than one of them (tool=select|free|pen): which one is not said. */
function listsCopied(input: Record<string, unknown>): string[] {
  return Object.entries(input)
    .filter(([, value]) => typeof value === 'string' && value.includes('|'))
    .map(([field, value]) => `${field}=${String(value)} is the list of its values: write one, as ${field}=${String(value).split('|')[0]!.trim()}`)
}

/** Why an input does not fit a command, with how to write it, and where its values fit instead. */
function notFitting(command: string, why: string, input: Record<string, unknown>): string {
  return [`The input does not fit ${command}:\n${why}`, ...listsCopied(input), `Its inputs: ${inputsLine(command)}`, `Write it as: ${exampleLine(finder().spec(command)!)}`, ...elsewhere(Object.values(input), command)].join('\n')
}

async function readyLine(line: string, words: string | undefined, commands: Commands, ask: Ask, meaning: Embedder | Meaning | undefined): Promise<Ready> {
  // The words written under the line, up to end, are its command's words input, as written.
  const read = parseLine(line)
  const parsed: Line =
    words === undefined
      ? read
      : read.kind === 'area'
        ? { ...read, given: { ...read.given, words } }
        : read.kind === 'command'
          ? { ...read, input: { ...read.input, words } }
          : read.kind === 'do'
            ? { ...read, given: { ...read.given, words } }
            : read
  const wrong = (why: string): Ready => ({ ok: false, why })
  const ready = (run: () => Promise<Output>): Ready => ({ ok: true, run })
  const fail = (text: string): Output => ({ line, ok: false, text })
  const done = (text: string): Output => ({ line, ok: true, text })
  // Ran, and left the state as it was: for a command whose effect the state shows, what it set was so already.
  const unchanged = (output: Output, command: string, before: string): Output => (SHOWN.has(command) && commands.state() === before ? { ...output, same: true } : output)

  /** Plain words: the finder, then the door when it is sure, the fields given by name taken as written. */
  const plainWords = async (words: string, given: Record<string, unknown> | undefined): Promise<Ready> => {
    const result = await finder().find(words, meaning)
    if (result.kind !== 'found') return wrong(`${found(result)}\nNothing ran.`)
    // Fields the words gave by name (kind=pencil) are taken as written, over what the finder read from the words.
    const spec = finder().spec(result.command)!
    const typedGiven = typed(spec, given ?? {})
    const shape = spec.input.shape as Record<string, unknown>
    const unknown = Object.keys(typedGiven).filter((field) => !(field in shape))
    if (unknown.length > 0) return wrong(`${result.command} has no ${unknown.join(', ')}: its inputs: ${inputsLine(result.command)}. Write it as: ${exampleLine(spec)}\nNothing ran.`)
    const input = { ...result.input, ...typedGiven }
    const missing = result.missing.filter((field) => !(field in typedGiven))
    if (missing.length > 0) return wrong(`${found(result)}\nNothing ran: write ${result.command} with ${missing.map((field) => `${field}=…`).join(' ')}.`)
    const checked = checkInput(spec, input)
    if (!checked.ok) return wrong(`${result.command}: ${notFitting(result.command, checked.why, input)}`)
    return ready(async () => {
      const ran = await commands.run(result.command, checked.input, ask)
      return ran.ok ? done(`${result.command}: ${ran.done}${watched(ran)}`) : fail(`${result.command}: ${ran.why}`)
    })
  }

  switch (parsed.kind) {
    case 'wrong':
      return wrong(parsed.why)
    case 'look':
      return ready(async () => {
        if (parsed.page === undefined) return done(commands.state() || 'The library is open; no note.')
        // The page as text (note control, step 1): the page in view, or the one asked for.
        const store = commands.places.note?.store
        if (!store) return fail('No note is open: open one first (note.open, or note.new).')
        const inView = store.pageInView ? store.doc.pages.indexOf(store.pageInView) + 1 : 1
        try {
          return done(pagePicture(store.doc, parsed.page === 'view' ? Math.max(1, inView) : parsed.page, drawnBoxes(store.doc)))
        } catch (error) {
          return fail(error instanceof Error ? error.message : String(error))
        }
      })
    case 'blocks':
      // The same as note.blocks: the shortcut, as look is for the state.
      return ready(async () => {
        const ran = await commands.run('note.blocks', parsed.page === undefined ? {} : { page: parsed.page }, ask)
        return ran.ok ? done(ran.done) : fail(ran.why)
      })
    case 'done':
      return ready(async () => ({ line, ok: true, text: parsed.summary === '' ? 'finished' : `finished: ${parsed.summary}`, end: true }))
    case 'find':
      return ready(async () => done(found(await finder().find(parsed.words, meaning))))
    case 'do':
      return plainWords(parsed.words, parsed.given)
    case 'area': {
      // The design: the area and the operation in plain words; the code picks the verb.
      const asMeaning = typeof meaning === 'function' ? { embed: meaning, cutoff: MEANING_CUTOFF, gap: MEANING_GAP } : meaning
      const routed = await route(parsed.area, parsed.words, parsed.given, asMeaning)
      // Written without its colon: plain words, as before, when the area's router is not sure.
      if (routed.kind !== 'found' && parsed.loose) return plainWords(parsed.loose.words, parsed.loose.given)
      if (routed.kind === 'no-area') return wrong(`There is no area "${routed.given}". The areas: ${areaNames(COMMANDS).join(', ')}.\nNothing ran.`)
      if (routed.kind === 'elsewhere') return wrong(`${routed.area}: ${routed.why}; these take them:\n${offered(routed.options)}\nNothing ran.`)
      // done written on the line itself (Gemma wrote a whole block on one line, the agent test, 20 October 2026).
      const ownLine = /\bdone\b/iu.test(parsed.words) ? ' done goes on a line of its own, after this one.' : ''
      if (routed.kind === 'unclear') return wrong(`${routed.area}: not sure (${routed.why}). Did you mean:\n${offered(routed.options)}\nWrite the one you mean.${ownLine} Nothing ran.`)
      if (routed.missing.length > 0) return wrong(`${routed.command} still needs ${routed.missing.join(', ')}: write it as ${exampleLine(finder().spec(routed.command)!)}\nNothing ran.`)
      const checked = checkInput(finder().spec(routed.command)!, routed.input)
      if (!checked.ok) return wrong(`${routed.command}: ${notFitting(routed.command, checked.why, routed.input)}`)
      return ready(async () => {
        const before = commands.state()
        const ran = await commands.run(routed.command, checked.input, ask)
        if (ran.ok) return unchanged(done(`${routed.command}: ${ran.done}${watched(ran)}`), routed.command, before)
        return fail(`${routed.command}: ${ran.why}\nIts inputs: ${inputsLine(routed.command)}\nWrite it as: ${exampleLine(finder().spec(routed.command)!)}`)
      })
    }
    case 'command': {
      const spec = finder().spec(parsed.name)
      if (!spec) return wrong(`There is no command ${parsed.name}. ${found(await finder().find(parsed.name.replace('.', ' '), meaning))}`)
      let input = typed(spec, parsed.input)
      // Plain words after the name, where no field takes them: the finder reads the command's inputs from them, those
      // given by name kept (note.open: Open the note "Chapter 3: Waves"; the agent test of 20 October 2026).
      if (POSITIONAL in input && parsed.written !== undefined) {
        const named = Object.fromEntries(Object.entries(parsed.input).filter(([field]) => field !== POSITIONAL))
        input = { ...finder().inputsOf(parsed.written, parsed.name), ...typed(spec, named) }
      }
      const checked = checkInput(spec, input)
      if (!checked.ok) return wrong(notFitting(parsed.name, checked.why, input))
      return ready(async () => {
        const before = commands.state()
        const ran = await commands.run(parsed.name, checked.input, ask)
        if (ran.ok) return unchanged(done(`${ran.done}${watched(ran)}`), parsed.name, before)
        return fail(ran.why)
      })
    }
    case 'block':
      // The same as note.block: the shortcut.
      return ready(async () => {
        const ran = await commands.run('note.block', { block: parsed.id }, ask)
        return ran.ok ? done(ran.done) : fail(ran.why)
      })
    case 'op': {
      // Its shape checked now; where it goes, when it runs (a line before it may open the note).
      try {
        checkOp(withIds(parsed.op, () => false))
      } catch (error) {
        return wrong(error instanceof Error ? error.message : String(error))
      }
      return ready(async () => {
        const store = commands.places.note?.store
        if (!store) return fail('No note is open: open one first (note.open, or note.new).')
        // Read-only here, as every command that changes the note says (another window edits it): its save would meet this.
        if (commands.places.workspace?.editing() === false) return fail('This note is read-only here: it is being edited in another window.')
        const op = withIds(parsed.op, (id) => idTaken(store.doc, id))
        try {
          store.apply([checkOp(op)], { origin: 'terminal' })
        } catch (error) {
          return fail(error instanceof Error ? error.message : String(error))
        }
        const made = (op as { op?: string; block?: { id?: string }; add?: { id?: string } }).block?.id ?? (op as { add?: { id?: string } }).add?.id
        return done(made ? `done: ${String((op as { op: string }).op)} ${made}` : `done: ${String((op as { op?: string }).op)}`)
      })
    }
  }
}

/**
 * An operation with what the writer may leave out filled in: a new block's or
 * page's id (random, unused), a block's `r` (apply sets it), a new page's empty
 * list. Anything else is checked as written.
 */
function withIds(op: unknown, taken: (id: string) => boolean): unknown {
  if (typeof op !== 'object' || op === null) return op
  const o = op as Record<string, unknown>
  if (o.op === 'add' && typeof o.block === 'object' && o.block !== null) {
    const block = o.block as Record<string, unknown>
    return { ...o, block: { ...block, id: block.id ?? newId(taken), r: block.r ?? 0 } }
  }
  if (o.op === 'page' && typeof o.add === 'object' && o.add !== null) {
    const page = o.add as Record<string, unknown>
    return { ...o, add: { ...page, id: page.id ?? newId(taken), free: page.free ?? [] } }
  }
  return op
}

/** The open note as it is now, its data and its blocks' boxes as drawn: what the change report compares with. */
export function noteNow(commands: Commands): { doc: Doc; drawn: Map<string, Drawn> } | undefined {
  const store = commands.places.note?.store
  return store ? { doc: store.doc, drawn: drawnBoxes(store.doc) } : undefined
}

/** One frame drawn: the page lays a change out before it is measured. */
const drawnOnce = (): Promise<void> => new Promise((done) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => done()) : setTimeout(done, 0)))

/**
 * What lines changed in the note since `before`, once the page has drawn it (note control, step 1: the change report,
 * the design 2): new, removed, changed, on another page, pushed down, now overlapping. None when nothing did.
 */
export async function changedSince(commands: Commands, before: ReturnType<typeof noteNow>): Promise<string | undefined> {
  const store = commands.places.note?.store
  if (!before || !store || store.doc === before.doc) return undefined
  await drawnOnce()
  await drawnOnce()
  return changeReport(before.doc, store.doc, before.drawn, drawnBoxes(store.doc))
}

/** The change report given with the last output of the lines that made it: one line, one output. */
export function withReport(outputs: readonly Output[], report: string | undefined): Output[] {
  const last = outputs.at(-1)
  return report && last ? [...outputs.slice(0, -1), { ...last, text: `${last.text}\n${report}` }] : [...outputs]
}

/** The page an output is printed for: the small models' page says a line that changed nothing did. */
export type OutputPage = 'overall' | 'small'

/** A block's outputs as the model reads them, with the app's state after it. */
export function outputText(outputs: readonly Output[], state: string, page: OutputPage = 'overall'): string {
  // An output the same as one before it, printed once: a model wrote blocks 40 times in one reply, each listing the
  // whole note, and went past its 8,192 tokens at 45,000 (the agent test's baseline, 20 October 2026).
  const lines = outputs.map((output, i) => {
    const before = outputs.findIndex((other) => other.line === output.line && other.ok === output.ok && other.text === output.text)
    const text = before < i ? `the same as [${before + 1}]` : output.text.replace(/\n/gu, '\n      ')
    const same = page === 'small' && output.same ? ' (no change: this was already so)' : ''
    return `[${i + 1}] ${output.line}\n    ${output.ok ? '✓' : '✗'} ${text}${same}`
  })
  return [...lines, `state: ${state || 'the library is open; no note'}`].join('\n')
}

/** The table embedded ahead, as the terminal opens, so the first plain-words line need not wait for it. */
export function prepareMeaning(meaning: Embedder | Meaning | undefined): void {
  if (meaning) void finder().prepareMeaning(meaning)
}
