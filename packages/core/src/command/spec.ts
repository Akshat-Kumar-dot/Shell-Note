// Commands (the person's plan for the agent, 19 October 2026:
//). A command is named area.verb and
// takes one object of named inputs, from one vocabulary shared by every
// command: a field means the same wherever it appears, so a model learns
// `colour` once. A command's spec is data: its name, what it does, how people
// ask for it, its inputs and an example. The app gives each its code; core
// keeps the specs, so the finder is tested with no browser.
import { z } from 'zod'
import { PLACES, SPANS } from '../note/place.js'
import { AnyColor, Font, MAX_LABEL, NodeShape } from '../schema/doc.js'

/** area.verb: lowercase, the verb may be camelCase (bin.deleteForever). */
export const COMMAND_NAME = /^[a-z]+\.[a-z][a-zA-Z]*$/u

/** A command's inputs: one strict object of fields from FIELDS. */
export type CommandInput = z.ZodObject<z.core.$ZodLooseShape, z.core.$strict>

export interface CommandSpec {
  /** area.verb, as tool.choose. */
  readonly name: string
  /** What it does, in a few words, for the model and for people. */
  readonly does: string
  /**
   * How people ask for it, three or more ways. A field name in braces stands
   * for any of its values: "use the {kind}" is "use the pencil", "use the
   * marker"… Never copied from the finder's test phrasings.
   */
  readonly says: readonly string[]
  readonly input: CommandInput
  /** One input that works, shown to the model with the command. */
  readonly example: Record<string, unknown>
  /**
   * Why the agent must ask the maintainer first: it cannot be undone. When it
   * asks only in some cases, the reason says which.
   */
  readonly asks?: string
  /**
   * Under high review: allowed, but each time the agent runs it the terminal
   * marks it, and it is reviewed closely. The reason says why it is watched.
   */
  readonly review?: string
}

/** Something the agent cannot do, and why: matched like a command, so a request for it is answered plainly. */
export interface Limit {
  readonly says: readonly string[]
  readonly why: string
}

const name = z.string().min(1).max(200)

/** The buttons the bar for typing can hold, in the order they are offered; the first twelve are in it as it starts, the rest under its More. */
export const TYPING_BUTTONS = ['undo', 'redo', 'style', 'font', 'bold', 'italic', 'underline', 'colour', 'align', 'link', 'picture', 'table', 'strike', 'highlight', 'code', 'sub', 'sup', 'todo', 'diagram', 'select'] as const
export type TypingButton = (typeof TYPING_BUTTONS)[number]
/** The bar for typing as it starts. */
export const TYPING_START: readonly TypingButton[] = TYPING_BUTTONS.slice(0, 12)
/**
 * The buttons the pen's row can hold, in the order they are offered: the first sixteen are in it as it starts, the
 * other colours under its More. Each of the note's colours is a button of its own, a colour in reach.
 */
export const PEN_BUTTONS = ['select', 'hand', 'pen', 'highlighter', 'eraser', 'black', 'blue', 'red', 'green', 'colour', 'width', 'undo', 'redo', 'tidy', 'type', 'picture', 'grey', 'orange', 'yellow', 'purple'] as const
export type PenButton = (typeof PEN_BUTTONS)[number]
/** The pen's row as it starts. */
export const PEN_START: readonly PenButton[] = PEN_BUTTONS.slice(0, 16)
/** The pen's row's buttons that always stay in it, though they can be moved along it: the pen, how the row starts, and Type, the way back to the row for words. */
export const PEN_KEPT: readonly PenButton[] = ['pen', 'type']
/**
 * The buttons a board's row can hold, in the order they are offered: the first ten are in it as it starts (Select, the
 * Hand, the Step tool, the Text tool, the pen and the eraser, undo and redo, Tidy, the whole board), the highlighter and
 * a picture under its More.
 */
