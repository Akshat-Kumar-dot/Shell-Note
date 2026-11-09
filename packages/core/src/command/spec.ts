// Commands (the person's plan for the agent, 19 October 2026:
//). A command is named area.verb and
// takes one object of named inputs, from one vocabulary shared by every
// command: a field means the same wherever it appears, so a model learns
// `colour` once. A command's spec is data: its name, what it does, how people
// ask for it, its inputs and an example. The app gives each its code; core
// keeps the specs, so the finder is tested with no browser.
import { z } from 'zod'
import { PLACES, SPANS } from '../note/place.js'
import { AnyColor, Font } from '../schema/doc.js'

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
  tool: z.enum(['type', 'select', 'free', 'pen', 'highlighter', 'eraser']).describe('A tool: type, select, free (the free cursor: type anywhere), pen, highlighter or eraser'),
  kind: z.enum(['pen', 'pencil', 'fountain', 'marker']).describe("The pen's kind: the plain pen, a pencil, a fountain pen or a marker"),
  colour: AnyColor.describe('A colour: ink (the usual near-black), gray, red, orange, yellow, green, blue or purple, or a code such as #e0563a'),
  width: z.enum(['extra-fine', 'fine', 'medium', 'broad', 'extra-broad']).describe('How wide a line is'),
  erase: z.enum(['whole', 'part']).describe('The eraser takes whole strokes, or only the part of a stroke it passes over'),
  size: z.enum(['small', 'medium', 'large']).describe('How big'),
  percent: z.int().min(25).max(400).describe('A zoom, in percent: 100 is actual size'),
  step: z.enum(['in', 'out', 'actual']).describe('Zoom one step in, one step out, or back to actual size'),
  page: z.int().min(1).describe('A page number, from 1'),
  on: z.boolean().describe('On (true) or off (false)'),
  panel: z.enum(['side', 'description', 'transcript', 'web', 'timer', 'output', 'ai']).describe('The side panel, or one of its tabs'),
  pane: z.enum(['notes', 'video', 'side']).describe('A panel of the workspace: the notes, the video, or the side panel'),
  bar: z.enum(['tools', 'format']).describe('A bar: tools (the tools) or format (the text formatting)'),
  place: z.enum(['top', 'bottom', 'left', 'right']).describe('Where a bar is docked'),
  by: z.enum(['edited', 'created']).describe('Sort by the date last edited, or created'),
  order: z.enum(['newest', 'oldest']).describe('Which come first'),
  look: z.enum(['system', 'light', 'dark']).describe("The app's appearance; system follows Windows"),
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
  to: z.union([z.enum(PLACES), z.int().min(1), name]).describe("Where it goes: a part of a page (top, bottom, left, right, middle, top left, top right, bottom left, bottom right), or for a page its new number"),
  beside: name.describe('The block a block goes beside: its id, $1, or words such as "the first paragraph"'),
  below: name.describe('The block a block goes below: its id, $1, or words such as "the table"'),
  span: z.enum(SPANS).describe("How wide a block is: half, a third or the full width of the page (a table's, of its column), or wider or narrower than now"),
  paper: z.enum(['blank', 'ruled', 'squares', 'dots']).describe("A page's paper: blank, ruled lines, squares or dots"),
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
