// What assistants did to a note, as the MCP server wrote it down, joining the
// note's own log: each entry once, and with its Undo only while this copy's
// blocks are as the edit left them.
import { apply, become, blockPrint, editById, type Doc, type LogEntry, type Op, type TextBlock } from '@shellnote/core'
import type { LogItem } from '@shellnote/editor'
import { describe, expect, it } from 'vitest'
import { PHYSICS } from '../../../packages/core/test/fixtures/index.js'
import { withAssistants } from '../src/ai/assistants.js'

const entry = (at: number, more: Partial<LogEntry> = {}): LogEntry => ({ at, source: 'mcp', model: 'an assistant', rulebook: 'r1', instruction: 'Why.', targets: ['t1'], ops: [{ op: 'style', ids: ['t1'], color: 'blue' }], result: 'applied', tier: 1, calls: 0, retries: 0, tokensIn: 0, tokensOut: 0, ms: 3, ...more })

/** An edit as the server makes it on its own copy, and what it writes of it in its log. */
function served(doc: Doc, ops: unknown[], at: number): { doc: Doc; item: { entry: LogEntry; undo: { inverse: Op[]; rev: number; after: Record<string, string | null> } } } {
  const result = editById({ doc, ops, baseRev: doc.rev }).result!
  const after: Record<string, string | null> = {}
  for (const id of result.changed) {
    if (result.doc.block[id]) after[id] = blockPrint(result.doc.block[id])
    else if (doc.block[id]) after[id] = null
  }
  return { doc: result.doc, item: { entry: entry(at), undo: { inverse: result.inverse, rev: result.doc.rev, after } } }
}

/** This device's copy after it took in the server's: the same note, under its own count of changes. */
const takenIn = (mine: Doc, theirs: Doc): Doc => become(mine, theirs).doc
/** The app's copy, some changes of its own ahead of the server's count. */
const APP = apply(apply(PHYSICS, [{ op: 'update', id: 't2', set: { md: 'x' } }]).doc, [{ op: 'update', id: 't2', set: { md: (PHYSICS.block.t2 as TextBlock).md } }]).doc

describe('the server\'s entries in a note\'s log', () => {
  it('join it once each, in the order things happened, and only when they are the server\'s', () => {
    const mine: LogItem[] = [{ entry: entry(10, { source: 'app', model: 'gemma' }) }, { entry: entry(30, { source: 'app', model: 'gemma' }) }]
    const kept = [{ entry: entry(20) }, { entry: entry(40, { result: 'failed', error: 'stale: Block t2 changed.' }) }]
    const next = withAssistants(mine, kept, PHYSICS)!
    expect(next.map((item) => [item.entry.at, item.entry.source])).toEqual([[10, 'app'], [20, 'mcp'], [30, 'app'], [40, 'mcp']])
    // Read again, nothing is new.
    expect(withAssistants(next, kept, PHYSICS)).toBeUndefined()
    expect(withAssistants(next, [...kept, { entry: entry(50) }], PHYSICS)!.map((item) => item.entry.at)).toEqual([10, 20, 30, 40, 50])
  })

  it('are taken as data: what is not an entry of the server\'s is left out', () => {
    const odd: unknown[] = [undefined, 'text', { not: 'a list' }, [5, null, 'x', {}, { entry: { at: 'now' } }, { entry: { ...entry(1), source: 'app' } }, { entry: { ...entry(2), extra: 'field' } }, { entry: { ...entry(3), tokensIn: -1 } }]]
    for (const kept of odd) expect(withAssistants([], kept, PHYSICS)).toBeUndefined()
  })
})

