// From an editor's view of a frame to operations.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { apply, frameOps, validateDoc, type ChildDraft, type Doc, type Frame, type TextBlock } from '../src/index.js'
import { MIXED, PHYSICS } from './fixtures/index.js'

/** The editor's view of a frame as it is now. */
function draftsOf(doc: Doc, frameId: string): ChildDraft[] {
  return (doc.block[frameId] as Frame).kids.map((id) => {
    const block = { ...doc.block[id]! } as Record<string, unknown>
    delete block.r
    delete block.parent
    return block as ChildDraft
  })
}

const text = (id: string, md: string, role: TextBlock['role'] = 'p'): ChildDraft => ({ id, type: 'text', role, indent: 0, md })

describe('frameOps', () => {
  const before = draftsOf(PHYSICS, 'f1')

  it('has nothing to do when nothing changed', () => {
    expect(frameOps(PHYSICS, 'f1', before)).toEqual([])
  })

  it('turns typing into one small splice', () => {
    const next = before.map((d) => (d.id === 't1' ? { ...d, md: "Newton's three laws" } : d))
    expect(frameOps(PHYSICS, 'f1', next)).toEqual([{ op: 'splice', id: 't1', field: 'md', at: 9, del: 0, ins: 'three ' }])
  })

  it('turns Enter into a splice and an add, and Backspace back again', () => {
    // Enter after "An object at rest" in t2.
    const t2 = PHYSICS.block.t2 as TextBlock
    const split = [before[0]!, { ...before[1]!, md: 'An object at rest' } as ChildDraft, text('n1', t2.md.slice('An object at rest '.length)), before[2]!]
    const ops = frameOps(PHYSICS, 'f1', split)
    expect(ops.map((op) => op.op)).toEqual(['add', 'splice'])
    const after = apply(PHYSICS, ops).doc
    expect((after.block.f1 as Frame).kids).toEqual(['t1', 't2', 'n1', 'm1'])
    expect(frameOps(after, 'f1', before).map((op) => op.op)).toEqual(['remove', 'splice'])
    expect(apply(after, frameOps(after, 'f1', before)).doc.block.t2).toMatchObject({ md: t2.md })
  })

  it('turns a role, indent, style or tick change into one update', () => {
    const next = before.map((d) => (d.id === 't2' ? { ...d, role: 'todo', indent: 1, style: { color: 'red' }, done: true } as ChildDraft : d))
    expect(frameOps(PHYSICS, 'f1', next)).toEqual([{ op: 'update', id: 't2', set: { role: 'todo', indent: 1, style: { color: 'red' }, done: true } }])
  })

  it("turns a picture's caption typed in a frame into a splice, and an emptied one goes", () => {
    const start = draftsOf(MIXED, 'fa')
    const typed = start.map((d) => (d.id === 'ic' ? { ...d, caption: 'One **period**' } : d))
    expect(frameOps(MIXED, 'fa', typed)).toEqual([{ op: 'splice', id: 'ic', field: 'caption', at: 0, del: 0, ins: 'One **period**' }])
    const after = apply(MIXED, frameOps(MIXED, 'fa', typed)).doc
    expect(after.block.ic).toMatchObject({ caption: 'One **period**' })
    expect(frameOps(after, 'fa', typed)).toEqual([])
    expect(apply(after, frameOps(after, 'fa', start)).doc.block.ic).not.toHaveProperty('caption')
  })

  it('moves blocks that changed place', () => {
    const next = [before[2]!, before[0]!, before[1]!]
    const after = apply(PHYSICS, frameOps(PHYSICS, 'f1', next)).doc
    expect((after.block.f1 as Frame).kids).toEqual(['m1', 't1', 't2'])
  })

  it('brings any edit of a frame about exactly', () => {
    const frame = 'fa'
    const start = draftsOf(MIXED, frame)
    const edit = fc.record({
      keep: fc.subarray(start.map((_, i) => i)),
      order: fc.array(fc.nat(), { maxLength: 20 }),
      fresh: fc.array(fc.record({ md: fc.string({ maxLength: 12 }), role: fc.constantFrom('p' as const, 'h2' as const, 'li' as const, 'todo' as const) }), { maxLength: 4 }),
      retype: fc.array(fc.tuple(fc.nat(), fc.string({ maxLength: 12 })), { maxLength: 4 }),
      restyle: fc.array(fc.tuple(fc.nat(), fc.constantFrom('h1' as const, 'oli' as const, 'todo' as const), fc.nat(3), fc.boolean()), { maxLength: 4 }),
    })
    fc.assert(
      fc.property(edit, ({ keep, order, fresh, retype, restyle }) => {
        let next: ChildDraft[] = keep.map((i) => start[i]!)
        fresh.forEach((f, n) => next.splice((order[n] ?? 0) % (next.length + 1), 0, text(`new${n}`, f.md, f.role)))
        // Shuffle a little, then change some text blocks.
        order.forEach((o, n) => {
          if (next.length < 2) return
          const [moved] = next.splice(n % next.length, 1)
          next.splice(o % (next.length + 1), 0, moved!)
        })
        next = next.map((d, i) => {
          if (d.type !== 'text') return d
          const md = retype.find(([at]) => at % next.length === i)?.[1]
          const style = restyle.find(([at]) => at % next.length === i)
          const out: ChildDraft = md === undefined ? d : { ...d, md }
          if (!style) return out
          const [, role, indent, tick] = style
          const changed = { ...out, role, indent } as Extract<ChildDraft, { type: 'text' }>
          if (role === 'todo' && tick) changed.done = true
          else delete changed.done
          return changed
        })
        const after = apply(MIXED, frameOps(MIXED, frame, next)).doc
        expect(validateDoc(after)).toBe(after)
        expect(draftsOf(after, frame)).toEqual(next)
      }),
      { numRuns: 300 },
    )
  })
})
