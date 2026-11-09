// The instant-command router: a request said any way runs the instant
// function it means, with no model, and only when the note confirms it;
// anything else goes to the model.
import { describe, expect, it } from 'vitest'
import { apply, createDoc, instantPreview, parseInline, plainText, runEdit, type Block, type Doc, type Model } from '../src/index.js'

/** A model that fails the test if it is asked anything. */
const NO_MODEL: Model = {
  name: 'none',
  caps: { jsonSchema: true, inlineContent: false, vision: false, opSet: 'small' },
  complete: () => Promise.reject(new Error('the model was asked')),
}

/** A note with a heading, a paragraph and a table of sales, not in any order. */
function note(): Doc {
  const doc = createDoc()
  const frame = doc.page[doc.pages[0]!]!.free[0]!
  const blocks: Record<string, unknown>[] = [
    { id: 'hd', type: 'text', role: 'h2', indent: 0, md: 'Sales report' },
    { id: 'pa', type: 'text', role: 'p', indent: 0, md: 'Smith sold the most this quarter, and **Smith** also led the team.' },
    { id: 'tb', type: 'table', head: true, rows: [['Name', 'Sales', 'Country'], ['Jones', '3,200.00', 'US'], ['Smith', '5,000.00', 'UK'], ['Patel', '4,700.00', 'IN']] },
  ]
  return apply(doc, blocks.map((block) => ({ op: 'add', block: { r: 0, parent: frame, ...block } as Block }))).doc
}

const NOTE = note()
const edit = (id: string, instruction: string, acceptSuggestion = false) => runEdit({ doc: NOTE, selection: { blocks: [id] }, instruction, model: NO_MODEL, ...(acceptSuggestion ? { acceptSuggestion } : {}) })
const preview = (id: string, instruction: string) => instantPreview({ doc: NOTE, selection: { blocks: [id] }, instruction })
const words = (doc: Doc, id: string): string => plainText(parseInline((doc.block[id] as { md: string }).md))
const rows = (doc: Doc): string[][] => (doc.block.tb as { rows: string[][] }).rows

describe('a request said any way runs its instant function, with no model', () => {
  it('find and replace, however it is put', async () => {
    for (const request of [
      'I typed Smith everywhere but his name is actually Akshat, please fix it',
      'it should say Akshat and not Smith',
      'Smith should be Akshat',
      'not Smith but Akshat',
      'hey, could you please write Akshat instead of Smith everywhere',
      'oops, I spelt his name wrong, please change Smith to Akshat in this paragraph',
    ]) {
      const out = await edit('pa', request)
      expect(out, request).toMatchObject({ tier: 0, calls: 0, tokensIn: 0 })
      // Every match, each keeping its formatting.
      expect(words(out.doc, 'pa'), request).toBe('Akshat sold the most this quarter, and Akshat also led the team.')
      expect((out.doc.block.pa as { md: string }).md).toContain('**Akshat**')
    }
  })

  it('a change of look inside a longer sentence', async () => {
    const red = await edit('hd', 'hey can you make this heading red because it is the important one')
    expect(red.doc.block.hd).toMatchObject({ style: { color: 'red' } })
    // Three ways of saying "bigger" in one request are one step bigger, not three.
    const bigger = await edit('hd', 'the font here is way too small, people at the back cannot read it, make it bigger')
    expect(bigger.doc.block.hd).toMatchObject({ style: { size: 'l' } })
    const bold = await edit('pa', 'please make the whole paragraph bold, it needs to stand out more')
    expect((bold.doc.block.pa as { md: string }).md).toBe('**Smith sold the most this quarter, and Smith also led the team.**')
    const two = await edit('pa', 'could you please underline all of this and make it green')
    expect(two.doc.block.pa).toMatchObject({ style: { color: 'green' } })
    expect((two.doc.block.pa as { md: string }).md).toMatch(/^\[.*\]\{\.underline\}$/u)
    for (const out of [red, bigger, bold, two]) expect(out).toMatchObject({ tier: 0, calls: 0 })
  })

  it('"too big" asks for smaller, and "too small" for bigger', async () => {
    expect((await edit('hd', 'this heading is too big')).doc.block.hd).toMatchObject({ style: { size: 's' } })
    expect((await edit('hd', 'it is too small')).doc.block.hd).toMatchObject({ style: { size: 'l' } })
  })

  it('table changes said in a sentence', async () => {
    const sorted = await edit('tb', 'order the people so the one who sold the most is on top')
    expect(rows(sorted.doc).map((row) => row[0])).toEqual(['Name', 'Smith', 'Patel', 'Jones'])
    const gone = await edit('tb', 'get rid of Jones, he left the company')
    expect(rows(gone.doc).map((row) => row[0])).toEqual(['Name', 'Smith', 'Patel'])
    const column = await edit('tb', 'remove the Country column, we do not need it')
    expect(rows(column.doc)[0]).toEqual(['Name', 'Sales'])
    const byCountry = await edit('tb', 'please sort the table by country')
    expect(rows(byCountry.doc).map((row) => row[2])).toEqual(['Country', 'IN', 'UK', 'US'])
    const replaced = await edit('tb', 'his surname is spelt wrong in all of these, it is Akshat not Smith')
    expect(rows(replaced.doc)[2]![0]).toBe('Akshat')
    for (const out of [sorted, gone, column, byCountry, replaced]) expect(out).toMatchObject({ tier: 0, calls: 0 })
  })

  it('several changes in one request, as one undo step', async () => {
    const out = await edit('hd', 'make the title blue and replace sales with revenue')
    expect(out).toMatchObject({ tier: 0, calls: 0 })
    expect(out.doc.block.hd).toMatchObject({ style: { color: 'blue' } })
    expect(words(out.doc, 'hd')).toBe('Revenue report')
    expect(apply(out.doc, out.inverse).doc.block.hd).toMatchObject({ md: 'Sales report' })
  })
})

