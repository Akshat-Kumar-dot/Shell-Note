// One step of a board: its shape's outline from core's `shapePath`, the outline the print and the library's picture
// draw too, and its words where core measured them (`wordsArea`), so they wrap as they were sized. A step with a colour
// has its outline in it and a light tint inside; one without, a dark outline on a light ground. Only the shape itself
// takes a press: a diamond's corner is the board under it. While its words are typed in place (StepWords.tsx), their
// editor shows them, and the step's own are hidden.
import { parseInline, shapePath, wordsArea, type NodeBlock } from '@shellnote/core'
import { memo, type CSSProperties } from 'react'
import { InlineView, inkColour } from '../blocks.js'
import { mm } from '../geometry.js'

export const StepView = memo(function StepView({ node, box, typing = false }: { node: NodeBlock; box?: { x: number; y: number; w: number; h: number } | undefined; typing?: boolean }) {
  // A step being moved or sized is drawn where it is going, from `box`.
  const { x, y, w, h } = box ?? node
  const words = wordsArea(node.shape, { x: 0, y: 0, w, h })
  const style = { left: mm(x), top: mm(y), width: mm(w), height: mm(h), ...(node.color === undefined ? {} : { '--nw-step-colour': inkColour(node.color) }) } as CSSProperties
  return (
    <div className="nw-step" data-id={node.id} data-shape={node.shape} data-coloured={node.color === undefined ? undefined : ''} style={style}>
      <svg className="nw-step-shape" viewBox={`0 0 ${w} ${h}`} aria-hidden>
        <path d={shapePath(node.shape, w, h)} />
      </svg>
      <div className="nw-step-words" data-typing={typing ? '' : undefined} style={{ left: mm(words.x), top: mm(words.y), width: mm(words.w), height: mm(words.h) }}>
        <span>
          <InlineView nodes={parseInline(node.md)} />
        </span>
      </div>
    </div>
  )
})
