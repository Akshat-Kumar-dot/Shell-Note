// A table's column widths as core keeps them (file format version 2): each
// column's share of the table's width, in whole thousandths adding up to 1000,
// so a saved file holds no floats and every column is told apart exactly.

/** The total of a table's column shares. */
export const SHARE_TOTAL = 1000

/**
 * Widths as shares that add up to 1000 exactly. A gap (a column just added,
 * which has no width yet) gets the average of the others; then all are
 * scaled, and the rounding goes to the largest remainders. Every column keeps
 * at least one thousandth.
 */
export function columnShares(widths: readonly (number | null | undefined)[]): number[] {
  if (widths.length === 0) return []
  const known = widths.filter((width): width is number => typeof width === 'number' && width > 0)
  const average = known.length > 0 ? known.reduce((sum, width) => sum + width, 0) / known.length : 1
  const filled = widths.map((width) => (typeof width === 'number' && width > 0 ? width : average))
  const total = filled.reduce((sum, width) => sum + width, 0)
  const exact = filled.map((width) => Math.max(1, (width / total) * SHARE_TOTAL))
  const shares = exact.map(Math.floor)
  // Hand out what rounding down left over, largest remainder first; or take back what the one-thousandth floor added.
  let left = SHARE_TOTAL - shares.reduce((sum, share) => sum + share, 0)
  const order = exact.map((value, i) => ({ i, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest || a.i - b.i)
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) shares[order[k]!.i]!++
  for (let k = order.length - 1; left < 0; k = (k - 1 + order.length) % order.length) {
    const i = order[k]!.i
    if (shares[i]! > 1) {
      shares[i]!--
      left++
    }
  }
  return shares
}

/** Equal shares for a number of columns: what a table without widths shows. */
export function equalShares(columns: number): number[] {
  return columnShares(Array<number>(columns).fill(1))
}
