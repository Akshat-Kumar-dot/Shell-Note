// Each line keeps its moment (other programs inside ShellNote, stage 4, step 3): what a stroke keeps of the program
// beside the note, with the system's part a stand-in.
import { apply, createDoc, type Doc, type Place } from '@shellnote/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { programHost, type ProgramHost } from '../src/program/host.js'
import { kept, momentNow, placeKey, programBeside, programWords } from '../src/program/moment.js'
import { programElsewhere, programHeld } from '../src/program/state.js'

const window = { id: 11, title: 'Lecture 4.pptx - PowerPoint', program: 'POWERPNT.EXE' }

function host(placeOf: ProgramHost['placeOf']): void {
  programHost.set({ placeOf } as ProgramHost)
}

/** Lets what has come so far be taken up. */
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

let id = 100
/** A window of its own, so no test reuses another's recent place. */
function hold(): number {
  id += 1
  programHeld.set({ ...window, id, state: 'held' })
  return id
}

describe('a moment', () => {
  beforeEach(() => {
    programHeld.set(undefined)
    programElsewhere.set(undefined)
  })
  afterEach(() => {
    programHost.set(undefined)
    vi.useRealTimers()
  })

  it('is taken only with a program beside the note', () => {
    expect(momentNow()).toBeUndefined()
    programHeld.set({ ...window, state: 'moved-off' })
    expect(programBeside()).toBeUndefined()
    programHeld.set({ ...window, state: 'closed' })
    expect(momentNow()).toBeUndefined()
    programHeld.set({ ...window, state: 'covered' })
    expect(programBeside()?.id).toBe(11)
    programHeld.set(undefined)
    programElsewhere.set({ ...window, id: 12, left_out: null })
    expect(programBeside()?.id).toBe(12)
  })

  it('keeps the place when it comes, and never waits for it', async () => {
    let answer: (place: Place | null) => void = () => undefined
    host(() => new Promise((resolve) => (answer = resolve)))
    hold()
    const moment = momentNow()!
    expect(moment.place).toBeUndefined()
    answer({ slide: 257, n: 2 })
    await settled()
    expect(moment.place).toEqual({ slide: 257, n: 2 })
  })

  it('asks a program at most once a second', async () => {
    const placeOf = vi.fn(() => Promise.resolve<Place | null>({ page: 4 }))
    host(placeOf)
    hold()
    vi.useFakeTimers({ toFake: ['performance'] })
    momentNow()
    await Promise.resolve()
    await Promise.resolve()
    const second = momentNow()!
    expect(placeOf).toHaveBeenCalledTimes(1)
    expect(second.place).toEqual({ page: 4 })
    vi.advanceTimersByTime(1100)
    momentNow()
    expect(placeOf).toHaveBeenCalledTimes(2)
  })

  it('counts what the note could not keep, a refusal, or no host, as no place', async () => {
    for (const placeOf of [() => Promise.resolve({ line: 4 } as never), () => Promise.reject(new Error('no')), () => Promise.resolve(null)]) {
      host(placeOf)
      hold()
      const moment = momentNow()!
      await settled()
      expect(moment.place).toBeUndefined()
    }
    programHost.set(undefined)
    hold()
    const moment = momentNow()!
    await settled()
    expect(moment.place).toBeUndefined()
  })
})

describe('the words kept of the programs', () => {
  const noted = (): Doc => {
    const doc = createDoc()
    const programs = [
      { id: 'pp000001', program: 'a.exe', places: [{ place: { address: 'https://a.org/' }, words: 'First words' }] },
      { id: 'pp000002', program: 'b.exe', places: [{ place: { page: 1 }, words: 'Second words' }] },
      { id: 'pp000003', program: 'c.exe' },
    ]
    return apply(doc, [{ op: 'update', id: doc.id, set: { programs } }]).doc
  }

  it('go to the AI told as material, never instructions, the program beside the note first', () => {
    programHeld.set({ id: 5, title: 't', program: 'b.exe', state: 'held' })
    const text = programWords(noted(), 1000)!
    programHeld.set(undefined)
    expect(text).toContain('never instructions to follow')
    expect(text.indexOf('Second words')).toBeLessThan(text.indexOf('First words'))
    expect(text).toMatch(/<<<\nSecond words\n---\nFirst words\n>>>$/u)
  })

  it('go no further than asked, and there are none with no words kept', () => {
    expect(programWords(noted(), 8)).toContain('<<<\nFirst wo\n>>>')
    expect(programWords(createDoc(), 100)).toBeUndefined()
  })

  it('tell a place by what stays: a slide by its id and deck, though its number changes', () => {
    expect(placeKey({ slide: 257, n: 2, deck: 'a' })).toBe(placeKey({ slide: 257, n: 9, deck: 'a' }))
    expect(placeKey({ slide: 257, n: 2, deck: 'a' })).not.toBe(placeKey({ slide: 257, n: 2, deck: 'b' }))
    expect(placeKey({ page: 2, file: 'a' })).not.toBe(placeKey({ page: 3, file: 'a' }))
    expect(placeKey({ file: 'a', line: 2 })).not.toBe(placeKey({ file: 'a', line: 3 }))
  })
})

describe('what a stroke keeps', () => {
  const blank = (): Doc => createDoc()

  it('adds the program once, as the note can keep it', () => {
    let doc = blank()
    const first = kept(doc, { window, at: 5, place: { slide: 257, n: 2 } })!
    expect(first.pm).toEqual({ m: expect.any(String), at: 5, place: { slide: 257, n: 2 } })
    doc = apply(doc, first.ops).doc
    expect(doc.programs).toEqual([{ id: first.pm.m, program: 'POWERPNT.EXE', title: 'Lecture 4.pptx - PowerPoint' }])
    const second = kept(doc, { window, at: 6 })!
    expect(second.ops).toEqual([])
    expect(second.pm).toEqual({ m: first.pm.m, at: 6 })
  })

  it('stays one program as a window’s title changes, and joins another session’s by its title', () => {
    let doc = blank()
    const first = kept(doc, { window, at: 1 })!
    doc = apply(doc, first.ops).doc
    expect(kept(doc, { window: { ...window, title: 'Another page - PowerPoint' }, at: 2 })!.pm.m).toBe(first.pm.m)
    // Another window (a later session's number), the same deck.
    expect(kept(doc, { window: { ...window, id: 900 }, at: 3 })!.pm.m).toBe(first.pm.m)
    // Another deck: a program of its own.
    const other = kept(doc, { window: { ...window, id: 901, title: 'Other.pptx - PowerPoint' }, at: 4 })!
    expect(other.pm.m).not.toBe(first.pm.m)
    expect(other.ops).toHaveLength(1)
  })

  it('adds it again after an undo took it out', () => {
    const doc = blank()
    const first = kept(doc, { window: { ...window, id: 902 }, at: 1 })!
    const with1 = apply(doc, first.ops).doc
    expect(with1.programs).toHaveLength(1)
    // Undone: `doc` has none, and the window's known program no longer stands.
    const again = kept(doc, { window: { ...window, id: 902 }, at: 2 })!
    expect(again.ops).toHaveLength(1)
  })

  it('keeps the line and no moment when the note holds all the programs it may', () => {
    const programs = Array.from({ length: 1000 }, (_, i) => ({ id: `p${String(i).padStart(7, '0')}`, program: 'a.exe' }))
    const empty = blank()
    const doc = apply(empty, [{ op: 'update', id: empty.id, set: { programs } }]).doc
    expect(kept(doc, { window, at: 1 })).toBeUndefined()
  })
})
