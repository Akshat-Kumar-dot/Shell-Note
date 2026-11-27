// The tools, the pens and undo, as commands (app control, step 2): each does
// exactly what its button did, and the buttons now call them. The command's
// words (a "fine" width, a "whole"-stroke eraser) map to the app's own here.
import type { AnyColor, NodeShape, StrokeWidth } from '@shellnote/core'
import { choosePen, penChoice, type EraserSize, type PenChoice } from '../ink/settings.js'
import type { EditorStore, Tool } from '../store.js'
import type { Commands, Places } from './run.js'

const WIDTHS: Record<string, StrokeWidth> = { 'extra-fine': 'xs', fine: 's', medium: 'm', broad: 'l', 'extra-broad': 'xl' }
const WIDTH_WORDS = Object.fromEntries(Object.entries(WIDTHS).map(([word, width]) => [width, word])) as Record<StrokeWidth, string>
const ERASER_SIZES: Record<string, EraserSize> = { small: 's', medium: 'm', large: 'l' }
const ERASER_WORDS = Object.fromEntries(Object.entries(ERASER_SIZES).map(([word, size]) => [size, word])) as Record<EraserSize, string>

/** Choose a tool. A box or ink is drawn over the page, not in the text, so they take the caret out of it. */
export function chooseTool(store: EditorStore, tool: Tool): void {
  if (tool !== 'type' && tool !== 'free' && typeof document !== 'undefined') (document.activeElement as HTMLElement | null)?.blur?.()
  store.setTool(tool)
}

/**
 * Why a tool cannot be taken up on a board, or undefined when it can: a board has no Type (Select chooses, free puts
 * a text box where it clicks), and the pen, the highlighter and the eraser come to boards later.
 */
function notOnBoard(store: EditorStore, tool: Tool): string | undefined {
  if (store.doc.kind !== 'board') return undefined
  if (tool === 'type') return 'A board has no Type tool: select chooses and moves what is on it, free puts a text box where it clicks, step draws steps and links.'
  if (tool === 'pen' || tool === 'highlighter' || tool === 'eraser') return `The ${tool} on a board comes later: for now draw steps with the Step tool (tool.choose tool=step), and words in a text box with free.`
  return undefined
}

/** A choice of the pen's, with only what was given. */
function change(parts: { [K in keyof PenChoice]?: PenChoice[K] | undefined }): Partial<PenChoice> {
  return Object.fromEntries(Object.entries(parts).filter(([, value]) => value !== undefined)) as Partial<PenChoice>
}

export function defineTools(commands: Commands): void {
  commands.define('tool.choose', ['note'], ({ tool, shape }, { note }) => {
    const board = note.store.doc.kind === 'board'
    // The Step tool draws a board's steps and links: a note of pages has none.
    if (tool === 'step' && !board) throw new Error('The Step tool is for a board: steps and links go on a board (note.new type=board). In a note of pages, a flowchart is a diagram (diagram: add).')
    if (shape !== undefined && tool !== 'step') throw new Error('shape= is the Step tool\'s: tool.choose tool=step shape=… chooses the shape its steps take.')
    const refused = notOnBoard(note.store, tool as Tool)
    if (refused) throw new Error(refused)
    if (shape !== undefined) note.store.setStepShape(shape as NodeShape)
    chooseTool(note.store, tool as Tool)
    if (tool === 'step') return `tool: step, drawing ${note.store.stepShape === 'box' ? 'boxes' : `${note.store.stepShape} steps`}`
    return `tool: ${String(tool)}${board && tool === 'free' ? ' (a text box where it clicks)' : ''}`
  })
  /** Refused on a board, for now, before anything changes. */
  const inkHere = (store: EditorStore, tool: Tool): void => {
    const refused = notOnBoard(store, tool)
    if (refused) throw new Error(refused)
  }
  commands.define('pen.set', ['note'], ({ kind, colour, width }, { note }) => {
    inkHere(note.store, 'pen')
    choosePen(change({ kind: kind as PenChoice['kind'] | undefined, color: colour as AnyColor | undefined, width: width === undefined ? undefined : WIDTHS[width as string] }))
    chooseTool(note.store, 'pen')
    return `pen: ${penLine()}`
  })
  commands.define('highlighter.set', ['note'], ({ colour, width }, { note }) => {
    inkHere(note.store, 'highlighter')
    choosePen(change({ highlighterColor: colour as AnyColor | undefined, highlighterWidth: width === undefined ? undefined : WIDTHS[width as string] }))
    chooseTool(note.store, 'highlighter')
    return `highlighter: ${highlighterLine()}`
  })
  commands.define('eraser.set', ['note'], ({ erase, size }, { note }) => {
    inkHere(note.store, 'eraser')
    choosePen(change({ eraser: erase === undefined ? undefined : erase === 'whole' ? 'stroke' : 'part', eraserSize: size === undefined ? undefined : ERASER_SIZES[size as string] }))
    chooseTool(note.store, 'eraser')
    return `eraser: ${eraserLine()}`
  })
  // Read-only here (another window edits the note): undo and redo change it, so they refuse, as Ctrl+Z is off then.
  const editable = (places: Places): void => {
    if (places.workspace && !places.workspace.editing()) throw new Error('This note is read-only here: it is being edited in another window.')
  }
  commands.define('edit.undo', ['note'], (_, places) => {
    editable(places)
    if (!places.note.store.canUndo) return 'nothing to undo'
    places.note.store.undo()
    return 'undone'
  })
  commands.define('edit.redo', ['note'], (_, places) => {
    editable(places)
    if (!places.note.store.canRedo) return 'nothing to redo'
    places.note.store.redo()
    return 'redone'
  })
}

/** A width as the commands say it: "fine" for s. */
export const widthWord = (width: StrokeWidth): string => WIDTH_WORDS[width]
/** An eraser size as the commands say it: "small" for s. */
export const eraserWord = (size: EraserSize): string => ERASER_WORDS[size]

const penLine = (): string => {
  const choice = penChoice.value
  return `${choice.kind}, ${WIDTH_WORDS[choice.width]}, ${choice.color}`
}
const highlighterLine = (): string => `${WIDTH_WORDS[penChoice.value.highlighterWidth]}, ${penChoice.value.highlighterColor}`
const eraserLine = (): string => `${penChoice.value.eraser === 'stroke' ? 'whole' : 'part'} strokes, ${ERASER_WORDS[penChoice.value.eraserSize]}`

/** The tools' line of the app-state map: the tool in use, and how each pen is set. */
export function toolsLine(store: EditorStore | undefined): string | undefined {
  if (!store) return undefined
  const tool = store.tool === 'step' ? `step (${store.stepShape})` : store.tool
  return `tool ${tool} · pen ${penLine()} · highlighter ${highlighterLine()} · eraser ${eraserLine()} · undo ${store.canUndo ? 'yes' : 'no'}, redo ${store.canRedo ? 'yes' : 'no'}`
}
