// The buttons the rows of tools can hold, the bar for typing's, the pen's row's and a board's: each one's name, its icon, and
// the group it sits with (a thin line is drawn where one group meets another). A row draws those the person keeps in
// it, in their order; its More holds the rest.
import type { BoardButton, Color, PenButton, TypingButton } from '@shellnote/core'
import {
  AlignLeft,
  ALargeSmall,
  Baseline,
  Bold,
  CircleDot,
  Code,
  Eraser,
  Hand,
  Highlighter,
  Image,
  Italic,
  Lasso,
  Link,
  ListChecks,
  Maximize,
  MousePointer2,
  Palette,
  PenLine,
  Pilcrow,
  RectangleHorizontal,
  Redo2,
  SquareDashedMousePointer,
  Strikethrough,
  Subscript,
  Superscript,
  Table2,
  Type,
  Underline,
  Undo2,
  WandSparkles,
  Workflow,
  type LucideIcon,
} from 'lucide-react'

export type ButtonGroup = 'history' | 'block' | 'words' | 'insert' | 'pointer'

export const TYPING_LOOK: Readonly<Record<TypingButton, { label: string; icon: LucideIcon; group: ButtonGroup }>> = {
  undo: { label: 'Undo', icon: Undo2, group: 'history' },
  redo: { label: 'Redo', icon: Redo2, group: 'history' },
  style: { label: 'Style', icon: Pilcrow, group: 'block' },
  font: { label: 'Font and size', icon: ALargeSmall, group: 'block' },
  bold: { label: 'Bold', icon: Bold, group: 'words' },
  italic: { label: 'Italic', icon: Italic, group: 'words' },
  underline: { label: 'Underline', icon: Underline, group: 'words' },
  colour: { label: 'Colour', icon: Baseline, group: 'words' },
  align: { label: 'Align', icon: AlignLeft, group: 'words' },
  link: { label: 'Link', icon: Link, group: 'insert' },
  picture: { label: 'Picture', icon: Image, group: 'insert' },
  table: { label: 'Table', icon: Table2, group: 'insert' },
  strike: { label: 'Strikethrough', icon: Strikethrough, group: 'words' },
  highlight: { label: 'Highlight', icon: Highlighter, group: 'words' },
  code: { label: 'Code', icon: Code, group: 'words' },
  sub: { label: 'Subscript', icon: Subscript, group: 'words' },
  sup: { label: 'Superscript', icon: Superscript, group: 'words' },
  todo: { label: 'To-do list', icon: ListChecks, group: 'words' },
  diagram: { label: 'Diagram', icon: Workflow, group: 'insert' },
  select: { label: 'Select with a box', icon: SquareDashedMousePointer, group: 'pointer' },
}

export type PenGroup = 'move' | 'ink' | 'colour' | 'history' | 'end'

/**
 * The pen's row's buttons. A colour in reach has its colour and no icon of its own: it is drawn as its dot. The pen
 * and Type are kept: they never leave the row.
 */
export const PEN_LOOK: Readonly<Record<PenButton, { label: string; icon: LucideIcon; group: PenGroup; colour?: Color; kept?: true }>> = {
  select: { label: 'Select', icon: Lasso, group: 'move' },
  hand: { label: 'Move the sheet', icon: Hand, group: 'move' },
  pen: { label: 'Pen', icon: PenLine, group: 'ink', kept: true },
  highlighter: { label: 'Highlighter', icon: Highlighter, group: 'ink' },
  eraser: { label: 'Eraser', icon: Eraser, group: 'ink' },
  black: { label: 'Black', icon: CircleDot, group: 'colour', colour: 'ink' },
  blue: { label: 'Blue', icon: CircleDot, group: 'colour', colour: 'blue' },
  red: { label: 'Red', icon: CircleDot, group: 'colour', colour: 'red' },
  green: { label: 'Green', icon: CircleDot, group: 'colour', colour: 'green' },
  grey: { label: 'Grey', icon: CircleDot, group: 'colour', colour: 'gray' },
  orange: { label: 'Orange', icon: CircleDot, group: 'colour', colour: 'orange' },
  yellow: { label: 'Yellow', icon: CircleDot, group: 'colour', colour: 'yellow' },
  purple: { label: 'Purple', icon: CircleDot, group: 'colour', colour: 'purple' },
  colour: { label: 'More colours', icon: Palette, group: 'colour' },
  width: { label: 'Width', icon: CircleDot, group: 'colour' },
  undo: { label: 'Undo', icon: Undo2, group: 'history' },
  redo: { label: 'Redo', icon: Redo2, group: 'history' },
  tidy: { label: 'Tidy handwriting', icon: WandSparkles, group: 'end' },
  type: { label: 'Type', icon: Type, group: 'end', kept: true },
  picture: { label: 'Picture', icon: Image, group: 'end' },
}

export type BoardGroup = 'move' | 'make' | 'ink' | 'history' | 'end'

/**
 * A board's row's buttons. Select is kept: a board opens with it. The pen, the eraser, the highlighter and a picture
 * come to a board later: until then their buttons show greyed, saying so.
 */
export const BOARD_LOOK: Readonly<Record<BoardButton, { label: string; icon: LucideIcon; group: BoardGroup; kept?: true; later?: true }>> = {
  select: { label: 'Select', icon: MousePointer2, group: 'move', kept: true },
  hand: { label: 'Move the board', icon: Hand, group: 'move' },
  step: { label: 'Step', icon: RectangleHorizontal, group: 'make' },
  text: { label: 'Text', icon: Type, group: 'make' },
  pen: { label: 'Pen', icon: PenLine, group: 'ink', later: true },
  eraser: { label: 'Eraser', icon: Eraser, group: 'ink', later: true },
  undo: { label: 'Undo', icon: Undo2, group: 'history' },
  redo: { label: 'Redo', icon: Redo2, group: 'history' },
  tidy: { label: 'Tidy the flowchart', icon: Workflow, group: 'end' },
  fit: { label: 'The whole board', icon: Maximize, group: 'end' },
  highlighter: { label: 'Highlighter', icon: Highlighter, group: 'ink', later: true },
  picture: { label: 'Picture', icon: Image, group: 'end', later: true },
}
