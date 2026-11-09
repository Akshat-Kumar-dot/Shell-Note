// The Tiptap schema for a frame: one node per kind of child block, marks for
// the inline Markdown subset, and the behaviour of a note editor. It mirrors
// core's model one to one, so the adapter only translates.
import { listNumbering, Role, SHARE_TOTAL, TableLook, type Asset, type Block } from '@shellnote/core'
import { Extension, InputRule, Mark, mergeAttributes, Node, type AnyExtension } from '@tiptap/core'
import Bold from '@tiptap/extension-bold'
import Code from '@tiptap/extension-code'
import Highlight from '@tiptap/extension-highlight'
import Italic from '@tiptap/extension-italic'
import Strike from '@tiptap/extension-strike'
import { dropCursor } from '@tiptap/pm/dropcursor'
import { gapCursor } from '@tiptap/pm/gapcursor'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey, TextSelection, type Command } from '@tiptap/pm/state'
import { addRowAfter, CellSelection, goToNextCell, isInTable, selectedRect, tableEditing } from '@tiptap/pm/tables'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { colourAttributes, colourOf } from '../colours.js'
import { inFrameSize } from '../geometry.js'
import { safeHref } from '../links.js'
import { listMarker } from '../markers.js'
import { DiagramView } from './diagramView.js'
import { MIN_WIDTH, sharesOf, TableView } from './tableView.js'
import { toggleWords } from './words.js'

export interface FrameOptions {
  /** True when a block id is in use anywhere in the document outside this frame. */
  takenElsewhere: (id: string) => boolean
  /** A new block id, unused in the document and by `alsoTaken`, the ids already in this frame. */
  newId: (alsoTaken: (id: string) => boolean) => string
  /** Where to load an image asset from, when the app has its bytes. */
  assetUrl: (hash: string) => string | undefined
  /** An image asset's metadata, for the picture's size before it loads. */
  asset: (hash: string) => Asset | undefined
  /** A press on a table's or a diagram's ⊕ handle, with its id: a click chooses it, a drag moves it (objectDrag.ts). */
  objectHandle?: (id: string, event: PointerEvent) => void
}

/** Set on transactions that bring the editor up to date with core, so they are not sent back as edits. */
export const OUTSIDE = 'shellnoteOutside'

const HEADINGS = new Set(['h1', 'h2', 'h3'])
const LISTS = new Set(['li', 'oli', 'todo'])
const MAX_INDENT = 8

// ----- nodes ----------------------------------------------------------------------

const Doc = Node.create({ name: 'doc', topNode: true, content: 'block+' })
const Text = Node.create({ name: 'text', group: 'inline' })

/** A block's id: kept by the first half when a block splits, never copied to the second. */
const idAttribute = {
  default: null,
  keepOnSplit: false,
  parseHTML: (el: HTMLElement) => el.dataset.id ?? null,
  renderHTML: (attrs: Record<string, unknown>) => (attrs.id ? { 'data-id': attrs.id } : {}),
}

/** A style token, kept when a block splits. Only values on its list are read from pasted HTML. */
function token(name: string, values: readonly string[]) {
  return {
    default: null,
    parseHTML: (el: HTMLElement) => {
      const value = el.dataset[name]
      return value !== undefined && values.includes(value) ? value : null
    },
    renderHTML: (attrs: Record<string, unknown>) => (attrs[name] ? { [`data-${name}`]: attrs[name] } : {}),
  }
}

function roleOf(el: HTMLElement): string {
  const role = el.dataset.role
  if (role !== undefined && (Role.options as readonly string[]).includes(role)) return role
  const tag = el.tagName.toLowerCase()
  if (tag === 'h1' || tag === 'h2' || tag === 'h3') return tag
  if (/^h[4-6]$/.test(tag)) return 'h3'
  if (tag === 'blockquote') return 'quote'
  if (tag === 'li') return el.closest('ol') ? 'oli' : 'li'
  return 'p'
}

