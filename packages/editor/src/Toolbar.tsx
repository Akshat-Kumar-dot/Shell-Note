// The note's bars (a new look, no new features). The tool strip sits in the app bar: undo and
// redo, the tools as tiles (with the Pen, Highlighter and Eraser), and Picture, Table and
// Paper. With an ink tool chosen, the format bar shows the pen's own options (ink/PenBar.tsx).
// Otherwise it floats below the strip with: the block's type and style tokens, colours, fonts,
// marks for selected words, a table's tools, a picture's description. Every button goes through
// core (format.ts), and none takes the focus, so the caret and selection stay put. In a caption
// or a table's cell, the word marks act through the editor, which hands its changes to core like
// any typing; so do the table's row and column buttons. Under a Select box, the word marks and
// colours act on each piece of text the box holds. The bar is never locked: with nothing
// selected, a change goes to the caret's word, or where the caret last was (target.ts). Every
// button is at least 40 px, for a finger or a pen.
import { libraryFont, type AnyColor, type Id, type Op, type Role, type Size } from '@shellnote/core'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Eraser,
  Grid3x3,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link,
  PenLine,
  Redo2,
  SquareCheck,
  SquareDashedMousePointer,
  Strikethrough,
  Subscript,
  Superscript,
  TextCursorInput,
  Type,
  Underline,
  Undo2,
  type LucideIcon,
  MessageSquareText,
} from 'lucide-react'
import { useCallback, useReducer, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react'
import { PICTURE_TYPES } from './assets.js'
import { useDismiss } from './dismiss.js'
import { activeEditor } from './frame/active.js'
import { onWords } from './frame/words.js'
import { FontLibrary } from './FontLibrary.js'
import { placeMenu } from './popover.js'
import { fontFamily, myFonts, saveMyFonts } from './fonts.js'
import { ColourMenu } from './ColourMenu.js'
import { commands } from './commands/index.js'
import { colourOps, firstText, fontOps, marksOver, sizeOps, styleOps, styleOver, wordOps, type BlockChange, type WordMarks } from './format.js'
import { safeHref } from './links.js'
import { paperOps, PAPERS, type Paper } from './paper.js'
import { addPictures, caretSpot, lastCaretSpot, pictureSpot, type PictureSpot } from './pictures.js'
import type { EditorStore, Tool } from './store.js'
import { TablePicker } from './TablePicker.js'
import { addTable, enterTable, newTable } from './tables.js'
import { aimAt } from './target.js'
import { TableTools } from './TableTools.js'
import { PenBar } from './ink/PenBar.js'
import { isInkTool } from './ink/PenLayer.js'

/** A block type's short sign, shown in place of its name when the bar runs down a side. */
const ROLE_SIGNS: Record<Role, string> = { p: '¶', h1: 'H1', h2: 'H2', h3: 'H3', li: '•', oli: '1.', todo: '☐', quote: '❝' }

const ROLES: [Role, string][] = [
  ['p', 'Paragraph'],
  ['h1', 'Heading 1'],
  ['h2', 'Heading 2'],
  ['h3', 'Heading 3'],
  ['li', 'Bullet list'],
  ['oli', 'Numbered list'],
  ['todo', 'To-do list'],
  ['quote', 'Quote'],
]
const SIZES = [
  ['s', 'S', 'Small'],
  ['m', 'M', 'Normal size'],
  ['l', 'L', 'Large'],
  ['xl', 'XL', 'Extra large'],
] as const
const FONTS = [
  ['sans', 'Sans'],
  ['serif', 'Serif'],
  ['mono', 'Mono'],
  ['hand', 'Handwriting'],
] as const
/** The last entry of the font menu, which opens the font library. */
const MORE_FONTS = '+more'
const ALIGNS: ['left' | 'center' | 'right', string, LucideIcon][] = [
  ['left', 'Align left', AlignLeft],
  ['center', 'Centre', AlignCenter],
  ['right', 'Align right', AlignRight],
]
/** Word marks: our name, Tiptap's, the label, the shortcut and the icon. */
const MARKS: [keyof WordMarks, string, string, string, LucideIcon][] = [
  ['bold', 'bold', 'Bold', 'Ctrl+B', Bold],
  ['italic', 'italic', 'Italic', 'Ctrl+I', Italic],
  ['strike', 'strike', 'Strikethrough', 'Ctrl+Shift+X', Strikethrough],
  ['code', 'code', 'Code', 'Ctrl+E', Code],
  ['highlight', 'highlight', 'Highlight', 'Ctrl+Shift+H', Highlighter],
  ['underline', 'underline', 'Underline', 'Ctrl+U', Underline],
  ['sub', 'subscript', 'Subscript', 'Ctrl+=', Subscript],
  ['sup', 'superscript', 'Superscript', 'Ctrl+Shift+=', Superscript],
]

/** The tools: what a press on the page does. */
const TOOLS: [Tool, string, string, LucideIcon][] = [
  ['type', 'Type', 'Type: click in text to write; a click on empty paper chooses nothing', Type],
  ['select', 'Select', 'Select: draw a box to take only what is inside it', SquareDashedMousePointer],
  ['free', 'Free cursor', 'Free cursor: click anywhere on the paper to start writing there', TextCursorInput],
  ['pen', 'Pen', 'Pen: write and draw; hold still at the end for a straight line or a shape', PenLine],
  ['highlighter', 'Highlighter', 'Highlighter: mark over words and ink', Highlighter],
  ['eraser', 'Eraser', 'Eraser: whole strokes, or the part of a stroke it passes over', Eraser],
]

/** A press on a button must not move the focus out of the text. */
const keepFocus = (event: MouseEvent): void => event.preventDefault()
const ICON = 18

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

/** The app bar's middle: undo and redo, the tools, and what can be put in. */
export function ToolStrip({ store }: { store: EditorStore }) {
  useSyncExternalStore(store.subscribe, store.snapshot)
  const tool = useSyncExternalStore(store.subscribeTool, store.toolSnapshot)
  // The Table button needs to know whether an editor has the caret.
  useSyncExternalStore(activeEditor.subscribe, activeEditor.snapshot)
  const editor = activeEditor.get()
  const typing = editor?.isFocused === true && activeEditor.frame() !== undefined
  const files = useRef<HTMLInputElement>(null)
  const spot = useRef<PictureSpot | undefined>(undefined)

  /** A table of the size picked on the grid, at the caret, or where it last was, with the caret in its first cell. */
  const insertTable = (rows: number, columns: number): void => {
    const at = caretSpot(store) ?? lastCaretSpot(store)
    const id = at && addTable(store, at.frame, at.at, newTable(rows, columns))
    const now = activeEditor.get()
    if (id !== undefined && now) enterTable(now, id)
  }

  return (
    <div className="nw-toolstrip" role="toolbar" aria-label="Tools">
      <span className="nw-group">
        <button type="button" className="nw-ibtn" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!store.canUndo} data-command="edit.undo" onMouseDown={keepFocus} onClick={() => void commands.do('edit.undo')}>
          <Undo2 size={ICON} aria-hidden />
        </button>
        <button type="button" className="nw-ibtn" aria-label="Redo" title="Redo (Ctrl+Y)" disabled={!store.canRedo} data-command="edit.redo" onMouseDown={keepFocus} onClick={() => void commands.do('edit.redo')}>
          <Redo2 size={ICON} aria-hidden />
        </button>
      </span>
      <span className="nw-sep" />
      <span className="nw-group nw-tools" role="radiogroup" aria-label="Tools">
        {TOOLS.map(([value, label, hint, Icon]) => (
          <button key={value} type="button" role="radio" className="nw-tool" aria-label={label} aria-checked={tool === value} title={hint} data-command="tool.choose" onMouseDown={keepFocus} onClick={() => void commands.do('tool.choose', { tool: value })}>
            <Icon size={20} aria-hidden />
          </button>
        ))}
      </span>
      <span className="nw-sep" />
      <span className="nw-group">
        <button
          type="button"
          className="nw-ibtn"
          aria-label="Picture"
          title="Add a picture: at the caret, or on the page"
          onMouseDown={keepFocus}
          onClick={() => {
            spot.current = pictureSpot(store)
            files.current?.click()
          }}
        >
          <ImagePlus size={ICON} aria-hidden />
        </button>
        <input
          ref={files}
          type="file"
          accept={PICTURE_TYPES.join(',')}
          multiple
          hidden
          onChange={(event) => {
            const picked = Array.from(event.target.files ?? [])
            event.target.value = ''
            if (spot.current) void addPictures(store, picked, spot.current)
          }}
        />
        <TablePicker disabled={!typing && lastCaretSpot(store) === undefined} onPick={insertTable} />
        <PaperMenu store={store} />
      </span>
    </div>
  )
}

