// The colours of the colour panel, as Word lays them out: the eight note
// colours (the ones the AI also uses) with lighter and darker shades of each,
// Word's ten standard colours, and the arithmetic of More colours: a colour as
// red, green and blue, or as hue, saturation and brightness. Every colour a
// person picks here is stored as a code (#rrggbb), except the note colours,
// which keep their names.
import type { Color } from '@shellnote/core'

/** The note colours as theme.css draws them. The paper stays white in every look, so these never change. */
export const NAMED_HEX: Readonly<Record<Color, string>> = {
  ink: '#1d1d22',
  gray: '#6b7079',
  red: '#c62828',
  orange: '#d9640a',
  yellow: '#a88400',
  green: '#2e7d32',
  blue: '#1f5fbf',
  purple: '#7a3db8',
}

/** Word's standard colours, with the names Word gives them. */
export const STANDARD: readonly (readonly [name: string, code: string])[] = [
  ['Dark red', '#c00000'],
  ['Red', '#ff0000'],
  ['Orange', '#ffc000'],
  ['Yellow', '#ffff00'],
  ['Light green', '#92d050'],
  ['Green', '#00b050'],
  ['Light blue', '#00b0f0'],
  ['Blue', '#0070c0'],
  ['Dark blue', '#002060'],
  ['Purple', '#7030a0'],
]

/** Red, green and blue, each from 0 to 255. */
export type Rgb = readonly [r: number, g: number, b: number]

/** Hue in degrees (0 to 360), saturation and brightness from 0 to 1. */
export interface Hsv {
  h: number
  s: number
  v: number
}

/** A code's red, green and blue. */
export function rgbOf(code: string): Rgb {
  const n = Number.parseInt(code.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Each part rounded to a whole number. */
export function rounded([r, g, b]: Rgb): Rgb {
  return [Math.round(r), Math.round(g), Math.round(b)]
}

/** The same colour with one part (0 red, 1 green, 2 blue) changed. */
export function withPart(rgb: Rgb, part: number, value: number): Rgb {
  const next: [number, number, number] = [...rgb]
  next[part] = value
  return next
}

/** The code of a colour, each part rounded and kept between 0 and 255. */
export function codeOf(rgb: Rgb): string {
  return `#${rgb.map((part) => Math.min(255, Math.max(0, Math.round(part))).toString(16).padStart(2, '0')).join('')}`
}

/** A colour moved toward white (255) or black (0) by `amount`, from 0 to 1. */
function mix(code: string, toward: number, amount: number): string {
  const [r, g, b] = rgbOf(code)
  const to = (part: number): number => part + (toward - part) * amount
  return codeOf([to(r), to(g), to(b)])
}

/** A colour mixed with white by `amount` (0 to 1), as Word's "Lighter 40%". */
export const lighter = (code: string, amount: number): string => mix(code, 255, amount)

/** A colour mixed with black by `amount` (0 to 1), as Word's "Darker 25%". */
export const darker = (code: string, amount: number): string => mix(code, 0, amount)

export interface Shade {
  code: string
  /** As a tooltip says it: "Red, lighter 60%". */
  label: string
}

/**
 * The shades under a note colour, lightest first: two lighter and two darker.
 * Ink is nearly black, so darker shades of it would look the same: it has four
 * lighter ones instead, as Word gives black.
 */
export function shadesOf(color: Color): Shade[] {
  const name = color[0]!.toUpperCase() + color.slice(1)
  const code = NAMED_HEX[color]
  const steps: [kind: 'lighter' | 'darker', amount: number][] =
    color === 'ink'
      ? [
          ['lighter', 0.8],
          ['lighter', 0.6],
          ['lighter', 0.4],
          ['lighter', 0.2],
        ]
      : [
          ['lighter', 0.6],
          ['lighter', 0.3],
          ['darker', 0.25],
          ['darker', 0.5],
        ]
  return steps.map(([kind, amount]) => ({
    code: kind === 'lighter' ? lighter(code, amount) : darker(code, amount),
    label: `${name}, ${kind} ${Math.round(amount * 100)}%`,
  }))
}

/** A colour as hue, saturation and brightness: what the colour field and the hue slider of More colours show. */
export function hsvOf([r, g, b]: Rgb): Hsv {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const range = max - min
  let h = 0
  if (range > 0) {
    if (max === r) h = ((g - b) / range + 6) % 6
    else if (max === g) h = (b - r) / range + 2
    else h = (r - g) / range + 4
  }
  return { h: h * 60, s: max === 0 ? 0 : range / max, v: max / 255 }
}

/** Back from hue, saturation and brightness to red, green and blue, unrounded. */
export function rgbOfHsv({ h, s, v }: Hsv): Rgb {
  const at = (n: number): number => {
    const k = (n + h / 60) % 6
    return 255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))
  }
  return [at(5), at(3), at(1)]
}
