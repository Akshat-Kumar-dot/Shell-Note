// File format version 4 (other programs inside ShellNote, stage 4, 2 November 2026): a
// note's sources may be another program, keeping the words of each place seen, and a stroke written beside it keeps
// its moment: which program, when, its place, and a small picture when the view had changed.
import { describe, expect, it } from 'vitest'
import { apply, fromFiles, parseDoc, SCHEMA_VERSION, toFiles, validateDoc, type Block, type Doc, type Stroke } from '../src/index.js'
import { PHYSICS } from './fixtures/index.js'
import { expectError } from './helpers.js'

const program = { id: 'pp000001', program: 'POWERPNT.EXE', title: 'Lecture 4.pptx - PowerPoint', places: [{ place: { slide: 256, n: 3 }, words: 'Waves carry energy' }] } as const

/** PHYSICS with the program as a source, and an ink block of these strokes. */
function written(...strokes: Stroke[]): Doc {
  const withProgram = apply(PHYSICS, [
    { op: 'asset', hash: 'a1b2c3d4', meta: { mime: 'image/webp', w: 640, h: 400, bytes: 4 } },
    { op: 'update', id: PHYSICS.id, set: { programs: [program] } },
  ]).doc
  return apply(withProgram, [{ op: 'add', block: { id: 'k9', r: 0, type: 'ink', page: 'p1', x: 3000, y: 21000, w: 4000, h: 2000, strokes } as Block }]).doc
}

const stroke = (extra: Partial<Stroke> = {}): Stroke => ({ pts: [0, 0, 128, 500, 40, 140], color: 'ink', width: 'm', ...extra })

describe('file format version 4', () => {
  it('is the version written', () => {
    expect(SCHEMA_VERSION).toBe(4)
  })

  it('opens a version 3 note unchanged but for its version', () => {
    const old = { ...structuredClone(PHYSICS), v: 3 }
    expect(parseDoc(old)).toEqual({ ...PHYSICS, v: 4 })
  })

  it('keeps a program as a source, and each stroke’s moment beside it, through saving and opening', () => {
    const doc = written(
      stroke({ pm: { m: 'pp000001', at: 1_762_000_000_000, place: { slide: 256, n: 3 } } }),
      stroke({ pm: { m: 'pp000001', at: 1_762_000_004_000, place: { address: 'https://example.com/waves#:~:text=Waves' }, pic: 'a1b2c3d4' } }),
      stroke({ pm: { m: 'pp000001', at: 1_762_000_009_000, place: { file: 'src/waves.ts', line: 42 } } }),
      stroke({ pm: { m: 'pp000001', at: 1_762_000_012_000 } }),
    )
    expect(validateDoc(doc)).toBe(doc)
    const back = fromFiles(toFiles(doc))
    expect(back.programs).toEqual([program])
    expect(back.block.k9).toEqual(doc.block.k9)
  })

  it('refuses a place that is none of a program’s', () => {
    expectError(() => written(stroke({ pm: { m: 'pp000001', at: 1, place: { slide: 256, n: 0 } } })), 'bad_shape', /pm/)
    expectError(() => written(stroke({ pm: { m: 'pp000001', at: 1, place: { line: 4 } as never } })), 'bad_shape', /pm/)
    expectError(() => written(stroke({ pm: { m: 'pp000001', at: -5 } })), 'bad_shape', /pm/)
  })
})