const TextBlock = Node.create({
  name: 'textBlock',
  group: 'block',
  content: 'inline*',
  defining: true,
  addAttributes() {
    return {
      id: idAttribute,
      role: { default: 'p', parseHTML: roleOf, renderHTML: (attrs) => ({ 'data-role': attrs.role }) },
      indent: {
        default: 0,
        parseHTML: (el) => Math.min(MAX_INDENT, Math.max(0, Number(el.dataset.indent ?? 0) || 0)),
        renderHTML: (attrs) => (attrs.indent ? { 'data-indent': attrs.indent, style: `--nw-indent: ${attrs.indent}` } : {}),
      },
      size: token('size', ['s', 'm', 'l', 'xl']),
      color: { default: null, parseHTML: (el) => colourOf(el.dataset.color), renderHTML: (attrs) => colourAttributes(attrs.color as string | null) },
      // A font style, or a library font's id (core's fonts.ts).
      font: { default: null, parseHTML: (el) => (/^[a-z][a-z0-9-]{1,39}$/.test(el.dataset.font ?? '') ? el.dataset.font : null), renderHTML: (attrs) => (attrs.font ? { 'data-font': attrs.font } : {}) },
      align: token('align', ['left', 'center', 'right']),
      done: {
        default: false,
        keepOnSplit: false,
        parseHTML: (el) => el.dataset.done !== undefined,
        renderHTML: (attrs) => (attrs.done ? { 'data-done': '' } : {}),
      },
    }
  },
  parseHTML() {
    return ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'li', 'div[data-role]'].map((tag) => ({ tag }))
  },
  renderHTML({ node, HTMLAttributes }) {
    const tag = HEADINGS.has(node.attrs.role as string) ? (node.attrs.role as string) : 'p'
    return [tag, mergeAttributes({ class: 'nw-text' }, HTMLAttributes), 0]
  },
})

const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({ tex: { default: '' } }),
  parseHTML: () => [{ tag: 'span[data-tex]', getAttrs: (el) => ({ tex: (el as HTMLElement).dataset.tex ?? '' }) }],
  renderHTML: ({ node }) => ['span', { class: 'nw-math-inline', 'data-tex': node.attrs.tex as string }, node.attrs.tex as string],
})

const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  addAttributes: () => ({ id: idAttribute, tex: { default: '' }, value: { default: null } }),
  parseHTML: () => [{ tag: 'div.nw-math', getAttrs: (el) => ({ tex: (el as HTMLElement).dataset.tex ?? '' }) }],
  renderHTML: ({ node }) => {
    const { id, tex, value } = node.attrs as { id: string | null; tex: string; value: string | null }
    const out: [string, Record<string, string>, ...unknown[]] = ['div', { class: 'nw-math', 'data-tex': tex, ...(id ? { 'data-id': id } : {}) }, ['code', tex]]
    if (value !== null) out.push(['span', { class: 'nw-math-value' }, ` = ${value}`])
    return out as never
  },
})

const DiagramBlock = Node.create<Pick<FrameOptions, 'objectHandle'>>({
  name: 'diagramBlock',
  group: 'block',
  atom: true,
  addAttributes: () => ({ id: idAttribute, src: { default: '' } }),
  parseHTML: () => [{ tag: 'figure.nw-diagram', getAttrs: (el) => ({ src: (el as HTMLElement).textContent ?? '' }) }],
  renderHTML: ({ node }) => ['figure', { class: 'nw-diagram', ...(node.attrs.id ? { 'data-id': node.attrs.id as string } : {}) }, ['pre', node.attrs.src as string]],
  addNodeView() {
    return ({ node }) => new DiagramView(node, this.options.objectHandle)
  },
})

/**
 * A picture, whose caption is the node's own text: typed in place under the
 * picture, with the same marks as any line. Isolating, so Backspace and
 * Delete never merge a caption with the text around it.
 */
const ImageBlock = Node.create<Pick<FrameOptions, 'assetUrl' | 'asset'>>({
  name: 'imageBlock',
  group: 'block',
  content: 'inline*',
  isolating: true,
  selectable: true,
  addOptions: () => ({ assetUrl: () => undefined, asset: () => undefined }),
  addAttributes: () => ({ id: idAttribute, asset: { default: '' }, alt: { default: null } }),
  parseHTML: () => [
    {
      tag: 'figure.nw-image[data-asset]',
      getAttrs: (el) => ({ asset: (el as HTMLElement).dataset.asset, alt: (el as HTMLElement).querySelector('img')?.getAttribute('alt') || null }),
      contentElement: (el) => (el as HTMLElement).querySelector<HTMLElement>('figcaption') ?? (el as HTMLElement).ownerDocument.createElement('figcaption'),
    },
  ],
  renderHTML({ node }) {
    const { id, asset, alt } = node.attrs as { id: string | null; asset: string; alt: string | null }
    const url = this.options.assetUrl(asset)
    const size = inFrameSize(this.options.asset(asset))
    const style = `width: ${size.width}${size.aspectRatio ? `; aspect-ratio: ${size.aspectRatio}` : ''}`
    const picture = url ? ['img', { src: url, alt: alt ?? '', draggable: 'false' }] : ['span', { class: 'nw-image-missing' }, alt ?? 'Picture']
    return [
      'figure',
      { class: 'nw-image', 'data-asset': asset, ...(id ? { 'data-id': id } : {}) },
      ['div', { class: 'nw-image-pic', contenteditable: 'false', style }, picture],
      ['figcaption', { class: 'nw-caption' }, 0],
    ]
  },
})

