// The note's row of tools, under the tabs: one slim row for words, or the pen's row while an ink tool is in hand
// (ink/PenBar.tsx); both, one under the other, for whoever chooses so. The row for words holds the buttons the person
// keeps in it, in their order (layout/custom.ts; as it starts: undo and redo, the block's style, the font and size,
// bold, italic and underline, the colour, alignment and indent, a link, a picture, a table), and More, which holds
// the rest, each one click away. Every button goes through core (format.ts), and none takes the focus, so the caret
// and selection stay put. In a caption or a table's cell, the word marks act through the editor, which hands its
// changes to core like any typing; so do the table's row and column buttons. Under a Select box, the word marks and
// colours act on each piece of text the box holds. The row is never locked: with nothing selected, a change goes to
// the caret's word, or where the caret last was (target.ts).
import { libraryFont, type AnyColor, type Color, type Id, type Op, type Role, type Size, type TypingButton } from '@shellnote/core'
import {
  ALargeSmall,
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Code,
  Ellipsis,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Image,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  MessageSquareText,
  PenLine,
  Pilcrow,
  Quote,
  Redo2,
  Rows2,
  Table2,
  Undo2,
  Workflow,
  SquareCheck,
  SquareDashedMousePointer,
  Strikethrough,
  Subscript,
  Superscript,
  TextCursorInput,
  Type,
  Underline,
  type LucideIcon,
} from 'lucide-react'
import { Fragment, useReducer, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { BarMenu, keepFocus, MenuItem } from './BarMenu.js'
import { RedoButton, UndoButton, usePictures } from './BarParts.js'
import { activeEditor } from './frame/active.js'
import { onWords } from './frame/words.js'
import { FontLibrary } from './FontLibrary.js'
import { fontFamily, myFonts, saveMyFonts } from './fonts.js'
import { ColourMenu } from './ColourMenu.js'
import { commands } from './commands/index.js'
import { colourOps, firstText, fontOps, marksOver, sizeOps, styleOps, styleOver, wordOps, type BlockChange, type WordMarks } from './format.js'
import { typingBar, underMore } from './layout/custom.js'
import { bothRows, showBothRows } from './layout/rows.js'
import { MARK_KEY, REDO_KEY, UNDO_KEY } from './keys.js'
import { NAMED_HEX } from './palette.js'
import { safeHref } from './links.js'
import { paperOps, PAPERS, type Paper } from './paper.js'
import { caretSpot, lastCaretSpot } from './pictures.js'
import type { EditorStore, Tool } from './store.js'
import { TableGrid, TablePicker } from './TablePicker.js'
import { TYPING_LOOK } from './typingButtons.js'
import { addTable, enterTable, newTable } from './tables.js'
import { aimAt } from './target.js'
import { TableTools } from './TableTools.js'
import { PenBar } from './ink/PenBar.js'
import { isInkTool } from './ink/PenLayer.js'

/** The block's styles; a line is drawn before the lists. */
const ROLES: [Role, string, LucideIcon][] = [
  ['p', 'Paragraph', Pilcrow],
  ['h1', 'Heading 1', Heading1],
  ['h2', 'Heading 2', Heading2],
  ['h3', 'Heading 3', Heading3],
  ['li', 'Bullet list', List],
  ['oli', 'Numbered list', ListOrdered],
  ['todo', 'To-do list', ListChecks],
  ['quote', 'Quote', Quote],
]
const SIZES = [
  ['s', 'Small', 'Small'],
  ['m', 'Normal', 'Normal size'],
  ['l', 'Large', 'Large'],
  ['xl', 'Extra', 'Extra large'],
] as const
const FONTS = [
  ['sans', 'Sans'],
  ['serif', 'Serif'],
  ['mono', 'Mono'],
  ['hand', 'Handwriting'],
] as const
const ALIGNS: ['left' | 'center' | 'right', string, LucideIcon][] = [
  ['left', 'Align left', AlignLeft],
  ['center', 'Centre', AlignCenter],
  ['right', 'Align right', AlignRight],
]
/** Word marks: our name, Tiptap's, the label, the shortcut (keys.ts) and the icon. Each is a button of the bar for typing, in it or under More. */
const MARKS: [keyof WordMarks, string, string, string, LucideIcon][] = [
  ['bold', 'bold', 'Bold', MARK_KEY.bold, Bold],
  ['italic', 'italic', 'Italic', MARK_KEY.italic, Italic],
  ['underline', 'underline', 'Underline', MARK_KEY.underline, Underline],
  ['strike', 'strike', 'Strikethrough', MARK_KEY.strike, Strikethrough],
  ['highlight', 'highlight', 'Highlight', MARK_KEY.highlight, Highlighter],
  ['code', 'code', 'Code', MARK_KEY.code, Code],
  ['sub', 'subscript', 'Subscript', MARK_KEY.sub, Subscript],
  ['sup', 'superscript', 'Superscript', MARK_KEY.sup, Superscript],
]

/** The buttons for a block of text, left out while a picture or a table is chosen. */
const FOR_TEXT: ReadonlySet<TypingButton> = new Set(['style', 'font', 'align'])

/** The note's colours, as More shows them when Colour is not in the bar. */
const SWATCHES: [Color, string][] = [
  ['ink', 'Automatic'],
  ['gray', 'Grey'],
  ['red', 'Red'],
  ['orange', 'Orange'],
  ['yellow', 'Yellow'],
  ['green', 'Green'],
  ['blue', 'Blue'],
  ['purple', 'Purple'],
]

/** The flowchart More's Diagram starts with, to be changed as the person likes. */
const STARTER_DIAGRAM = 'flowchart TD\n  A[Start] --> B[Next step]'

/** What a press on the page does, while words are in hand: under More. */
const POINTERS: [Tool, string, string, LucideIcon][] = [
  ['type', 'Type', 'Type: click in text to write; a click on empty paper chooses nothing', Type],
  ['free', 'Free cursor', 'Free cursor: click anywhere on the paper to start writing there', TextCursorInput],
  ['select', 'Select', 'Select: draw a box to take only what is inside it', SquareDashedMousePointer],
]

const ICON = 18
const ARROW = 14

/** Apply operations as one undo step; a change that does not fit the selection is left out. */
function runner(store: EditorStore) {
  return (ops: Op[], key?: string): void => {
    if (ops.length === 0) return
    try {
      store.apply(ops, { origin: 'toolbar', ...(key === undefined ? {} : { key }) })
    } catch (error) {
      console.warn('shellnote: that change does not fit the selection', error)
    }
  }
}

/**
 * The note's tools: the row of what is in hand. A click in the text, or Type, brings the row for words; the pen, the
 * highlighter or the eraser brings the pen's. With both rows chosen (More), the two show together.
 */
export function NoteBar({ store }: { store: EditorStore }) {
  const tool = useSyncExternalStore(store.subscribeTool, store.toolSnapshot)
  const both = useSyncExternalStore(bothRows.subscribe, bothRows.snapshot)
  // The Hand is the pen's row's: with it in hand, that row stays.
  const ink = isInkTool(tool) || tool === 'hand'
  return (
    <div className="sh-rows" data-both={both ? '' : undefined}>
      {both || !ink ? <TextRow store={store} /> : null}
      {both || ink ? <PenBar store={store} /> : null}
    </div>
  )
}

/**
 * What a picture or a table shows, for whoever cannot see it: a field at the row's end while one is chosen. Down a side,
 * where a field hangs off both edges of the strip, a button with the field in a small menu. CSS shows one or the other.
 */
function DescribeField({ kind, value, onChange }: { kind: 'picture' | 'table'; value: string; onChange: (value: string) => void }) {
  const field = (
    <label className="nw-describe">
      <span>Description</span>
      <input type="text" aria-label="Description" placeholder={`What the ${kind} shows (not on the page)`} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
  return (
    <>
      <span className="nw-describe-along">{field}</span>
      <span className="nw-describe-down">
        <BarMenu label="Description" title={`What the ${kind} shows (not on the page)`} button={<MessageSquareText size={ICON} aria-hidden />}>
          {() => field}
        </BarMenu>
      </span>
    </>
  )
}

function TextRow({ store }: { store: EditorStore }) {
  const doc = useSyncExternalStore(store.subscribe, store.snapshot)
  const selection = useSyncExternalStore(store.subscribeSelection, store.selectionSnapshot)
  const tool = useSyncExternalStore(store.subscribeTool, store.toolSnapshot)
  const both = useSyncExternalStore(bothRows.subscribe, bothRows.snapshot)
  const bar = useSyncExternalStore(typingBar.subscribe, typingBar.snapshot)
  const pictures = usePictures(store)
  // The marks in captions and cells, and the Table button, need to know which editor has the focus.
  useSyncExternalStore(activeEditor.subscribe, activeEditor.snapshot)
  // Marks switched on for the next words typed change no document, so ask for a redraw.
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  const typing = activeEditor.get()?.isFocused === true && activeEditor.frame() !== undefined

  // Where a change goes, and what the row shows (target.ts): what is selected, else the caret's word, else where the caret last was.
  const shown = aimAt(store)
  const block = firstText(doc, { blocks: shown.blocks })
  const words = shown.pieces.length > 0
  const marks = marksOver(doc, shown.pieces)
  const chosen = selection.blocks.length === 1 ? doc.block[selection.blocks[0]!] : undefined
  const picture = chosen?.type === 'image' || chosen?.type === 'table' ? chosen : undefined
  const table = chosen?.type === 'table' ? chosen : undefined
  const [fonts, setFonts] = useState(myFonts)
  const [library, setLibrary] = useState(false)
  const [everyPage, setEveryPage] = useState(true)
  // The size and font of the words a change goes to: their own, or their line's; for the words typed next, the editor's.
  const lineSize = block?.style?.size ?? 'm'
  const lineFont = block?.style?.font ?? 'sans'
  const size = words ? (styleOver(doc, shown.pieces, 'size') ?? '') : ((shown.editor?.getAttributes('wordSize').size as string | undefined) ?? lineSize)
  const font = words ? (styleOver(doc, shown.pieces, 'font') ?? lineFont) : ((shown.editor?.getAttributes('wordFont').font as string | undefined) ?? lineFont)
  // The same for colour: undefined for words of several colours.
  const colour = (words ? styleOver(doc, shown.pieces, 'color') : ((shown.editor?.getAttributes('colour').color as string | undefined) ?? block?.style?.color ?? 'ink')) as AnyColor | undefined
  // The fonts in the menu, and the words' library font even when it is not one of them.
  const menuFonts = libraryFont(font) && !fonts.includes(font) ? [...fonts, font] : fonts
  const role = block?.role ?? 'p'
  const RoleIcon = ROLES.find(([value]) => value === role)?.[2] ?? Pilcrow
  const align = block?.style?.align ?? 'left'
  const AlignNow = ALIGNS.find(([value]) => value === align)?.[2] ?? AlignLeft

  const run = runner(store)
  const style = (change: BlockChange): void => run(styleOps(store.doc, { blocks: aimAt(store).blocks }, change))
  /**
   * A size or font for words: the selected ones or the
   * caret's word, a whole line's when all its words are chosen; else the words
   * typed next, or a caption's or cell's, through the editor.
   */
  const wordStyle = (key: 'size' | 'font', value: string): void => {
    const aim = aimAt(store)
    if (aim.pieces.length > 0) run(key === 'size' ? sizeOps(store.doc, aim.pieces, value as Size) : fontOps(store.doc, aim.pieces, value))
    else if (aim.editor) {
      const mark = key === 'size' ? 'wordSize' : 'wordFont'
      const line = firstText(store.doc, { blocks: aim.blocks })?.style?.[key] ?? (key === 'size' ? 'm' : 'sans')
      if (value === line) onWords(aim.editor, (chain) => chain.unsetMark(mark))
      else onWords(aim.editor, (chain) => chain.setMark(mark, { [key]: value }))
    }
    redraw()
  }
  /**
   * Colour words: the selected ones, the caret's word, or else the words
   * typed next. In a caption, a table's cell or a selection across lines,
   * the editor colours them and hands the change to core like any typing.
   */
  const paint = (color: AnyColor): void => {
    const aim = aimAt(store)
    if (aim.pieces.length > 0) run(colourOps(store.doc, aim.pieces, color))
    else if (aim.editor) onWords(aim.editor, (chain) => (color === 'ink' ? chain.unsetMark('colour') : chain.setMark('colour', { color })), false)
    redraw()
  }
  /** Back to the text after a menu or a prompt; not while blocks or a Select box are chosen, which the text's caret would let go. */
  const refocus = (): void => {
    if (store.selectionKind !== 'objects') activeEditor.get()?.commands.focus()
  }
  const mark = (name: keyof WordMarks, tiptap: string): void => {
    const aim = aimAt(store)
    if (aim.pieces.length > 0) run(wordOps(store.doc, aim.pieces, { [name]: !marksOver(store.doc, aim.pieces)[name] }))
    else if (aim.editor) onWords(aim.editor, (chain) => chain.toggleMark(tiptap))
    redraw()
  }
  const markOn = (name: keyof WordMarks, tiptap: string): boolean => (words ? marks[name] : (shown.editor?.isActive(tiptap) ?? false))
  /** Link the selected words, or the caret's word; between words, the address goes in as a linked word. */
  const link = (): void => {
    const aim = aimAt(store)
    const href = safeHref(window.prompt('Link the selected words to (https://…)', 'https://') ?? '')
    if (href !== undefined) {
      if (aim.pieces.length > 0) run(wordOps(store.doc, aim.pieces, { link: true }, href))
      else if (aim.editor && !aim.editor.state.selection.empty) onWords(aim.editor, (chain) => chain.setMark('link', { href }))
      else aim.editor?.chain().focus().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run()
    }
    refocus()
  }
  /** A picture's or table's description: plain words for screen readers and the AI, not shown on the page. */
  const describe = (id: Id, alt: string): void => {
    const now = store.doc.block[id]
    if ((now?.type === 'image' || now?.type === 'table') && (now.alt ?? '') !== alt) run([{ op: 'update', id, set: { alt: alt === '' ? null : alt } }], `alt:${id}`)
  }
  /** A table of the size picked on the grid, at the caret, or where it last was, with the caret in its first cell. */
  const insertTable = (rows: number, columns: number): void => {
    const at = caretSpot(store) ?? lastCaretSpot(store)
    const id = at && addTable(store, at.frame, at.at, newTable(rows, columns))
    const now = activeEditor.get()
    if (id !== undefined && now) enterTable(now, id)
  }
  /** The paper of the page in view, or of every page: blank, lines, squares or dots. */
  const inView = store.pageInView !== undefined && doc.page[store.pageInView] ? store.pageInView : doc.pages[0]!
  const paperNow = doc.page[inView]?.bg ?? 'blank'
  const paper = (kind: Paper): void => run(paperOps(store.doc, everyPage ? store.doc.pages : [inView], kind))

  // A table or a picture chosen: its own tools take the place of those for text blocks, which do not apply to it.
  const textTools = picture === undefined
  // The buttons the person keeps in the bar, in their order; More holds the rest, in the order they are offered.
  const inTheBar = bar.filter((button) => textTools || !FOR_TEXT.has(button))
  const inTheMore = underMore(bar).filter((button) => textTools || !FOR_TEXT.has(button))
  // Select with a box is a button of its own when it is in the bar; under More it stays with the other ways a press on the page goes.
  const pointers = POINTERS.filter(([value]) => value !== 'select' || !bar.includes('select'))
  const canTable = typing || lastCaretSpot(store) !== undefined
  const markOf = (button: TypingButton) => MARKS.find(([name]) => name === button)
  const addDiagram = (): void => void commands.press('diagram.add', { words: STARTER_DIAGRAM, ...(block ? { after: block.id } : { at: 'end' }) })
  const toggleTodo = (): void => style({ role: role === 'todo' ? 'p' : 'todo' })

  /** A button in the bar. */
  const inBar = (button: TypingButton): ReactNode => {
    const found = markOf(button)
    if (found) {
      const [name, tiptap, label, keys, Icon] = found
      return (
        <button type="button" className="sh-b" aria-label={label} title={`${label} (${keys})`} aria-pressed={markOn(name, tiptap)} onMouseDown={keepFocus} onClick={() => mark(name, tiptap)}>
          <Icon size={ICON} aria-hidden />
        </button>
      )
    }
    switch (button) {
      case 'undo':
        return <UndoButton store={store} />
      case 'redo':
        return <RedoButton store={store} />
      case 'style':
        return (
          <BarMenu
            label="Style"
            title="Paragraph, headings, lists"
            className="sh-b sh-word"
            onDone={refocus}
            button={
              <>
                <RoleIcon className="sh-word-sign" size={ICON} aria-hidden />
                <span className="sh-word-text">{ROLES.find(([value]) => value === role)?.[1] ?? 'Paragraph'}</span>
                <ChevronDown size={ARROW} aria-hidden />
              </>
            }
          >
            {(close) => styleChoices(close)}
          </BarMenu>
        )
      case 'font':
        return (
          <BarMenu
            label="Font and size"
            width={236}
            onDone={refocus}
            button={
              <>
                <ALargeSmall size={ICON} aria-hidden />
                <ChevronDown size={ARROW} aria-hidden />
              </>
            }
          >
            {(close) => fontChoices(close)}
          </BarMenu>
        )
      case 'colour':
        return <ColourMenu current={colour} onNamed={(color) => paint(color)} onCode={(code) => paint(code as AnyColor)} onDone={refocus} look="letter" />
      case 'align':
        return (
          <BarMenu
            label="Align and indent"
            button={
              <>
                <AlignNow size={ICON} aria-hidden />
                <ChevronDown size={ARROW} aria-hidden />
              </>
            }
          >
            {() => alignChoices()}
          </BarMenu>
        )
      case 'link':
        return (
          <button type="button" className="sh-b" aria-label="Link" title="Link the selected words" onMouseDown={keepFocus} onClick={link}>
            <Link size={ICON} aria-hidden />
          </button>
        )
      case 'picture':
        return (
          <button type="button" className="sh-b" aria-label="Picture" title="Add a picture: at the caret, or on the page" onMouseDown={keepFocus} onClick={pictures.choose}>
            <Image size={ICON} aria-hidden />
          </button>
        )
      case 'table':
        return <TablePicker disabled={!canTable} onPick={insertTable} />
      case 'todo':
        return (
          <button type="button" className="sh-b" aria-label="To-do list" title="A to-do: the line with a box to tick" aria-pressed={role === 'todo'} onMouseDown={keepFocus} onClick={toggleTodo}>
            <ListChecks size={ICON} aria-hidden />
          </button>
        )
      case 'diagram':
        return (
          <button type="button" className="sh-b" aria-label="Diagram" title="A flowchart under the line the caret is on, to change as you like (Mermaid)" onMouseDown={keepFocus} onClick={addDiagram}>
            <Workflow size={ICON} aria-hidden />
          </button>
        )
      case 'select':
        return (
          <button
            type="button"
            className="sh-b"
            aria-label="Select with a box"
            title="Select: draw a box to take only what is inside it"
            aria-pressed={tool === 'select'}
            data-command="tool.choose"
            onMouseDown={keepFocus}
            onClick={() => void commands.do('tool.choose', { tool: tool === 'select' ? 'type' : 'select' })}
          >
            <SquareDashedMousePointer size={ICON} aria-hidden />
          </button>
        )
      default:
        return null
    }
  }

  /** A button under More: a line to choose, or a menu's choices under its name. */
  const inMore = (button: TypingButton, close: () => void): ReactNode => {
    const found = markOf(button)
    if (found) {
      const [name, tiptap, label, keys, Icon] = found
      return (
        <MenuItem label={label} title={`${label} (${keys})`} kind="checkbox" checked={markOn(name, tiptap)} onChoose={() => mark(name, tiptap)}>
          <Icon size={ICON} aria-hidden />
          {label}
          <kbd>{keys}</kbd>
        </MenuItem>
      )
    }
    switch (button) {
      case 'undo':
        return (
          <MenuItem label="Undo" disabled={!store.canUndo} command="edit.undo" onChoose={() => void commands.do('edit.undo')}>
            <Undo2 size={ICON} aria-hidden />
            Undo<kbd>{UNDO_KEY}</kbd>
          </MenuItem>
        )
      case 'redo':
        return (
          <MenuItem label="Redo" disabled={!store.canRedo} command="edit.redo" onChoose={() => void commands.do('edit.redo')}>
            <Redo2 size={ICON} aria-hidden />
            Redo<kbd>{REDO_KEY}</kbd>
          </MenuItem>
        )
      case 'style':
        return (
          <>
            <div className="sh-menu-head">Style</div>
            {styleChoices(close)}
          </>
        )
      case 'font':
        return fontChoices(close)
      case 'colour':
        return (
          <>
            <div className="sh-menu-head">Colour</div>
            <div className="sh-swatches" role="radiogroup" aria-label="Colour">
              {SWATCHES.map(([name, label]) => (
                <button
                  key={name}
                  type="button"
                  role="radio"
                  className="sh-swatch"
                  aria-label={label}
                  title={label}
                  aria-checked={colour === name}
                  style={{ '--swatch': name === 'ink' ? 'var(--sh-text)' : NAMED_HEX[name] } as CSSProperties}
                  onMouseDown={keepFocus}
                  onClick={() => {
                    paint(name)
                    close()
                  }}
                />
              ))}
            </div>
          </>
        )
      case 'align':
        return (
          <>
            <div className="sh-menu-head">Align</div>
            {alignChoices()}
          </>
        )
      case 'link':
        return (
          <MenuItem
            label="Link"
            title="Link the selected words"
            onChoose={() => {
              close()
              link()
            }}
          >
            <Link size={ICON} aria-hidden />
            Link…
          </MenuItem>
        )
      case 'picture':
        return (
          <MenuItem
            label="Picture"
            title="Add a picture: at the caret, or on the page"
            onChoose={() => {
              close()
              pictures.choose()
            }}
          >
            <Image size={ICON} aria-hidden />
            Picture…
          </MenuItem>
        )
      case 'table':
        return canTable ? (
          <>
            <div className="sh-menu-head">Table</div>
            <div className="sh-menu-grid" role="group" aria-label="Table size">
              <TableGrid
                onPick={(rows, columns) => {
                  close()
                  insertTable(rows, columns)
                }}
              />
            </div>
          </>
        ) : (
          <MenuItem label="Table" title="Put the caret in the text first" disabled onChoose={() => undefined}>
            <Table2 size={ICON} aria-hidden />
            Table
          </MenuItem>
        )
      case 'todo':
        return (
          <MenuItem kind="checkbox" label="To-do list" checked={role === 'todo'} onChoose={toggleTodo}>
            <ListChecks size={ICON} aria-hidden />
            To-do list
          </MenuItem>
        )
      case 'diagram':
        return (
          <MenuItem
            label="Diagram"
            title="A flowchart under the line the caret is on, to change as you like (Mermaid)"
            onChoose={() => {
              close()
              addDiagram()
            }}
          >
            <Workflow size={ICON} aria-hidden />
            Diagram
          </MenuItem>
        )
      default:
        return null
    }
  }

  /** The block's styles, in the Style menu or under More. */
  function styleChoices(close: () => void): ReactNode {
    return ROLES.map(([value, label, Icon]) => (
      <span key={value} style={{ display: 'contents' }}>
        {value === 'li' ? <hr /> : null}
        <MenuItem
          checked={role === value}
          onChoose={() => {
            style({ role: value })
            close()
          }}
        >
          <Icon size={ICON} aria-hidden />
          {label}
        </MenuItem>
      </span>
    ))
  }

  /** The size and the font, in their menu or under More. */
  function fontChoices(close: () => void): ReactNode {
    return (
      <>
        <div className="sh-menu-head">Size</div>
        <div className="sh-seg" role="radiogroup" aria-label="Size">
          {SIZES.map(([value, short, label]) => (
            <button key={value} type="button" role="radio" aria-label={label} title={label} aria-checked={size === value} onMouseDown={keepFocus} onClick={() => wordStyle('size', value)}>
              {short}
            </button>
          ))}
        </div>
        <div className="sh-menu-head">Font</div>
        {FONTS.map(([value, label]) => (
          <MenuItem
            key={value}
            checked={font === value}
            onChoose={() => {
              wordStyle('font', value)
              close()
            }}
          >
            <span style={{ fontFamily: fontFamily(value) }}>{label}</span>
          </MenuItem>
        ))}
        {menuFonts.map((id) => (
          <MenuItem
            key={id}
            checked={font === id}
            onChoose={() => {
              wordStyle('font', id)
              close()
            }}
          >
            <span style={{ fontFamily: fontFamily(id) }}>{libraryFont(id)!.name}</span>
          </MenuItem>
        ))}
        <hr />
        <MenuItem
          onChoose={() => {
            setLibrary(true)
            close()
          }}
        >
          More fonts…
        </MenuItem>
      </>
    )
  }

  /** The alignments and the indent, in their menu or under More. */
  function alignChoices(): ReactNode {
    return (
      <>
        {ALIGNS.map(([value, label, Icon]) => (
          <MenuItem key={value} checked={align === value} onChoose={() => style({ align: value })}>
            <Icon size={ICON} aria-hidden />
            {label}
          </MenuItem>
        ))}
        <hr />
        <MenuItem label="Indent less" disabled={block?.indent === 0} onChoose={() => style({ indent: 'out' })}>
          <IndentDecrease size={ICON} aria-hidden />
          Indent less<kbd>Shift+Tab</kbd>
        </MenuItem>
        <MenuItem label="Indent more" onChoose={() => style({ indent: 'in' })}>
          <IndentIncrease size={ICON} aria-hidden />
          Indent more<kbd>Tab</kbd>
        </MenuItem>
      </>
    )
  }

  return (
    <div className="sh-tools" role="toolbar" aria-label="Formatting">
      {inTheBar.map((button, i) => (
        <Fragment key={button}>
          {i > 0 && TYPING_LOOK[button].group !== TYPING_LOOK[inTheBar[i - 1]!].group ? <span className="sh-sep" /> : null}
          {inBar(button)}
        </Fragment>
      ))}
      {library ? (
        <span className="nw-font-menu">
          <FontLibrary
            chosen={fonts}
            onChange={(picked) => setFonts(saveMyFonts(picked))}
            onClose={() => {
              setLibrary(false)
              refocus()
            }}
          />
        </span>
      ) : null}
      {pictures.input}
      <BarMenu label="More" button={<Ellipsis size={ICON} aria-hidden />}>
        {(close) => (
          <>
            {inTheMore.map((button) => (
              <Fragment key={button}>{inMore(button, close)}</Fragment>
            ))}
            {role === 'todo' ? (
              <MenuItem kind="checkbox" label="Ticked" checked={block?.done === true} onChoose={() => style({ done: block?.done !== true })}>
                <SquareCheck size={ICON} aria-hidden />
                Tick the to-do
              </MenuItem>
            ) : null}
            <hr />
            <div className="sh-menu-head">A press on the page</div>
            {pointers.map(([value, label, hint, Icon]) => (
              <MenuItem
                key={value}
                label={label}
                title={hint}
                checked={tool === value}
                command="tool.choose"
                onChoose={() => {
                  void commands.do('tool.choose', { tool: value })
                  close()
                }}
              >
                <Icon size={ICON} aria-hidden />
                {value === 'select' ? 'Select with a box' : value === 'type' ? 'Type in the text' : 'Free cursor: write anywhere'}
              </MenuItem>
            ))}
            <hr />
            <div className="sh-menu-head">Paper</div>
            <div className="sh-seg" role="radiogroup" aria-label="Paper">
              {PAPERS.map(([kind, label]) => (
                <button key={kind} type="button" role="radio" aria-checked={paperNow === kind} onMouseDown={keepFocus} onClick={() => paper(kind)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="sh-seg" role="radiogroup" aria-label="Pages">
              <button type="button" role="radio" aria-checked={everyPage} onMouseDown={keepFocus} onClick={() => setEveryPage(true)}>
                All pages
              </button>
              <button type="button" role="radio" aria-checked={!everyPage} onMouseDown={keepFocus} onClick={() => setEveryPage(false)}>
                This page
              </button>
            </div>
            <hr />
            <MenuItem kind="checkbox" label="Show both rows" checked={both} title="The row for words and the pen's row, one under the other" onChoose={() => showBothRows(!both)}>
              <Rows2 size={ICON} aria-hidden />
              Show both rows
            </MenuItem>
          </>
        )}
      </BarMenu>
      <span className="sh-sep" />
      <button type="button" className="sh-b" aria-label="Pen" aria-pressed={false} title="Pen: write and draw; the pen's row takes this one's place" data-command="tool.choose" onMouseDown={keepFocus} onClick={() => void commands.do('tool.choose', { tool: 'pen' })}>
        <PenLine size={ICON} aria-hidden />
      </button>
      {table ? (
        <>
          <span className="sh-sep" />
          <TableTools store={store} table={table} />
        </>
      ) : null}
      {picture ? (
        <>
          <span className="sh-sep" />
          <DescribeField kind={picture.type === 'table' ? 'table' : 'picture'} value={picture.alt ?? ''} onChange={(value) => describe(picture.id, value)} />
        </>
      ) : null}
    </div>
  )
}