describe('an assistant\'s edit', () => {
  it('can be undone here while its blocks are as it left them, by this device\'s own count', () => {
    const edit = served(PHYSICS, [{ op: 'style', ids: ['t1'], set: [{ color: 'blue' }] }, { op: 'insert', at: 'after', ref: 't2', kind: 'math', content: 'a = F / m' }], 100)
    const mine = takenIn(APP, edit.doc)
    const [item] = withAssistants([], [edit.item], mine)!
    expect(item!.undo).toEqual({ inverse: edit.item.undo.inverse, rev: mine.rev })
    expect(mine.rev).not.toBe(edit.item.undo.rev)
    // Applied as the log's Undo applies it, the note is as it was.
    const back = apply(mine, item!.undo!.inverse, { baseRev: item!.undo!.rev }).doc
    expect((back.block.t1 as TextBlock).style).toBeUndefined()
    expect(Object.keys(back.block).sort()).toEqual(Object.keys(PHYSICS.block).sort())
    // A column laid out again since (its height) does not stand in the way: its blocks are what must be as they were left.
    const laidOut = apply(mine, [{ op: 'update', id: 'f1', set: { h: 12345 } }]).doc
    expect(withAssistants([], [edit.item], laidOut)![0]!.undo).toBeDefined()
  })

  it('keeps no Undo once the person changed one of its blocks, or removed one, or brought back one it removed', () => {
    const styled = served(PHYSICS, [{ op: 'style', ids: ['t1'], set: [{ color: 'blue' }] }], 100)
    const mine = takenIn(APP, styled.doc)
    const typed = apply(mine, [{ op: 'update', id: 't1', set: { md: 'Typed since.' } }]).doc
    expect(withAssistants([], [styled.item], typed)![0]!.undo).toBeUndefined()
    expect(withAssistants([], [styled.item], apply(mine, [{ op: 'remove', id: 't1' }]).doc)![0]!.undo).toBeUndefined()
    // Not taken in yet: the blocks here are not as the edit left them, so there is nothing to undo here.
    expect(withAssistants([], [styled.item], APP)![0]!.undo).toBeUndefined()

    const removed = served(PHYSICS, [{ op: 'delete', ids: ['t2'] }], 200)
    const without = takenIn(APP, removed.doc)
    expect(withAssistants([], [removed.item], without)![0]!.undo).toBeDefined()
    expect(withAssistants([], [removed.item], APP)![0]!.undo).toBeUndefined()
  })

  it('of two that reached the note together, only the later one of a block keeps its Undo', () => {
    const first = served(PHYSICS, [{ op: 'style', ids: ['t1'], set: [{ color: 'blue' }] }], 100)
    const second = served(first.doc, [{ op: 'style', ids: ['t1'], set: [{ size: 'l' }] }], 200)
    const other = served(second.doc, [{ op: 'rewrite', id: 't2', content: 'Rewritten.' }], 300)
    const next = withAssistants([], [first.item, second.item, other.item], takenIn(APP, other.doc))!
    expect(next.map((item) => item.undo !== undefined)).toEqual([false, true, true])
  })

  it('keeps no Undo it cannot check: no marks, operations that are not operations, or far too many', () => {
    const edit = served(PHYSICS, [{ op: 'style', ids: ['t1'], set: [{ color: 'blue' }] }], 100)
    const mine = takenIn(APP, edit.doc)
    const undos: unknown[] = [
      undefined,
      'undo',
      { inverse: edit.item.undo.inverse, rev: 1 },
      { ...edit.item.undo, after: {} },
      { ...edit.item.undo, after: { f1: edit.item.undo.after.f1 ?? 'x' } },
      { ...edit.item.undo, inverse: [] },
      { ...edit.item.undo, inverse: [{ op: 'run', command: 'anything' }] },
      { ...edit.item.undo, inverse: [{ op: 'update', id: 't1', set: {}, more: 1 }] },
      { ...edit.item.undo, inverse: Array.from({ length: 2001 }, () => edit.item.undo.inverse[0]) },
    ]
    for (const undo of undos) expect(withAssistants([], [{ entry: entry(100), undo }], mine)![0]!.undo, JSON.stringify(undo)?.slice(0, 80)).toBeUndefined()
    // And an edit that was refused has none, whatever its entry says.
    expect(withAssistants([], [{ entry: entry(100, { result: 'failed', error: 'stale' }), undo: edit.item.undo }], mine)![0]!.undo).toBeUndefined()
  })
})
