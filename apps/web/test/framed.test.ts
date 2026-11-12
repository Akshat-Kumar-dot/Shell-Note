// The page draws nothing inside another page's frame (framed.ts).
import { describe, expect, it } from 'vitest'
import { inAFrame } from '../src/framed.js'

describe('whether the page is inside a frame', () => {
  it('is not, in a tab or a window of its own', () => {
    const own = {}
    expect(inAFrame({ top: own, self: own })).toBe(false)
  })

  it('is, when the page above is another', () => {
    expect(inAFrame({ top: {}, self: {} })).toBe(true)
  })

  it('is taken to be, when the browser will not say', () => {
    const closed = {
      get top(): unknown {
        throw new Error('not allowed')
      },
      self: {},
    }
    expect(inAFrame(closed)).toBe(true)
  })
})
