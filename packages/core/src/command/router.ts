// The area router: the model names the area and says the operation
// in its own simple words, with the inputs it knows (video: play from seconds=120); code picks the command inside
// that one area, from at most twelve, usually one to four:
//   1. the inputs: only commands that take every input given (video: start seconds=120 cannot be video.play)
//   2. the verb meaning table (lexicon.ts): the operation's words against each command's, the longest phrase first
//   3. the inputs again: of two the words leave even, the one whose inputs are all there
//   4. meaning: an embedding model, when the caller passes one, for words no list has
// Not sure, it never guesses: it offers that area's few commands. What cannot be undone runs only on its phrase
// matched whole. Inputs that fit no command of the area are looked for in the others (pen: change erase=part is the
// eraser's).
import { z } from 'zod'
import { NOTE_COMMANDS } from '../note/commands.js'
import { COMMANDS } from './all.js'
import { Finder, type Meaning } from './finder.js'
import { AREAS, areaOf, rootsOf, STRICT, VERBS } from './lexicon.js'
import { bare, isNumber, valuesOf, type CommandSpec } from './spec.js'
import { POSITIONAL, typed } from './terminal.js'

/** Whether a phrase's roots are in some words', in order, other words between them allowed. */
function within(words: readonly string[], phrase: readonly string[]): boolean {
  let at = 0
  for (const root of words) if (root === phrase[at] && ++at === phrase.length) return true
  return phrase.length === 0
}

/**
 * Small words that link a verb to what it acts on ("start from", "turn off", "bring back"). A phrase begun lacks only
 * these, or it names another action: "open a new note" lacks "new", and note: open name=… made a note (the agent
 * test's baseline, 20 October 2026).
 */
const LINKING = new Set(rootsOf('from to at back up down out off on in into onto over with for by again away'))
/** Whether some words begin a phrase of two words or more: its first word said, every other said or a linking word. */
const begins = (words: readonly string[], phrase: readonly string[]): boolean =>
  phrase.length > 1 && words.includes(phrase[0]!) && phrase.slice(1).every((root) => words.includes(root) || LINKING.has(root))

/** The words a switch is said with: video: set times off. */
const SWITCHED = new Set(rootsOf('on off'))
/** Whether a command takes a switch (on, or off). */
const takesSwitch = (spec: CommandSpec): boolean => Object.values(spec.input.shape as Record<string, z.ZodType>).some((schema) => bare(schema) instanceof z.ZodBoolean)

const areaOfName = (name: string): string => name.split('.')[0]!
/** A command's own verb, as words: playFrom is "play from", deleteForever "delete forever". */
const verbWords = (name: string): string => name.split('.')[1]!.replace(/([a-z])([A-Z])/gu, '$1 $2').toLowerCase()

/** A command's own verb, as words, and its listed phrases, as written. */
const phrasesWritten = (name: string): string[] => [verbWords(name), ...(VERBS[name] ?? [])]
/**
 * An area's own words, as written: left out of its phrases and of an operation said in it ("go to the video" is
 * "go to"), before roots are made, so "settings" goes but a typed "set" stays (open the settings took developer mode
 * while their roots were compared). Not a word that is one of the area's phrases whole, a verb there: view's "zoom"
 * and "fullscreen", timer's "countdown" (view: fullscreen on=true found nothing while it was left out; the agent
 * test, 20 October 2026).
 */
const areaWordsOf = (area: string): Set<string> => {
  // A verb there: a whole phrase of one word ("zoom"), never the first word of a longer one ("note" of "note down",
  // which made note: close note name=… a new note; the agent test, 20 October 2026).
  const verbs = new Set(
    COMMANDS.filter((spec) => areaOfName(spec.name) === area)
      .flatMap((spec) => phrasesWritten(spec.name).map((text) => text.replace(/([a-z])([A-Z])/gu, '$1 $2').toLowerCase()))
      .filter((text) => !/\s/u.test(text)),
  )
  const own = [area, ...(AREAS[area]?.words ?? [])].filter((word) => !/\s/u.test(word))
  return new Set(own.filter((word) => !verbs.has(word)))
}
let phrasesMade: Map<string, string[][]> | undefined
/** A command's phrases, as roots. The table is made the first time a line is routed, not as the app starts. */
const phrasesOf = (name: string): string[][] => {
  phrasesMade ??= new Map(
    COMMANDS.map((spec) => {
      const own = areaWordsOf(areaOfName(spec.name))
      // A phrase the area's words leave one word of was about the thing, not the operation ("show page" is no "show").
      const list = phrasesWritten(spec.name)
        .map((text) => ({ roots: rootsOf(text), left: rootsOf(text, own) }))
        .filter(({ roots, left }) => left.length > 0 && (left.length === roots.length || left.length > 1))
        .map(({ left }) => left)
      return [spec.name, list]
    }),
  )
  return phrasesMade.get(name) ?? []
}

