// A table in a frame, drawn as Word draws one (Stage 3a): its columns at the
// widths they were given, as wide as it was made, in its look; and the handles
// that change it: ⊕ at its top left corner to choose or move it, each border
// between two columns to drag, and the bottom right corner for its width. A
// drag shows the new widths at once and hands them to the editor on release,
// so each is one undo step. Widths are shares in thousandths (core's cols and
// width): a cell keeps its column's share as prosemirror-tables' colwidth, so
// columns added or taken away keep the others' widths.
import { columnShares, equalShares, SHARE_TOTAL } from '@shellnote/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TableMap } from '@tiptap/pm/tables'
import type { EditorView, NodeView, ViewMutationRecord } from '@tiptap/pm/view'

/** The narrowest a column can be dragged to: 5% of the table. */
export const MIN_SHARE = 50
/** The narrowest a table can be made: a fifth of its frame. */
export const MIN_WIDTH = 200

/** Each column's share of the table's width, from its first row; undefined when no cell has one, as in a table never sized. */
export function columnWidths(table: PMNode): number[] | undefined {
  const map = TableMap.get(table)
  const widths: (number | null)[] = []
  for (let c = 0; c < map.width; c++) {
    const pos = map.map[c]!
    const colwidth = table.nodeAt(pos)!.attrs.colwidth as number[] | null
    widths.push(colwidth?.[c - map.colCount(pos)] ?? null)
  }
  return widths.some((width) => width !== null) ? columnShares(widths) : undefined
}

/** The shares a table is drawn with: its own, or equal ones. */
export function sharesOf(table: PMNode): number[] {
  return columnWidths(table) ?? equalShares(TableMap.get(table).width)
}

/** Each column's left edge, as a share of the table's width. */
function edges(shares: readonly number[]): number[] {
  let at = 0
  return shares.map((share) => (at += share) - share)
}

const percent = (share: number): string => `${share / (SHARE_TOTAL / 100)}%`

/** Lucide's "move" icon (ISC), as the handle Word shows. */
export const MOVE_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v20"/><path d="m15 19-3 3-3-3"/><path d="m19 9 3 3-3 3"/><path d="M2 12h20"/><path d="m5 9-3 3 3 3"/><path d="m9 5 3-3 3 3"/></svg>'

function part(className: string, attributes: Record<string, string> = {}): HTMLElement {
  const element = document.createElement('span')
  element.className = className
  element.contentEditable = 'false'
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value)
  return element
}