export const BOARD_BUTTONS = ['select', 'hand', 'step', 'text', 'pen', 'eraser', 'undo', 'redo', 'tidy', 'fit', 'highlighter', 'picture'] as const
export type BoardButton = (typeof BOARD_BUTTONS)[number]
/** The board's row as it starts. */
export const BOARD_START: readonly BoardButton[] = BOARD_BUTTONS.slice(0, 10)
/** The board's row's buttons that always stay in it, though they can be moved along it: Select, which a board opens with. */
export const BOARD_KEPT: readonly BoardButton[] = ['select']
/** Every button a row of tools can hold, each name once. */
const ROW_BUTTONS = [...new Set<string>([...TYPING_BUTTONS, ...PEN_BUTTONS, ...BOARD_BUTTONS])] as [string, ...string[]]
/** The sections of Settings, in the order its column lists them. */
export const SETTINGS_SECTIONS = ['general', 'appearance', 'customise', 'pen', 'ai', 'assistants', 'storage', 'about'] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

/**
 * The input vocabulary: every command's fields come from here, so each name has
 * one meaning. Values are the words people use (a pen's width is "fine", not
 * "s"); the app maps them to its own.
 */
export const FIELDS = {
  note: name.describe('A note: its id from the library, or its exact name. Left out: the note open now'),
  folder: name.describe('A folder: its id, or its exact name. Left out: the top of the library'),
  into: name.describe('The folder to put something in: its id, or its exact name. Left out: the top of the library'),
  item: name.describe('A note or folder in Recently deleted: its id, or its exact name'),
  name: name.describe('A new name'),
  text: z.string().max(200).describe('Words to look for'),
  transcript: z.string().min(1).max(500_000).describe("A video's transcript with its times, as YouTube shows it, or a subtitle file (SRT, WebVTT)"),
  path: name.describe('A file on this computer: its full path, ending in .shellnote'),
  tool: z
    .enum(['type', 'select', 'free', 'pen', 'highlighter', 'eraser', 'hand', 'step'])
    .describe('A tool: type, select, free (the free cursor: type anywhere; on a board, a text box where it clicks), pen, highlighter, eraser, hand (a drag moves the sheet), or step (on a board: a drag draws a step, a drag from a step a link)'),
  kind: z.enum(['pen', 'pencil', 'fountain', 'marker']).describe("The pen's kind: the plain pen, a pencil, a fountain pen or a marker"),
  colour: AnyColor.describe('A colour: ink (the usual near-black), gray, red, orange, yellow, green, blue or purple, or a code such as #e0563a'),
  width: z.enum(['extra-fine', 'fine', 'medium', 'broad', 'extra-broad']).describe('How wide a line is'),
  erase: z.enum(['whole', 'part']).describe('The eraser takes whole strokes, or only the part of a stroke it passes over'),
  size: z.enum(['small', 'medium', 'large']).describe('How big'),
  percent: z.int().min(10).max(400).describe('A zoom, in percent: 100 is actual size; pages from 25, a board from 10'),
  step: z.enum(['in', 'out', 'actual', 'fit']).describe('Zoom one step in, one step out, back to actual size, or (on a board) to show the whole board'),
  page: z.int().min(1).describe('A page number, from 1'),
  on: z.boolean().describe('On (true) or off (false)'),
  panel: z.enum(['side', 'description', 'transcript', 'web', 'timer', 'output', 'ai']).describe('The side panel, or one of its tabs'),
  pane: z.enum(['notes', 'video', 'side']).describe('A panel of the workspace: the notes, the video, or the side panel'),
  bar: z.enum(['tools', 'format']).describe('A bar: tools (the tools) or format (the text formatting)'),
  place: z.enum(['top', 'bottom', 'left', 'right']).describe('Where a bar is docked'),
  by: z.enum(['edited', 'created']).describe('Sort by the date last edited, or created'),
  order: z.enum(['newest', 'oldest']).describe('Which come first'),
  section: z.enum(SETTINGS_SECTIONS).describe('A section of Settings: general (the keys), appearance, customise, pen, ai, assistants, storage (sync and storage) or about'),
  shell: z.enum(['flat', 'islands', 'dock']).describe("The app's look: flat (one row of tools under the tabs, thin lines), islands (rounded panels, the tools floating over the note) or dock (no rail, the tools at the bottom)"),
  button: z
    .enum(ROW_BUTTONS)
    .describe(
      "A button of a row of tools. The bar for typing's: undo, redo, style, font (font and size), bold, italic, underline, colour, align, link, picture, table, strike (strikethrough), highlight, code, sub (subscript), sup (superscript), todo (to-do list), diagram, select (select with a box). The pen's row's (tools=pen): select, hand (move the sheet), pen, highlighter, eraser, black, blue, red, green, grey, orange, yellow, purple (the colours in reach), colour (more colours), width, undo, redo, tidy, type, picture. A board's row's (tools=board): select, hand (move the board), step, text, pen, eraser, undo, redo, tidy (the flowchart laid out again), fit (the whole board in view), highlighter, picture",
    ),
  tools: z.enum(['typing', 'pen', 'board']).describe("Which row of tools a button is of: the bar for typing (typing; left out, this one), the pen's row (pen), or a board's row (board)"),
  position: z.int().min(1).max(Math.max(TYPING_BUTTONS.length, PEN_BUTTONS.length, BOARD_BUTTONS.length)).describe('A place in a row of tools, counted from 1 at its start'),
  side: z.enum(['left', 'right', 'hidden']).describe('Which side of the window something sits on, left or right, or hidden'),
  view: z.enum(['cards', 'list', 'home']).describe('How the library shows its folders and notes: as cards, as a list, or, at its top, as Home (start a note, the three notes to go on with, the folders, then every other note)'),
  part: z.enum(['all', 'look', 'tools', 'pen', 'board', 'places']).describe("What goes back as it started: the places of the panels, the bars and the library's column (places), the app's look (look), the bar for typing's buttons (tools), the pen's row's buttons (pen), a board's row's buttons and the points where links join (board), or all of it (all)"),
  show: z.enum(['all', 'text', 'sketch', 'mixed']).describe('Which notes the library shows: all of them, or only the text notes, the sketches or the mixed notes'),
  look: z.enum(['system', 'light', 'dark']).describe("The app's appearance; system follows Windows"),
  accent: z.enum(['graphite', 'blue', 'teal', 'green', 'amber', 'rose', 'red']).describe("The app's own colour, on its buttons and what is chosen; graphite is no colour"),
  type: z.enum(['text', 'sketch', 'mixed', 'board']).describe('What a note is for: text (typing), sketch (the pen), mixed (both), or board (flowcharts on an endless page: made as one, never made into one)'),
  sheet: z.enum(['a4', 'a5', 'a6', 'letter']).describe('A page size: a4, a5, a6 or letter'),
  turn: z.enum(['upright', 'across']).describe('Which way up the pages are: upright (portrait) or across (landscape)'),
  link: name.describe('A YouTube link, or a video id'),
  video: name.describe("One of the note's videos: its id, or its title. Left out: the first"),
  seconds: z.number().min(0).describe('A time in the video, in seconds'),
  minutes: z.number().positive().max(600).describe('A length of time, in minutes'),
  mode: z.enum(['edit', 'ask']).describe("The AI box: edit changes the note, ask answers and changes nothing"),
  request: z.string().min(1).max(4000).describe('What to ask the AI, in words'),
  make: z.enum(['ask', 'table', 'flowchart', 'summary']).describe("What the side panel's AI chat does: answer, or make a table, a flowchart, or a summary of the video's transcript"),
  put: z.enum(['note', 'pad']).describe('Where a thing the AI makes goes: into the note, or onto the scratch pad first'),
  made: name.describe('A thing on the scratch pad: its id, or what it is of. Left out: the latest'),
  model: name.describe('An AI model, by its id in the AI settings'),
  option: z.enum(['fingers', 'lines', 'shapes', 'smoothing', 'pressure', 'scratch', 'tidy', 'anchor', 'gap', 'symbols']).describe('A pen setting'),
  value: z.string().min(1).max(60).describe("A setting's value, as its command lists them"),
  scope: z.enum(['mine', 'note']).describe("Whose settings: the person's own (mine), or this note's, which travel with it and win"),
  rule: z.enum(['ends', 'letters', 'level', 'gaps', 'margin', 'marks', 'once', 'ties', 'base', 'waist', 'rest']).describe('A tidy rule, as developer mode lists them'),
  blocks: z.array(name).min(1).max(500).describe('Blocks of the note, each by its id or its words, all or how they start (note.blocks lists them)'),
  block: name.describe('One block of the note, by its id or its words, all or how they start (note.blocks lists them)'),
  x: z.number().min(0).max(2000).describe("Across, in mm from the page's left edge"),
  y: z.number().min(0).max(2000).describe("Down, in mm from the page's top edge"),
  w: z.number().positive().max(2000).describe('A width, in mm'),
  h: z.number().positive().max(2000).describe('A height, in mm'),
  // The note's content (note control, step 2): what a block of text is, where a new one goes, its look, its words.
  role: z.enum(['paragraph', 'heading', 'quote', 'bullet', 'numbered', 'todo']).describe("What a block of text is: a paragraph, a heading, a quote, or an item of a list (bullet, numbered, todo)"),
  level: z.int().min(1).max(3).describe("A heading's level: 1 the biggest, to 3"),
  style: z.enum(['bullet', 'numbered', 'todo']).describe("A list's kind: bullet points, numbered, or to-dos with tick boxes"),
  after: name.describe('The block a new one goes after: its id, $1 for the block an earlier line made, or words such as "the second paragraph" or "the heading Summary"'),
  before: name.describe('The block a new one goes before: its id, $1, or words such as "the first heading"'),
  at: z.enum(['top', 'end']).describe('At the top or the end of a page (page=…; left out: the page the request is about)'),
  font: Font.describe('A font: sans, serif, mono, hand, or a font of the library by its id, such as lora'),
  align: z.enum(['left', 'center', 'right']).describe('How lines of text line up: left, center or right'),
  words: z.string().min(1).max(20_000).describe('What goes into the note, on the lines under the line, up to a line end, as it is, no quotes: words, a table as a Markdown table, a formula in LaTeX, a diagram in Mermaid'),
  // Tables, maths, diagrams and pictures (note control, step 3;).
  row: name.describe("A row of a table: its number from 1 (the header row is 1), last, or the words of its first cell"),
  column: name.describe("A column of a table: its number from 1, last, or the words of its header"),
  design: z.enum(['grid', 'lines', 'banded', 'header']).describe("A table's look: grid (every line), lines (between the rows only), banded (rows shaded in turn), header (its header row marked)"),
  head: z.boolean().describe("A table's first row its header row (on), or a plain row (off)"),
  picture: name.describe('A picture of another note of the library: its description or caption, with its note when that helps, as "the circuit photo from my Electronics note"'),
  // Places on a page and pages (note control, step 4): words, never millimetres; code finds the spot.
  to: z.union([z.enum(PLACES), z.int().min(1), name]).describe("Where it goes: a part of a page (top, bottom, left, right, middle, top left, top right, bottom left, bottom right), for a page its new number, or for a link the step it leads to"),
  beside: name.describe('The block a block goes beside: its id, $1, or words such as "the first paragraph"'),
  below: name.describe('The block a block goes below: its id, $1, or words such as "the table"'),
  span: z.enum(SPANS).describe("How wide a block is: half, a third or the full width of the page (a table's, of its column), or wider or narrower than now"),
  paper: z.enum(['blank', 'ruled', 'squares', 'dots']).describe("A page's paper: blank, ruled lines, squares or dots"),
  // A board's flowchart (the Board, step 2): steps named by id or in words, never a place; code does every place.
  from: name.describe('The step a link leaves: its id, $1, or words such as "the step Review" or "the diamond"'),
  shape: z.enum(NodeShape.options).describe("A step's shape: box, round, pill (a start or an end), subroutine, cylinder (stored data), circle, double-circle, flag, diamond (a decision), hexagon, slant (an input or output), slant-back, trapezoid, trapezoid-down"),
  label: z.string().max(MAX_LABEL).describe("A link's words, one line (empty: none)"),
  route: z.enum(['angled', 'straight', 'curved']).describe('How a link runs between its steps: angled (in right angles), straight, or curved'),
  line: z.enum(['plain', 'dotted', 'thick']).describe('How a link is drawn: a plain, a dotted or a thick line'),
  arrow: z.boolean().describe('A link with an arrow at its end (on), or a line with none (off)'),
  flow: z.enum(['down', 'right', 'up', 'left']).describe('Which way a flowchart runs: down (top to bottom), right (left to right), up, or left'),
} as const