// ----- tables ---------------------------------------------------------------------
//
// Core's table block is a tableBlock: the grid (a prosemirror-tables table),
// then its caption. Cells hold one line of formatted words, like a text block.

/** Which part of a table each node is, for prosemirror-tables. */
const TABLE_ROLES: Readonly<Record<string, string>> = { table: 'table', tableRow: 'row', tableCell: 'cell', tableHeader: 'header_cell' }

/** Merged cells are read from pasted tables so their words land in the right column; core then keeps one cell per spot. */
const span = (name: 'colspan' | 'rowspan') => ({
  default: 1,
  parseHTML: (el: HTMLElement) => Math.max(1, Number(el.getAttribute(name)) || 1),
  renderHTML: (attrs: Record<string, unknown>) => ((attrs[name] as number) > 1 ? { [name]: attrs[name] } : {}),
})
/** A cell's column width, as its share of the table's, in thousandths: one number for each column it spans (tableView.ts). */
const colwidth = {
  default: null,
  parseHTML: (el: HTMLElement) => {
    const shares = el.dataset.share?.split(',').map(Number)
    return shares?.every((share) => Number.isInteger(share) && share > 0) ? shares : null
  },
  renderHTML: (attrs: Record<string, unknown>) => (Array.isArray(attrs.colwidth) ? { 'data-share': attrs.colwidth.join(',') } : {}),
}
const cellAttributes = () => ({ colspan: span('colspan'), rowspan: span('rowspan'), colwidth })
/** Blocks inside a pasted cell, such as a paragraph from a word processor, give only their words. */
const CELL_BLOCKS = { tag: 'p, div, h1, h2, h3, h4, h5, h6, li, ul, ol, blockquote', context: 'tableCell/|tableHeader/|tableCaption/', skip: true, priority: 60 } as const

const TableBlock = Node.create({
  name: 'tableBlock',
  group: 'block',
  content: 'table tableCaption',
  isolating: true,
  addAttributes: () => ({
    id: idAttribute,
    alt: { default: null, parseHTML: (el) => el.dataset.alt ?? null, renderHTML: (attrs) => (attrs.alt ? { 'data-alt': attrs.alt } : {}) },
  }),
  parseHTML: () => [{ tag: 'figure.nw-table' }],
  renderHTML: ({ HTMLAttributes }) => ['figure', mergeAttributes({ class: 'nw-table' }, HTMLAttributes), 0],
})

/** The grid, with its width as a share of the frame's and its look (file format version 2), drawn by TableView. */
const Table = Node.create<Pick<FrameOptions, 'objectHandle'>>({
  name: 'table',
  content: 'tableRow+',
  isolating: true,
  addOptions: () => ({}),
  addAttributes: () => ({
    width: {
      default: null,
      parseHTML: (el) => {
        const width = Number(el.dataset.width)
        return Number.isInteger(width) && width >= MIN_WIDTH && width < SHARE_TOTAL ? width : null
      },
      renderHTML: (attrs) => (attrs.width ? { 'data-width': attrs.width } : {}),
    },
    look: {
      default: null,
      parseHTML: (el) => (TableLook.safeParse(el.dataset.look).success ? el.dataset.look : null),
      renderHTML: (attrs) => (attrs.look ? { 'data-look': attrs.look } : {}),
    },
  }),
  parseHTML: () => [{ tag: 'table' }],
  // As copied: the widths go along, so a table pasted back looks the same.
  renderHTML: ({ node, HTMLAttributes }) => ['table', HTMLAttributes, ['colgroup', ...sharesOf(node).map((share) => ['col', { style: `width: ${share / 10}%` }])], ['tbody', 0]],
  addNodeView() {
    return ({ node, view, getPos }) => new TableView(node, view, getPos, this.options.objectHandle)
  },
})

