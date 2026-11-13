// What the server keeps for the person in its own place: each note's log,
// and a note as it was before an assistant changed it.
import { apply, type LogEntry } from '@shellnote/core'
import { MemoryFiles } from '@shellnote/library'
import { describe, expect, it } from 'vitest'
import { PHYSICS } from '../../../packages/core/test/fixtures/index.js'
import { COPIES_KEPT, COPY_DAYS, COPY_EVERY, Keeper, LOG_KEPT } from '../src/keeper.js'
import { kindOf } from '../src/nodeFiles.js'

const DAY = 24 * 60 * 60 * 1000
const entry = (at: number, more: Partial<LogEntry> = {}): LogEntry => ({ at, source: 'mcp', model: 'an assistant', rulebook: 'r1', instruction: '', targets: ['t1'], ops: [{ op: 'delete', ids: ['t1'] }], result: 'applied', tier: 1, calls: 0, retries: 0, tokensIn: 0, tokensOut: 0, ms: 3, ...more })

function fresh(): { keeper: Keeper; files: MemoryFiles; clock: { time: number } } {
  const clock = { time: 1_800_000_000_000 }
  const files = new MemoryFiles(() => clock.time)
  return { keeper: new Keeper(files, () => clock.time), files, clock }
}

describe('a note\'s log', () => {
  it('holds each edit in order, with what undoes it, and keeps the latest entries only', async () => {
    const { keeper, files } = fresh()
    expect(await keeper.logged('n1')).toEqual([])
    await keeper.log('n1', { entry: entry(1), undo: { inverse: [{ op: 'remove', id: 'x' }], rev: 13 } })
    await keeper.log('n1', { entry: entry(2, { result: 'failed', error: 'stale: Block t2 changed.' }) })
    await keeper.log('n2', { entry: entry(3) })
    const kept = await keeper.logged('n1')
    expect(kept.map((item) => [item.entry.at, item.entry.result])).toEqual([[1, 'applied'], [2, 'failed']])
    expect(kept[0]!.undo).toEqual({ inverse: [{ op: 'remove', id: 'x' }], rev: 13 })
    expect((await files.list()).filter((info) => !info.folder).map((info) => info.path).sort()).toEqual(['log/n1.json', 'log/n2.json'])

    for (let i = 0; i < LOG_KEPT + 5; i++) await keeper.log('n3', { entry: entry(100 + i) })
    const many = await keeper.logged('n3')
    expect(many).toHaveLength(LOG_KEPT)
    expect(many[0]!.entry.at).toBe(105)
  })

  it('takes only what is a log entry, and only for a note a file may be named after', async () => {
    const { keeper, files } = fresh()
    await expect(keeper.log('n1', { entry: { ...entry(1), source: 'someone' } as unknown as LogEntry })).rejects.toThrow()
    await keeper.log('../../outside', { entry: entry(1) })
    await keeper.log('', { entry: entry(1) })
    expect(await files.list()).toEqual([])
    // A file something else wrote there is read as no log, never as a fault.
    files.put('log/n1.json', new TextEncoder().encode('{"not":"a list"'))
    expect(await keeper.logged('n1')).toEqual([])
    files.put('log/n1.json', new TextEncoder().encode(JSON.stringify([{ entry: { at: 'yesterday' } }, { entry: entry(7) }, 5])))
    expect((await keeper.logged('n1')).map((item) => item.entry.at)).toEqual([7])
  })
})

describe('a note as it was', () => {
  it('is kept before a run of edits, once an hour at most', async () => {
    const { keeper, clock } = fresh()
    const later = apply(PHYSICS, [{ op: 'update', id: 't1', set: { md: 'Changed' } }]).doc
    expect(await keeper.copy('n1', PHYSICS)).toBe(true)
    clock.time += 5 * 60 * 1000
    expect(await keeper.copy('n1', later)).toBe(false)
    clock.time += COPY_EVERY
    expect(await keeper.copy('n1', later)).toBe(true)
    const kept = await keeper.copies('n1')
    expect(kept).toHaveLength(2)
    expect(await keeper.copyAt('n1', kept[0]!)).toEqual(PHYSICS)
    expect(await keeper.copyAt('n1', kept[1]!)).toEqual(later)
    expect(await keeper.copyAt('n1', 12345)).toBeUndefined()
    expect(await keeper.copies('n2')).toEqual([])
  })

  it('goes once there are too many, or when it has been kept as long as was promised', async () => {
    const { keeper, files, clock } = fresh()
    for (let i = 0; i < COPIES_KEPT + 3; i++) {
      expect(await keeper.copy('n1', PHYSICS)).toBe(true)
      clock.time += COPY_EVERY
    }
    expect(await keeper.copies('n1')).toHaveLength(COPIES_KEPT)
    expect((await files.list()).filter((info) => !info.folder && info.path.startsWith('copies/n1/') && !info.path.endsWith('index.json'))).toHaveLength(COPIES_KEPT)

    clock.time += (COPY_DAYS + 1) * DAY
    expect(await keeper.copy('n1', PHYSICS)).toBe(true)
    expect(await keeper.copies('n1')).toEqual([clock.time])
    expect((await files.list()).filter((info) => !info.folder).map((info) => info.path).sort()).toEqual([`copies/n1/${clock.time}.json`, 'copies/n1/index.json'])
  })

  it('and the log are files the server\'s own place takes, and no others like them', () => {
    expect(kindOf('own', 'log/n1.json')).toBe('own')
    expect(kindOf('own', 'copies/n1/index.json')).toBe('own')
    expect(kindOf('own', 'copies/n1/1800000000000.json')).toBe('own')
    for (const path of ['log/n1.exe', 'log/a/n1.json', 'log/.json', 'copies/n1/run.exe', 'copies/n1/x.json', 'copies/index.json', 'copies/n1/a/1.json', 'log/n 1.json']) expect(kindOf('own', path), path).toBe('other')
    expect(kindOf('shared', 'log/n1.json')).toBe('other')
  })
})

describe('the notes a copy is kept of', () => {
  it('are named, and a copy asked for whatever was kept before is always kept, at a time of its own', async () => {
    const { keeper, clock } = fresh()
    expect(await keeper.kept()).toEqual([])
    await keeper.copy('n2', PHYSICS)
    await keeper.copy('n1', PHYSICS)
    await keeper.log('n3', { entry: entry(1) })
    expect(await keeper.kept()).toEqual(['n1', 'n2'])
    // Within the hour, and in the very same moment: still kept when it must be.
    expect(await keeper.copy('n1', PHYSICS)).toBe(false)
    expect(await keeper.copy('n1', PHYSICS, true)).toBe(true)
    expect(await keeper.copy('n1', PHYSICS, true)).toBe(true)
    expect(await keeper.copies('n1')).toEqual([clock.time, clock.time + 1, clock.time + 2])
  })
})
