// File format version 3 (the pen, phase 3, 13 October 2026): a stroke may have
// a pen kind, a colour code, five widths, tilt and a snapped shape, and a note
// its own pen switches.
import { describe, expect, it } from 'vitest'
import { apply, fromFiles, migrate, parseDoc, SCHEMA_VERSION, toFiles, validateDoc, type Block, type Doc, type Stroke } from '../src/index.js'
import { PHYSICS } from './fixtures/index.js'
import { expectError } from './helpers.js'

const stroke = (extra: Partial<Stroke> = {}): Stroke => ({ pts: [0, 0, 128, 500, 40, 140], color: 'ink', width: 'm', ...extra })

/** PHYSICS with one more ink block holding these strokes. */
function withInk(...strokes: Stroke[]): Doc {
  return apply(PHYSICS, [{ op: 'add', block: { id: 'k9', r: 0, type: 'ink', page: 'p1', x: 3000, y: 21000, w: 4000, h: 2000, strokes } as Block }]).doc
}

describe('file format version 3', () => {
  it('is followed by version 4, which only adds (other programs’ places, stage 4)', () => {
    expect(SCHEMA_VERSION).toBe(4)
  })

  it('opens a version 2 note unchanged but for its version', () => {
    const old = { ...structuredClone(PHYSICS), v: 2 }
    const opened = parseDoc(old)
    expect(opened).toEqual({ ...PHYSICS, v: SCHEMA_VERSION })
  })

  it('keeps a stroke drawn with any pen, in any colour, with tilt and a shape', () => {
    const doc = withInk(
      stroke({ tool: 'pencil', tilt: [20, 35], color: '#e0563a', width: 'xs' }),
      stroke({ tool: 'highlighter', width: 'xl' }),
      stroke({ straight: true, shape: { kind: 'line', key: [0, 0, 500, 40] } }),
      stroke({ tool: 'fountain', shape: { kind: 'circle', key: [250, 20, 240] } }),
    )
    expect(validateDoc(doc)).toBe(doc)
    const back = fromFiles(toFiles(doc))
    expect(back.block.k9).toEqual(doc.block.k9)
  })

  it('refuses what a stroke cannot hold', () => {
    expectError(() => withInk(stroke({ tilt: [20] })), 'bad_shape', /tilt holds one value for each point/)
    expectError(() => withInk(stroke({ tilt: [20, 91] })), 'bad_shape', /tilt holds whole numbers from 0 to 90/)
    expectError(() => withInk(stroke({ tilt: [20, 4.5] })), 'bad_shape', /tilt holds whole numbers/)
    expectError(() => withInk(stroke({ tool: 'crayon' as never })), 'bad_shape', /tool/)
    expectError(() => withInk(stroke({ width: 'xxl' as never })), 'bad_shape', /width/)
    expectError(() => withInk(stroke({ color: '#E0563A' as never })), 'bad_shape', /color/)
    expectError(() => withInk(stroke({ shape: { kind: 'blob' as never, key: [] } })), 'bad_shape', /kind/)
  })
})

describe("a note's own pen switches", () => {
  it('are set, changed and taken away by update, each one undo step', () => {
    const set = apply(PHYSICS, [{ op: 'update', id: 'd1', set: { pen: { shapes: 'off', smoothing: 2 } } }])
    expect(set.doc.pen).toEqual({ shapes: 'off', smoothing: 2 })
    expect(apply(set.doc, set.inverse).doc).not.toHaveProperty('pen')
    const gone = apply(set.doc, [{ op: 'update', id: 'd1', set: { pen: null } }])
    expect(gone.doc).not.toHaveProperty('pen')
    expect(apply(gone.doc, gone.inverse).doc.pen).toEqual({ shapes: 'off', smoothing: 2 })
  })

  it('travel with the file', () => {
    const doc = apply(PHYSICS, [{ op: 'update', id: 'd1', set: { pen: { penOnly: 'always', neaten: 'line' } } }]).doc
    expect(fromFiles(toFiles(doc)).pen).toEqual({ penOnly: 'always', neaten: 'line' })
  })

  it('take only the switches there are, with their values', () => {
    expectError(() => apply(PHYSICS, [{ op: 'update', id: 'd1', set: { pen: { colour: 'red' } } }]), 'bad_shape', /pen/)
    expectError(() => apply(PHYSICS, [{ op: 'update', id: 'd1', set: { pen: { smoothing: 4 } } }]), 'bad_shape', /smoothing/)
  })

  it('make an older app say to update it', () => {
    expectError(() => migrate({ ...structuredClone(PHYSICS), v: SCHEMA_VERSION + 1 }), 'too_new', /Update the app/)
  })
})