const TableRow = Node.create({
  name: 'tableRow',
  content: '(tableCell | tableHeader)*',
  parseHTML: () => [{ tag: 'tr' }],
  renderHTML: () => ['tr', 0],
})

const TableCell = Node.create({
  name: 'tableCell',
  content: 'inline*',
  isolating: true,
  addAttributes: cellAttributes,
  parseHTML: () => [{ tag: 'td' }, CELL_BLOCKS],
  renderHTML: ({ HTMLAttributes }) => ['td', HTMLAttributes, 0],
})

const TableHeader = Node.create({
  name: 'tableHeader',
  content: 'inline*',
  isolating: true,
  addAttributes: cellAttributes,
  parseHTML: () => [{ tag: 'th' }],
  renderHTML: ({ HTMLAttributes }) => ['th', HTMLAttributes, 0],
})

const TableCaption = Node.create({
  name: 'tableCaption',
  content: 'inline*',
  parseHTML: () => [{ tag: 'figure.nw-table > figcaption' }],
  renderHTML: () => ['figcaption', { class: 'nw-caption' }, 0],
})

/** Tab and Shift+Tab go from cell to cell, Tab past the last cell adds a row, and Enter goes down a row. */
const TableKeys = Extension.create({
  name: 'shellnoteTables',
  // Before the frame's own keys, which indent a line on Tab.
  priority: 110,

  extendNodeSchema(extension) {
    const role = TABLE_ROLES[extension.name]
    return role === undefined ? {} : { tableRole: role }
  },

  addKeyboardShortcuts() {
    const editor = this.editor
    const run = (command: Command): boolean => command(editor.state, editor.view.dispatch, editor.view)
    const inCell = (): boolean => isInTable(editor.state) && TABLE_ROLES[editor.state.selection.$from.parent.type.name] !== undefined
    const down = (): boolean => {
      if (!inCell()) return false
      if (selectedRect(editor.state).bottom === selectedRect(editor.state).map.height) run(addRowAfter)
      const rect = selectedRect(editor.state)
      const cell = rect.tableStart + rect.map.positionAt(rect.bottom, rect.left, rect.table)
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, cell + 1)).scrollIntoView())
      return true
    }
    // With every cell selected, Backspace or Delete removes the whole table, caption and all.
    const removeTable = (): boolean => {
      const { selection } = editor.state
      if (!(selection instanceof CellSelection) || !selection.isRowSelection() || !selection.isColSelection()) return false
      const $cell = selection.$anchorCell
      for (let depth = $cell.depth; depth > 0; depth--) {
        if ($cell.node(depth).type.name === 'tableBlock') {
          editor.view.dispatch(editor.state.tr.delete($cell.before(depth), $cell.after(depth)))
          return true
        }
      }
      return false
    }
    return {
      Tab: () => inCell() && (run(goToNextCell(1)) || (run(addRowAfter) && run(goToNextCell(1)))),
      'Shift-Tab': () => inCell() && run(goToNextCell(-1)),
      Enter: down,
      Backspace: removeTable,
      Delete: removeTable,
    }
  },

  addProseMirrorPlugins() {
    return [tableEditing()]
  },
})

// ----- marks ----------------------------------------------------------------------

const Link = Mark.create({
  name: 'link',
  inclusive: false,
  addAttributes: () => ({ href: { default: null } }),
  parseHTML: () => [
    {
      tag: 'a[href]',
      // Only addresses a note may hold: never javascript: or the like.
      getAttrs: (el) => {
        const href = safeHref((el as HTMLElement).getAttribute('href') ?? '')
        return href === undefined ? false : { href }
      },
    },
  ],
  // Drawn as a link only when a note may hold it. A note from a file keeps its words, and the address as written,
  // but a javascript: or data: address is never put into the page (blocks.tsx draws it the same way).
  renderHTML: ({ HTMLAttributes }) => {
    const href = safeHref(String(HTMLAttributes.href ?? ''))
    return href === undefined ? ['span', 0] : ['a', { href, target: '_blank', rel: 'noopener noreferrer' }, 0]
  },
})

