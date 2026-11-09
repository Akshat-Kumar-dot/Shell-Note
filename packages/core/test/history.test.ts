import { describe, expect, it } from 'vitest'
import { apply, emptyHistory, record, redo, undo, validateDoc, type Doc, type History, type Op } from '../src/index.js'
import physics from './fixtures/physics.json' with { type: 'json' }
import { content, deepFreeze } from './helpers.js'

const base: Doc = deepFreeze(validateDoc(structuredClone(physics)))

/** Apply ops and record them, like the editor will. */
function edit(state: { doc: Doc; history: History }, ops: Op[], key?: string, at = 0) {
  const result = apply(state.doc, ops)
  return { doc: result.doc, history: record(state.history, ops, result.inverse, { at, ...(key ? { key } : {}) }) }
}

const type = (at: number, ins: string): Op => ({ op: 'splice', id: 't1', field: 'md', at, del: 0, ins })
const md = (doc: Doc, id: string) => (doc.block[id] as { md: string }).md

describe('undo and redo', () => {
  it('undo goes back, redo goes forward again', () => {
    let state = { doc: base, history: emptyHistory() }
    state = edit(state, [{ op: 'remove', id: 't2' }])
    state = edit(state, [{ op: 'update', id: 't1', set: { role: 'h1' } }])

    const back1 = undo(state.history, state.doc)!
    expect(back1.doc.block.t1).toMatchObject({ role: 'h2' })
    const back2 = undo(back1.history, back1.doc)!
    expect(content(back2.doc)).toStrictEqual(content(base))
    expect(undo(back2.history, back2.doc)).toBeNull()

    const fwd1 = redo(back2.history, back2.doc)!
    const fwd2 = redo(fwd1.history, fwd1.doc)!
    expect(content(fwd2.doc)).toStrictEqual(content(state.doc))
    expect(redo(fwd2.history, fwd2.doc)).toBeNull()
  })

  it('a new change clears what could be redone', () => {
    let state = { doc: base, history: emptyHistory() }
    state = edit(state, [{ op: 'remove', id: 't2' }])
    const back = undo(state.history, state.doc)!
    const after = edit({ doc: back.doc, history: back.history }, [{ op: 'remove', id: 'm1' }])
    expect(after.history.undone).toHaveLength(0)
  })
})

describe('merging', () => {
  it('typing with short pauses is one step', () => {
    let state = { doc: base, history: emptyHistory() }
    ;['a', 'b', 'c', 'd'].forEach((letter, i) => {
      state = edit(state, [type(i, letter)], 'type:t1', i * 400)
    })
    expect(md(state.doc, 't1')).toBe("abcdNewton's laws")
    expect(state.history.done).toHaveLength(1)
    expect(md(undo(state.history, state.doc)!.doc, 't1')).toBe("Newton's laws")
  })

  it('a long pause, another block or an AI edit starts a new step', () => {
    let state = { doc: base, history: emptyHistory() }
    state = edit(state, [type(0, 'a')], 'type:t1', 0)
    state = edit(state, [type(1, 'b')], 'type:t1', 5000)
    state = edit(state, [{ op: 'splice', id: 't2', field: 'md', at: 0, del: 0, ins: 'c' }], 'type:t2', 5100)
    state = edit(state, [{ op: 'update', id: 't1', set: { role: 'h1' } }], undefined, 5200)
    state = edit(state, [{ op: 'update', id: 't2', set: { role: 'quote' } }], undefined, 5300)
    expect(state.history.done).toHaveLength(5)
  })

  it('a change that follows from the last step joins it, so one undo takes back both', () => {
    let state = { doc: base, history: emptyHistory() }
    state = edit(state, [{ op: 'update', id: 't2', set: { role: 'li' } }], undefined, 0)
    state = edit(state, [type(0, 'a')], 'type:t1', 100)
    // Say the typing pushed m1 out of its frame: the push joins the typing step, hours later or not.
    const pushed = apply(state.doc, [{ op: 'remove', id: 'm1' }])
    state = { doc: pushed.doc, history: record(state.history, [{ op: 'remove', id: 'm1' }], pushed.inverse, { join: true, at: 9_999_999 }) }
    expect(state.history.done).toHaveLength(2)
    // Typing carries on in the same step: the joined step keeps its key.
    state = edit(state, [type(1, 'b')], 'type:t1', 9_999_999 + 100)
    expect(state.history.done).toHaveLength(2)
    const back = undo(state.history, state.doc)!
    expect(md(back.doc, 't1')).toBe("Newton's laws")
    expect(back.doc.block.m1).toBeDefined()
  })

  it('typing after an undo or redo starts a new step', () => {
    let state = { doc: base, history: emptyHistory() }
    state = edit(state, [type(0, 'a')], 'type:t1', 0)
    const back = undo(state.history, state.doc)!
    const fwd = redo(back.history, back.doc)!
    const next = edit({ doc: fwd.doc, history: fwd.history }, [type(1, 'b')], 'type:t1', 100)
    expect(next.history.done).toHaveLength(2)
  })
})

describe('the limit', () => {
  it('keeps only the most recent steps', () => {
    let state = { doc: base, history: emptyHistory() }
    for (let i = 0; i < 12; i++) {
      const result = apply(state.doc, [type(0, 'x')])
      state = { doc: result.doc, history: record(state.history, [type(0, 'x')], result.inverse, { limit: 10, at: i }) }
    }
    expect(state.history.done).toHaveLength(10)
  })
})
