// File format version 5 (15 November 2026): a note may say what it is for (kind), how its pages are shown (view)
// and which of its pictures is its cover. All three are optional: a note without them is a mixed note shown as pages,
// as every note was before.
import { describe, expect, it } from 'vitest'
import { apply, fromFiles, merge, parseDoc, SCHEMA_VERSION, toFiles, validateDoc, type Doc } from '../src/index.js'
import { PHYSICS } from './fixtures/index.js'
import { expectError } from './helpers.js'

const PICTURE = 'c0ffee00'

/** PHYSICS with one picture more, unused, to be its cover. */
function withPicture(): Doc {
  return apply(PHYSICS, [{ op: 'asset', hash: PICTURE, meta: { mime: 'image/jpeg', w: 800, h: 400, bytes: 4 } }]).doc
}

describe('file format version 5', () => {
  it('is the version written', () => {
    expect(SCHEMA_VERSION).toBe(5)
  })

  it('opens a version 4 note unchanged but for its version', () => {
    const old = { ...structuredClone(PHYSICS), v: 4 }
    expect(parseDoc(old)).toEqual({ ...PHYSICS, v: 5 })
  })

  it('writes an older note’s file with nothing new in it', () => {
    const text = toFiles(PHYSICS)['doc.json']!
    expect(text).not.toMatch(/"kind"|"view"|"cover"/u)
  })

  it('keeps the kind, the view and the cover through saving and opening', () => {
    const doc = apply(withPicture(), [{ op: 'update', id: PHYSICS.id, set: { kind: 'sketch', view: 'seamless', cover: PICTURE } }]).doc
    expect(validateDoc(doc)).toBe(doc)
    const files = toFiles(doc)
    expect(files['doc.json']).toMatch(/"title": "[^"]*",\n {2}"kind": "sketch",\n {2}"view": "seamless",\n {2}"cover": "c0ffee00",\n {2}"rev"/u)
    expect(fromFiles(files)).toEqual(doc)
  })

  it('takes a change of view back with undo, leaving the note as it was', () => {
    const done = apply(PHYSICS, [{ op: 'update', id: PHYSICS.id, set: { view: 'seamless' } }])
    expect(done.doc.view).toBe('seamless')
    const back = apply(done.doc, done.inverse).doc
    expect(back.view).toBeUndefined()
    expect(toFiles(back)['doc.json']).toBe(toFiles({ ...PHYSICS, rev: back.rev })['doc.json'])
  })

  it('refuses a kind or a view it does not know', () => {
    expectError(() => apply(PHYSICS, [{ op: 'update', id: PHYSICS.id, set: { kind: 'board' } }]), 'bad_shape')
    expectError(() => apply(PHYSICS, [{ op: 'update', id: PHYSICS.id, set: { view: 'scroll' } }]), 'bad_shape')
  })

  it('takes as a cover only a picture the note holds, and keeps that picture while it is the cover', () => {
    expectError(() => apply(PHYSICS, [{ op: 'update', id: PHYSICS.id, set: { cover: PICTURE } }]), 'unknown_id')
    const covered = apply(withPicture(), [{ op: 'update', id: PHYSICS.id, set: { cover: PICTURE } }]).doc
    expectError(() => apply(covered, [{ op: 'asset', hash: PICTURE, meta: null }]), 'in_use')
    const bare = apply(covered, [
      { op: 'update', id: PHYSICS.id, set: { cover: null } },
      { op: 'asset', hash: PICTURE, meta: null },
    ]).doc
    expect(bare.cover).toBeUndefined()
    expectError(() => validateDoc({ ...covered, asset: PHYSICS.asset }), 'bad_doc', /cover/u)
  })

  it('merges what each device chose: the side that changed one, and the picture with the cover', () => {
    const base = withPicture()
    const mine = apply(base, [{ op: 'update', id: PHYSICS.id, set: { view: 'seamless' } }]).doc
    const theirs = apply(base, [{ op: 'update', id: PHYSICS.id, set: { kind: 'text', cover: PICTURE } }]).doc
    const { doc } = merge(mine, theirs, { base, first: 'mine' })
    expect(doc).toMatchObject({ kind: 'text', view: 'seamless', cover: PICTURE })
    expect(doc.asset[PICTURE]).toBeDefined()
    expect(validateDoc({ ...doc, v: SCHEMA_VERSION })).toBeDefined()
  })
})
