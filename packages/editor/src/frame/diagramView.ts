// A diagram in a frame's text, drawn by Mermaid once it has loaded, as on the
// page (diagram.ts). The source shows until then, and when it cannot be drawn.
// Its ⊕ handle, as a table's, chooses it with a click and moves it with a
// drag (objectDrag.ts): onto bare paper, it goes on its own, to be resized.
import type { Node as PMNode } from '@tiptap/pm/model'
import type { NodeView } from '@tiptap/pm/view'
import { drawDiagram } from '../diagram.js'
import { MOVE_ICON } from './tableView.js'

export class DiagramView implements NodeView {
  readonly dom: HTMLElement
  readonly #drawing: HTMLElement
  #src: string | undefined
  #id: string | null = null

  constructor(node: PMNode, handle?: (id: string, event: PointerEvent) => void) {
    this.dom = document.createElement('figure')
    this.dom.className = 'nw-diagram'
    this.#drawing = document.createElement('div')
    this.dom.append(this.#drawing)
    if (handle) {
      const grip = document.createElement('span')
      grip.className = 'nw-object-handle'
      grip.setAttribute('role', 'button')
      grip.setAttribute('aria-label', 'Choose or move the diagram')
      grip.title = 'Click to choose the diagram, drag to move it; onto bare paper, it can then be resized'
      grip.contentEditable = 'false'
      grip.innerHTML = MOVE_ICON
      grip.addEventListener('pointerdown', (event) => {
        if (this.#id) handle(this.#id, event)
      })
      this.dom.append(grip)
    }
    this.#show(node)
  }

  /** A press on the handle is the handle's, not the text editor's. */
  stopEvent(event: Event): boolean {
    return event.target instanceof Element && event.target.closest('.nw-object-handle') !== null
  }

  update(node: PMNode): boolean {
    if (node.type.name !== 'diagramBlock') return false
    this.#show(node)
    return true
  }

  #show(node: PMNode): void {
    const { id, src } = node.attrs as { id: string | null; src: string }
    this.#id = id
    if (id) this.dom.dataset.id = id
    else delete this.dom.dataset.id
    if (src === this.#src) return
    this.#src = src
    const pre = this.dom.ownerDocument.createElement('pre')
    pre.textContent = src
    this.#drawing.replaceChildren(pre)
    delete this.dom.dataset.drawn
    drawDiagram(src).then(
      (svg) => {
        if (this.#src !== src) return
        const drawing = this.dom.ownerDocument.createElement('div')
        drawing.className = 'nw-diagram-svg'
        // Mermaid's strict mode cleans what it draws: no HTML, scripts or links from the source.
        drawing.innerHTML = svg
        this.#drawing.replaceChildren(drawing)
        this.dom.dataset.drawn = ''
      },
      () => {},
    )
  }
}
