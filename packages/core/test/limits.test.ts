// A note holds at most MAX_BLOCKS blocks. Opening checks every block, so a small file holding hundreds of thousands
// would hold the app for seconds or minutes, on every device that looks at the folder it lies in: such a file is
// refused before any block is checked, and a note is never grown past what its own file may hold.
import { describe, expect, it } from 'vitest'
import { apply, createDoc, fromFiles, MAX_BLOCKS, toFiles, ValidationError, type Block, type Doc, type Op } from '../src/index.js'
import { expectError } from './helpers.js'

/** A note's files with `count` paragraphs written into its first page's file, as a crafted file would have them. */
function filesWith(count: number): Record<string, string> {
  const doc = createDoc({ title: 'Many' })
  const files = toFiles(doc)
  const page = `pages/${doc.pages[0]}.json`
  const frame = Object.values(doc.block).find((block) => block.type === 'frame')!
  const blocks = JSON.parse(files[page]!) as { block: Record<string, unknown> }
  for (let i = 0; i < count; i++) {
    const id = `b${i.toString(36)}`
    blocks.block[id] = { id, r: 0, type: 'text', parent: frame.id, role: 'p', indent: 0, md: 'A paragraph.' }
  }
  return { ...files, [page]: JSON.stringify(blocks) }
}

describe('the most blocks a note holds', () => {
  it('is fifty thousand', () => {
    expect(MAX_BLOCKS).toBe(50_000)
  })

  it('a file with more is refused, with words a person can read, before its blocks are checked', () => {
    const files = filesWith(MAX_BLOCKS + 1)
    let refused: unknown
    const before = performance.now()
    try {
      fromFiles(files)
    } catch (error) {
      refused = error
    }
    const took = performance.now() - before
    expect(refused).toBeInstanceOf(ValidationError)
    expect((refused as ValidationError).code).toBe('bad_doc')
    expect((refused as ValidationError).hint).toBe('This note is too large to open: it holds more than 50,000 blocks.')
    // Refused on the count alone: checking fifty thousand blocks takes seconds, counting them a few milliseconds.
    expect(took).toBeLessThan(1500)
  })

  it('a note that is full takes no more blocks, so it never outgrows its own file', () => {
    const doc = createDoc({ title: 'Full' })
    const frame = Object.values(doc.block).find((block) => block.type === 'frame')!
    // As many blocks as a note may hold, put there without the checks, as no person could by hand.
    const block: Record<string, Block> = { ...doc.block }
    for (let i = Object.keys(block).length; i < MAX_BLOCKS; i++) block[`f${i.toString(36)}`] = { id: `f${i.toString(36)}`, r: 0, type: 'text', parent: frame.id, role: 'p', indent: 0, md: '' } as Block
    const full: Doc = { ...doc, block }
    const one: Op = { op: 'add', block: { id: 'onemore1', r: 0, type: 'text', parent: frame.id, role: 'p', indent: 0, md: 'One more.' } as Block }
    expectError(() => apply(full, [one]), 'bad_doc')
    // One short of full, it takes one.
    const fewer = Object.fromEntries(Object.entries(block).filter(([id]) => id !== `f${(MAX_BLOCKS - 1).toString(36)}`))
    expect(Object.keys(apply({ ...doc, block: fewer }, [one]).doc.block)).toHaveLength(MAX_BLOCKS)
  })
})
