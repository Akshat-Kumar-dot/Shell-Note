// A board's links, under its steps: each one's line as core runs it (route.ts), an arrow at its end unless it has none,
// dotted or thick when it says so, and its words on a patch of paper where core placed them (labels.ts). Only the links
// near the view are drawn. Each takes a press along a band wider than its line, so a thin line is easy to choose.
import { LABEL_SIZE, overlaps, routeBox, type Box, type DrawnLink, type Route } from '@shellnote/core'
import { memo } from 'react'
import { mm } from '../geometry.js'

/** A link's path as SVG path data. */
export function pathData(route: Pick<Route, 'kind' | 'points'>): string {
  const [first, ...rest] = route.points
  if (!first) return ''
  if (route.kind === 'curved') {
    const [c1, c2, end] = rest as [Route['points'][number], Route['points'][number], Route['points'][number]]
    return `M${first.x} ${first.y}C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}`
  }
  return `M${first.x} ${first.y}${rest.map((point) => `L${point.x} ${point.y}`).join('')}`
}

export const LinkLayer = memo(function LinkLayer({ links, view, chosen, arrow }: { links: readonly DrawnLink[]; view: Box; chosen: string | undefined; arrow: string }) {
  const near = links.filter((link) => overlaps(routeBox(link.route), view) || (link.label !== undefined && overlaps(link.label, view)))
  return (
    <svg className="nw-links" viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} style={{ left: mm(view.x), top: mm(view.y), width: mm(view.w), height: mm(view.h) }}>
      <defs>
        <marker id={arrow} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" className="nw-link-head" />
        </marker>
      </defs>
      {near.map((link) => {
        const d = pathData(link.route)
        const key = `${link.from}>${link.to}`
        return (
          <g key={key} className="nw-link" data-from={link.from} data-to={link.to} data-line={link.link.line} data-chosen={chosen === key ? '' : undefined}>
            <path className="nw-link-hit" d={d} />
            <path className="nw-link-line" d={d} markerEnd={link.link.head === 'none' ? undefined : `url(#${arrow})`} />
            {link.label ? (
              <g className="nw-link-words">
                <rect x={link.label.x} y={link.label.y} width={link.label.w} height={link.label.h} rx={120} />
                <text x={link.label.x + link.label.w / 2} y={link.label.y + link.label.h / 2} fontSize={LABEL_SIZE}>
                  {link.link.label}
                </text>
              </g>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
})