export type Routed =
  | { kind: 'found'; area: string; command: string; input: Record<string, unknown>; missing: string[]; by: 'verb' | 'inputs' | 'only' | 'meaning' }
  | { kind: 'unclear'; area: string; options: string[]; why: string }
  | { kind: 'elsewhere'; area: string; options: string[]; why: string }
  | { kind: 'no-area'; given: string }

interface Weighed {
  spec: CommandSpec
  input: Record<string, unknown>
  missing: string[]
  /** The longest of its phrases found in the operation, in roots; 0 for none. */
  verb: number
  /** That phrase, its roots. */
  phrase: readonly string[]
  /** Every input it must have given by name, or read as one of a short list: what breaks a tie. */
  filled: boolean
  /** A phrase of two words or more begun: its first word is in the operation. Ranks the commands offered. */
  part: boolean
  /** A phrase begun lacking only linking words ("start" of "start from", never "open" of "open a new"): decides. */
  begun: boolean
  /** Whether the operation, its inputs' values and the area's words taken out, is one of its phrases whole. */
  whole: boolean
  meaning?: number
}

const finders = new Map<string, Finder>()
/** One finder for an area's commands alone: inputs read from words, and meaning compared within the area. */
function finderOf(area: string): Finder {
  let made = finders.get(area)
  if (!made) {
    made = new Finder(COMMANDS.filter((spec) => areaOfName(spec.name) === area))
    finders.set(area, made)
  }
  return made
}

/** The inputs that name a thing to act on by its name (or id): what name= means for a command that takes no new name. */
const THINGS = ['note', 'folder', 'item', 'video'] as const

/**
 * The words of an operation left when its verb's words, the area's own and small words are taken out, as written: the
 * value of the one input a command still needs, when it is written in, not chosen from a list (video: remove YouTube
 * aircAruvnKk is video=aircAruvnKk; the agent test of 20 October 2026). Undefined when nothing is left.
 */