/** Underline, Ctrl+U, as in Word (file format version 2). */
const Underline = Mark.create({
  name: 'underline',
  parseHTML: () => [{ tag: 'u' }, { style: 'text-decoration=underline', consuming: false }],
  renderHTML: () => ['u', 0],
  addKeyboardShortcuts() {
    return { 'Mod-u': () => this.editor.commands.toggleMark(this.name) }
  },
})

/** Words written small below the line, Ctrl+=, as in Word; never at once with superscript. */
const Subscript = Mark.create({
  name: 'subscript',
  excludes: 'superscript',
  parseHTML: () => [{ tag: 'sub' }],
  renderHTML: () => ['sub', 0],
  addKeyboardShortcuts() {
    return { 'Mod-=': () => this.editor.commands.toggleMark(this.name) }
  },
})

/** Words written small above the line, Ctrl+Shift+=, as in Word. With Shift, many keyboards report "+". */
const Superscript = Mark.create({
  name: 'superscript',
  excludes: 'subscript',
  parseHTML: () => [{ tag: 'sup' }],
  renderHTML: () => ['sup', 0],
  addKeyboardShortcuts() {
    const toggle = (): boolean => this.editor.commands.toggleMark(this.name)
    return { 'Mod-Shift-=': toggle, 'Mod-+': toggle }
  },
})

/** A size of the words' own, s to xl. */
const WordSize = Mark.create({
  name: 'wordSize',
  addAttributes: () => ({ size: { default: null } }),
  parseHTML: () => [
    {
      tag: 'span[data-size]',
      getAttrs: (el) => {
        const size = (el as HTMLElement).dataset.size
        return size === 's' || size === 'm' || size === 'l' || size === 'xl' ? { size } : false
      },
    },
  ],
  renderHTML: ({ HTMLAttributes }) => ['span', { 'data-size': HTMLAttributes.size as string }, 0],
})

/** A font of the words' own: a font style, or a library font's id. */
const WordFont = Mark.create({
  name: 'wordFont',
  addAttributes: () => ({ font: { default: null } }),
  parseHTML: () => [
    {
      tag: 'span[data-font]',
      getAttrs: (el) => {
        const font = (el as HTMLElement).dataset.font ?? ''
        return /^[a-z][a-z0-9-]{1,39}$/.test(font) ? { font } : false
      },
    },
  ],
  renderHTML: ({ HTMLAttributes }) => ['span', { 'data-font': HTMLAttributes.font as string }, 0],
})

const Colour = Mark.create({
  name: 'colour',
  addAttributes: () => ({ color: { default: null } }),
  parseHTML: () => [
    {
      tag: 'span[data-color]',
      getAttrs: (el) => {
        const color = colourOf((el as HTMLElement).dataset.color)
        return color === null ? false : { color }
      },
    },
  ],
  renderHTML: ({ HTMLAttributes }) => ['span', colourAttributes(HTMLAttributes.color as string), 0],
})

// ----- behaviour ------------------------------------------------------------------