export type Field = keyof typeof FIELDS

/** A command's input schema from vocabulary fields: those in `optional` may be left out. */
export function inputs<R extends Field, O extends Field = never>(required: readonly R[], optional: readonly O[] = []): CommandInput {
  const shape: Record<string, z.ZodType> = {}
  for (const field of required) shape[field] = FIELDS[field]
  for (const field of optional) shape[field] = FIELDS[field].optional()
  return z.strictObject(shape)
}

/** A field's schema without its optional wrapper. */
export function bare(schema: z.ZodType): z.ZodType {
  return schema instanceof z.ZodOptional ? (bare(schema.unwrap() as z.ZodType)) : schema
}

/** A field's allowed words, when it is a short list (or a short list or a code, as a colour is). */
export function valuesOf(schema: z.ZodType): readonly string[] | undefined {
  const inner = bare(schema)
  if (inner instanceof z.ZodEnum) return inner.options as string[]
  if (inner instanceof z.ZodUnion) {
    const words = (inner.options as z.ZodType[]).flatMap((option) => valuesOf(option) ?? [])
    return words.length > 0 ? words : undefined
  }
  return undefined
}

/** Whether a field takes a number. */
export function isNumber(schema: z.ZodType): boolean {
  return bare(schema) instanceof z.ZodNumber
}

