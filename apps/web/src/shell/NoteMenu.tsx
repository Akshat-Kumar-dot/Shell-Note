// The note's own menu, at the end of the tabs, as the sketch has it: what the note is (Kind), its pages (size, which
// way up, shown as pages or as one sheet), its paper and its cover; then saving, printing, and what the AI changed.
// Kind, Page and Paper open their choices in the menu itself, with a way back. Each choice is a command, one undo step.
import type { EditorStore } from '@shellnote/editor'
import { commands, MenuItem, pagesOf, paperOps, PAPERS, type Paper } from '@shellnote/editor'
import type { NoteKind } from '@shellnote/core'
import { ChevronLeft, FileText, ImageMinus, ImagePlus, Layers, LayoutGrid, PenLine, Printer, Ruler } from 'lucide-react'
import { useState, useSyncExternalStore, type ReactNode } from 'react'

const KINDS: readonly [NoteKind, string, string, typeof FileText][] = [
  ['text', 'Text', 'for typing', FileText],
  ['sketch', 'Sketch', 'a sheet for the pen', PenLine],
  ['mixed', 'Mixed', 'typing and the pen', Layers],
]
const SIZES = [
  ['a4', 'A4'],
  ['a5', 'A5'],
  ['a6', 'A6'],
  ['letter', 'Letter'],
] as const

type Level = 'main' | 'kind' | 'page' | 'paper'

export interface NoteMenuProps {
  store: EditorStore
  close: () => void
  /** Whether this window edits the note: another window may, and then nothing here changes it. */
  editing: boolean
  /** The menu's other lines: saving and opening, then the view's, as the workspace gives them. */
  children: ReactNode
  /** Export and what the AI changed, last. */
  after: ReactNode
}