describe('a reading that is only likely is offered, and runs when the person takes it', () => {
  const request = 'can you put one more person at the bottom: Green who sold 4,100.00 in India'

  it('says what it would do', () => {
    expect(preview('tb', request)).toEqual({ band: 'likely', summary: 'add a row Green | 4,100.00 | India' })
  })

  it('goes to the model unless taken', async () => {
    await expect(edit('tb', request)).rejects.toThrow('the model was asked')
    const taken = await edit('tb', request, true)
    expect(rows(taken.doc).at(-1)).toEqual(['Green', '4,100.00', 'India'])
  })
})

describe('the prompt box says what will happen', () => {
  it('names the change, counting the words replaced', () => {
    expect(preview('pa', 'replace Smith with Akshat')).toEqual({ band: 'exact', summary: 'replace 2 × “Smith” with “Akshat”' })
    expect(preview('pa', 'his name is actually Akshat, not Smith')).toEqual({ band: 'sure', summary: 'replace 2 × “Smith” with “Akshat”' })
    expect(preview('hd', 'make it blue and bigger')).toEqual({ band: 'exact', summary: 'blue, size L' })
    expect(preview('tb', 'sort by Sales')).toEqual({ band: 'exact', summary: 'sort by Sales' })
  })

  it('says nothing for what needs the model', () => {
    expect(preview('pa', 'make this sound more formal')).toBeUndefined()
  })
})

describe('everything else still goes to the model', () => {
  it('writing, questions, translations, and changes it cannot confirm in the note', () => {
    for (const [id, request] of [
      ['pa', 'make this sound more formal'],
      ['pa', 'translate this into French'],
      ['pa', 'say this in simpler words'],
      ['pa', 'what does this mean?'],
      ['pa', 'make a list of the red fruits'],
      ['pa', 'make it red and add a footnote about the source'],
      ['pa', 'change Jones to Akshat'],
      ['pa', 'Smith is red'],
      ['hd', 'make it look like a title page'],
      ['pa', 'make it better'],
      ['pa', 'add a sentence about inertia after this'],
      ['tb', 'add a row for Mars, which has 2 moons'],
      ['pa', 'do not make it bold'],
      ['pa', 'change the date to tomorrow'],
      ['pa', 'fix the grammar'],
      ['tb', 'delete Smith and make the table blue'],
      ['pa', 'the team led by Smith should be bigger next year'],
      ['pa', 'who sold the most?'],
      ['tb', 'add a column showing the sales in dollars'],
    ] as const) {
      const out = preview(id, request)
      expect(out, request).toBeUndefined()
    }
  })

  it('reads words of the note only as they stand: "back" is not "black", "sold" is not "bold"', () => {
    expect(preview('hd', 'people at the back cannot read it')).toEqual({ band: 'sure', summary: 'size L' })
    expect(preview('pa', 'the people who sold the most')).toBeUndefined()
  })
})