/** Typed at the start of a block: "# " makes a heading, "- " a bullet, and so on. */
const SHORTCUTS: [RegExp, Record<string, unknown>][] = [
  [/^#\s$/, { role: 'h1' }],
  [/^##\s$/, { role: 'h2' }],
  [/^###\s$/, { role: 'h3' }],
  [/^[-*]\s$/, { role: 'li' }],
  [/^1[.)]\s$/, { role: 'oli' }],
  [/^\[ ?\]\s$/, { role: 'todo', done: false }],
  [/^\[x\]\s$/i, { role: 'todo', done: true }],
  [/^>\s$/, { role: 'quote' }],
]

const Behaviour = Extension.create<FrameOptions>({
  name: 'shellnoteBehaviour',

  addOptions: () => ({ takenElsewhere: () => false, newId: () => '', assetUrl: () => undefined, asset: () => undefined }) as FrameOptions,

  addKeyboardShortcuts() {
    const editor = this.editor
    const current = (): PMNode | undefined => {
      const { $from } = editor.state.selection
      return $from.parent.type.name === 'textBlock' ? $from.parent : undefined
    }
    const indentBy = (step: number): boolean => {
      const node = current()
      if (!node) return false
      const indent = Math.min(MAX_INDENT, Math.max(0, (node.attrs.indent as number) + step))
      if (indent !== node.attrs.indent) editor.commands.updateAttributes('textBlock', { indent })
      return true
    }
    return {
      Enter: () => {
        const { $from, empty } = editor.state.selection
        // Enter in a caption starts a new line under the picture or table.
        if ($from.parent.type.name === 'imageBlock' || $from.parent.type.name === 'tableCaption') {
          return editor.commands.command(({ tr, state }) => {
            const after = $from.after(1)
            tr.insert(after, state.schema.nodes.textBlock!.create())
            tr.setSelection(TextSelection.create(tr.doc, after + 1))
            return true
          })
        }
        const node = current()
        if (!node || !empty) return false
        const role = node.attrs.role as string
        // An empty list item steps out: one level up, or out of the list.
        if (LISTS.has(role) && node.content.size === 0) {
          return editor.commands.updateAttributes('textBlock', (node.attrs.indent as number) > 0 ? { indent: (node.attrs.indent as number) - 1 } : { role: 'p', done: false })
        }
        // After a heading or a quote comes a paragraph; a list carries on.
        const atEnd = $from.parentOffset === node.content.size
        const next = (HEADINGS.has(role) || role === 'quote') && atEnd ? 'p' : role
        return editor.chain().splitBlock().updateAttributes('textBlock', { role: next, done: false }).run()
      },
      Backspace: () => {
        const { $from, empty } = editor.state.selection
        const node = current()
        if (!node || !empty || $from.parentOffset !== 0) return false
        if ((node.attrs.indent as number) > 0) return editor.commands.updateAttributes('textBlock', { indent: (node.attrs.indent as number) - 1 })
        if (node.attrs.role !== 'p') return editor.commands.updateAttributes('textBlock', { role: 'p', done: false })
        return false
      },
      Tab: () => indentBy(1),
      'Shift-Tab': () => indentBy(-1),
    }
  },

  addInputRules() {
    return SHORTCUTS.map(
      ([find, attrs]) =>
        new InputRule({
          find,
          handler: ({ state, range }) => {
            const $start = state.doc.resolve(range.from)
            if ($start.parent.type.name !== 'textBlock') return null
            // setNodeMarkup keeps the block's id: the block changes role, it is not replaced.
            state.tr.delete(range.from, range.to).setNodeMarkup($start.before(), undefined, { ...$start.parent.attrs, ...attrs })
          },
        }),
    )
  },

  addProseMirrorPlugins() {
    return [idPlugin(this.options), numbersPlugin(), captionsPlugin(), chosenPlugin(), lastCaretPlugin(), pictureClicks(), gapCursor(), dropCursor({ color: '#1f5fbf', width: 2 })]
  },
})

/**
 * Every block gets an id that is unique in the whole document. A block made by
 * Enter, or pasted with an id another block has, here or in another frame,
 * gets a fresh one; the first holder of an id keeps it.
 */
function idPlugin(options: FrameOptions): Plugin {
  return new Plugin({
    key: new PluginKey('shellnoteIds'),
    appendTransaction(transactions, _before, state) {
      if (!transactions.some((tr) => tr.docChanged)) return null
      const present = new Set<string>()
      state.doc.forEach((node) => {
        if (typeof node.attrs.id === 'string') present.add(node.attrs.id)
      })
      const seen = new Set<string>()
      let tr = state.tr
      let changed = false
      state.doc.forEach((node, pos) => {
        const id = node.attrs.id as string | null
        if (id && !seen.has(id) && !options.takenElsewhere(id)) {
          seen.add(id)
          return
        }
        const fresh = options.newId((candidate) => present.has(candidate) || seen.has(candidate))
        seen.add(fresh)
        tr = tr.setNodeAttribute(pos, 'id', fresh)
        changed = true
      })
      return changed ? tr.setMeta(OUTSIDE, transactions.some((t) => t.getMeta(OUTSIDE))) : null
    },
  })
}

/** The ids of a frame's blocks chosen as objects (by a marquee or Shift+click); FrameEditor sends them as this key's meta. */
/** What is chosen in one frame: blocks, by id, and the pieces of text a Select box holds, as editor positions. */
export interface Chosen {
  blocks: ReadonlySet<string>
  words: readonly (readonly [number, number])[]
}

export const CHOSEN = new PluginKey<Chosen>('shellnoteChosen')

/** Blocks chosen as objects and the words a Select box holds are marked, so a person sees what Delete will remove. */
function chosenPlugin(): Plugin<Chosen> {
  return new Plugin<Chosen>({
    key: CHOSEN,
    state: {
      init: () => ({ blocks: new Set<string>(), words: [] }),
      apply: (tr, value) => {
        const set = tr.getMeta(CHOSEN) as Chosen | undefined
        if (set) return set
        if (!tr.docChanged || value.words.length === 0) return value
        return { blocks: value.blocks, words: value.words.map(([from, to]) => [tr.mapping.map(from, 1), tr.mapping.map(to, -1)] as const).filter(([from, to]) => from < to) }
      },
    },
    props: {
      decorations(state) {
        const chosen = CHOSEN.getState(state)
        if (!chosen || (chosen.blocks.size === 0 && chosen.words.length === 0)) return null
        const marks: Decoration[] = []
        state.doc.forEach((node, pos) => {
          if (!chosen.blocks.has(node.attrs.id as string)) return
          // A line of text chosen whole shows its words, as Word does, not the blank space beside them;
          // an empty line, a mark where its first letter would be. Pictures, tables and formulas show the block.
          if (node.type.name !== 'textBlock') marks.push(Decoration.node(pos, pos + node.nodeSize, { 'data-chosen': '' }))
          else if (node.content.size > 0) marks.push(Decoration.inline(pos + 1, pos + node.nodeSize - 1, { class: 'nw-chosen-words' }))
          else marks.push(Decoration.node(pos, pos + node.nodeSize, { 'data-chosen-empty': '' }))
        })
        const size = state.doc.content.size
        for (const [from, to] of chosen.words) if (from < to && to <= size) marks.push(Decoration.inline(from, to, { class: 'nw-chosen-words' }))
        return DecorationSet.create(state.doc, marks)
      },
    },
  })
}

/** Set to true or false on a transaction to show or hide where the caret last was. */
export const LAST_CARET = new PluginKey<boolean>('shellnoteLastCaret')

/**
 * With nothing chosen and no text typed in, the toolbar acts where the caret
 * last was (target.ts); the frame it was in shows it in grey there, or the
 * words it last had selected, as Word shows a selection in a window that has
 * lost the focus.
 */
function lastCaretPlugin(): Plugin<boolean> {
  return new Plugin<boolean>({
    key: LAST_CARET,
    state: {
      init: () => false,
      apply: (tr, value) => (tr.getMeta(LAST_CARET) as boolean | undefined) ?? value,
    },
    props: {
      decorations(state) {
        const { selection } = state
        if (!LAST_CARET.getState(state) || !(selection instanceof TextSelection)) return null
        if (!selection.empty) return DecorationSet.create(state.doc, [Decoration.inline(selection.from, selection.to, { class: 'nw-last-selection' })])
        const caret = (): HTMLElement => {
          const mark = document.createElement('span')
          mark.className = 'nw-last-caret'
          return mark
        }
        return DecorationSet.create(state.doc, [Decoration.widget(selection.head, caret, { side: -1, key: 'last-caret', ignoreSelection: true })])
      },
    },
  })
}

/** Numbered items show their number, worked out as the exports do. */
function numbersPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey('shellnoteNumbers'),
    props: {
      decorations(state) {
        const numbering = listNumbering()
        const marks: Decoration[] = []
        state.doc.forEach((node, pos) => {
          const block = node.type.name === 'textBlock' ? { type: 'text', role: node.attrs.role, indent: node.attrs.indent } : { type: 'math' }
          const mark = numbering.next(block as Block)
          if (mark.kind === 'ordered') marks.push(Decoration.node(pos, pos + node.nodeSize, { 'data-number': listMarker(mark.level, mark.number) }))
        })
        return DecorationSet.create(state.doc, marks)
      },
    },
  })
}

