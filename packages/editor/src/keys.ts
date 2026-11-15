// The app's keys, in one list: Settings shows it (General), and the buttons' hints read their keys from it. A key
// that changes here changes in both. On a Mac, ⌘ stands for Ctrl.
import type { WordMarks } from './format.js'

/** The keys of the word marks, as the bar's buttons and the editor's marks have them. */
export const MARK_KEY: Readonly<Record<keyof WordMarks, string>> = {
  bold: 'Ctrl+B',
  italic: 'Ctrl+I',
  underline: 'Ctrl+U',
  strike: 'Ctrl+Shift+X',
  highlight: 'Ctrl+Shift+H',
  code: 'Ctrl+E',
  sub: 'Ctrl+=',
  sup: 'Ctrl+Shift+=',
}

export const UNDO_KEY = 'Ctrl+Z'
export const REDO_KEY = 'Ctrl+Y'

export interface KeyLine {
  readonly keys: string
  readonly does: string
}
export interface KeyGroup {
  readonly name: string
  readonly keys: readonly KeyLine[]
}

const MARK_WORDS: [keyof WordMarks, string][] = [
  ['bold', 'Bold'],
  ['italic', 'Italic'],
  ['underline', 'Underline'],
  ['strike', 'Strikethrough'],
  ['highlight', 'Highlight'],
  ['code', 'Code'],
  ['sub', 'Subscript'],
  ['sup', 'Superscript'],
]

export const KEYS: readonly KeyGroup[] = [
  {
    name: 'Anywhere',
    keys: [
      { keys: 'Ctrl+O', does: 'Open a .shellnote file into the library' },
      { keys: 'Ctrl+Shift+P', does: 'The terminal: type a command, or ask the model' },
    ],
  },
  {
    name: 'In a note',
    keys: [
      { keys: UNDO_KEY, does: 'Undo' },
      { keys: `${REDO_KEY} or Ctrl+Shift+Z`, does: 'Redo' },
      { keys: 'Ctrl+S', does: "Save the note to its file" },
      { keys: 'Ctrl+Shift+S', does: 'Save the note to a new file' },
      { keys: 'Ctrl+K', does: 'The AI box, on what is chosen' },
      { keys: 'Ctrl+Shift+Space', does: 'Show or hide the video' },
      { keys: 'Ctrl+mouse wheel', does: 'Zoom in or out' },
      { keys: 'Delete', does: 'Remove what a Select box has chosen' },
      { keys: 'Escape', does: 'Let go of a Select box, or put a menu away' },
    ],
  },
  {
    name: 'Words',
    keys: [...MARK_WORDS.map(([mark, does]) => ({ keys: MARK_KEY[mark], does })), { keys: 'Tab', does: 'Indent more' }, { keys: 'Shift+Tab', does: 'Indent less' }],
  },
  {
    name: 'The terminal',
    keys: [
      { keys: 'Enter', does: 'Run the line' },
      { keys: 'Ctrl+Enter', does: 'Ask the model' },
      { keys: 'Escape', does: 'Close the terminal' },
    ],
  },
]
