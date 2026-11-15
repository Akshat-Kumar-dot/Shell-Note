// The buttons the bar for typing can hold: each one's name, its icon, and the group it sits with (a thin line is drawn
// where one group meets another). The bar draws those the person keeps in it, in their order; More holds the rest.
import type { TypingButton } from '@shellnote/core'
import {
  AlignLeft,
  ALargeSmall,
  Baseline,
  Bold,
  Code,
  Highlighter,
  Image,
  Italic,
  Link,
  ListChecks,
  Pilcrow,
  Redo2,
  SquareDashedMousePointer,
  Strikethrough,
  Subscript,
  Superscript,
  Table2,
  Underline,
  Undo2,
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