export class TableView implements NodeView {
  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement
  #node: PMNode
  readonly #view: EditorView
  readonly #getPos: () => number | undefined
  readonly #colgroup: HTMLElement
  readonly #borders: HTMLElement

  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined, onHandle?: (id: string, event: PointerEvent) => void) {
    this.#node = node
    this.#view = view
    this.#getPos = getPos
    this.dom = document.createElement('div')
    this.dom.className = 'nw-grid'
    const table = document.createElement('table')
    this.#colgroup = document.createElement('colgroup')
    this.contentDOM = document.createElement('tbody')
    table.append(this.#colgroup, this.contentDOM)
    const handle = part('nw-table-handle', { role: 'button', 'aria-label': 'Choose or move the table', title: 'Click to choose the table, drag to move it' })
    handle.innerHTML = MOVE_ICON
    this.#borders = part('nw-col-borders')
    const corner = part('nw-table-corner', { title: "Drag to change the table's width" })
    this.dom.append(table, handle, this.#borders, corner)
    handle.addEventListener('pointerdown', (event) => {
      const pos = this.#getPos()
      const id = pos === undefined ? undefined : (this.#view.state.doc.resolve(pos).parent.attrs.id as string | null)
      if (id && onHandle) onHandle(id, event)
    })
    this.#borders.addEventListener('pointerdown', (event) => this.#dragBorder(event))
    corner.addEventListener('pointerdown', (event) => this.#dragCorner(event, corner))
    this.#draw()
  }

  update(node: PMNode): boolean {
    if (node.type !== this.#node.type) return false
    this.#node = node
    this.#draw()
    return true
  }

  /** The handles, the columns' widths and the table's own width are this view's: only the cells are the editor's. */
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return mutation.type !== 'selection' && !this.contentDOM.contains(mutation.target)
  }

  /** A press on a handle is the handle's, not a place for the caret. */
  stopEvent(event: Event): boolean {
    return event.target instanceof Element && event.target.closest('.nw-table-handle, .nw-col-border, .nw-table-corner') !== null
  }

  #draw(): void {
    this.#show(sharesOf(this.#node))
    const width = this.#node.attrs.width as number | null
    this.dom.style.width = percent(width ?? SHARE_TOTAL)
    this.dom.dataset.look = (this.#node.attrs.look as string | null) ?? 'grid'
  }

  /** Columns at these widths, and a border to drag between each two. */
  #show(shares: readonly number[]): void {
    const cols = this.#colgroup.children
    while (cols.length > shares.length) cols[cols.length - 1]!.remove()
    while (cols.length < shares.length) this.#colgroup.append(document.createElement('col'))
    shares.forEach((share, i) => ((cols[i] as HTMLElement).style.width = percent(share)))
    const lefts = edges(shares).slice(1)
    const borders = this.#borders.children
    while (borders.length > lefts.length) borders[borders.length - 1]!.remove()
    while (borders.length < lefts.length) this.#borders.append(part('nw-col-border', { title: 'Drag to change the columns’ widths' }))
    lefts.forEach((left, i) => {
      const border = borders[i] as HTMLElement
      border.dataset.col = String(i)
      border.style.left = percent(left)
    })
  }

  #dragBorder(down: PointerEvent): void {
    const border = down.target instanceof Element ? down.target.closest<HTMLElement>('.nw-col-border') : null
    if (!border || down.button !== 0) return
    down.preventDefault()
    const col = Number(border.dataset.col)
    const start = sharesOf(this.#node)
    const pair = start[col]! + start[col + 1]!
    if (pair < 2 * MIN_SHARE) return
    const across = this.dom.getBoundingClientRect().width
    let shares = start
    this.dom.dataset.resizing = ''
    this.#track(
      border,
      down,
      (event) => {
        const left = Math.min(pair - MIN_SHARE, Math.max(MIN_SHARE, start[col]! + Math.round(((event.clientX - down.clientX) / across) * SHARE_TOTAL)))
        shares = start.map((share, i) => (i === col ? left : i === col + 1 ? pair - left : share))
        this.#show(shares)
      },
      (done) => {
        delete this.dom.dataset.resizing
        if (done && shares !== start) this.#setShares(shares)
        else this.#draw()
      },
    )
  }

  #dragCorner(down: PointerEvent, corner: HTMLElement): void {
    if (down.button !== 0) return
    down.preventDefault()
    const frame = this.dom.parentElement?.getBoundingClientRect()
    if (!frame) return
    const left = this.dom.getBoundingClientRect().left
    const before = (this.#node.attrs.width as number | null) ?? SHARE_TOTAL
    let width = before
    this.dom.dataset.resizing = ''
    this.#track(
      corner,
      down,
      (event) => {
        width = Math.min(SHARE_TOTAL, Math.max(MIN_WIDTH, Math.round(((event.clientX - left) / frame.width) * SHARE_TOTAL)))
        this.dom.style.width = percent(width)
      },
      (done) => {
        delete this.dom.dataset.resizing
        const pos = this.#getPos()
        if (!done || width === before || pos === undefined) return this.#draw()
        this.#view.dispatch(this.#view.state.tr.setNodeMarkup(pos, undefined, { ...this.#node.attrs, width: width === SHARE_TOTAL ? null : width }))
      },
    )
  }

  /** Follow a pointer pressed on a handle until it is let go (done) or the press is taken away (not done). */
  #track(handle: HTMLElement, down: PointerEvent, move: (event: PointerEvent) => void, end: (done: boolean) => void): void {
    handle.setPointerCapture(down.pointerId)
    const onMove = (event: PointerEvent): void => move(event)
    const finish = (event: PointerEvent): void => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', finish)
      handle.removeEventListener('pointercancel', finish)
      end(event.type === 'pointerup')
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', finish)
    handle.addEventListener('pointercancel', finish)
  }

  /** Give every cell its column's new share, in one transaction: one undo step. */
  #setShares(shares: readonly number[]): void {
    const pos = this.#getPos()
    if (pos === undefined) return
    const table = this.#node
    const map = TableMap.get(table)
    const tr = this.#view.state.tr
    for (const cellPos of new Set(map.map)) {
      const cell = table.nodeAt(cellPos)!
      const from = map.colCount(cellPos)
      tr.setNodeMarkup(pos + 1 + cellPos, undefined, { ...cell.attrs, colwidth: shares.slice(from, from + (cell.attrs.colspan as number)) })
    }
    this.#view.dispatch(tr)
  }
}
