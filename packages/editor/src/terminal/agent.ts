// The model in the terminal: the request
// goes to the model with the terminal's instruction page and the app's state;
// the model writes blocks of lines; each block runs when it closes, and its
// output goes back as the next message; a reply with no block is the end. No
// JSON tool calling, so any model can do it, and ShellNote checks every line.
import { aboutTheText, aloneOf, areaNames, blocksOf, commandLine, COMMANDS, linesOf, namedIn, pagePicture, parseLine, QUESTION, stepsOf, terminalGuide, wordsInFull, type Embedder, type Meaning, type Message, type Model, type StopSignal } from '@shellnote/core'
import { beginNoteRequest } from '../commands/content.js'
import type { Commands } from '../commands/run.js'
import { drawnBoxes } from '../commands/view.js'
import { changedSince, finder, noteNow, outputText, runLines, withReport, type Ask, type Output } from './run.js'
import { plainState } from './state.js'

/** At most this many replies for one request: then it stops and says so. */
export const MAX_TURNS = 12

/** The kinds of line that only read: they change nothing of the app or the note. */
const READS: ReadonlySet<string> = new Set(['look', 'blocks', 'block', 'find'])

/**
 * How a request ended: done (said done, or a reply with no block), stopped, out of turns, repeating itself with nothing
 * changing, or run by code alone with no call to the model.
 */
export type AgentEnd = 'done' | 'stopped' | 'turns' | 'repeated' | 'code'

export interface AgentContext {
  model: Model
  commands: Commands
  ask: Ask
  signal?: StopSignal
  /** An embedding model, for plain words the finder's first two ways leave unclear; none, they are left to "did you mean". */
  meaning?: Embedder | Meaning | undefined
  maxTurns?: number
  /**
   * Which page the model gets (the prompt by the model's size): the one for every model, or the small models',
   * whose state is in plain sentences and whose lines that changed nothing say so.
   */
  page?: 'overall' | 'small'
  /** The model's reply, as it came. */
  onReply: (text: string) => void
  /** A block's lines, as they ran, and the state after. */
  onOutput: (outputs: Output[], state: string) => void
}

/**
 * What the app will not do, when the request asks it: the limit the request is, or the closest thing the finder
 * knows to it. Told to the model before it starts: asked to set an API key, two models went on for minutes instead,
 * one making 36 notes and both turning developer mode on (the agent test, 19 October 2026).
 */
function limitOf(request: string): string | undefined {
  const known = finder().findNow(request)
  if (known.kind === 'impossible') return `The app cannot do this, by its own rules: ${known.why} Run nothing: answer with one line, done and the reason, as done the app cannot do this: ….`
  const first = known.kind === 'unclear' ? known.closest[0] : undefined
  if (!first || !('limit' in first)) return undefined
  return `The closest thing the app knows to this is something it cannot do, by its own rules: ${first.limit} If that is what is asked, run nothing: answer with one line, done and the reason, as done the app cannot do this: ….`
}

/**
 * What the request asks before the model starts, told the way a limit is (the person: "try the before-start notice for
 * questions and for writing into the note, instead of page rules", 20 October 2026; the two rules on the page changed
 * no answer). A question asks for an answer: one beginning what, which, how, is, are, does…; "Can you…?" asks for a
 * change (QUESTION, in core's alone.ts). A question ended with done and nothing run ends there. Since note control's
 * step 2 (24 October 2026) the note's text is written by its commands, and since step 3 its tables, formulas, diagrams
 * and pictures of other notes; drawing in the note (handwriting, sketches) is still not built: a putting verb first,
 * then one of them.
 */
const NOT_YET = /^(?:please\s+)?(?:write|insert|add|put|draw|paste|place|make)\b.*\b(?:drawings?|sketch(?:es)?|handwriting|doodles?|in my hand|with the pen)\b/iu
function noticeOf(request: string): string | undefined {
  const limit = limitOf(request)
  if (limit !== undefined) return limit
  const said = request.trim()
  if (QUESTION.test(said)) return "This asks a question: answer it from the app's state above, in one line: done and the answer. Change nothing."
  if (NOT_YET.test(said)) return "If this asks to draw or write by hand in the note itself: that comes with a later step, not built yet (the note's commands write text, lists, tables, formulas and diagrams, and place pictures of other notes). Then run nothing: answer with one line, done and the reason."
  return undefined
}

/**
 * The page a request about the note's text is about, as text, with the whole words of the blocks it names (picks n3a
 * and fc1: no call to look at the page first, none to read a block before rewriting it): the page it names ("on page
 * 2"), else the page in view. None for a request about the app, so its first message is as it was.
 */
function pageAbout(commands: Commands, request: string): { page: number; text: string } | undefined {
  const store = commands.places.note?.store
  if (!store || !aboutTheText(request)) return undefined
  const doc = store.doc
  const named = /\bpage\s+(\d+)\b/iu.exec(request)
  const inView = store.pageInView ? doc.pages.indexOf(store.pageInView) + 1 : 1
  const page = named && Number(named[1]) >= 1 && Number(named[1]) <= doc.pages.length ? Number(named[1]) : Math.max(1, inView)
  const drawn = drawnBoxes(doc)
  const words = namedIn(doc, request, { page, drawn }).flatMap((id) => {
    const full = wordsInFull(doc, id)
    return full === undefined ? [] : [`  ${id}  ${full}`]
  })
  const text = `The page the request is about:\n${pagePicture(doc, page, drawn)}${words.length > 0 ? `\nThe whole words of the blocks the request names:\n${words.join('\n')}` : ''}`
  return { page, text }
}

