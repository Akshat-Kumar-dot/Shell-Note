// Between core's blocks and a frame editor's content. Core to editor when a
// frame opens or changes from outside; editor to drafts (ChildDraft) when the
// person types, which frameOps then turns into operations.
import { fromRuns, sameRuns, toRuns, type ChildBlock, type ChildDraft, type Color, type Doc, type Frame, type Id, type Marks, type Run, type Selection, type Size, type TableLook } from '@shellnote/core'
import type { JSONContent } from '@tiptap/core'
import type { Mark as PMMark, Node as PMNode } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'
import { TableMap } from '@tiptap/pm/tables'
import { columnWidths } from './tableView.js'

/** Core's mark names and the editor's. Link, colour, size and font carry a value and are handled apart. */
const MARKS: [keyof Marks, string][] = [
  ['b', 'bold'],
  ['i', 'italic'],
  ['s', 'strike'],
  ['code', 'code'],
  ['hl', 'highlight'],
  ['u', 'underline'],
  ['sub', 'subscript'],
  ['sup', 'superscript'],
]

/** A text block's md as the editor's inline content. */
export function inlineJSON(md: string): JSONContent[] {
  return toRuns(md)
    .filter((run) => !('text' in run) || run.text !== '')
    .map((run) => {
      const marks: NonNullable<JSONContent['marks']> = MARKS.filter(([key]) => run.marks[key]).map(([, type]) => ({ type }))
      if (run.marks.color) marks.push({ type: 'colour', attrs: { color: run.marks.color } })
      if (run.marks.link) marks.push({ type: 'link', attrs: { href: run.marks.link } })
      if (run.marks.size) marks.push({ type: 'wordSize', attrs: { size: run.marks.size } })
      if (run.marks.font) marks.push({ type: 'wordFont', attrs: { font: run.marks.font } })
      const withMarks = marks.length > 0 ? { marks } : {}
      return 'math' in run ? { type: 'mathInline', attrs: { tex: run.math }, ...withMarks } : { type: 'text', text: run.text, ...withMarks }
    })
}

export function blockJSON(block: ChildBlock): JSONContent {
  switch (block.type) {
    case 'text': {
      const content = inlineJSON(block.md)
      return {
        type: 'textBlock',
        attrs: {
          id: block.id,
          role: block.role,
          indent: block.indent,
          size: block.style?.size ?? null,
          color: block.style?.color ?? null,
          font: block.style?.font ?? null,
          align: block.style?.align ?? null,
          done: block.done === true,
        },
        ...(content.length > 0 ? { content } : {}),
      }
    }
    case 'math':
      return { type: 'mathBlock', attrs: { id: block.id, tex: block.tex, value: block.value ?? null } }
    case 'image': {
      const caption = inlineJSON(block.caption ?? '')
      return { type: 'imageBlock', attrs: { id: block.id, asset: block.asset, alt: block.alt ?? null }, ...(caption.length > 0 ? { content: caption } : {}) }
    }
    case 'diagram':
      return { type: 'diagramBlock', attrs: { id: block.id, src: block.src } }
    case 'table': {
      // Each cell carries its column's share, as prosemirror-tables keeps a column's width (tableView.ts).
      const cell = (md: string, header: boolean, column: number): JSONContent => {
        const content = inlineJSON(md)
        const share = block.cols?.[column]
        return { type: header ? 'tableHeader' : 'tableCell', ...(share === undefined ? {} : { attrs: { colwidth: [share] } }), ...(content.length > 0 ? { content } : {}) }
      }
      const caption = inlineJSON(block.caption ?? '')
      return {
        type: 'tableBlock',
        attrs: { id: block.id, alt: block.alt ?? null },
        content: [
          {
            type: 'table',
            attrs: { width: block.width ?? null, look: block.look ?? null },
            content: block.rows.map((row, r) => ({ type: 'tableRow', content: row.map((md, c) => cell(md, r === 0 && block.head === true, c)) })),
          },
          { type: 'tableCaption', ...(caption.length > 0 ? { content: caption } : {}) },
        ],
      }
    }
  }
}

/** A frame's blocks as the editor's document. An empty frame shows one empty paragraph to type in. */
export function frameJSON(doc: Doc, frameId: Id): JSONContent {
  const frame = doc.block[frameId] as Frame
  const content = frame.kids.map((id) => blockJSON(doc.block[id] as ChildBlock))
  return { type: 'doc', content: content.length > 0 ? content : [{ type: 'textBlock' }] }
}