/** The paper of the page in view, or of every page: blank, lines, squares or dots. */
function PaperMenu({ store }: { store: EditorStore }) {
  const doc = useSyncExternalStore(store.subscribe, store.snapshot)
  const [open, setOpen] = useState(false)
  const [everyPage, setEveryPage] = useState(true)
  const root = useRef<HTMLSpanElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, root, close)
  const inView = store.pageInView !== undefined && doc.page[store.pageInView] ? store.pageInView : doc.pages[0]!
  const current = doc.page[inView]?.bg ?? 'blank'
  const choose = (paper: Paper): void => runner(store)(paperOps(store.doc, everyPage ? store.doc.pages : [inView], paper))
  return (
    <span className="nw-popover-anchor" ref={root}>
      <button type="button" className="nw-ibtn" aria-label="Paper" aria-expanded={open} title="Paper: blank, lines, squares or dots" onMouseDown={keepFocus} onClick={() => setOpen(!open)}>
        <Grid3x3 size={ICON} aria-hidden />
      </button>
      {open ? (
        <div ref={placeMenu} className="nw-popover nw-paper-menu" role="group" aria-label="Paper">
          <div className="nw-paper-choices">
            {PAPERS.map(([paper, label]) => (
              <button key={paper} type="button" className="nw-paper" aria-pressed={current === paper} onMouseDown={keepFocus} onClick={() => choose(paper)}>
                <span className="nw-paper-sample" data-bg={paper} aria-hidden />
                {label}
              </button>
            ))}
          </div>
          <div className="nw-segmented" role="radiogroup" aria-label="Pages">
            <button type="button" role="radio" aria-checked={everyPage} onMouseDown={keepFocus} onClick={() => setEveryPage(true)}>
              All pages
            </button>
            <button type="button" role="radio" aria-checked={!everyPage} onMouseDown={keepFocus} onClick={() => setEveryPage(false)}>
              This page
            </button>
          </div>
        </div>
      ) : null}
    </span>
  )
}

