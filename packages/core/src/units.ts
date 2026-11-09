/** Geometry is whole numbers of 0.01 mm. A4 is 21000 × 29700. */
export const UNITS_PER_MM = 100

/** Millimetres to document units, rounded to a whole unit. */
export function mm(value: number): number {
  return Math.round(value * UNITS_PER_MM)
}

/** Standard page sizes, in units. */
export const PAGE_SIZES = {
  A4: { w: 21000, h: 29700 },
  Letter: { w: 21590, h: 27940 },
} as const
export type PageSize = keyof typeof PAGE_SIZES

/** Margin of a new page: 20 mm. */
export const MARGIN = 2000
