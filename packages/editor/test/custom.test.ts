// The rows of tools as the person sets them (layout/custom.ts), and the panel beside the notes on either side
// (layout/tree.ts): a button out waits under its row's More, the pen and Type never leave the pen's row, a button a row
// has not is refused, and the panel moves with what is docked with it.
import { PEN_START, TYPING_START } from '@shellnote/core'
import { afterEach, describe, expect, it } from 'vitest'
import { penRow, putButton, resetCustom, typingBar, underMore, underPenMore } from '../src/layout/custom.js'
import { DEFAULT_LAYOUT, panelTo, sideOfPanel } from '../src/layout/tree.js'

describe('the rows of tools as the person sets them', () => {
  afterEach(() => {
    resetCustom('tools')
    resetCustom('pen')
  })

  it('start as the design has them', () => {
    expect(typingBar.value).toEqual(TYPING_START)
    expect(penRow.value).toEqual(PEN_START)
    expect(underPenMore(penRow.value)).toEqual(['grey', 'orange', 'yellow', 'purple'])
  })

  it('a button taken out of the bar for typing waits under its More, and comes back at the place asked', () => {
    putButton('table', false)
    expect(typingBar.value).not.toContain('table')
    expect(underMore(typingBar.value)[0]).toBe('table')
    putButton('table', true, 1)
    expect(typingBar.value[0]).toBe('table')
    // Put in with no place, a button goes to the end.
    putButton('strike', true)
    expect(typingBar.value.at(-1)).toBe('strike')
  })

  it("the pen and Type never leave the pen's row, though they move along it; a colour comes into reach", () => {
    expect(() => putButton('pen', false, undefined, 'pen')).toThrow(/always stays/u)
    expect(() => putButton('type', false, undefined, 'pen')).toThrow(/always stays/u)
    putButton('pen', true, 1, 'pen')
    expect(penRow.value[0]).toBe('pen')
    putButton('orange', true, 10, 'pen')
    expect(penRow.value[9]).toBe('orange')
    expect(underPenMore(penRow.value)).not.toContain('orange')
  })

  it("a button a row has not is refused, with the row's own named", () => {
    expect(() => putButton('eraser' as never, true)).toThrow(/bar for typing has no eraser/u)
    expect(() => putButton('bold' as never, true, undefined, 'pen')).toThrow(/pen's row has no bold/u)
  })
})

describe('the panel beside the notes, on either side', () => {
  it('goes left with what is docked with it, as wide as it was, and back again as it was', () => {
    expect(sideOfPanel(DEFAULT_LAYOUT)).toBe('right')
    const left = panelTo(DEFAULT_LAYOUT, 'left')
    expect(sideOfPanel(left)).toBe('left')
    expect(panelTo(left, 'left')).toBe(left)
    expect(panelTo(left, 'right').root).toEqual(DEFAULT_LAYOUT.root)
  })
})