export function NoteMenu({ store, close, editing, children, after }: NoteMenuProps) {
  const doc = useSyncExternalStore(store.subscribe, store.snapshot)
  const [level, setLevel] = useState<Level>('main')
  const kind = doc.kind ?? 'mixed'
  const seamless = doc.view === 'seamless'
  const { sheet, turn } = pagesOf(doc)
  const papers = new Set(doc.pages.map((id) => doc.page[id]!.bg))
  const paperNow = papers.size === 1 ? [...papers][0]! : undefined
  const sheetWord = SIZES.find(([, name]) => name === sheet)?.[1] ?? 'Own size'
  const shownWord = seamless ? (kind === 'sketch' ? 'growing sheet' : 'no page breaks') : 'pages'
  const back = (
    <MenuItem label="Back to This note" onChoose={() => setLevel('main')}>
      <ChevronLeft size={18} aria-hidden />
      This note
    </MenuItem>
  )

  if (level === 'kind')
    return (
      <>
        {back}
        <div className="sh-menu-head">What this note is for</div>
        {KINDS.map(([value, name, what, Icon]) => (
          <MenuItem
            key={value}
            label={`${name} note`}
            title={`A ${name.toLowerCase()} note: ${what}. Its tools and the paper of new pages follow; what it holds stays as it is.`}
            checked={kind === value}
            command="note.kind"
            disabled={!editing}
            onChoose={() => {
              close()
              commands.tap('note.kind', { type: value })
            }}
          >
            <Icon size={18} aria-hidden />
            {name}
            <em>{what}</em>
          </MenuItem>
        ))}
      </>
    )

  if (level === 'page')
    return (
      <>
        {back}
        <div className="sh-menu-head">Size</div>
        {SIZES.map(([value, name]) => (
          <MenuItem
            key={value}
            label={`Pages ${name}`}
            title={`Every page ${name}: what each holds is fitted to it`}
            checked={sheet === name}
            command="page.size"
            disabled={!editing}
            onChoose={() => {
              close()
              commands.tap('page.size', { sheet: value })
            }}
          >
            {name}
          </MenuItem>
        ))}
        <div className="sh-menu-head">Which way up</div>
        {(
          [
            ['upright', 'Upright', 'taller than wide, as a book'],
            ['across', 'Across', 'wider than tall, as a slide'],
          ] as const
        ).map(([value, name, what]) => (
          <MenuItem
            key={value}
            label={`Pages ${name.toLowerCase()}`}
            title={`Every page ${what}`}
            checked={turn === value}
            command="page.size"
            disabled={!editing}
            onChoose={() => {
              close()
              commands.tap('page.size', { turn: value })
            }}
          >
            {name}
            <em>{what}</em>
          </MenuItem>
        ))}
        <div className="sh-menu-head">Shown as</div>
        <MenuItem
          label="Pages, one below another"
          title="Pages one below another, with the buttons that add or delete a page"
          checked={!seamless}
          command="note.seamless"
          onChoose={() => {
            close()
            commands.tap('note.seamless', { on: false })
          }}
        >
          Pages
          <em>one below another</em>
        </MenuItem>
        <MenuItem
          label={kind === 'sketch' ? 'One growing sheet' : 'No page breaks'}
          title="One sheet with no page breaks, the same pages inside: it grows as you write, and prints as its pages"
          checked={seamless}
          command="note.seamless"
          onChoose={() => {
            close()
            commands.tap('note.seamless', { on: true })
          }}
        >
          {kind === 'sketch' ? 'One growing sheet' : 'No page breaks'}
          <em>the same pages inside</em>
        </MenuItem>
      </>
    )

  if (level === 'paper')
    return (
      <>
        {back}
        <div className="sh-menu-head">Paper, on every page</div>
        {PAPERS.map(([value, name]) => (
          <MenuItem
            key={value}
            label={name}
            title={`${name} paper on every page`}
            checked={paperNow === value}
            disabled={!editing}
            onChoose={() => {
              close()
              const ops = paperOps(store.doc, store.doc.pages, value as Paper)
              if (ops.length > 0) store.apply(ops, { origin: 'toolbar' })
            }}
          >
            {name}
          </MenuItem>
        ))}
      </>
    )

  // A board is made as one and stays one, and its one page is endless: it has no kind to change and no page size.
  const board = kind === 'board'
  return (
    <>
      <div className="sh-menu-head">This note</div>
      {board ? null : (
        <MenuItem label="Kind" title="What this note is for: text, sketch or mixed" onChoose={() => setLevel('kind')}>
          <Layers size={18} aria-hidden />
          Kind
          <em>{KINDS.find(([value]) => value === kind)?.[1] ?? kind} ›</em>
        </MenuItem>
      )}
      {board ? null : (
        <MenuItem label="Page" title="The pages' size, which way up, and whether they show as pages or as one sheet" onChoose={() => setLevel('page')}>
          <Ruler size={18} aria-hidden />
          Page
          <em>
            {sheetWord}
            {turn === 'across' ? ' across' : ''} · {shownWord} ›
          </em>
        </MenuItem>
      )}
      <MenuItem label="Paper" title={board ? 'Blank, lines, squares or dots, on the board' : 'Blank, lines, squares or dots, on every page'} onChoose={() => setLevel('paper')}>
        <LayoutGrid size={18} aria-hidden />
        Paper
        <em>{(PAPERS.find(([value]) => value === paperNow)?.[1] ?? 'Mixed') + ' ›'}</em>
      </MenuItem>
      <MenuItem
        label="Cover picture"
        title="A picture of your own for the note's card in the library, kept in the note's file"
        command="note.cover"
        disabled={!editing}
        onChoose={() => {
          close()
          commands.tap('note.cover', { on: true })
        }}
      >
        <ImagePlus size={18} aria-hidden />
        {doc.cover ? 'Change the cover picture…' : 'Cover picture…'}
      </MenuItem>
      {doc.cover ? (
        <MenuItem
          label="Take the cover off"
          command="note.cover"
          disabled={!editing}
          onChoose={() => {
            close()
            commands.tap('note.cover', { on: false })
          }}
        >
          <ImageMinus size={18} aria-hidden />
          Take the cover off
        </MenuItem>
      ) : null}
      <hr />
      {children}
      {board ? null : (
        <MenuItem
          label="Export"
          title="Print the note, or save it as a PDF from the print window: each page on its own sheet, on white paper"
          command="note.print"
          onChoose={() => {
            close()
            commands.press('note.print')
          }}
        >
          <Printer size={18} aria-hidden />
          Export…
        </MenuItem>
      )}
      {after}
    </>
  )
}