/**
 * Lines written outside a block: a line naming an area, then inputs or done. Gemma 4 E4B once wrote its own tool-call
 * form, "<|tool_call>call:tool: choose tool=eraser done picked the eraser tool", and the request ended with nothing
 * run (the po run, 20 October 2026). A plain answer ("The note has 3 pages.") has none.
 */
const AREA_LINE = new RegExp(`(?:^|[\\s>:|])(?:${areaNames(COMMANDS).join('|')}):\\s.*(?:=|\\bdone\\b)`, 'mu')

export async function agentRun(request: string, context: AgentContext): Promise<AgentEnd> {
  const { model, commands } = context
  // The page a request about the text is about, read once: its picture goes in the first message, and its blocks are
  // what "the second paragraph" names in every line of the request. Its changes are one step of Undo.
  const about = pageAbout(commands, request)
  beginNoteRequest(about?.page)
  // A request the app knows word for word, changing only the view or the tools: run by code, with no call.
  const alone = aloneOf(finder(), request)
  if (alone) {
    const before = noteNow(commands)
    const ran = await runLines([commandLine(alone.command, alone.input)], { commands, ask: context.ask, ...(context.signal ? { signal: context.signal } : {}) })
    context.onOutput(withReport(ran, await changedSince(commands, before)), commands.state())
    return 'code'
  }
  const page = context.page ?? 'overall'
  const shown = (state: string): string => (page === 'small' ? plainState(state) : state)
  const limit = noticeOf(request)
  const messages: Message[] = [
    { role: 'system', content: terminalGuide(COMMANDS) },
    { role: 'user', content: `${request}\n\nThe app now: ${shown(commands.state()) || 'the library is open; no note'}${about ? `\n\n${about.text}` : ''}${limit ? `\n\n${limit}` : ''}` },
  ]
  let last: { lines: string; state: string } | undefined
  // Whether any line but done has run for this request, and whether done alone was sent back once already.
  let ran = false
  let sentBack = false
  let toldBlock = false
  for (let turn = 0; turn < (context.maxTurns ?? MAX_TURNS); turn++) {
    if (context.signal?.aborted) return 'stopped'
    // No temperature given: the provider sends 0, the steadiest, so the same request gives the same lines.
    const reply = await model.complete({ messages, maxTokens: 1024, ...(context.signal ? { signal: context.signal } : {}) })
    if (context.signal?.aborted) return 'stopped'
    context.onReply(reply.text)
    messages.push({ role: 'assistant', content: reply.text })
    const { blocks, unclosed } = blocksOf(reply.text)
    if (blocks.length === 0 && !unclosed) {
      if (toldBlock || !AREA_LINE.test(reply.text)) return 'done'
      toldBlock = true
      messages.push({ role: 'user', content: 'Nothing ran: lines run only inside a block that opens with ```wn and closes with ```. Write them in one.' })
      continue
    }
    let outputs: Output[] = []
    // The note before the lines, for the change report after them (note control, step 1).
    const before = noteNow(commands)
    for (const block of blocks) {
      // A line of the note's text takes the words under it, up to end.
      const ran = await runLines(stepsOf(block), { commands: commands, ask: context.ask, meaning: context.meaning, ...(context.signal ? { signal: context.signal } : {}) })
      outputs.push(...ran)
      if (ran.some((output) => !output.ok)) break
    }
    if (unclosed && outputs.every((output) => output.ok)) outputs.push({ line: '```wn', ok: false, text: 'A block was opened and never closed: nothing in it ran. Close it with ```.' })
    outputs = withReport(outputs, await changedSince(commands, before))
    const state = commands.state()
    context.onOutput(outputs, state)
    // A line that only reads (look, blocks, block, find) changes nothing: a model that looked, then said done, did not
    // do a request for a change (Qwen3-VL-8B, the note test's baseline, 25 October 2026).
    if (outputs.some((output) => !output.end && !READS.has(parseLine(output.line).kind))) ran = true
    if (outputs.some((output) => output.end)) {
      // done with nothing run, for a request that asks for a change: sent back once ("Go back to typing" ended with
      // done alone, the agent test, 20 October 2026). A question, or what the app was told it cannot do, ends there.
      if (ran || sentBack || limit !== undefined || QUESTION.test(request.trim())) return 'done'
      sentBack = true
      messages.push({ role: 'user', content: `${outputText(outputs, shown(state), page)}\nNothing changed for this request: done alone, or lines that only read, change nothing. If it asks for a change the app can make, write its lines, then done; if the app cannot, write done again with the reason.` })
      continue
    }
    // The same block again with nothing changed: a small model that does not know it has finished (seen 19 October).
    const lines = blocks.map((block) => linesOf(block).join('\n')).join('\n')
    if (last && last.lines === lines && last.state === state) return 'repeated'
    last = { lines, state }
    messages.push({ role: 'user', content: outputText(outputs, shown(state), page) })
  }
  return 'turns'
}
