// The geometry of a board's nodes: each shape's outline in its box, and the point on each of its four sides where a
// link meets it. It is here, with no browser, so that the screen, the print and the library's small picture draw the
// same shape, and a link ends on the outline whatever draws it. Units are 0.01 mm, whole numbers.
import type { Box } from '../ink/geometry.js'
import type { NodeShape } from '../schema/doc.js'

export type Side = 'top' | 'right' | 'bottom' | 'left'

/** How far a shape's slanted sides lean in from its box, for the shapes that have them; 0 for the others. */
export function leanOf(shape: NodeShape, w: number, h: number): number {
  switch (shape) {
    case 'hexagon':
      return Math.round(Math.min(h / 2, w / 4))
    case 'slant':
    case 'slant-back':
    case 'trapezoid':
    case 'trapezoid-down':
      return Math.round(Math.min(h * 0.4, w / 4))
    case 'flag':
      return Math.round(Math.min(h / 2, w / 5))
    default:
      return 0
  }
}

/** A rectangle with its corners rounded by `r`. */
function rounded(w: number, h: number, r: number): string {
  return `M${r} 0H${w - r}A${r} ${r} 0 0 1 ${w} ${r}V${h - r}A${r} ${r} 0 0 1 ${w - r} ${h}H${r}A${r} ${r} 0 0 1 0 ${h - r}V${r}A${r} ${r} 0 0 1 ${r} 0Z`
}

/** An ellipse filling a box of w × h whose corner is at x, y. */
function ellipse(x: number, y: number, w: number, h: number): string {
  const [rx, ry] = [w / 2, h / 2]
  return `M${x} ${y + ry}A${rx} ${ry} 0 1 1 ${x + w} ${y + ry}A${rx} ${ry} 0 1 1 ${x} ${y + ry}Z`
}

/**
 * A shape's outline in a box of w × h with its corner at 0, 0, as the data of an SVG path. The first part is the
 * outline itself, closed; a subroutine's two inner lines, a cylinder's rim and a double circle's inner circle follow
 * it as parts of their own.
 */
export function shapePath(shape: NodeShape, w: number, h: number): string {
  const k = leanOf(shape, w, h)
  switch (shape) {
    case 'box':
      return `M0 0H${w}V${h}H0Z`
    case 'round':
      return rounded(w, h, Math.round(Math.min(400, w / 2, h / 2)))
    case 'pill':
      return rounded(w, h, Math.min(w, h) / 2)
    case 'subroutine': {
      const inset = Math.round(Math.min(300, w / 6))
      return `M0 0H${w}V${h}H0ZM${inset} 0V${h}M${w - inset} 0V${h}`
    }
    case 'cylinder': {
      const ry = Math.round(Math.min(400, h / 6))
      const rx = w / 2
      return `M0 ${ry}A${rx} ${ry} 0 0 1 ${w} ${ry}V${h - ry}A${rx} ${ry} 0 0 1 0 ${h - ry}ZM0 ${ry}A${rx} ${ry} 0 0 0 ${w} ${ry}`
    }
    case 'circle':
      return ellipse(0, 0, w, h)
    case 'double-circle': {
      const gap = Math.round(Math.min(200, w / 8, h / 8))
      return `${ellipse(0, 0, w, h)}${ellipse(gap, gap, w - 2 * gap, h - 2 * gap)}`
    }
    case 'flag':
      return `M0 0H${w}V${h}H0L${k} ${h / 2}Z`
    case 'diamond':
      return `M${w / 2} 0L${w} ${h / 2}L${w / 2} ${h}L0 ${h / 2}Z`
    case 'hexagon':
      return `M${k} 0H${w - k}L${w} ${h / 2}L${w - k} ${h}H${k}L0 ${h / 2}Z`
    case 'slant':
      return `M${k} 0H${w}L${w - k} ${h}H0Z`
    case 'slant-back':
      return `M0 0H${w - k}L${w} ${h}H${k}Z`
    case 'trapezoid':
      return `M${k} 0H${w - k}L${w} ${h}H0Z`
    case 'trapezoid-down':
      return `M0 0H${w}L${w - k} ${h}H${k}Z`
  }
}

/**
 * Where a link meets a node on one of its sides: the middle of that side, on the shape's own outline (a slanted
 * side's middle lies inside the box; a flag's left side is its notch).
 */
export function portOf(shape: NodeShape, box: Box, side: Side): { x: number; y: number } {
  const k = leanOf(shape, box.w, box.h)
  // How far the left and right sides' middles lie inside the box.
  const inLeft = shape === 'flag' ? k : shape === 'slant' || shape === 'slant-back' || shape === 'trapezoid' || shape === 'trapezoid-down' ? k / 2 : 0
  const inRight = shape === 'flag' ? 0 : inLeft
  switch (side) {
    case 'top':
      return { x: Math.round(box.x + box.w / 2), y: box.y }
    case 'bottom':
      return { x: Math.round(box.x + box.w / 2), y: box.y + box.h }
    case 'left':
      return { x: Math.round(box.x + inLeft), y: Math.round(box.y + box.h / 2) }
    case 'right':
      return { x: Math.round(box.x + box.w - inRight), y: Math.round(box.y + box.h / 2) }
  }
}
