// Read-only views of a page and its blocks. Text carries its role and style as
// data attributes (data-role="h1", data-color="red"), and theme.css draws them,
// so the editable frames produce the same attributes and look the same.
// Diagrams are drawn by Mermaid (diagram.ts), handwriting by ink/render.ts;
// math is a placeholder until its phase.
import { listNumbering, parseInline, type AnyColor, type Block, type ChildBlock, type Doc, type Frame, type FreeBlock, type Inline, type InkBlock, type ListMark, type Page, type TableBlock, type TextBlock } from '@shellnote/core'
import { Fragment, memo, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { colourProps, isColourCode } from './colours.js'
import { drawDiagram } from './diagram.js'
import { inFrameSize, mm } from './geometry.js'
import { lookOf, strokeRuns, strokeSignature } from './ink/render.js'
import { safeHref } from './links.js'
import { listMarker } from './markers.js'

/** Where to load each image from, by asset hash (object URLs made by the app). */
export type AssetUrls = Readonly<Record<string, string>>

// ----- inline text ----------------------------------------------------------------

/** Core's inline tree as React elements. */
export function InlineView({ nodes }: { nodes: readonly Inline[] }): ReactNode {
  return nodes.map(inlineNode)
}

function inlineNode(node: Inline, key: number): ReactNode {
  switch (node.t) {
    case 'text':
      return node.v
    case 'code':
      return <code key={key}>{node.v}</code>
    case 'math':
      return (
        <span key={key} className="nw-math-inline" data-tex={node.v}>
          {node.v}
        </span>
      )
    case 'b':
      return (
        <strong key={key}>
          <InlineView nodes={node.c} />
        </strong>
      )
    case 'i':
      return (
        <em key={key}>
          <InlineView nodes={node.c} />
        </em>
      )
    case 's':
      return (
        <s key={key}>
          <InlineView nodes={node.c} />
        </s>
      )
    case 'hl':
      return (
        <mark key={key}>
          <InlineView nodes={node.c} />
        </mark>
      )
    case 'link': {
      const href = safeHref(node.href)
      // An address a note may not hold is shown as plain words.
      if (href === undefined) return <InlineView key={key} nodes={node.c} />
      return (
        <a key={key} href={href} target="_blank" rel="noopener noreferrer">
          <InlineView nodes={node.c} />
        </a>
      )
    }
    case 'color':
      return (
        <span key={key} {...colourProps(node.color)}>
          <InlineView nodes={node.c} />
        </span>
      )
    case 'u':
      return (
        <u key={key}>
          <InlineView nodes={node.c} />
        </u>
      )
    case 'sub':
      return (
        <sub key={key}>
          <InlineView nodes={node.c} />
        </sub>
      )
    case 'sup':
      return (
        <sup key={key}>
          <InlineView nodes={node.c} />
        </sup>
      )
    case 'size':
      return (
        <span key={key} data-size={node.size}>
          <InlineView nodes={node.c} />
        </span>
      )
    case 'font':
      return (
        <span key={key} data-font={node.font}>
          <InlineView nodes={node.c} />
        </span>
      )
  }
}

// ----- blocks ---------------------------------------------------------------------

const HEADING = { h1: 'h1', h2: 'h2', h3: 'h3' } as const

/** One paragraph, heading, list item, to-do or quote. `mark` numbers it within its list. */
export function TextView({ block, mark }: { block: TextBlock; mark?: ListMark }) {
  const Tag = HEADING[block.role as keyof typeof HEADING] ?? 'p'
  return (
    <Tag
      className="nw-text"
      data-id={block.id}
      data-role={block.role}
      data-indent={block.indent || undefined}
      data-size={block.style?.size}
      data-color={block.style?.color}
      data-font={block.style?.font}
      data-align={block.style?.align}
      data-done={block.done ? '' : undefined}
      data-number={mark?.kind === 'ordered' ? listMarker(mark.level, mark.number) : undefined}
      style={{ '--nw-indent': block.indent, ...colourProps(block.style?.color).style } as CSSProperties}
    >
      <InlineView nodes={parseInline(block.md)} />
    </Tag>
  )
}

export function MathView({ block }: { block: Extract<Block, { type: 'math' }> }) {
  return (
    <div className="nw-math" data-id={block.id}>
      <code>{block.tex}</code>
      {block.value === undefined ? null : <span className="nw-math-value"> = {block.value}</span>}
    </div>
  )
}

/** A Mermaid diagram, drawn once Mermaid has loaded; its source until then, or when it cannot be drawn. */
export function DiagramView({ block }: { block: Extract<Block, { type: 'diagram' }> }) {
  const [svg, setSvg] = useState<{ src: string; svg: string }>()
  useEffect(() => {
    let live = true
    drawDiagram(block.src).then(
      (drawing) => live && setSvg({ src: block.src, svg: drawing }),
      () => live && setSvg(undefined),
    )
    return () => {
      live = false
    }
  }, [block.src])
  const shown = svg?.src === block.src ? svg.svg : undefined
  return (
    <figure className="nw-diagram" data-id={block.id} data-drawn={shown === undefined ? undefined : ''}>
      {/* Mermaid's strict mode cleans what it draws: no HTML, scripts or links from the source. */}
      {shown === undefined ? <pre>{block.src}</pre> : <div className="nw-diagram-svg" dangerouslySetInnerHTML={{ __html: shown }} />}
    </figure>
  )
}

/**
 * A picture and its caption. In a frame's text, the picture has its own size
 * up to the frame's width; placed on the page, it fills its box and the
 * caption hangs below. `caption` replaces the read-only caption, such as with
 * an editor for it.
 */
export function ImageView({ block, doc, assets, caption }: { block: Extract<Block, { type: 'image' }>; doc: Doc; assets: AssetUrls; caption?: ReactNode }) {
  const url = assets[block.asset]
  const size = 'parent' in block ? inFrameSize(doc.asset[block.asset]) : undefined
  return (
    <figure className="nw-image" data-id={block.id}>
      <div className="nw-image-pic" style={size}>
        {url ? <img src={url} alt={block.alt ?? ''} draggable={false} /> : <span className="nw-image-missing">{block.alt ?? 'Picture'}</span>}
      </div>
      {caption !== undefined ? caption : block.caption ? (
        <figcaption className="nw-caption">
          <InlineView nodes={parseInline(block.caption)} />
        </figcaption>
      ) : null}
    </figure>
  )
}

/** A table: its cells as formatted words, the first row as a header when it is one, and its caption under it. */
export function TableView({ block }: { block: TableBlock }) {
  return (
    <figure className="nw-table" data-id={block.id}>
      <table aria-description={block.alt}>
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r}>
              {row.map((md, c) => {
                const Cell = r === 0 && block.head ? 'th' : 'td'
                return (
                  <Cell key={c}>
                    <InlineView nodes={parseInline(md)} />
                  </Cell>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {block.caption ? (
        <figcaption className="nw-caption">
          <InlineView nodes={parseInline(block.caption)} />
        </figcaption>
      ) : null}
    </figure>
  )
}

/** A stroke's colour for CSS: a colour code as it is, a named colour through the theme's token; a highlighter's own, lighter ones. */
export const inkColour = (color: AnyColor, highlighter = false): string => (isColourCode(color) ? color : `var(--nw-${highlighter ? 'hl-' : ''}${color})`)

/**
 * Handwriting: each stroke a line through its points, as wide as its pen
 * pressed (ink/render.ts). A see-through stroke is one group, so where its
 * pieces meet it is no darker. Highlighter strokes sit in a layer of their
 * own, multiplied with what is behind them, so the words they mark show
 * through, as on paper.
 *
 * The drawing is the size of the page, at the page's own scale, held still
 * against the page however the block's box grows or moves its corner as
 * strokes join it: a new letter adds its own lines, and the letters before it
 * are never drawn again (they would land a hair off and flicker).
 */
export const InkView = memo(function InkView({ block, page }: { block: InkBlock; page: { w: number; h: number } }) {
  const under: ReactNode[] = []
  const over: ReactNode[] = []
  // Each stroke's drawing keyed by what it is on the page, not its place in the block, so erasing one draws no other again.
  const seen = new Map<string, number>()
  block.strokes.forEach((stroke) => {
    const look = lookOf(stroke.tool)
    const colour = inkColour(stroke.color, look.under)
    const signature = strokeSignature(stroke, block.x, block.y)
    const twin = seen.get(signature) ?? 0
    seen.set(signature, twin + 1)
    const group = (
      <g key={twin === 0 ? signature : `${signature}#${twin}`} stroke={colour} opacity={look.opacity === 1 ? undefined : look.opacity}>
        {strokeRuns(stroke, block.x, block.y).map((run) => (
          <path key={run.width} d={run.d} strokeWidth={run.width} />
        ))}
      </g>
    )
    ;(look.under ? under : over).push(group)
  })
  const box = `0 0 ${page.w} ${page.h}`
  // The page's corner, from the block's: where the page-sized drawing sits inside the block's box.
  const place: CSSProperties = { left: mm(-block.x), top: mm(-block.y), width: mm(page.w), height: mm(page.h) }
  const lines = { fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  return (
    <>
      {under.length > 0 ? (
        <svg className="nw-ink nw-ink-under" data-id={block.id} viewBox={box} style={place} aria-hidden {...lines}>
          {under}
        </svg>
      ) : null}
      {over.length > 0 ? (
        <svg className="nw-ink" data-id={block.id} viewBox={box} style={place} aria-label={block.text ?? 'Handwriting'} {...lines}>
          {over}
        </svg>
      ) : null}
    </>
  )
})

function ChildView({ block, doc, assets, mark }: { block: ChildBlock; doc: Doc; assets: AssetUrls; mark: ListMark }) {
  switch (block.type) {
    case 'text':
      return <TextView block={block} mark={mark} />
    case 'math':
      return <MathView block={block} />
    case 'diagram':
      return <DiagramView block={block} />
    case 'image':
      return <ImageView block={block} doc={doc} assets={assets} />
    case 'table':
      return <TableView block={block} />
    default:
      return null
  }
}

/** A column of text: its blocks in order, with lists numbered as the exports number them. */
export function FrameView({ frame, doc, assets }: { frame: Frame; doc: Doc; assets: AssetUrls }) {
  const numbering = listNumbering()
  return (
    <div className="nw-frame nw-free" data-id={frame.id} style={{ left: mm(frame.x), top: mm(frame.y), width: mm(frame.w) }}>
      {frame.kids.map((id) => {
        const kid = doc.block[id] as ChildBlock | undefined
        if (!kid) return null
        return <ChildView key={id} block={kid} doc={doc} assets={assets} mark={numbering.next(kid)} />
      })}
    </div>
  )
}

/** How to draw a block placed on the page instead of the read-only view, such as an editable one. */
export type FreeRenderer = (block: FreeBlock) => ReactNode

/** A block placed on the page with its own position and size. */
export function FreeView({ block, doc, assets }: { block: FreeBlock; doc: Doc; assets: AssetUrls }) {
  if (block.type === 'frame') return <FrameView frame={block} doc={doc} assets={assets} />
  const box: CSSProperties = { left: mm(block.x), top: mm(block.y), width: mm(block.w), height: mm(block.h) }
  return (
    <div className="nw-free" data-free={block.type} style={box}>
      <PlacedView block={block} doc={doc} assets={assets} />
    </div>
  )
}

/** A page's size when a block's page cannot be found: A4. */
const A4 = { w: 21000, h: 29700 }

/** What a block placed on the page shows inside its box. */
export function PlacedView({ block, doc, assets }: { block: Exclude<FreeBlock, { type: 'frame' }>; doc: Doc; assets: AssetUrls }) {
  switch (block.type) {
    case 'math':
      return <MathView block={block} />
    case 'diagram':
      return <DiagramView block={block} />
    case 'image':
      return <ImageView block={block} doc={doc} assets={assets} />
    case 'ink':
      return <InkView block={block} page={doc.page[block.page] ?? A4} />
  }
}

/**
 * One page at its real size, with its free blocks drawn back to front, by
 * `render` when it is given; then `children`, such as a Select box, on top.
 */
export function PageBox({ page, doc, assets, render, children }: { page: Page; doc: Doc; assets: AssetUrls; render?: FreeRenderer | undefined; children?: ReactNode }) {
  return (
    <div className="nw-page" data-page={page.id} data-bg={page.bg} style={{ width: mm(page.w), height: mm(page.h) }}>
      {page.free.map((id) => {
        const block = doc.block[id] as FreeBlock | undefined
        if (!block) return null
        return render ? <Fragment key={id}>{render(block)}</Fragment> : <FreeView key={id} block={block} doc={doc} assets={assets} />
      })}
      {children}
    </div>
  )
}
