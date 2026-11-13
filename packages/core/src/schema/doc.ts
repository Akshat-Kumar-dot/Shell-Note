// The document model. Every schema is defined once, here, in
// Zod: it gives the TypeScript types and the runtime checks. validate/shape.ts
// wraps these schemas to give errors with hints.
import { z } from 'zod'
import { isWellFormed } from '../util.js'

/**
 * Schema version written into every document. Each change ships a migration
 * (schema/migrate.ts). Version 2, 10 October 2026: text may hold underline,
 * subscript, superscript, and a size or font on words (markdown/inline.ts).
 * Version 3, 13 October 2026 (the pen, phase 3): a stroke may have a pen kind,
 * a colour code, five widths, tilt and a snapped shape, and a note its own
 * pen switches.
 */
export const SCHEMA_VERSION = 4

/**
 * The most blocks a note holds. Every block of a note is checked as it is opened, so a file with very many (a small
 * file can hold hundreds of thousands) would hold the app for seconds or minutes, on every device that looks at the
 * folder it lies in: a file with more is refused, and a note is never grown past what its own file may hold. A
 * note of a thousand full pages is far below it.
 */
export const MAX_BLOCKS = 50_000

/** Any text field. It must be valid UTF-16, because saved files are UTF-8. */
const Str = z.string().refine(isWellFormed, {
  error: 'contains a broken character (half of an emoji on its own).',
})

/**
 * Ids of blocks, pages and documents. Generated ids are 8 random characters
 * (ids.ts); hand-written fixtures use shorter ones. Starting with a letter or
 * digit also rules out special object keys such as `__proto__`.
 */
export const Id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/, {
  error: 'Ids are 1 to 32 letters, digits, - or _, starting with a letter or digit.',
})
export type Id = z.infer<typeof Id>

/** Content hash of an asset, in lowercase hex. */
export const Hash = z.string().regex(/^[0-9a-f]{4,64}$/, {
  error: 'Asset hashes are 4 to 64 lowercase hex characters.',
})
export type Hash = z.infer<typeof Hash>

/** A position, in units of 0.01 mm. Whole numbers only: no floats in a saved file. */
const Pos = z.int()
/** A width or height, in units of 0.01 mm. */
const Len = z.int().nonnegative()

