// A change of format through the editor goes to the selected words, not the
// spaces at the ends of the selection, as a double-click on Windows takes the
// space after a word too (found in Edge).
import { getSchema } from '@tiptap/core'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'
import { frameExtensions } from '../src/frame/schema.js'
import { wordSpan } from '../src/frame/words.js'

const schema = getSchema(frameExtensions({ takenElsewhere: () => false, newId: () => 'unused', assetUrl: () => undefined, asset: () => undefined }))

/** One line, "one two three", or two lines; a selection from one position to another. */
function selected(from: number, to: number, lines = ['one two three']): EditorState {
  const doc = schema.nodeFromJSON({ type: 'doc', content: lines.map((text) => ({ type: 'textBlock', attrs: { id: text.slice(0, 3) }, content: [{ type: 'text', text }] })) })
  return EditorState.create({ doc, selection: TextSelection.create(doc, from, to) })
}

describe('the words of a selection', () => {
  it('leave out the spaces at its ends', () => {
    // Positions: 1 is before "one"; "two " is 5 to 9.
    expect(wordSpan(selected(5, 9))).toEqual({ from: 5, to: 8 })
    expect(wordSpan(selected(4, 9))).toEqual({ from: 5, to: 8 })
  })

  it('need no change when the selection has no spaces at its ends, and stay put when it is only spaces', () => {
    expect(wordSpan(selected(5, 8))).toBeUndefined()
    expect(wordSpan(selected(4, 5))).toBeUndefined()
    expect(wordSpan(selected(5, 5))).toBeUndefined()
  })

  it('across lines, leave out the spaces at the ends too', () => {
    // "one two" is 1 to 8; "three four " is 10 to 21. From "two" to the end of the second line, space and all.
    const lines = ['one two', 'three four ']
    expect(wordSpan(selected(5, 21, lines))).toEqual({ from: 5, to: 20 })
    expect(wordSpan(selected(5, 20, lines))).toBeUndefined()
  })
})
