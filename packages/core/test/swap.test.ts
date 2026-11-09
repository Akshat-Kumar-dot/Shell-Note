// Find and replace by code: "change Smith
// to Akshat" swaps the words in what is chosen, keeping their formatting, with
// no model; a request that only looks like one goes on to the model.
import { describe, expect, it } from 'vitest'
import { apply, createDoc, replaceMatches, runEdit, swapOf, type Block, type Doc, type Model, type Selection } from '../src/index.js'

/** A model that fails the test if it is asked anything. */
const NO_MODEL: Model = {
  name: 'none',
  caps: { jsonSchema: true, inlineContent: false, vision: false, opSet: 'small' },
  complete: () => Promise.reject(new Error('the model was asked')),
}

/** A new note whose one frame holds these blocks. */
function note(...blocks: Record<string, unknown>[]): Doc {
  const doc = createDoc()
  const frame = doc.page[doc.pages[0]!]!.free[0]!
  return apply(doc, blocks.map((block) => ({ op: 'add', block: { r: 0, parent: frame, ...block } as Block }))).doc
}

const swap = (doc: Doc, selection: Selection, instruction: string) => runEdit({ doc, selection, instruction, model: NO_MODEL })
const md = (doc: Doc, id: string): string => (doc.block[id] as { md: string }).md

describe('what a request asks to swap', () => {
  it('reads the usual ways of asking, with typos and polite words', () => {
    expect(swapOf('change the name smith to akshat')).toEqual({ find: 'smith', put: 'akshat' })
    expect(swapOf('please replace colour with color.')).toEqual({ find: 'colour', put: 'color' })
    expect(swapOf('rename Q3 to Quarter 3')).toEqual({ find: 'Q3', put: 'Quarter 3' })
    expect(swapOf('Smith -> Akshat')).toEqual({ find: 'Smith', put: 'Akshat' })
    expect(swapOf('write Akshat instead of Smith')).toEqual({ find: 'Smith', put: 'Akshat' })
    expect(swapOf('chnage smith to akshat everywhere')).toEqual({ find: 'smith', put: 'akshat' })
    expect(swapOf('change Qtr 3 to Qtr 4 in the table')).toEqual({ find: 'Qtr 3', put: 'Qtr 4' })
    expect(swapOf('change all the smiths to akshat')).toEqual({ find: 'smiths', put: 'akshat' })
    // In quotes, words are taken exactly, even "the" and "to".
    expect(swapOf('replace "the end" with "fin"')).toEqual({ find: 'the end', put: 'fin' })
    expect(swapOf('replace "to" with "too"')).toEqual({ find: 'to', put: 'too' })
  })

  it('is not a swap when it asks for a change of look, language, kind or value', () => {
    for (const request of [
      'change it to blue',
      'change it to bold',
      'change the heading to red',
      'change smith to bold',
      'change hello to Hindi',
      'change this to French',
      'change the font to serif',
      'change the date to tomorrow',
      'rename the title to Physics',
      'replace it with a table',
      'change these into a numbered list',
      'make it bigger',
      'swap the first two rows',
      'switch to dark mode',
      'use bullets instead of numbers',
    ]) expect(swapOf(request), request).toBeUndefined()
  })
})

describe('words swapped in what is chosen', () => {
  it('changes every match in a table, each in its letter case, with no model, as one edit', async () => {
    const doc = note({ id: 'tb', type: 'table', head: true, rows: [['Last Name', 'Sales'], ['Smith', '16,753.00'], ['Johnson', '14,808.00'], ['SMITH', '9,698.00'], ['smithson', '1.00']], caption: 'Sales by **Smith** and others' })
    const out = await swap(doc, { blocks: ['tb'] }, 'change the name smith to akshat')
    expect(out).toMatchObject({ tier: 0, calls: 0, tokensIn: 0, log: { model: 'tier0' } })
    expect(out.doc.block.tb).toMatchObject({
      rows: [['Last Name', 'Sales'], ['Akshat', '16,753.00'], ['Johnson', '14,808.00'], ['AKSHAT', '9,698.00'], ['smithson', '1.00']],
      caption: 'Sales by **Akshat** and others',
    })
    // One undo step puts it all back.
    const { rows, caption } = doc.block.tb as unknown as { rows: string[][]; caption: string }
    expect(apply(out.doc, out.inverse).doc.block.tb).toMatchObject({ rows, caption })
  })

  it('keeps formatting, and leaves code, formulas and link addresses alone', async () => {
    const doc = note({ id: 'p1', type: 'text', role: 'p', indent: 0, md: '**Smith** wrote `smith()` and $smith$ for [smith](https://smith.example), smith said' })
    const out = await swap(doc, { blocks: ['p1'] }, 'replace smith with akshat')
    expect(md(out.doc, 'p1')).toBe('**Akshat** wrote `smith()` and $smith$ for [akshat](https://smith.example), akshat said')
  })

  it('changes only the chosen words of a block', async () => {
    const doc = note({ id: 'p1', type: 'text', role: 'p', indent: 0, md: 'Smith met Smith and Smith' })
    // "met Smith": characters 6 to 15.
    const out = await swap(doc, { blocks: [], words: [{ block: 'p1', start: 6, end: 15 }] }, 'change Smith to Akshat')
    expect(md(out.doc, 'p1')).toBe('Smith met Akshat and Smith')
  })

  it('finds a plural as one name, and words over several blocks', async () => {
    const doc = note({ id: 'p1', type: 'text', role: 'p', indent: 0, md: 'Smith won.' }, { id: 'p2', type: 'text', role: 'li', indent: 0, md: 'Ask smith.' })
    const out = await swap(doc, { blocks: ['p1', 'p2'] }, 'change all the smiths to akshat')
    expect([md(out.doc, 'p1'), md(out.doc, 'p2')]).toEqual(['Akshat won.', 'Ask akshat.'])
  })

  it('goes to the model when the words are not in what is chosen', async () => {
    const doc = note({ id: 'p1', type: 'text', role: 'p', indent: 0, md: 'Jones won.' }, { id: 'p2', type: 'text', role: 'p', indent: 0, md: 'Smith lost.' })
    const asked: string[] = []
    const model: Model = { ...NO_MODEL, complete: async (req) => (asked.push(String(req.messages[1]!.content)), { text: '{"ops":[{"op":"none","why":"Not chosen."}]}', tokensIn: 1, tokensOut: 1, ms: 1 }) }
    const out = await runEdit({ doc, selection: { blocks: ['p1'] }, instruction: 'change smith to akshat', model })
    expect(asked).toHaveLength(1)
    expect(out.doc).toBe(doc)
  })

  it('replaces a match only where it stands as a word, and only inside the range given', () => {
    const all = /(?<![\p{L}\p{N}_])smith(?![\p{L}\p{N}_])/giu
    expect(replaceMatches('Smith, smithy and blacksmith; *smith*', all, () => 'X')).toBe('X, smithy and blacksmith; *X*')
    expect(replaceMatches('smith smith smith', all, () => 'X', 6, 11)).toBe('smith X smith')
  })
})
