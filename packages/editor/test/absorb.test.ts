// A change from another device arrives in the note that is open: what was
// typed here stays, undo still takes back what the person did, and what came
// in is left alone.
import { apply, createDoc, type Doc, type Frame, type Op, type TextBlock } from '@shellnote/core'
import { describe, expect, it } from 'vitest'
import { EditorStore } from '../src/index.js'

function note(): { doc: Doc; frame: string } {
  const start = createDoc({ title: 'Trip' })
  const frame = Object.keys(start.block)[0]!
  const ops: Op[] = [
    ['a', 'Pack the tent.'],
    ['b', 'Leave on Friday.'],
  ].map(([id, md]) => ({ op: 'add', block: { id: id!, r: 0, type: 'text', parent: frame, role: 'p', indent: 0, md: md! } }))
  return { doc: apply(start, ops).doc, frame }
}
const md = (doc: Doc, id: string): string => (doc.block[id] as TextBlock).md
const kids = (doc: Doc, frame: string): string[] => (doc.block[frame] as Frame).kids

describe('a change from elsewhere, into the open note', () => {
  it('goes in beside what was typed here, as no undo step', () => {
    const { doc, frame } = note()
    const store = new EditorStore(doc)
    store.apply([{ op: 'splice', id: 'a', field: 'md', at: 14, del: 0, ins: ' And the stove.' }])
    const theirs = apply(doc, [{ op: 'add', block: { id: 'c', r: 0, type: 'text', parent: frame, role: 'p', indent: 0, md: 'From the phone.' } }]).doc
    const heard: { changed: Set<string>; recorded: boolean }[] = []
    store.subscribe((change) => heard.push({ changed: new Set(change.changed), recorded: change.recorded }))
    expect(store.absorb(doc, theirs)).toBe(true)
    expect(md(store.doc, 'a')).toBe('Pack the tent. And the stove.')
    expect(kids(store.doc, frame)).toEqual(['a', 'b', 'c'])
    expect(heard).toEqual([{ changed: new Set(['c', frame]), recorded: false }])
    expect(store.history.done).toHaveLength(1)
    // Undo takes back the typing, and leaves what came in.
    expect(store.undo()).toBe(true)
    expect(md(store.doc, 'a')).toBe('Pack the tent.')
    expect(kids(store.doc, frame)).toEqual(['a', 'b', 'c'])
    expect(store.redo()).toBe(true)
    expect(md(store.doc, 'a')).toBe('Pack the tent. And the stove.')
    expect(store.undo()).toBe(true)
    expect(store.canUndo).toBe(false)
  })

  it('keeps undo right when the change came into the paragraph being typed in', () => {
    const { doc } = note()
    const store = new EditorStore(doc)
    store.apply([{ op: 'splice', id: 'b', field: 'md', at: 16, del: 0, ins: ' Early.' }])
    const theirs = apply(doc, [{ op: 'splice', id: 'b', field: 'md', at: 0, del: 5, ins: 'We leave' }]).doc
    store.absorb(doc, theirs)
    expect(md(store.doc, 'b')).toBe('We leave on Friday. Early.')
    store.undo()
    expect(md(store.doc, 'b')).toBe('We leave on Friday.')
    store.redo()
    expect(md(store.doc, 'b')).toBe('We leave on Friday. Early.')
  })

  it('says nothing changed when the same note comes back', () => {
    const { doc } = note()
    const store = new EditorStore(doc)
    store.apply([{ op: 'update', id: 'a', set: { md: 'Pack.' } }])
    const rev = store.doc.rev
    expect(store.absorb(doc, doc)).toBe(false)
    expect(store.absorb(doc, store.doc)).toBe(false)
    expect(store.doc.rev).toBe(rev)
  })

  it('lets go of what is selected when it is gone', () => {
    const { doc } = note()
    const store = new EditorStore(doc)
    store.select({ blocks: ['a', 'b'] }, 'objects')
    store.absorb(doc, apply(doc, [{ op: 'remove', id: 'b' }]).doc)
    expect(store.selection.blocks).toEqual(['a'])
  })

  it('takes back only what the person did when both changed the same words', () => {
    const { doc } = note()
    const store = new EditorStore(doc)
    store.apply([{ op: 'update', id: 'a', set: { role: 'h1' } }])
    store.apply([{ op: 'update', id: 'b', set: { md: 'Leave on Saturday.' } }])
    store.apply([{ op: 'update', id: 'a', set: { role: 'h2' } }])
    const theirs = apply(doc, [{ op: 'update', id: 'b', set: { md: 'Leave on Sunday.' } }]).doc
    store.absorb(doc, theirs)
    const words = (): string[] => Object.values(store.doc.block).flatMap((block) => (block.type === 'text' ? [block.md] : []))
    // Both paragraphs are kept, the other device's as a copy.
    expect(words()).toEqual(expect.arrayContaining(['Leave on Saturday.', 'Leave on Sunday.']))
    store.undo()
    expect(store.doc.block.a).toMatchObject({ role: 'h1' })
    store.undo()
    // The person's own change is taken back; the other device's words stay.
    expect(md(store.doc, 'b')).toBe('Leave on Friday.')
    expect(words()).toContain('Leave on Sunday.')
    store.undo()
    expect(store.doc.block.a).toMatchObject({ role: 'p' })
    expect(store.canUndo).toBe(false)
  })
})