/**
 * The editor's document as drafts for frameOps. An empty paragraph alone in a
 * frame is the place to type, not a block: a frame that shows only it is empty.
 */
export function draftsOf(doc: PMNode): ChildDraft[] {
  const drafts: ChildDraft[] = []
  doc.forEach((node) => {
    const id = node.attrs.id as string
    switch (node.type.name) {
      case 'textBlock': {
        const a = node.attrs as { role: string; indent: number; size: string | null; color: string | null; font: string | null; align: string | null; done: boolean }
        const style = Object.fromEntries(
          (['size', 'color', 'font', 'align'] as const).flatMap((key) => (a[key] === null ? [] : [[key, a[key]]])),
        )
        drafts.push({
          id,
          type: 'text',
          role: a.role,
          indent: a.indent,
          md: fromRuns(runsOf(node)),
          ...(Object.keys(style).length > 0 ? { style } : {}),
          ...(a.role === 'todo' && a.done ? { done: true } : {}),
        } as ChildDraft)
        break
      }
      case 'mathBlock':
        drafts.push({ id, type: 'math', tex: node.attrs.tex as string, ...(node.attrs.value === null ? {} : { value: node.attrs.value as string }) })
        break
      case 'imageBlock': {
        const caption = fromRuns(runsOf(node))
        drafts.push({
          id,
          type: 'image',
          asset: node.attrs.asset as string,
          ...(node.attrs.alt === null ? {} : { alt: node.attrs.alt as string }),
          ...(caption === '' ? {} : { caption }),
        })
        break
      }
      case 'diagramBlock':
        drafts.push({ id, type: 'diagram', lang: 'mermaid', src: node.attrs.src as string })
        break
      case 'tableBlock':
        drafts.push(tableDraft(node))
        break
    }
  })
  const only = drafts[0]
  if (drafts.length === 1 && only?.type === 'text' && only.md === '' && only.role === 'p' && only.indent === 0 && !only.style) return []
  return drafts
}

/**
 * Keep core's own words for blocks that look the same. md can say one thing
 * in more than one way ([x]{.b} and **x**); a block or caption that came from
 * a file or an AI keeps its form until the person changes how it looks, so
 * typing in one block never rewrites another.
 */
export function keepForms(drafts: readonly ChildDraft[], doc: Doc): ChildDraft[] {
  return drafts.map((draft) => {
    const old = doc.block[draft.id]
    if (draft.type === 'text' && old?.type === 'text' && old.md !== draft.md) {
      return sameRuns(toRuns(old.md), toRuns(draft.md)) ? { ...draft, md: old.md } : draft
    }
    if (draft.type === 'table' && old?.type === 'table') {
      const rows = draft.rows.map((row, r) => row.map((md, c) => keepForm(old.rows[r]?.[c], md)))
      const caption = draft.caption === undefined ? undefined : keepForm(old.caption, draft.caption)
      return { ...draft, rows, ...(caption === undefined ? {} : { caption }) }
    }
    if (draft.type === 'image' && old?.type === 'image' && draft.caption !== undefined) {
      return { ...draft, caption: keepForm(old.caption, draft.caption) }
    }
    return draft
  })
}

/** Core's words when the editor's say the same thing another way; else the editor's. */
function keepForm(old: string | undefined, md: string): string {
  return old !== undefined && old !== md && sameRuns(toRuns(old), toRuns(md)) ? old : md
}

/**
 * A table as core holds it: one cell per spot. A merged cell, as pasted from
 * elsewhere, gives its words to its first spot and leaves the rest empty.
 * The first row is a header when all its cells are header cells.
 */