describe("the videos beside a note, their marks, and the video time on strokes (17 October 2026)", () => {
  const youtube = { id: 'vid00001', kind: 'youtube' as const, video: 'dQw4w9WgXcQ', title: 'A lecture' }
  const hash = 'a'.repeat(64)
  const film = { id: 'vid00002', kind: 'file' as const, asset: hash, name: 'my clip.mp4', crop: { x: 100, y: 0, w: 800, h: 1000 } }
  const mark = { id: 'clp00001', media: 'vid00001', from: 7500, to: 7900, page: 'p1', x: 2000, y: 3000 }

  it('are set and taken away by update, each one undo step, and travel with the file', () => {
    const withAsset = apply(PHYSICS, [{ op: 'asset', hash, meta: { mime: 'video/mp4', bytes: 1000 } }]).doc
    const { doc, inverse } = apply(withAsset, [{ op: 'update', id: withAsset.id, set: { media: [youtube, film], clips: [mark] } }])
    expect(doc.media).toEqual([youtube, film])
    expect(doc.clips).toEqual([mark])
    expect(fromFiles(toFiles(doc))).toEqual(doc)
    const back = apply(doc, inverse).doc
    expect(back.media).toBeUndefined()
    expect(back.clips).toBeUndefined()
    // A video file in use cannot lose its bytes.
    expectError(() => apply(doc, [{ op: 'asset', hash, meta: null }]), 'in_use')
  })

  it('refuses a mark of a video the note lacks, a file not kept, a bad YouTube id, an id used twice', () => {
    expectError(() => apply(PHYSICS, [{ op: 'update', id: PHYSICS.id, set: { clips: [mark] } }]), 'unknown_id')
    expectError(() => apply(PHYSICS, [{ op: 'update', id: PHYSICS.id, set: { media: [film] } }]), 'unknown_id')
    expectError(() => apply(PHYSICS, [{ op: 'update', id: PHYSICS.id, set: { media: [{ ...youtube, video: 'not an id' }] } }]), 'bad_shape')
    expectError(() => apply(PHYSICS, [{ op: 'update', id: PHYSICS.id, set: { media: [youtube, { ...youtube, video: 'abcdefghijk' }] } }]), 'duplicate_id')
    expectError(() => apply(PHYSICS, [{ op: 'update', id: PHYSICS.id, set: { media: [youtube], clips: [{ ...mark, to: 7000 }] } }]), 'bad_shape')
  })

  it('keeps a video’s transcript, its lines in time order', () => {
    const youtube = { id: 'vid00001', kind: 'youtube' as const, video: 'aircAruvnKk', transcript: [{ t: 0, text: 'Hello' }, { t: 52, text: 'Welcome back' }] }
    const doc = apply(PHYSICS, [{ op: 'update', id: PHYSICS.id, set: { media: [youtube] } }]).doc
    expect(fromFiles(toFiles(doc)).media).toEqual([youtube])
    expectError(() => apply(PHYSICS, [{ op: 'update', id: PHYSICS.id, set: { media: [{ ...youtube, transcript: [{ t: 52, text: 'b' }, { t: 0, text: 'a' }] }] } }]), 'bad_shape')
  })

  it('keeps on each stroke which video it was written beside and when, from and to', () => {
    const doc = withInk(stroke({ vt: { m: 'vid00001', t: 7512 } }))
    expect(fromFiles(toFiles(doc)).block.k9).toEqual(doc.block.k9)
    const both = withInk(stroke({ vt: { m: 'vid00001', t: 7512, e: 7530 } }))
    expect(fromFiles(toFiles(both)).block.k9).toEqual(both.block.k9)
    expect(() => withInk(stroke({ vt: { m: 'vid00001', t: 7512, e: 7512 } }))).toThrow()
  })
})
