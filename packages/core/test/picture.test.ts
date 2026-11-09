// Pictures: their key (the hash of their bytes) and their caption.
import { describe, expect, it } from 'vitest'
import { apply, checkInline, hashBytes, toMarkdown, toText, type Block } from '../src/index.js'
import { PHYSICS } from './fixtures/index.js'
import { expectError } from './helpers.js'

describe('the key of a picture', () => {
  it('is SHA-256 of its bytes, in lowercase hex', async () => {
    // The standard test vector for "abc".
    expect(await hashBytes(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('a caption', () => {
  it('is typed with splices, and an emptied caption goes', () => {
    const typed = apply(PHYSICS, [{ op: 'splice', id: 'g1', field: 'caption', at: 0, del: 0, ins: 'A **block** on a slope' }])
    expect(typed.doc.block.g1).toMatchObject({ caption: 'A **block** on a slope' })
    const emptied = apply(typed.doc, [{ op: 'splice', id: 'g1', field: 'caption', at: 0, del: 22, ins: '' }]).doc
    expect(emptied.block.g1).not.toHaveProperty('caption')
    // Undo brings the words back.
    expect(apply(typed.doc, typed.inverse).doc.block.g1).not.toHaveProperty('caption')
  })

  it('belongs to pictures only, and is checked like a text block', () => {
    expectError(() => apply(PHYSICS, [{ op: 'splice', id: 't2', field: 'caption', at: 0, del: 0, ins: 'x' }]), 'wrong_type', /splice its md/)
    expectError(() => apply(PHYSICS, [{ op: 'update', id: 'g1', set: { caption: '# Not a heading' } }], { validators: { md: checkInline } }), 'content', /Headings are a block role/)
  })

  it('is written under the picture in both exports', () => {
    const doc = apply(PHYSICS, [{ op: 'update', id: 'g1', set: { caption: 'Forces on a **block**' } }]).doc
    expect(toMarkdown(doc, { title: false }).markdown).toContain('![Free-body diagram of a block on a slope](assets/a91f.png)\n\nForces on a **block**')
    expect(toText(doc, { title: false })).toContain('[image: Free-body diagram of a block on a slope]\n\nForces on a block')
    expect((doc.block.g1 as Extract<Block, { type: 'image' }>).caption).toBe('Forces on a **block**')
  })
})
