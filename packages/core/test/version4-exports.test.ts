// Stage 4 of other programs inside shellnote: what a note keeps of the programs written beside (the person's: pictures
// and words left out of an exported note unless the person keeps them in) stays out of the exports there are, and a
// stroke's picture counts as in use, so its bytes are never lost.
import { describe, expect, it } from 'vitest'
import { apply, idTaken, pack, toMarkdown, unpack, validateDoc, type Block, type Doc, type Stroke } from '../src/index.js'
import { toText } from '../src/export/text.js'
import { PHYSICS } from './fixtures/index.js'
import { expectError } from './helpers.js'

const HASH = 'a1b2c3d4'
const pm = { m: 'pp000001', at: 1_762_000_000_000, place: { address: 'https://example.com/private?key=sekret' }, pic: HASH }
const stroke: Stroke = { pts: [0, 0, 128, 500, 40, 140], color: 'ink', width: 'm', pm }

/** PHYSICS with a program, the words of a place, a picture, and a stroke written beside it. */
function written(): Doc {
  const withProgram = apply(PHYSICS, [
    { op: 'asset', hash: HASH, meta: { mime: 'image/webp', w: 640, h: 400, bytes: 4 } },
    { op: 'update', id: PHYSICS.id, set: { programs: [{ id: 'pp000001', program: 'chrome.exe', title: 'A private page', places: [{ place: pm.place, words: 'The words of that page' }] }] } },
  ]).doc
  return apply(withProgram, [{ op: 'add', block: { id: 'k9', r: 0, type: 'ink', page: 'p1', x: 3000, y: 21000, w: 4000, h: 2000, strokes: [stroke] } as Block }]).doc
}

describe('what is kept of a program', () => {
  it('stays out of the exports there are: its address, its words, its picture, its title', () => {
    for (const text of [toMarkdown(written()).markdown, toText(written())]) {
      for (const secret of ['sekret', 'example.com', 'The words of that page', 'A private page', HASH]) expect(text).not.toContain(secret)
    }
  })

  it('counts a stroke’s picture as in use: it is not taken out, and its bytes must be saved', () => {
    const doc = written()
    expectError(() => apply(doc, [{ op: 'asset', hash: HASH, meta: null }]), 'in_use', /picture/u)
    // The note's other pictures have their bytes: only this one is missing.
    const others = Object.fromEntries(Object.keys(PHYSICS.asset).map((hash) => [hash, new Uint8Array([9])]))
    expectError(() => pack(doc, others), 'bad_doc', new RegExp(HASH, 'u'))
    const bytes = new Uint8Array([1, 2, 3, 4])
    const opened = unpack(pack(doc, { ...others, [HASH]: bytes }))
    expect(opened.doc.block.k9).toEqual(doc.block.k9)
    expect(opened.assets[HASH]).toEqual(bytes)
  })

  it('is checked when a note is read: a stroke’s program and its picture must be there', () => {
    expect(validateDoc(written())).toBeTruthy()
    const noProgram = structuredClone(written())
    delete noProgram.programs
    expectError(() => validateDoc(noProgram), 'bad_doc', /program pp000001/u)
    const noPicture = structuredClone(written())
    delete noPicture.asset[HASH]
    expectError(() => validateDoc(noPicture), 'bad_doc', /asset a1b2c3d4/u)
  })

  it('keeps ids apart: a new block’s id never takes a program’s', () => {
    expect(idTaken(written(), 'pp000001')).toBe(true)
    expect(idTaken(written(), 'pp000002')).toBe(false)
  })
})