/** How a person is asked for one of a command's inputs in the command box: a choice of words, on or off, a number, or a few words typed. */
export type InputAsk = { field: string; kind: 'choice'; values: readonly string[] } | { field: string; kind: 'switch' } | { field: string; kind: 'number' } | { field: string; kind: 'words' }

/** The inputs of words a person may type in the command box: a name, or words to look for. */
const TYPED: ReadonlySet<string> = new Set(['name', 'text'])

/**
 * The inputs a command cannot do without, as the command box asks a person for them, in order; undefined when one of
 * them cannot be asked there (blocks of a note, a place on a page, a long text: the terminal's and the AI's).
 */
export function asksOf(spec: CommandSpec): InputAsk[] | undefined {
  const asks: InputAsk[] = []
  for (const [field, schema] of Object.entries(spec.input.shape as Record<string, z.ZodType>)) {
    if (schema instanceof z.ZodOptional) continue
    const inner = bare(schema)
    if (inner instanceof z.ZodEnum) asks.push({ field, kind: 'choice', values: inner.options as string[] })
    else if (inner instanceof z.ZodBoolean) asks.push({ field, kind: 'switch' })
    else if (inner instanceof z.ZodNumber) asks.push({ field, kind: 'number' })
    else if (TYPED.has(field)) asks.push({ field, kind: 'words' })
    else return undefined
  }
  return asks
}

/** A command as the model is shown it once found: what it does, its inputs (JSON Schema), an example, and whether it asks first. */
export function describe(spec: CommandSpec): { command: string; does: string; input: Record<string, unknown>; example: Record<string, unknown>; asks?: string } {
  return {
    command: spec.name,
    does: spec.does,
    input: z.toJSONSchema(spec.input) as Record<string, unknown>,
    example: spec.example,
    ...(spec.asks ? { asks: spec.asks } : {}),
  }
}

/** A command's input, checked: the clean value, or why not, in words the model can act on (the allowed values named). */
export function checkInput(spec: CommandSpec, input: unknown): { ok: true; input: Record<string, unknown> } | { ok: false; why: string } {
  const result = spec.input.safeParse(input ?? {})
  return result.success ? { ok: true, input: result.data as Record<string, unknown> } : { ok: false, why: z.prettifyError(result.error) }
}