/**
 * Under a picture or table without a caption, the caption line shows only
 * while the picture or table is selected or being typed in, with a hint to
 * type one.
 */
function captionsPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey('shellnoteCaptions'),
    props: {
      decorations(state) {
        const { from, to } = state.selection
        const marks: Decoration[] = []
        state.doc.forEach((node, pos) => {
          if (node.type.name !== 'imageBlock' && node.type.name !== 'tableBlock') return
          const end = pos + node.nodeSize
          // A picture's caption is its own text; a table's is its last child.
          const empty = (node.type.name === 'tableBlock' ? node.lastChild! : node).content.size === 0
          const editing = from >= pos && to <= end
          if (empty || editing) marks.push(Decoration.node(pos, end, { ...(empty ? { 'data-empty': '' } : {}), ...(editing ? { 'data-editing': '' } : {}) }))
        })
        return DecorationSet.create(state.doc, marks)
      },
    },
  })
}

/** A click on a picture in the text selects the picture, so Delete removes it. A click on its caption puts the caret there. */
function pictureClicks(): Plugin {
  return new Plugin({
    key: new PluginKey('shellnotePictureClicks'),
    props: {
      handleClickOn(view, _pos, node, nodePos, event) {
        if (node.type.name !== 'imageBlock' || !(event.target as Element).closest('.nw-image-pic')) return false
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodePos)))
        return true
      },
    },
  })
}