function tableDraft(node: PMNode): ChildDraft {
  const table = node.child(0)
  const map = TableMap.get(table)
  const rows: string[][] = []
  for (let r = 0; r < map.height; r++) {
    const row: string[] = []
    for (let c = 0; c < map.width; c++) {
      const at = r * map.width + c
      const pos = map.map[at]!
      // Cells hold one line; a pasted line break becomes a space.
      row.push(map.map.indexOf(pos) === at ? fromRuns(runsOf(table.nodeAt(pos)!)).replace(/\s*\n\s*/gu, ' ') : '')
    }
    rows.push(row)
  }
  const first = table.firstChild!
  const head = first.childCount > 0 && Array.from({ length: first.childCount }, (_, i) => first.child(i)).every((cell) => cell.type.name === 'tableHeader')
  const caption = fromRuns(runsOf(node.child(1)))
  const alt = node.attrs.alt as string | null
  // Its size and look; a column just added gets a share of its own here (columnWidths).
  const cols = columnWidths(table)
  const width = table.attrs.width as number | null
  const look = table.attrs.look as TableLook | null
  return {
    id: node.attrs.id as string,
    type: 'table',
    rows,
    ...(head ? { head: true } : {}),
    ...(alt === null ? {} : { alt }),
    ...(caption === '' ? {} : { caption }),
    ...(cols === undefined ? {} : { cols }),
    ...(width === null ? {} : { width }),
    ...(look === null ? {} : { look }),
  }
}

/** The words of a text block or a caption, as runs. */
export function runsOf(node: PMNode): Run[] {
  const runs: Run[] = []
  node.forEach((child) => {
    const marks = marksOf(child.marks)
    if (child.isText) runs.push({ text: child.text ?? '', marks })
    else if (child.type.name === 'mathInline') runs.push({ math: child.attrs.tex as string, marks })
  })
  return runs
}

function marksOf(marks: readonly PMMark[]): Marks {
  const out: Marks = {}
  for (const mark of marks) {
    const key = MARKS.find(([, type]) => type === mark.type.name)?.[0]
    if (key === 'b' || key === 'i' || key === 's' || key === 'hl' || key === 'code' || key === 'u' || key === 'sub' || key === 'sup') out[key] = true
    else if (mark.type.name === 'link') out.link = mark.attrs.href as string
    else if (mark.type.name === 'colour') out.color = mark.attrs.color as Color
    else if (mark.type.name === 'wordSize' && mark.attrs.size) out.size = mark.attrs.size as Size
    else if (mark.type.name === 'wordFont' && mark.attrs.font) out.font = mark.attrs.font as string
  }
  return out
}

/**
 * A position inside a text block, from the editor's count to core's. They
 * agree on text; a formula is one position in the editor and its $tex$ in
 * core's plain text (see markdown/range.ts).
 */
export function coreOffset(block: PMNode, offset: number): number {
  let at = 0
  let core = 0
  let result: number | undefined
  block.forEach((child) => {
    if (result !== undefined) return
    if (offset <= at) {
      result = core
      return
    }
    if (child.isText && offset < at + child.nodeSize) {
      result = core + (offset - at)
      return
    }
    at += child.nodeSize
    core += child.isText ? (child.text ?? '').length : child.type.name === 'mathInline' ? (child.attrs.tex as string).length + 2 : 0
  })
  return result ?? core
}

/**
 * A position inside a text block, from core's count to the editor's: the
 * inverse of coreOffset. A position inside a formula's $tex$ snaps to the
 * formula's start or end.
 */
export function editorOffset(block: PMNode, core: number): number {
  let at = 0
  let count = 0
  let result: number | undefined
  block.forEach((child) => {
    if (result !== undefined) return
    const length = child.isText ? (child.text ?? '').length : child.type.name === 'mathInline' ? (child.attrs.tex as string).length + 2 : 0
    if (child.isText && core <= count + length) result = at + (core - count)
    else if (core < count + length) result = core === count ? at : at + child.nodeSize
    else {
      at += child.nodeSize
      count += length
    }
  })
  return result ?? at
}

/**
 * The editor's selection in core's terms: the blocks it touches and, inside
 * one text block, the words. The empty paragraph of an empty frame is not a
 * block yet, so it is never selected.
 */
export function selectionOf(state: EditorState, doc: Doc): Selection {
  const { from, to, empty, $from, $to } = state.selection
  const blocks: Id[] = []
  state.doc.forEach((node, pos) => {
    const id = node.attrs.id as string | null
    if (!id || !doc.block[id]) return
    const end = pos + node.nodeSize
    if (empty ? pos < from && from < end : from < end && to > pos) blocks.push(id)
  })
  const parent = $from.parent
  const id = parent.attrs.id as string | null
  if (!empty && parent === $to.parent && parent.type.name === 'textBlock' && id && doc.block[id]) {
    return { blocks, range: { block: id, start: coreOffset(parent, $from.parentOffset), end: coreOffset(parent, $to.parentOffset) } }
  }
  return { blocks }
}
