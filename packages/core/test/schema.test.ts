import { describe, expect, it } from 'vitest'
import { createDoc, ID_LENGTH, migrate, newId, parseDoc, SCHEMA_VERSION, validateDoc } from '../src/index.js'
import physics from './fixtures/physics.json' with { type: 'json' }
import { DELETE, edited, expectError } from './helpers.js'

describe('the document schema', () => {
  it('accepts the example document from the brief', () => {
    expect(validateDoc(physics)).toBe(physics)
    expect(parseDoc(physics)).toBe(physics)
  })

  it('creates a new document: one page, one empty frame inside the margins', () => {
    const doc = validateDoc(createDoc({ title: 'Week 1' }))
    expect(doc.title).toBe('Week 1')
    expect(doc.pages).toHaveLength(1)
    const page = doc.page[doc.pages[0]!]!
    expect(page).toMatchObject({ w: 21000, h: 29700, bg: 'blank' })
    expect(page.free).toHaveLength(1)
    expect(doc.block[page.free[0]!]).toMatchObject({ type: 'frame', x: 2000, y: 2000, w: 17000, kids: [] })
    expect(new Set([doc.id, page.id, page.free[0]]).size).toBe(3)
  })

  it('supports Letter and custom page sizes', () => {
    expect(Object.values(createDoc({ size: 'Letter' }).page)[0]).toMatchObject({ w: 21590, h: 27940 })
    expect(Object.values(createDoc({ size: { w: 10000, h: 15000 } }).page)[0]).toMatchObject({ w: 10000, h: 15000 })
  })
})

describe('ids', () => {
  it('are 8 random letters and digits', () => {
    const ids = Array.from({ length: 2000 }, () => newId())
    for (const id of ids) expect(id).toMatch(new RegExp(`^[0-9A-Za-z]{${ID_LENGTH}}$`))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('skip ids that are already taken', () => {
    let tries = 0
    newId(() => ++tries < 4)
    expect(tries).toBe(4)
  })
})

describe('shape errors carry a hint that says how to fix them', () => {
  const cases: [string, (string | number)[], unknown, RegExp][] = [
    ['text with page fields', ['block', 't1', 'page'], 'p1', /Give parent, not page/],
    ['math both in a frame and on a page', ['block', 'm1', 'page'], 'p1', /not both/],
    ['text placed on a page', ['block', 't1', 'parent'], DELETE, /text blocks sit inside a frame/],
    ['frame inside a frame', ['block', 'f1', 'parent'], 'f1', /frame blocks are placed on a page/],
    ['unknown block type', ['block', 'g1', 'type'], 'video', /unknown type "video"/],
    ['fractional position', ['block', 'g1', 'x'], 1.5, /^Block g1: x:/],
    ['pressure out of range', ['block', 'k1', 'strokes', 0, 'pts', 2], 300, /pressure from 0 to 255/],
    ['fractional point', ['block', 'k1', 'strokes', 0, 'pts', 0], 1.5, /pts holds x, y, pressure triples, whole numbers/],
    ['point that is not a number', ['block', 'k1', 'strokes', 0, 'pts', 1], '7', /pts holds/],
    ['points that are not a list', ['block', 'k1', 'strokes', 0, 'pts'], { 0: 1 }, /pts holds/],
    ['missing text', ['block', 't2', 'md'], DELETE, /Block t2: md:/],
    ['unknown field', ['block', 't1', 'colour'], 'red', /colour/],
    ['bad style token', ['block', 't1', 'style'], { color: 'pink' }, /style\.color/],
    ['bad id', ['block', 't1', 'id'], '_t1', /Ids are/],
  ]
  for (const [name, path, value, hint] of cases) {
    it(name, () => {
      expectError(() => validateDoc(edited(physics, path, value)), 'bad_shape', hint)
    })
  }
})

describe('structure errors', () => {
  const cases: [string, (string | number)[], unknown, RegExp][] = [
    ['a frame lists a missing block', ['block', 'f1', 'kids'], ['t1', 't2', 'm1', 'zz'], /frame f1 lists zz, which does not exist/],
    ['a block listed twice', ['block', 'f1', 'kids'], ['t1', 't2', 'm1', 't1'], /t1 is listed 2 times/],
    ['a free block missing from its page', ['page', 'p1', 'free'], ['f1', 'g1'], /k1 is listed 0 times/],
    ['r later than rev', ['block', 't1', 'r'], 13, /later than the document rev/],
    ['an image without its asset', ['block', 'g1', 'asset'], 'beef', /asset beef, which does not exist/],
    ['a frame continuing in itself', ['block', 'f1', 'next'], 'f1', /continues in itself/],
    ['a page listed twice', ['pages'], ['p1', 'p1'], /pages lists p1 twice/],
    ['no pages', ['pages'], [], /at least one page/],
    ['an id used twice', ['id'], 'p1', /document id p1 is also used/],
  ]
  for (const [name, path, value, hint] of cases) {
    it(name, () => {
      expectError(() => validateDoc(edited(physics, path, value)), 'bad_doc', hint)
    })
  }

  it('lists every problem, not only the first', () => {
    const broken = edited(edited(physics, ['block', 't1', 'r'], 99), ['block', 'g1', 'asset'], 'beef')
    const error = expectError(() => validateDoc(broken), 'bad_doc')
    expect(error.details.problems).toHaveLength(2)
  })
})

describe('migrations', () => {
  it('pass a current document through', () => {
    expect(migrate(physics)).toBe(physics)
  })

  it('refuse a document from a newer app', () => {
    expectError(() => migrate({ ...physics, v: SCHEMA_VERSION + 1 }), 'too_new', /Update the app/)
  })

  it('refuse something that is not a document', () => {
    expectError(() => migrate({ title: 'x' }), 'bad_doc', /no schema version/)
    expectError(() => migrate('hello'), 'bad_doc')
  })
})
