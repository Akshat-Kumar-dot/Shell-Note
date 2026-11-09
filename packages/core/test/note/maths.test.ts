// Formulas in note control (step 3): the LaTeX taken from under the line, and a light check, with no package.
import { describe, expect, it } from 'vitest'
import { texHint, texOf } from '../../src/note/maths.js'

describe('a formula written under a line', () => {
  it('takes off the delimiters and the fence a model writes around it', () => {
    expect(texOf('$$E_k = \\frac{1}{2} m v^2$$')).toBe('E_k = \\frac{1}{2} m v^2')
    expect(texOf('$v = f \\lambda$')).toBe('v = f \\lambda')
    expect(texOf('\\[ F = ma \\]')).toBe('F = ma')
    expect(texOf('```latex\nF = ma\n```')).toBe('F = ma')
    expect(texOf('a + b')).toBe('a + b')
  })
})

describe('the light check', () => {
  it('passes formulas that hold together', () => {
    for (const tex of ['E_k = \\frac{1}{2} m v^2', '\\left( \\frac{a}{b} \\right)', '\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}', '\\{ x \\mid x > 0 \\}', 'x % a comment {', '\\$5']) expect(texHint(tex)).toBeNull()
  })

  it('says what is wrong: braces, \\left and \\right, \\begin and \\end, a $ inside, nothing at all', () => {
    expect(texHint('\\frac{1}{2')).toMatch(/never closed/u)
    expect(texHint('a}')).toMatch(/never opened/u)
    expect(texHint('\\left( x')).toMatch(/1 \\left and 0 \\right/u)
    expect(texHint('\\begin{aligned} a \\end{matrix}')).toMatch(/closed by \\end\{matrix\}/u)
    expect(texHint('\\begin{cases} a')).toMatch(/never closed/u)
    expect(texHint('a $ b')).toMatch(/no \$ signs/u)
    expect(texHint(' ')).toMatch(/No formula/u)
  })
})
