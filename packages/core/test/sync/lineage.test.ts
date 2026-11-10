// What a note's file says of its past (sync.json), and what two of them say of each other.
import { strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { apply, compare, contentId, includes, lineageText, mergeOptions, pack, readLineage, seenByBoth, unpack, type Lineage } from '../../src/index.js'
import { MIXED, PHYSICS } from '../fixtures/index.js'

const lineage = (by: string, seen: Record<string, number>, more: Partial<Lineage> = {}): Lineage => ({ v: 1, by, at: 1000, id: '0123456789abcdef', seen, ...more })

describe('what two versions have seen', () => {
  it('tells the same, ahead, behind and apart', () => {
    expect(compare({ laptop: 4 }, { laptop: 4 })).toBe('same')
    expect(compare({ laptop: 5, phone: 2 }, { laptop: 4 })).toBe('ahead')
    expect(compare({ laptop: 4 }, { laptop: 4, phone: 2 })).toBe('behind')
    expect(compare({ laptop: 5 }, { laptop: 4, phone: 2 })).toBe('apart')
    expect(includes({ laptop: 0 }, {})).toBe(true)
    expect(includes({}, { laptop: 0 })).toBe(false)
  })

  it('joins what both have seen', () => {
    expect(seenByBoth({ laptop: 5, phone: 1 }, { phone: 3, pad: 2 })).toEqual({ laptop: 5, phone: 3, pad: 2 })
  })
})

describe('mergeOptions', () => {
  it('counts each side from the latest point the other has seen', () => {
    // The phone took the laptop's rev 40 (its own rev 12 just after), then wrote; the laptop wrote on to 45.
    const laptop = lineage('laptop', { laptop: 45 }, { at: 2000 })
    const phone = lineage('phone', { laptop: 40, phone: 15 }, { at: 3000, base: { seen: { laptop: 40 }, rev: 12 } })
    expect(mergeOptions(laptop, phone)).toEqual({ mineSince: 40, theirsSince: 12, first: 'theirs' })
    expect(mergeOptions(phone, laptop)).toEqual({ mineSince: 12, theirsSince: 40, first: 'mine' })
  })

  it('knows nothing of a side the other never saw', () => {
    const laptop = lineage('laptop', { laptop: 3 })
    const phone = lineage('phone', { phone: 9 })
    expect(mergeOptions(laptop, phone)).toEqual({ first: 'theirs' })
    expect(mergeOptions(phone, laptop)).toEqual({ first: 'mine' })
  })

  it('does not count from a version the other has not seen all of', () => {
    const laptop = lineage('laptop', { laptop: 45, pad: 7 }, { base: { seen: { laptop: 30, pad: 7 }, rev: 31 } })
    const phone = lineage('phone', { laptop: 40, phone: 15 })
    // The phone has seen the laptop's rev 40, but not the pad's 7 the laptop's base holds.
    expect(mergeOptions(laptop, phone).mineSince).toBe(40)
  })
})

describe('contentId', () => {
  it('is the same for the same content, whatever the counts, and differs with the content', async () => {
    const edited = apply(PHYSICS, [{ op: 'update', id: 't1', set: { md: 'Newton' } }]).doc
    const back = apply(edited, [{ op: 'update', id: 't1', set: { md: "Newton's laws" } }]).doc
    expect(await contentId(back)).toBe(await contentId(PHYSICS))
    expect(await contentId(edited)).not.toBe(await contentId(PHYSICS))
    expect(await contentId(PHYSICS)).toMatch(/^[0-9a-f]{32}$/u)
  })
})

describe('sync.json in a file', () => {
  const images = Object.fromEntries(Object.keys(MIXED.asset).map((hash) => [hash, new Uint8Array([1, 2, 3])]))
  const told = lineage('k3J9x2Qa', { k3J9x2Qa: 12, Zp01mN7c: 8 }, { base: { seen: { Zp01mN7c: 8 }, rev: 9 } })

  it('is written and read back, and left out when there is none', () => {
    const opened = unpack(pack(MIXED, images, told))
    expect(opened.lineage).toEqual(told)
    expect(opened.doc).toStrictEqual(MIXED)
    expect(unpack(pack(MIXED, images)).lineage).toBeUndefined()
    expect(Object.keys(unzipSync(pack(MIXED, images)))).not.toContain('sync.json')
  })

  it('reads the same whatever the order it was told in', () => {
    expect(lineageText({ ...told, seen: { Zp01mN7c: 8, k3J9x2Qa: 12 } })).toBe(lineageText(told))
  })

  it('never stops a note from opening when it is damaged', () => {
    const entries = unzipSync(pack(MIXED, images, told))
    entries['sync.json'] = strToU8('{"v":1,"by":')
    expect(unpack(zipSync(entries)).lineage).toBeUndefined()
    expect(readLineage('{"v":2}')).toBeUndefined()
    expect(readLineage(undefined)).toBeUndefined()
  })

  it('opens a note without reading its pictures when they are not wanted', () => {
    const bytes = pack(PHYSICS, { a91f: new Uint8Array([1, 2, 3]) }, told)
    expect(unpack(bytes).assets).toHaveProperty('a91f')
    const light = unpack(bytes, { assets: false })
    expect(light.assets).toEqual({})
    expect(light.lineage).toEqual(told)
    expect(light.doc).toStrictEqual(PHYSICS)
  })
})
