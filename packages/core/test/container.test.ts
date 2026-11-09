// Phase 0 exit check: save then load gives a deep-equal document.
import fc from 'fast-check'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { apply, fromFiles, pack, toFiles, unpack, type Doc } from '../src/index.js'
import { isRecord } from '../src/util.js'
import { Namer, planTransaction, transactions } from './arbitraries.js'
import { FIXTURES, MIXED, PHYSICS } from './fixtures/index.js'
import { expectError } from './helpers.js'

/** Made-up bytes for each image the document lists. */
function imagesFor(doc: Doc): Record<string, Uint8Array> {
  return Object.fromEntries(Object.keys(doc.asset).map((hash, i) => [hash, new Uint8Array([0x89, 0x50, 0x4e, 0x47, i, hash.length])]))
}

/** The same value with every object's keys in reverse order. */
function reversed(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversed)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.entries(value).reverse().map(([key, inner]) => [key, reversed(inner)]))
}

/** Edit one page file of the folder form. */
function editPage(files: Record<string, string>, page: string, edit: (blocks: Record<string, unknown>) => void): void {
  const file = JSON.parse(files[`pages/${page}.json`]!) as { block: Record<string, unknown> }
  edit(file.block)
  files[`pages/${page}.json`] = JSON.stringify(file)
}

describe('save then open', () => {
  for (const [name, doc] of Object.entries(FIXTURES)) {
    it(`gives back ${name} exactly, images included`, () => {
      const images = imagesFor(doc)
      const opened = unpack(pack(doc, images))
      expect(opened.doc).toStrictEqual(doc)
      expect(opened.assets).toStrictEqual(images)
    })
  }

  it('gives back randomly edited documents exactly', () => {
    fc.assert(
      fc.property(fc.constantFrom(...Object.values(FIXTURES)), transactions, (start, plan) => {
        const namer = new Namer()
        let doc = start
        for (const seeds of plan) {
          const { ops } = planTransaction(namer, doc, seeds)
          if (ops.length > 0) doc = apply(doc, ops).doc
        }
        expect(unpack(pack(doc, imagesFor(doc))).doc).toStrictEqual(doc)
      }),
      { numRuns: 200 },
    )
  })

  it('writes the same bytes for the same document, whatever order its fields are in', () => {
    const images = imagesFor(MIXED)
    expect(pack(reversed(MIXED) as Doc, images)).toStrictEqual(pack(MIXED, images))
  })

  it('needs the bytes of every image in use, but not of unused assets', () => {
    expectError(() => pack(PHYSICS), 'bad_doc', /a91f has no bytes/)
    const used = Object.fromEntries(Object.entries(imagesFor(MIXED)).filter(([hash]) => hash !== 'c0de'))
    expect(unpack(pack(MIXED, used)).assets).toStrictEqual(used)
  })
})

describe('the folder form', () => {
  it('looks like this', async () => {
    const files = toFiles(PHYSICS)
    const listing = Object.entries(files).map(([path, text]) => `=== ${path}\n${text}`)
    await expect(listing.join('')).toMatchFileSnapshot('./__snapshots__/files.physics.txt')
  })

  it('reads back what it writes', () => {
    for (const doc of Object.values(FIXTURES)) expect(fromFiles(toFiles(doc))).toStrictEqual(doc)
  })

  it('tolerates a byte-order mark added by a text editor', () => {
    const files = toFiles(PHYSICS)
    files['doc.json'] = String.fromCharCode(0xfeff) + files['doc.json']
    expect(fromFiles(files)).toStrictEqual(PHYSICS)
    // ...and only a real one: text that merely spells it is still refused.
    expectError(() => fromFiles({ ...files, 'doc.json': `FEFF${toFiles(PHYSICS)['doc.json']}` }), 'bad_doc', /not valid JSON/)
  })
})

describe('damaged files are refused with a reason', () => {
  it('not a zip at all', () => {
    expectError(() => unpack(strToU8('hello')), 'bad_doc', /not a notes file/)
  })

  it('missing parts', () => {
    expectError(() => unpack(zipSync({ 'readme.txt': strToU8('hi') })), 'bad_doc', /missing doc\.json/)
    const files = toFiles(PHYSICS)
    delete files['pages/p1.json']
    expectError(() => fromFiles(files), 'bad_doc', /missing pages\/p1\.json/)
  })

  it('broken JSON', () => {
    expectError(() => fromFiles({ ...toFiles(PHYSICS), 'doc.json': '{"v": 1,' }), 'bad_doc', /doc\.json is not valid JSON/)
  })

  it('a block stored with the wrong page, or twice', () => {
    const moved = toFiles(MIXED)
    let image: unknown
    editPage(moved, 'w2', (blocks) => {
      image = blocks.gi
      delete blocks.gi
    })
    editPage(moved, 'w1', (blocks) => {
      blocks.gi = image
    })
    expectError(() => fromFiles(moved), 'bad_doc', /gi is stored in pages\/w1\.json, but it is on page w2/)

    const twice = toFiles(MIXED)
    editPage(twice, 'w1', (blocks) => {
      blocks.c1 = (JSON.parse(twice['pages/w2.json']!) as { block: Record<string, unknown> }).block.c1
    })
    expectError(() => fromFiles(twice), 'bad_doc', /c1 is stored twice/)
  })

  it('a file from a newer version of the app', () => {
    const files = toFiles(PHYSICS)
    files['doc.json'] = files['doc.json']!.replace('"v": 4', '"v": 5')
    expectError(() => fromFiles(files), 'too_new', /Update the app/)
  })

  it('ignores files that are not part of the format', () => {
    const zip = zipSync({ ...Object.fromEntries(Object.entries(toFiles(PHYSICS)).map(([p, t]) => [p, strToU8(t)])), 'notes/other.txt': strToU8('x') })
    expect(unpack(zip).doc).toStrictEqual(PHYSICS)
  })
})