/** The floating bar: the pen's options with an ink tool; otherwise the block's type and style, colours, fonts, marks, and a table's or picture's own tools. */
export function FormatBar({ store }: { store: EditorStore }) {
  const tool = useSyncExternalStore(store.subscribeTool, store.toolSnapshot)
  return isInkTool(tool) ? <PenBar store={store} /> : <TextBar store={store} />
}

/**
 * What a picture or a table shows, for whoever cannot see it. Along a bar, a field. Down a side, whose strip is 68 pixels
 * wide, the field hung off both its edges (found 6 November 2026), so there it is a button with the field in a small menu.
 * CSS shows one or the other: the bar knows its direction, this does not.
 */
function DescribeField({ kind, value, onChange }: { kind: 'picture' | 'table'; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, root, close)
  const field = (
    <label className="nw-describe">
      <span>Description</span>
      <input type="text" aria-label="Description" placeholder={`What the ${kind} shows (not on the page)`} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
  return (
    <>
      <span className="nw-describe-along">{field}</span>
      <span className="nw-popover-anchor nw-describe-down" ref={root}>
        <button type="button" className="nw-ibtn" aria-label="Description" aria-expanded={open} title={`What the ${kind} shows (not on the page)`} onClick={() => setOpen(!open)}>
          <MessageSquareText size={18} aria-hidden />
        </button>
        {open ? (
          <div ref={placeMenu} className="nw-popover">
            {field}
          </div>
        ) : null}
      </span>
    </>
  )
}

function TextBar({ store }: { store: EditorStore }) {
  const doc = useSyncExternalStore(store.subscribe, store.snapshot)
  const selection = useSyncExternalStore(store.subscribeSelection, store.selectionSnapshot)
  // The marks in captions and cells need to know which editor has the focus.
  useSyncExternalStore(activeEditor.subscribe, activeEditor.snapshot)
  // Marks switched on for the next words typed change no document, so ask for a redraw.
  const [, redraw] = useReducer((n: number) => n + 1, 0)

  // Where a change goes, and what the bar shows (target.ts): what is selected, else the caret's word, else where the caret last was.
  const shown = aimAt(store)
  const block = firstText(doc, { blocks: shown.blocks })
  const words = shown.pieces.length > 0
  const marks = marksOver(doc, shown.pieces)
  const chosen = selection.blocks.length === 1 ? doc.block[selection.blocks[0]!] : undefined
  const picture = chosen?.type === 'image' || chosen?.type === 'table' ? chosen : undefined
  const table = chosen?.type === 'table' ? chosen : undefined
  const [fonts, setFonts] = useState(myFonts)
  const [library, setLibrary] = useState(false)
  // The size and font of the words a change goes to: their own, or their line's; for the words typed next, the editor's.
  const lineSize = block?.style?.size ?? 'm'
  const lineFont = block?.style?.font ?? 'sans'
  const size = words ? (styleOver(doc, shown.pieces, 'size') ?? '') : ((shown.editor?.getAttributes('wordSize').size as string | undefined) ?? lineSize)
  const font = words ? (styleOver(doc, shown.pieces, 'font') ?? lineFont) : ((shown.editor?.getAttributes('wordFont').font as string | undefined) ?? lineFont)
  // The same for colour: undefined for words of several colours.
  const colour = (words ? styleOver(doc, shown.pieces, 'color') : ((shown.editor?.getAttributes('colour').color as string | undefined) ?? block?.style?.color ?? 'ink')) as AnyColor | undefined
  // The fonts in the menu, and the words' library font even when it is not one of them.
  const menuFonts = libraryFont(font) && !fonts.includes(font) ? [...fonts, font] : fonts

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
  const chooseFont = (value: string): void => wordStyle('font', value)
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

  // The block's type and size, before the colours.
  const blockTools = (
    <>
      {/* Down a side, the menu shows as its sign; pressed, it opens with every name, as across. */}
      <span className="nw-select-wrap">
        <span className="nw-select-short" aria-hidden>
          {ROLE_SIGNS[block?.role ?? 'p'] ?? '¶'}
        </span>
        <select
          className="nw-select"
          aria-label="Block type"
          value={block?.role ?? 'p'}
          onChange={(event) => {
            style({ role: event.target.value as Role })
            refocus()
          }}
        >
          {ROLES.map(([role, label]) => (
            <option key={role} value={role}>
              {label}
            </option>
          ))}
        </select>
      </span>
      <span className="nw-group nw-segment" role="group" aria-label="Size">
        {SIZES.map(([value, short, label]) => (
          <button key={value} type="button" className="nw-ibtn nw-text-btn" aria-label={label} title={label} aria-pressed={size === value} onMouseDown={keepFocus} onClick={() => wordStyle('size', value)}>
            {short}
          </button>
        ))}
      </span>
      <span className="nw-sep" />
    </>
  )
  // The font, alignment, indent and tick, after the colours.
  const lineTools = (
    <>
      <span className="nw-sep" />
      <span className="nw-font-menu nw-select-wrap">
        <span className="nw-select-short" aria-hidden style={{ fontFamily: fontFamily(font) }}>
          Aa
        </span>
        <select
          className="nw-select"
          aria-label="Font"
          value={font}
          onChange={(event) => {
            if (event.target.value === MORE_FONTS) setLibrary(true)
            else {
              chooseFont(event.target.value)
              refocus()
            }
          }}
        >
          <optgroup label="Styles">
            {FONTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </optgroup>
          {menuFonts.length > 0 ? (
            <optgroup label="My fonts">
              {menuFonts.map((id) => (
                <option key={id} value={id} style={{ fontFamily: fontFamily(id) }}>
                  {libraryFont(id)!.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          <option value={MORE_FONTS}>More fonts…</option>
        </select>
        {library ? (
          <FontLibrary
            chosen={fonts}
            onChange={(chosen) => setFonts(saveMyFonts(chosen))}
            onClose={() => {
              setLibrary(false)
              refocus()
            }}
          />
        ) : null}
      </span>
      <span className="nw-sep" />
      <span className="nw-group" role="group" aria-label="Alignment">
        {ALIGNS.map(([align, label, Icon]) => (
          <button key={align} type="button" className="nw-ibtn" aria-label={label} title={label} aria-pressed={(block?.style?.align ?? 'left') === align} onMouseDown={keepFocus} onClick={() => style({ align })}>
            <Icon size={ICON} aria-hidden />
          </button>
        ))}
      </span>
      <span className="nw-group" role="group" aria-label="Indent">
        <button type="button" className="nw-ibtn" aria-label="Indent less" title="Indent less (Shift+Tab)" disabled={block?.indent === 0} onMouseDown={keepFocus} onClick={() => style({ indent: 'out' })}>
          <IndentDecrease size={ICON} aria-hidden />
        </button>
        <button type="button" className="nw-ibtn" aria-label="Indent more" title="Indent more (Tab)" onMouseDown={keepFocus} onClick={() => style({ indent: 'in' })}>
          <IndentIncrease size={ICON} aria-hidden />
        </button>
      </span>
      <button type="button" className="nw-ibtn" aria-label="Ticked" title="Tick the to-do" aria-pressed={block?.done === true} disabled={block?.role !== 'todo'} onMouseDown={keepFocus} onClick={() => style({ done: block?.done !== true })}>
        <SquareCheck size={ICON} aria-hidden />
      </button>
    </>
  )
  // A table or a picture chosen: its own tools take the place of those for text blocks, which do not apply to it, so the bar stays on one line.
  const textTools = picture === undefined

  return (
    <div className="nw-formatbar" role="toolbar" aria-label="Formatting">
      {textTools ? blockTools : null}
      <ColourMenu current={colour} onNamed={(color) => paint(color)} onCode={(code) => paint(code as AnyColor)} onDone={refocus} />
      {textTools ? lineTools : null}
      <span className="nw-sep" />
      <span className="nw-group" role="group" aria-label="Words">
        {MARKS.map(([name, tiptap, label, keys, Icon]) => {
          const on = words ? marks[name] : (shown.editor?.isActive(tiptap) ?? false)
          return (
            <button key={name} type="button" className="nw-ibtn" aria-label={label} title={`${label} (${keys})`} aria-pressed={on} onMouseDown={keepFocus} onClick={() => mark(name, tiptap)}>
              <Icon size={ICON} aria-hidden />
            </button>
          )
        })}
        <button type="button" className="nw-ibtn" aria-label="Link" title="Link the selected words" onMouseDown={keepFocus} onClick={link}>
          <Link size={ICON} aria-hidden />
        </button>
      </span>
      {table ? (
        <>
          <span className="nw-sep" />
          <TableTools store={store} table={table} />
        </>
      ) : null}
      {picture ? (
        <>
          <span className="nw-sep" />
          <DescribeField kind={picture.type === 'table' ? 'table' : 'picture'} value={picture.alt ?? ''} onChange={(value) => describe(picture.id, value)} />
        </>
      ) : null}
    </div>
  )
}