/** The marks of the inline Markdown subset. */
function markExtensions(): AnyExtension[] {
  return [
    Bold,
    Italic,
    // Ctrl+Shift+X, not the library's Ctrl+Shift+S, which saves to a new file.
    Strike.extend({ addKeyboardShortcuts: () => ({ 'Mod-Shift-x': ({ editor }) => editor.commands.toggleStrike() }) }),
    // Core allows marks around code, as in **`x`**.
    Code.extend({ excludes: '' }),
    Highlight,
    Underline,
    Subscript,
    Superscript,
    Link,
    Colour,
    WordSize,
    WordFont,
    WordKeys,
  ]
}

/**
 * The word marks' keys act on the selected words without the spaces at their
 * ends, as the bar does (words.ts). Taken before the marks' own keys.
 */
const WordKeys = Extension.create({
  name: 'shellnoteWordKeys',
  priority: 105,
  addKeyboardShortcuts() {
    const keys: Record<string, () => boolean> = {}
    // Always taken: a mark that replaces another (subscript for superscript) reports it could not be set though it was, and the mark's own key would then take it off again.
    const toggle = (mark: string) => (): boolean => {
      toggleWords(this.editor, mark)
      return true
    }
    for (const [key, mark] of [
      ['b', 'bold'],
      ['i', 'italic'],
      ['e', 'code'],
      ['u', 'underline'],
      ['=', 'subscript'],
      ['Shift-=', 'superscript'],
      ['+', 'superscript'],
      ['Shift-x', 'strike'],
      ['Shift-h', 'highlight'],
    ] as const) {
      keys[`Mod-${key}`] = toggle(mark)
      // With Caps Lock on, the key comes as a capital.
      if (/[a-z]$/u.test(key)) keys[`Mod-${key.slice(0, -1)}${key.at(-1)!.toUpperCase()}`] = toggle(mark)
    }
    return keys
  },
})

/** Everything a frame's editor is made of. */
export function frameExtensions(options: FrameOptions): AnyExtension[] {
  return [
    Doc,
    Text,
    TextBlock,
    MathInline,
    MathBlock,
    DiagramBlock.configure(options.objectHandle ? { objectHandle: options.objectHandle } : {}),
    ImageBlock.configure({ assetUrl: options.assetUrl, asset: options.asset }),
    TableBlock,
    Table.configure(options.objectHandle ? { objectHandle: options.objectHandle } : {}),
    TableRow,
    TableCell,
    TableHeader,
    TableCaption,
    TableKeys,
    ...markExtensions(),
    Behaviour.configure(options),
  ]
}

// ----- a caption under a picture placed on the page ----------------------------

/** A caption is one line of words. */
const CaptionDoc = Node.create({ name: 'caption', topNode: true, content: 'inline*' })

const CaptionBehaviour = Extension.create({
  name: 'shellnoteCaption',

  addKeyboardShortcuts() {
    const editor = this.editor
    // Enter and Escape finish the caption and hand the keys back to the picture.
    const done = (): boolean => {
      editor.view.dom.closest<HTMLElement>('.nw-picture')?.focus()
      return true
    }
    return { Enter: done, Escape: done }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('shellnoteCaptionEmpty'),
        props: { attributes: (state): Record<string, string> => (state.doc.content.size === 0 ? { 'data-empty': '' } : {}) },
      }),
    ]
  },
})

/** Everything the caption editor under a picture placed on the page is made of. */
export function captionExtensions(): AnyExtension[] {
  return [CaptionDoc, Text, MathInline, ...markExtensions(), CaptionBehaviour]
}