/** The named colours: the ones the AI chooses from, and the theme maps to real colours (with dark mode). */
export const Color = z.enum(['ink', 'gray', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'])
export type Color = z.infer<typeof Color>

/** A colour a person picked, as #rrggbb in lowercase. It is shown as it is, also in dark mode. */
export const Hex = z.string().regex(/^#[0-9a-f]{6}$/, { error: 'A colour code is # and six lowercase hex digits, such as #e0563a.' })
/** A named colour, or a person's own colour code. */
export const AnyColor = z.union([Color, Hex])
export type AnyColor = z.infer<typeof AnyColor>

export const Role = z.enum(['p', 'h1', 'h2', 'h3', 'li', 'oli', 'todo', 'quote'])
export type Role = z.infer<typeof Role>

/**
 * A font style (sans, serif, mono, hand), or a font from the library bundled
 * with the app, by its id (fonts.ts). An id this app does not know is kept,
 * and drawn in sans, so a note from a newer app still opens.
 */
export const Font = z.union([
  z.enum(['sans', 'serif', 'mono', 'hand']),
  z.string().regex(/^[a-z][a-z0-9-]{1,39}$/, { error: 'A font is sans, serif, mono, hand, or a library font id such as lora.' }),
])

/** Style values are tokens from short lists. A theme maps them to real sizes and colours. */
export const Style = z.strictObject({
  size: z.enum(['s', 'm', 'l', 'xl']).optional(),
  color: AnyColor.optional(),
  font: Font.optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
})
export type Style = z.infer<typeof Style>

/** What a stroke was drawn with, besides the plain pen (version 3). The highlighter is drawn under ink, see-through. */
export const PenKind = z.enum(['pencil', 'fountain', 'marker', 'highlighter'])
export type PenKind = z.infer<typeof PenKind>

/** A stroke's width, as a token the pen kind turns into a size (version 3 adds xs and xl). */
export const StrokeWidth = z.enum(['xs', 's', 'm', 'l', 'xl'])
export type StrokeWidth = z.infer<typeof StrokeWidth>

/** The symbols corrected as the pen lifts (ink/symbols.ts): ( ) [ ] { } , and @. */
export const SymbolKind = z.enum(['paren', 'bracket', 'brace', 'comma', 'at'])
export type SymbolKind = z.infer<typeof SymbolKind>
/** The shapes a held stroke snaps to (ink/shapes.ts), and the symbols. */
export const ShapeKind = z.enum(['line', 'arrow', 'arc', 'curve', 'triangle', 'rect', 'square', 'rhombus', 'polygon', 'star', 'ellipse', 'circle', 'heart', 'cloud', 'bubble', ...SymbolKind.options])
export type ShapeKind = z.infer<typeof ShapeKind>

export const Stroke = z
  .strictObject({
    /** x, y, pressure, repeated. x and y are relative to the ink block; pressure is 0 to 255. */
    pts: z.custom<number[]>(isPointList, {
      error: 'pts holds x, y, pressure triples, whole numbers, with pressure from 0 to 255.',
    }),
    /** A named colour, or (version 3) a person's own colour code. */
    color: AnyColor,
    width: StrokeWidth,
    /** Missing: the plain pen. */
    tool: PenKind.optional(),
    /** For a pencil: how far the pen leant at each point, 0 (upright) to 90 degrees. */
    tilt: z.custom<number[]>((value) => Array.isArray(value) && value.every((v) => Number.isInteger(v) && v >= 0 && v <= 90), { error: 'tilt holds whole numbers from 0 to 90.' }).optional(),
    straight: z.literal(true).optional(),
    /** A stroke snapped to a shape keeps what it is and its key points, so it can be changed as that shape. */
    shape: z.strictObject({ kind: ShapeKind, key: z.array(z.int()) }).optional(),
    /**
     * Written beside a video: which of the note's videos (`media`) and where
     * it was, in tenths of a second, as the pen went down (`t`) and, when later, as it lifted (`e`), so a line shows
     * when it was written, from and to, and a tap goes back there.
     */
    vt: z
      .strictObject({ m: Id, t: z.int().nonnegative(), e: z.int().nonnegative().optional() })
      .refine((vt) => vt.e === undefined || vt.e > vt.t, { error: 'A stroke ends after it begins.' })
      .optional(),
    /**
     * Written beside another program (version 4, 25 October 2026): which of the note's programs
     * (`programs`), when (milliseconds since 1970), its place then, and a small picture's asset when its view had changed
     * since the last kept, so a tap goes back to the place, or shows the picture.
     */
    pm: z.strictObject({ m: Id, at: z.int().nonnegative(), place: z.lazy(() => Place).optional(), pic: z.lazy(() => Hash).optional() }).optional(),
  })
  .refine((stroke) => stroke.tilt === undefined || !Array.isArray(stroke.pts) || stroke.tilt.length * 3 === stroke.pts.length, {
    error: 'tilt holds one value for each point of pts.',
  })
export type Stroke = z.infer<typeof Stroke>

// Checked in one pass, without copying: an ink block can hold thousands of strokes, and Zod checking
// each number on its own made adding or opening one about ten times slower.
function isPointList(pts: unknown): boolean {
  if (!Array.isArray(pts) || pts.length === 0 || pts.length % 3 !== 0) return false
  for (let i = 0; i < pts.length; i++) {
    const value: unknown = pts[i]
    if (!Number.isSafeInteger(value)) return false
    if (i % 3 === 2 && ((value as number) < 0 || (value as number) > 255)) return false
  }
  return true
}

// Every block has an id and `r`, the `rev` of the transaction that last changed it.
const base = { id: Id, r: z.int().nonnegative() }
// A free block is placed on a page with a position and size.
const free = { page: Id, x: Pos, y: Pos, w: Len, h: Len }
// A child block sits in a frame. Its position is its index in the frame's `kids`.
const child = { parent: Id }

const mathContent = { tex: Str, value: Str.optional() }
/** alt: a plain description for screen readers and the AI. caption: shown under the picture, as inline Markdown. */
const imageContent = { asset: Hash, alt: Str.optional(), caption: Str.optional() }
const diagramContent = { lang: z.literal('mermaid'), src: Str }

const frame = z.strictObject({
  ...base,
  type: z.literal('frame'),
  ...free,
  kids: z.array(Id),
  next: Id.optional(),
})
const text = z
  .strictObject({
    ...base,
    type: z.literal('text'),
    ...child,
    role: Role,
    indent: z.int().min(0).max(8),
    md: Str,
    style: Style.optional(),
    /** A ticked to-do item. */
    done: z.literal(true).optional(),
  })
  .refine((block) => block.done === undefined || block.role === 'todo', {
    error: 'done is only for to-do items (role todo).',
  })
const mathFree = z.strictObject({ ...base, type: z.literal('math'), ...free, ...mathContent })
const mathChild = z.strictObject({ ...base, type: z.literal('math'), ...child, ...mathContent })
const imageFree = z.strictObject({ ...base, type: z.literal('image'), ...free, ...imageContent })
const imageChild = z.strictObject({ ...base, type: z.literal('image'), ...child, ...imageContent })
const diagramFree = z.strictObject({ ...base, type: z.literal('diagram'), ...free, ...diagramContent })
const diagramChild = z.strictObject({ ...base, type: z.literal('diagram'), ...child, ...diagramContent })
const ink = z.strictObject({
  ...base,
  type: z.literal('ink'),
  ...free,
  strokes: z.array(Stroke),
  text: Str.optional(),
})

/** One cell of a table: inline Markdown, like a text block's md, on one line. */
const Cell = Str.refine((cell) => !/[\r\n]/u.test(cell), { error: 'A table cell is one line: it holds no line breaks.' })
/** A table's cells, row by row. Every row has the same number of cells. */
const Rows = z
  .array(z.array(Cell).min(1, { error: 'A table row has at least one cell.' }))
  .min(1, { error: 'A table has at least one row.' })
  .refine((rows) => rows.every((row) => row.length === rows[0]!.length), { error: 'Every row of a table has the same number of cells.' })
/** How a table is drawn, besides the grid it has when this is missing (version 2). */
export const TableLook = z.enum(['lines', 'banded', 'header'])
export type TableLook = z.infer<typeof TableLook>
/** Shares are in thousandths: whole numbers, so a saved file holds no floats. */
const SHARES = 1000

/**
 * A table sits in a frame. head: the first row is a header. alt and caption
 * as on a picture. From version 2, a person may size and style it, as in Word.
 */
const table = z
  .strictObject({
    ...base,
    type: z.literal('table'),
    ...child,
    rows: Rows,
    head: z.literal(true).optional(),
    alt: Str.optional(),
    caption: Str.optional(),
    /** Each column's share of the table's width, in thousandths, adding up to 1000. Equal columns when missing. */
    cols: z.array(z.int().min(1)).optional(),
    /** The table's width as a share of its frame's, in thousandths, from 200 to 1000. The frame's whole width when missing. */
    width: z.int().min(200).max(SHARES).optional(),
    look: TableLook.optional(),
  })
  .refine((block) => block.cols === undefined || !Array.isArray(block.rows) || (block.cols.length === block.rows[0]?.length && block.cols.reduce((sum, share) => sum + share, 0) === SHARES), {
    error: 'cols holds one share for each column, in thousandths, adding up to 1000.',
  })

/**
 * Any block. Math, image and diagram blocks can be free or children, so they
 * have two variants each. (Zod's discriminated unions cannot hold those
 * pairs, so this is a plain union; validate/shape.ts picks the variant.)
 */
export const Block = z.union([
  frame,
  text,
  mathFree,
  mathChild,
  imageFree,
  imageChild,
  diagramFree,
  diagramChild,
  ink,
  table,
])
export type Block = z.infer<typeof Block>
export type BlockType = Block['type']
export type FreeBlock = Extract<Block, { page: string }>
export type ChildBlock = Extract<Block, { parent: string }>
export type Frame = z.infer<typeof frame>
export type TextBlock = z.infer<typeof text>
export type TableBlock = z.infer<typeof table>
export type InkBlock = z.infer<typeof ink>

/** The schema for each block type, by placement. A missing entry means "not allowed". */
export const BLOCK_SHAPES: Record<BlockType, { free?: z.ZodType; child?: z.ZodType }> = {
  frame: { free: frame },
  text: { child: text },
  math: { free: mathFree, child: mathChild },
  image: { free: imageFree, child: imageChild },
  diagram: { free: diagramFree, child: diagramChild },
  ink: { free: ink },
  table: { child: table },
}

export const Page = z.strictObject({
  id: Id,
  w: z.int().positive(),
  h: z.int().positive(),
  bg: z.enum(['blank', 'ruled', 'grid', 'dots']),
  /** Free blocks on this page, back to front. */
  free: z.array(Id),
})
export type Page = z.infer<typeof Page>

/** Metadata of an image. The bytes live outside the JSON, keyed by content hash. */
export const Asset = z.strictObject({
  mime: z.string().regex(/^[a-z]+\/[a-z0-9.+-]+$/, { error: 'mime must look like image/png.' }),
  w: z.int().positive().optional(),
  h: z.int().positive().optional(),
  bytes: z.int().nonnegative(),
})
export type Asset = z.infer<typeof Asset>

/**
 * The pen's switches: each person's
 * defaults are kept in their browser, and a note may override any of them;
 * the overrides travel with the note's file (`Doc.pen`).
 */
export const PenSettings = z.strictObject({
  /** Fingers never draw once a pen is seen (auto), never (always), or draw too (off). */
  penOnly: z.enum(['auto', 'always', 'off']),
  /** Straight lines, and arrows: by holding the pen still at the end, or also on their own as the pen lifts, when clearly one. */
  lines: z.enum(['off', 'hold', 'auto']),
  /** Shapes by holding the pen still at the end. */
  shapes: z.enum(['off', 'hold']),
  /** How much a stroke is smoothed. It never makes the ink late (ink/smooth.ts). */
  smoothing: z.int().min(0).max(3),
  /**
   * Tidy handwriting (stage 2;, 17 October 2026): off; only with the Tidy button (demand); each word as the
   * next one starts (word); and each line levelled as the next one starts too (line).
   */
  neaten: z.enum(['off', 'demand', 'word', 'line']),
  /**
   * Tidy: the line a finished line's words are put on: its first word's, the
   * one most of its words sit on, or its last word's.
   */
  anchor: z.enum(['first', 'most', 'last']),
  /**
   * Tidy: the gap a finished line's words are spaced to: the line's usual gap,
   * its first gap, a little tighter or wider than usual, or the gaps as written (only words written over each other
   * moved apart).
   */
  wordGap: z.enum(['usual', 'first', 'tighter', 'wider', 'written']),
  /** Handwriting to text: on demand, or live (only with a fast recogniser). */
  toText: z.enum(['off', 'demand', 'live']),
  /** A zigzag over strokes deletes them. */
  scratch: z.boolean(),
  /** A loop drawn and held becomes a lasso. */
  circleLasso: z.boolean(),
  /** The symbols corrected as the pen lifts; none, to correct none. */
  symbols: z.array(SymbolKind),
  /** How hard a press makes a line full width; off, an even width, as a mouse draws. */
  pressure: z.enum(['off', 'soft', 'normal', 'firm']),
})
export type PenSettings = z.infer<typeof PenSettings>

/** The switches a note sets for itself. */
export const PenOverrides = PenSettings.partial()
export type PenOverrides = z.infer<typeof PenOverrides>

/** A YouTube video's id: 11 letters, digits, - and _. */
const YouTubeId = z.string().regex(/^[A-Za-z0-9_-]{11}$/, { error: 'A YouTube video id is 11 letters, digits, - or _.' })
/** A crop of a video, in thousandths of its width and height from its top left. */
const Crop = z
  .strictObject({ x: z.int().min(0).max(999), y: z.int().min(0).max(999), w: z.int().min(1).max(1000), h: z.int().min(1).max(1000) })
  .refine((c) => c.x + c.w <= 1000 && c.y + c.h <= 1000, { error: 'A crop stays inside the video.' })

/**
 * A video's transcript: its lines, each from a time in tenths of a second, in
 * order; pasted by the person (from YouTube's own "Show transcript", or a subtitle file), kept with the note.
 */
export const Transcript = z
  .array(z.strictObject({ t: z.int().nonnegative(), text: Str }))
  .max(50_000)
  .refine((lines) => lines.every((line, i) => i === 0 || line.t >= lines[i - 1]!.t), { error: 'A transcript runs in time order.' })

/**
 * A program's place (version 4; stage 4 of other programs inside ShellNote): a slide of
 * PowerPoint (its stable id, and its number then), a page of a PDF, a browser's address, a file and line of VS Code.
 */
export const Place = z.union([
  z.strictObject({ slide: z.int().nonnegative(), n: z.int().positive(), deck: Str.optional() }),
  z.strictObject({ page: z.int().positive(), file: Str.optional() }),
  z.strictObject({ address: Str }),
  z.strictObject({ file: Str, line: z.int().positive().optional() }),
])
export type Place = z.infer<typeof Place>

/**
 * A video beside the note: a YouTube video, played in YouTube's own
 * player and never stored, or a video file of the person's own, kept with the note as an asset, which may be cropped.
 * Either may keep a transcript.
 */
export const Media = z.union([
  z.strictObject({ id: Id, kind: z.literal('youtube'), video: YouTubeId, title: Str.optional(), transcript: Transcript.optional() }),
  z.strictObject({ id: Id, kind: z.literal('file'), asset: Hash, name: Str.optional(), crop: Crop.optional(), transcript: Transcript.optional() }),
])
export type Media = z.infer<typeof Media>

/**
 * Another program written beside (version 4; stage 4 of other programs inside ShellNote): its file and title, and the
 * words of each place seen, each place once, as a video's transcript is kept. A list of its own beside the videos.
 */
export const ProgramSource = z.strictObject({
  id: Id,
  program: Str,
  title: Str.optional(),
  places: z.array(z.strictObject({ place: Place, words: Str })).max(10_000).optional(),
})
export type ProgramSource = z.infer<typeof ProgramSource>

/**
 * A part of a video marked in the note (yv1's ▶ marks): which video, from and to, in tenths of a second, and where it
 * sits, on which page, in the page's units.
 */
export const Clip = z
  .strictObject({ id: Id, media: Id, from: z.int().nonnegative(), to: z.int().nonnegative(), page: Id, x: z.int(), y: z.int(), note: Str.optional() })
  .refine((c) => c.to > c.from, { error: 'A clip ends after it starts.' })
export type Clip = z.infer<typeof Clip>

/** The whole document. Use validateDoc() to check one: it gives clearer errors. */
export const Doc = z.strictObject({
  v: z.literal(SCHEMA_VERSION),
  id: Id,
  title: Str,
  /** +1 for each applied transaction. */
  rev: z.int().nonnegative(),
  /** Page order. */
  pages: z.array(Id),
  page: z.record(Id, Page),
  /** Every block, flat: any block is one lookup away. */
  block: z.record(Id, Block),
  asset: z.record(Hash, Asset),
  /** The user's own notebook rules, one short line each. */
  rules: z.array(Str),
  /** The pen switches this note sets for itself (version 3). */
  pen: PenOverrides.optional(),
  /** The videos beside the note (version 3, 17 October 2026). */
  media: z.array(Media).optional(),
  /** Parts of those videos marked in the note. */
  clips: z.array(Clip).optional(),
  /** Other programs written beside (version 4). */
  programs: z.array(ProgramSource).max(1000).optional(),
})
export type Doc = z.infer<typeof Doc>

/** The document-level fields that `update` may set. */
export const DocFields = Doc.pick({ title: true, rules: true, pen: true, media: true, clips: true, programs: true })