function leftOf(operation: string, phrase: readonly string[], own: ReadonlySet<string>, values: ReadonlySet<string>): string | undefined {
  const verb = [...phrase]
  const kept = operation
    .split(/\s+/u)
    .filter((word) => {
      const found = rootsOf(word, own)
      if (found.length === 0 || found.every((root) => LINKING.has(root) || values.has(root))) return false
      const at = found.length === 1 ? verb.indexOf(found[0]!) : -1
      if (at >= 0) verb.splice(at, 1)
      return at < 0
    })
    .join(' ')
    .replace(/^["'“‘]|["'”’]$/gu, '')
    .trim()
  return kept === '' ? undefined : kept
}

/** The inputs a command must have, of those it takes. */
const required = (spec: CommandSpec): string[] =>
  Object.entries(spec.input.shape as Record<string, z.ZodType>)
    .filter(([, schema]) => !(schema instanceof z.ZodOptional))
    .map(([field]) => field)

/** The words a value of an input is written with, as roots: "extra-fine" is extra, fine; 150 is 150. */
const valueRoots = (input: Record<string, unknown>): Set<string> => new Set(Object.values(input).flatMap((value) => (Array.isArray(value) ? value : [value])).flatMap((value) => rootsOf(String(value))))

/**
 * When the verb table decides. `alone`: a phrase of one word decides only when no other command of the area has words
 * in the operation, and a phrase of two words or more when it is longer than any other's ("get rid of" over note.open's
 * "get"); without it, the longest phrase decides. `most`: only for an operation of at most this many words (filler,
 * values and the area's own words left out), since a long sentence names many verbs in passing. Measured on 20 October
 * 2026 on 900 requests Gemma wrote and the 135 of the finder test (the record).
 */
export interface RouteRules {
  alone: boolean
  most: number
}
export const ROUTE_RULES: RouteRules = { alone: true, most: 4 }

/** The recipes a model names as a role or a kind of list. */
const RECIPE_ROLES: Readonly<Record<string, string>> = {
  qa: 'recipe.qa', 'q&a': 'recipe.qa', question: 'recipe.qa', questions: 'recipe.qa', summary: 'recipe.summary', definition: 'recipe.definition', define: 'recipe.definition',
  section: 'recipe.section', steps: 'recipe.steps', step: 'recipe.steps', compare: 'recipe.compare', comparison: 'recipe.compare',
}
/** Words for seeing a page, as roots. */
const SEEING = new Set(['look', 'show', 'view', 'see', 'go', 'open', 'display', 'to', 'at'].map((word) => rootsOf(word)[0] ?? word))

/** The note's own areas (note control): text, list, block and those after them. */
const NOTE_AREAS: readonly string[] = [...new Set(NOTE_COMMANDS.map((spec) => areaOfName(spec.name)))]

/**
 * Route an operation, said in an area, with the inputs given by name. The note's areas are one family: an operation
 * none of the area's commands has, or inputs none takes, that is one sibling area's command and only one, runs as it
 * (text: remove block=p2 is block's remove, text: add style=bullet list's add; the note check of 24 October 2026).
 * Never when the area itself has the words, or two siblings fit.
 */
export async function route(area: string, operation: string, given: Record<string, unknown> = {}, meaning?: Meaning, rules: RouteRules = ROUTE_RULES): Promise<Routed> {
  const known = areaOf(area)
  // A recipe named as a block's role or a list's kind: text: add role=summary is recipe.summary (Qwen3-VL-8B, four tasks
  // of the note test's baseline, 25 October 2026).
  if (known !== undefined && NOTE_AREAS.includes(known) && known !== 'recipe') {
    for (const field of ['role', 'style']) {
      const recipe = RECIPE_ROLES[String(given[field] ?? '').toLowerCase()]
      const spec = recipe ? COMMANDS.find((one) => one.name === recipe) : undefined
      if (!spec) continue
      const input = typed(spec, Object.fromEntries(Object.entries(given).filter(([one]) => one !== field)))
      return { kind: 'found', area: 'recipe', command: spec.name, input, missing: required(spec).filter((one) => !(one in input)), by: 'inputs' }
    }
  }
  // A page named alone in the page area, or with a word for seeing it: page: page=3, page: look page=1 shows that page
  // (Qwen3-VL-8B wrote it before writing on a page, three tasks of the same baseline).
  const named = Object.keys(given).filter((field) => field !== POSITIONAL)
  if (known === 'page' && named.length === 1 && named[0] === 'page' && rootsOf(operation, areaWordsOf('page')).every((root) => SEEING.has(root) || root === String(given.page))) {
    return { kind: 'found', area: 'screen', command: 'screen.page', input: typed(COMMANDS.find((one) => one.name === 'screen.page')!, { page: given.page }), missing: [], by: 'inputs' }
  }
  const routed = await routeIn(area, operation, given, meaning, rules)
  const missed = routed.kind === 'elsewhere' || (routed.kind === 'unclear' && routed.why.startsWith('no command of'))
  if (!known || !NOTE_AREAS.includes(known) || !missed) return routed
  const found: Routed[] = []
  for (const other of NOTE_AREAS.filter((one) => one !== known)) {
    const there = await routeIn(other, operation, given, meaning, rules)
    if (there.kind === 'found') found.push(there)
  }
  return found.length === 1 ? found[0]! : routed
}

/**
 * The steps at the top of this file, inside one area (`route` above handles what spans areas): each step returns as
 * soon as it is sure, and step 0 comes first because a verb that clearly names a command must not be overruled by
 * another command that merely takes the inputs. With no step sure, it offers the area's commands and never guesses.
 */
async function routeIn(area: string, operation: string, given: Record<string, unknown> = {}, meaning?: Meaning, rules: RouteRules = ROUTE_RULES): Promise<Routed> {
  const known = areaOf(area)
  if (!known) return { kind: 'no-area', given: area }
  const specs = COMMANDS.filter((spec) => areaOfName(spec.name) === known)
  const named = Object.keys(given).filter((field) => field !== POSITIONAL)
  const takes = (spec: CommandSpec): boolean => named.every((field) => field in (spec.input.shape as Record<string, unknown>))

  // 0. A verb that clearly names one command of the area, which does not take the inputs given: how to write it, not
  // another command that takes them (folder: move name=Receipts is folder.move's, written folder=Receipts; the area
  // test, 20 October 2026, made a new folder of it).
  // Words that are only the values given are no operation: ai: mode=ask has "ask" for its words, which took ai.send's
  // verb (the baseline, 20 October 2026); with nothing else said, the inputs decide or the area's commands are offered.
  const written = rootsOf(operation, areaWordsOf(known))
  const values = valueRoots(given)
  // An input's value is no verb when it is one of its field's listed values or has more than one word: ai: open
  // mode=ask offered ai.send for "ask", ai: instant request="make it red" ai.send for "make" (the check of every
  // operation on the page, 20 October 2026). A value of one word written in still counts (bin: delete all item=all).
  const listedIn = (field: string, value: unknown): boolean => specs.some((spec) => valuesOf((spec.input.shape as Record<string, z.ZodType>)[field] ?? z.never())?.includes(String(value).toLowerCase()) === true)
  const noVerb = new Set(Object.entries(given).filter(([field, value]) => field !== POSITIONAL && (/\s/u.test(String(value).trim()) || listedIn(field, value))).flatMap(([, value]) => rootsOf(String(value))))
  const said = written.every((root) => values.has(root)) ? [] : written.filter((root) => !noVerb.has(root))
  const verbOf = (spec: CommandSpec): number => Math.max(0, ...phrasesOf(spec.name).filter((phrase) => within(said, phrase)).map((phrase) => phrase.length))
  const begunBy = (spec: CommandSpec): boolean => phrasesOf(spec.name).some((phrase) => begins(said, phrase))
  const taking = specs.filter(takes)
  // Only when some command of the area takes the inputs, none of them with the operation's words: else the inputs
  // are another area's (pen: change erase=part), or the words fit a command that takes them (video: start seconds=120).
  if (named.length > 0 && taking.length > 0) {
    const scored = specs.map((spec) => ({ spec, verb: verbOf(spec) })).sort((a, b) => b.verb - a.verb)
    const [first, second] = scored
    // A phrase of two words or more is strong ("delete all" is bin.empty's, whatever item= says); one word only when
    // no command taking the inputs has any of the operation's words.
    const strong = first !== undefined && (first.verb > 1 || !taking.some((spec) => verbOf(spec) > 0 || begunBy(spec)))
    if (first && first.verb > 0 && strong && (!second || second.verb < first.verb) && !takes(first.spec)) {
      const wrong = named.filter((field) => !(field in (first.spec.input.shape as Record<string, unknown>)))
      // name= for the thing the command acts on, by its name: note: open name="Waves" is note=Waves, when the command
      // takes no name and one such thing (the agent test of 20 October 2026, 50 lines).
      const things = THINGS.filter((field) => field in (first.spec.input.shape as Record<string, unknown>) && !(field in given))
      if (wrong.length === 1 && wrong[0] === 'name' && things.length === 1) {
        const { name, ...rest } = given
        return route(area, operation, { ...rest, [things[0]!]: name }, meaning, rules)
      }
      return { kind: 'unclear', area: known, options: [first.spec.name], why: `${first.spec.name} has no ${wrong.join(', ')}` }
    }
  }

  // 1. The inputs given: only the commands that take them all, else the commands of other areas that do.
  const fits = specs.filter(takes)
  if (fits.length === 0) {
    const others = COMMANDS.filter((spec) => areaOfName(spec.name) !== known && named.length > 0 && takes(spec))
    if (others.length > 0) return { kind: 'elsewhere', area: known, options: others.slice(0, 4).map((spec) => spec.name), why: `no command of ${known} takes ${named.join(', ')}` }
    return { kind: 'unclear', area: known, options: specs.map((spec) => spec.name), why: `no command of ${known} takes ${named.join(', ')}` }
  }

  // 2. The verb meaning table, each command's inputs read from the words besides those given.
  const words = said
  // The values given by name left out: video: remove video="But what is a neural network?" is one word of operation.
  const coreLength = words.filter((root) => !values.has(root) && !/^\d/u.test(root)).length
  const finder = finderOf(known)
  const switched = words.some((root) => SWITCHED.has(root))
  const weighed: Weighed[] = fits.map((spec) => {
    const read = finder.inputsOf(operation, spec.name)
    const explicit = typed(spec, given)
    const input = { ...read, ...explicit }
    const missing = required(spec).filter((field) => !(field in input))
    // Filled for a tie: every input it must have given by name, or read as one of a short list or a number (never a
    // switch read from a word, as "open" for on).
    const shape = spec.input.shape as Record<string, z.ZodType>
    const filled = required(spec).length > 0 && required(spec).every((field) => field in explicit || (field in read && !(bare(shape[field]!) instanceof z.ZodBoolean)))
    const its = valueRoots(input)
    const core = words.filter((root) => !its.has(root) && !/^\d/u.test(root))
    let verb = 0
    let phrase: readonly string[] = []
    let part = false
    let begun = false
    let whole = false
    for (const one of phrasesOf(spec.name)) {
      if (within(words, one) && one.length > verb) {
        verb = one.length
        phrase = one
      } else if (one.length > 1 && words.includes(one[0]!)) {
        part = true
        if (begins(words, one)) begun = true
      }
      if (one.length === core.length && one.every((root, i) => root === core[i])) whole = true
    }
    // A switch said with the verb counts for the commands that take one: video: set times off is video.times's
    // ("times" and off), not video.seek's "set the time" (the agent test, 20 October 2026).
    if (verb > 0 && switched && takesSwitch(spec)) verb += 1
    return { spec, input, missing, verb, phrase, part, begun, whole, filled }
  })

  // 3. Of those the words leave even, the one whose inputs are all there.
  // Filled: a command with inputs it must have, every one given or read ("move the panel to the left": place).
  const complete = (w: Weighed): number => (w.filled ? 1 : 0)
  const ranked = (list: readonly Weighed[]): Weighed[] =>
    [...list].sort((a, b) => b.verb - a.verb || complete(b) - complete(a) || Number(b.part) - Number(a.part) || (b.meaning ?? 0) - (a.meaning ?? 0))
  const done = (chosen: Weighed, by: 'verb' | 'inputs' | 'only' | 'meaning'): Routed => {
    if (STRICT.has(chosen.spec.name) && !chosen.whole) return { kind: 'unclear', area: known, options: ranked(weighed).slice(0, 4).map((w) => w.spec.name), why: `${chosen.spec.name} cannot be undone or asks first: write its name, or its words whole` }
    // The one input still needed, written in: the words the verb leaves.
    const [field] = chosen.missing
    const schema = field === undefined ? undefined : bare((chosen.spec.input.shape as Record<string, z.ZodType>)[field]!)
    const left = by === 'verb' && chosen.missing.length === 1 && schema instanceof z.ZodString ? leftOf(operation, chosen.phrase, areaWordsOf(known), values) : undefined
    if (field !== undefined && left !== undefined) return { kind: 'found', area: known, command: chosen.spec.name, input: { ...chosen.input, [field]: left }, missing: [], by }
    return { kind: 'found', area: known, command: chosen.spec.name, input: chosen.input, missing: chosen.missing, by }
  }

  // An area of one command has nothing to confuse it with: any length (eraser: whole strokes and medium size; the
  // agent test of 24 October 2026).
  const short = coreLength <= rules.most || specs.length === 1
  const [top, next] = ranked(weighed)
  if (top && top.verb > 0 && short) {
    const rival = next !== undefined && next.verb > 0
    const longer = !rival || top.verb > next.verb
    const evenButComplete = rival && next.verb === top.verb && complete(top) > complete(next)
    if (rules.alone ? !rival || (top.verb > 1 && longer) || evenButComplete : longer || evenButComplete) return done(top, 'verb')
  }
  const anyVerb = weighed.some((w) => w.verb > 0)
  if (!anyVerb && short) {
    // A phrase begun ("start" of "start from"), when no phrase is whole and inputs narrowed the commands: the one
    // command it begins (video: start seconds=120, video.play taking no seconds).
    const begun = weighed.filter((w) => w.begun)
    if (begun.length === 1 && named.length > 0) return done(begun[0]!, 'verb')
    // One command left by the inputs given, or the area has one. Inputs alone decide only through one of a short list
    // of values (pen: kind=pencil), never a bare switch (video: on=off took video.times for hiding the video).
    // And only with every such value on its list: settings: open them option=look scope=mine took settings.pen, whose
    // option has no "look" (the baseline, 20 October 2026; the model meant the theme's look=light).
    const listed = (field: string): boolean | undefined => valuesOf((fits[0]!.input.shape as Record<string, z.ZodType>)[field]!)?.includes(String(given[field]).toLowerCase())
    // Or a number only that command takes: screen: page=2, select: page=1 x=20 … (the agent test of 20 October
    // 2026). A number says which; a switch never does.
    const counted = (field: string): boolean => isNumber((fits[0]!.input.shape as Record<string, z.ZodType>)[field]!)
    const telling = named.some((field) => listed(field) === true || counted(field)) && !named.some((field) => listed(field) === false)
    if (fits.length === 1 && (specs.length === 1 || (named.length > 0 && telling))) return done(weighed[0]!, specs.length === 1 ? 'only' : 'inputs')
  }

  // 4. Meaning, for words no list has: the area's commands compared with the operation, the clear first only.
  if (meaning && !anyVerb) {
    try {
      const near = new Map((await finder.nearestInMeaning(operation, meaning)).map((c) => [c.command, c.score]))
      for (const w of weighed) w.meaning = near.get(w.spec.name) ?? 0
      const [best, second] = [...weighed].sort((a, b) => (b.meaning ?? 0) - (a.meaning ?? 0))
      if (best && (best.meaning ?? 0) >= meaning.cutoff && (!second || (best.meaning ?? 0) - (second.meaning ?? 0) >= meaning.gap)) return done(best, 'meaning')
    } catch {
      // No embedding model to be had now: the area's commands are offered, as without one.
    }
  }
  // No verb of this area, and the words are another area's command's own phrase whole, of two words or more, taking
  // the inputs given: that command (screen: full view on=on is panel.full's "full view": both models wrote it, the
  // agent test of 24 October 2026). Only when one command is so, and never one that cannot be undone.
  if (!anyVerb) {
    const core = said.filter((root) => !values.has(root) && !/^\d/u.test(root))
    const whole = (spec: CommandSpec): boolean => phrasesOf(spec.name).some((phrase) => phrase.length === core.length && phrase.every((root, i) => root === core[i]))
    const others = core.length > 1 ? COMMANDS.filter((spec) => areaOfName(spec.name) !== known && !STRICT.has(spec.name) && takes(spec) && whole(spec)) : []
    if (others.length === 1) {
      const spec = others[0]!
      const area = areaOfName(spec.name)
      const input = { ...finderOf(area).inputsOf(operation, spec.name), ...typed(spec, given) }
      return { kind: 'found', area, command: spec.name, input, missing: required(spec).filter((field) => !(field in input)), by: 'verb' }
    }
  }
  // No verb at all: the area's commands, those taking the inputs first; the inputs may be wrong too (panel: side
  // on=off offered only panel.full, which takes on, when panel.hide was meant).
  const options = anyVerb ? ranked(weighed).map((w) => w.spec.name) : [...new Set([...ranked(weighed).map((w) => w.spec.name), ...specs.map((spec) => spec.name)])]
  return { kind: 'unclear', area: known, options: options.slice(0, anyVerb ? 4 : 6), why: !short ? 'too many words to be sure: say the operation in a few' : anyVerb ? 'more than one fits those words' : `no command of ${known} has those words` }
}
