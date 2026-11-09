// The colour panel's colours (Stage 3a): the note colours as the page draws
// them, their shades, Word's standard colours, and the arithmetic of More
// colours, which must give back exactly the colour typed into it.
import { Color } from '@shellnote/core'
import { describe, expect, it } from 'vitest'
import theme from '../src/theme.css?raw'
import { codeOf, darker, hsvOf, lighter, NAMED_HEX, rgbOf, rgbOfHsv, rounded, shadesOf, STANDARD, withPart } from '../src/palette.js'

const CODE = /^#[0-9a-f]{6}$/u

describe('the colour panel', () => {
  it('knows the note colours as the page draws them', () => {
    for (const color of Color.options) expect(theme, color).toContain(`--nw-${color}: ${NAMED_HEX[color]};`)
  })

  it('gives each note colour four shades, lightest first; ink, nearly black, only lighter ones', () => {
    for (const color of Color.options) {
      const shades = shadesOf(color)
      expect(shades).toHaveLength(4)
      for (const shade of shades) expect(shade.code).toMatch(CODE)
      const brightness = (code: string): number => rgbOf(code).reduce((sum, part) => sum + part, 0)
      const codes = shades.map((shade) => shade.code)
      const all = [...codes.slice(0, 2), NAMED_HEX[color], ...codes.slice(2)]
      if (color !== 'ink') for (let i = 1; i < all.length; i++) expect(brightness(all[i]!), shades[0]!.label).toBeLessThanOrEqual(brightness(all[i - 1]!))
    }
    expect(shadesOf('red').map((shade) => shade.label)).toEqual(['Red, lighter 60%', 'Red, lighter 30%', 'Red, darker 25%', 'Red, darker 50%'])
    expect(shadesOf('ink').every((shade) => shade.label.includes('lighter'))).toBe(true)
  })

  it('mixes with white and black as Word does', () => {
    expect(lighter('#000000', 0.5)).toBe('#808080')
    expect(lighter('#c62828', 1)).toBe('#ffffff')
    expect(darker('#c62828', 0.5)).toBe('#631414')
    expect(darker('#c62828', 0)).toBe('#c62828')
  })

  it("has Word's ten standard colours", () => {
    expect(STANDARD).toHaveLength(10)
    expect(STANDARD.map(([, code]) => code).every((code) => CODE.test(code))).toBe(true)
    expect(STANDARD[0]).toEqual(['Dark red', '#c00000'])
  })
})

describe('More colours', () => {
  it('reads and writes codes', () => {
    expect(rgbOf('#ff8800')).toEqual([255, 136, 0])
    expect(codeOf([255, 136, 0])).toBe('#ff8800')
    expect(codeOf([300, -4, 12.6])).toBe('#ff000d')
    expect(withPart([1, 2, 3], 1, 200)).toEqual([1, 200, 3])
  })

  it('gives back exactly the red, green and blue it was given, through hue, saturation and brightness', () => {
    // Every third value of each part, 0 and 255 among them: 636,056 colours.
    for (let r = 0; r <= 255; r += 3) {
      for (let g = 0; g <= 255; g += 3) {
        for (let b = 0; b <= 255; b += 3) {
          const back = rounded(rgbOfHsv(hsvOf([r, g, b])))
          if (back[0] !== r || back[1] !== g || back[2] !== b) expect(back).toEqual([r, g, b])
        }
      }
    }
  })

  it('puts hue, saturation and brightness where the field and the slider show them', () => {
    expect(hsvOf([255, 0, 0])).toEqual({ h: 0, s: 1, v: 1 })
    expect(hsvOf([0, 0, 255])).toEqual({ h: 240, s: 1, v: 1 })
    expect(hsvOf([128, 128, 128])).toMatchObject({ s: 0 })
    expect(codeOf(rgbOfHsv({ h: 120, s: 1, v: 1 }))).toBe('#00ff00')
    expect(codeOf(rgbOfHsv({ h: 32, s: 1, v: 1 }))).toBe('#ff8800')
  })
})
