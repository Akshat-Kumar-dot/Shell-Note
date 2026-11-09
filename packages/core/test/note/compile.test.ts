// The note's commands made into the note's own operations (note control, step 2, piece 4): each command's ops,
// applied through apply, make the note they should; places are relative only, and code works them out.
import { describe, expect, it } from 'vitest'
import { apply } from '../../src/apply.js'
import { idTaken } from '../../src/ids.js'
import { compileNote, itemsOf, paragraphsOf, type NoteInput } from '../../src/note/compile.js'
import type { Block, Doc } from '../../src/schema/doc.js'
import { EMPTY, MIXED } from '../fixtures/index.js'

type Text = Extract<Block, { type: 'text' }>
const context = (doc: Doc, made: string[] = []) => ({ page: 1, made, taken: (id: string) => idTaken(doc, id) })
const run = (command: string, input: NoteInput, doc: Doc = MIXED, made: string[] = []) => {
  const compiled = compileNote(doc, command, input, context(doc, made))
  return { ...compiled, doc: apply(doc, compiled.ops).doc }
}
const kids = (doc: Doc, frame = 'fa'): string[] => (doc.block[frame] as { kids: string[] }).kids
const text = (doc: Doc, id: string): Text => doc.block[id] as Text

describe('words written under a line', () => {
  it('part into paragraphs at blank lines, and into items a line each, their signs and levels read', () => {
    expect(paragraphsOf('One line\nwrapped.\n\nTwo.\n\n\n')).toEqual(['One line wrapped.', 'Two.'])
    expect(itemsOf('- Agents learn by reward\n  - from trying actions\n* Q-learning\n1. First\n[x] done one\n- [ ] open one')).toEqual([
      { md: 'Agents learn by reward', indent: 0, done: false },
      { md: 'from trying actions', indent: 1, done: false },
      { md: 'Q-learning', indent: 0, done: false },
      { md: 'First', indent: 0, done: false },
      { md: 'done one', indent: 0, done: true },
      { md: 'open one', indent: 0, done: false },
    ])
  })
})

describe('text.add', () => {
  it('adds a heading after a block named in words, its level as given, the sign a model writes taken off', () => {
    const { doc, made, said } = run('text.add', { role: 'heading', level: 2, after: 'the second paragraph', words: '## Summary' })
    expect(text(doc, made[0]!)).toMatchObject({ type: 'text', role: 'h2', md: 'Summary', parent: 'fa', indent: 0 })
    expect(kids(doc).indexOf(made[0]!)).toBe(kids(doc).indexOf('p2') + 1)
    expect(said).toBe(`added heading 2 “Summary” (${made[0]!}), after p2`)
  })

  it('adds a paragraph a part, before a block, or at the end of the page the request is about', () => {
    const before = run('text.add', { before: 'h1', words: 'First.\n\nSecond.' })
    expect(before.made.map((id) => text(before.doc, id).md)).toEqual(['First.', 'Second.'])
    expect(kids(before.doc).slice(0, 3)).toEqual([...before.made, 'h1'])
    // The end of page 1: after its last block of text, in reading order (the right column's last).
    const end = run('text.add', { words: 'At the end.' })
    expect(kids(end.doc, 'fb').at(-1)).toBe(end.made[0])
    const top = run('text.add', { at: 'top', page: 2, words: 'Top of two.' })
    expect(kids(top.doc, 'fc')[0]).toBe(top.made[0])
  })

  it('writes into an empty page\'s frame, and refuses where it cannot say where', () => {
    const empty = run('text.add', { words: 'Hello.' }, EMPTY)
    expect(empty.said).toBe(`added paragraph “Hello.” (${empty.made[0]!}), on page 1`)
    expect(() => compileNote(MIXED, 'text.add', { after: 'kk', words: 'x' }, context(MIXED))).toThrow('kk is placed on the page, not in the text')
    expect(() => compileNote(MIXED, 'text.add', { after: 'p1', before: 'p2', words: 'x' }, context(MIXED))).toThrow('not both')
    expect(() => compileNote(MIXED, 'text.add', { role: 'heading', level: 4, words: 'x' }, context(MIXED))).toThrow("A heading's level is 1, 2 or 3")
    expect(() => compileNote(MIXED, 'text.add', { words: '  ' }, context(MIXED))).toThrow('No words')
  })

  it('names a block an earlier line made by $1', () => {
    const first = run('text.add', { role: 'heading', after: 'p2', words: 'Summary' })
    const second = run('list.add', { after: '$1', words: '- Agents learn by reward\n- Q-learning is one way' }, first.doc, first.made)
    expect(kids(second.doc).slice(kids(second.doc).indexOf('p2'), kids(second.doc).indexOf('p2') + 4)).toEqual(['p2', first.made[0], ...second.made])
    expect(second.made.map((id) => text(second.doc, id).role)).toEqual(['li', 'li'])
  })
})

describe('lists', () => {
  it('list.add makes a list of the kind asked, an item a line, its levels and ticks read', () => {
    const { doc, made, said } = run('list.add', { style: 'todo', after: 'p1', words: '[x] Read chapter 3\n[ ] Do the problems\n  sub-step' })
    expect(made.map((id) => [text(doc, id).role, text(doc, id).indent, text(doc, id).done ?? false])).toEqual([
      ['todo', 0, true],
      ['todo', 0, false],
      ['todo', 1, false],
    ])
    expect(said).toBe(`added a list of 3 to-dos (${made.join(', ')}), after p1`)
  })

  it('list.addItem adds at the end of the list named by one of its items, or right after the item named', () => {
    const atEnd = run('list.addItem', { block: 'l1', words: 'Surface waves' })
    expect(kids(atEnd.doc).indexOf(atEnd.made[0]!)).toBe(kids(atEnd.doc).indexOf('l3') + 1)
    expect(text(atEnd.doc, atEnd.made[0]!)).toMatchObject({ role: 'li', indent: 0 })
    const after = run('list.addItem', { after: 'l2', words: 'Sound' })
    // After "Light", one level in: the new item too.
    expect(kids(after.doc).indexOf(after.made[0]!)).toBe(kids(after.doc).indexOf('l2') + 1)
    expect(text(after.doc, after.made[0]!)).toMatchObject({ role: 'li', indent: 1 })
    expect(() => compileNote(MIXED, 'list.addItem', { block: 'p1', words: 'x' }, context(MIXED))).toThrow('p1 is a paragraph, not a list')
  })
})

describe('changing a block', () => {
  it('text.rewrite rewrites by diff: the marks of words that stayed kept, a paragraph more added after', () => {
    const marked = apply(MIXED, [{ op: 'update', id: 'p2', set: { md: 'The **lab kit** costs $5, or $10 with the stand.' } }]).doc
    const { doc, said } = run('text.rewrite', { block: 'the second paragraph', words: 'The lab kit costs $6, or $12 with the stand.' }, marked)
    expect(text(doc, 'p2').md).toBe('The **lab kit** costs $6, or $12 with the stand.')
    expect(said).toBe('rewrote p2')
    const more = run('text.rewrite', { block: 'p2', words: 'The lab kit costs $5, or $10 with the stand.\n\nIt is sold out.' })
    expect(more.ops).toHaveLength(1)
    expect(text(more.doc, more.made[0]!)).toMatchObject({ role: 'p', md: 'It is sold out.' })
    expect(run('text.rewrite', { block: 'p2', words: 'The lab kit costs $5, or $10 with the stand.' }).said).toBe('p2 already says that: nothing changed')
  })

  it('text.rewrite of a list\'s item takes a line an item', () => {
    const { doc, made } = run('text.rewrite', { block: 'l3', words: 'Longitudinal waves\nSound waves' })
    expect(text(doc, made[0]!)).toMatchObject({ role: 'li', indent: 0, md: 'Sound waves' })
  })

  it('text.look sets the size, colour, font and alignment asked, keeping the rest of its look', () => {
    const { doc, said } = run('text.look', { block: 'h1', size: 'large', colour: 'blue', align: 'center' })
    expect(text(doc, 'h1').style).toMatchObject({ size: 'l', color: 'blue', align: 'center' })
    expect(said).toBe('h1: size large, colour blue, aligned center')
    expect(() => compileNote(MIXED, 'text.look', { block: 'h1' }, context(MIXED))).toThrow('Say the look')
    expect(() => compileNote(MIXED, 'text.look', { block: 'mc', colour: 'red' }, context(MIXED))).toThrow('mc is a math, not text')
  })

  it('text.role, indent, outdent and tick change one thing each, and say so when it was so already', () => {
    expect(text(run('text.role', { block: 'p1', role: 'heading', level: 3 }).doc, 'p1').role).toBe('h3')
    // Leaving to-do takes its tick away: done is only for to-dos.
    const bullet = text(run('text.role', { block: 'tk', role: 'bullet' }).doc, 'tk')
    expect(bullet.role).toBe('li')
    expect('done' in bullet).toBe(false)
    expect(run('text.role', { block: 'p1', role: 'paragraph' }).said).toBe('p1 is a paragraph already: nothing changed')
    expect(text(run('text.indent', { block: 'l3' }).doc, 'l3').indent).toBe(1)
    expect(run('text.outdent', { block: 'l1' }).said).toBe('l1 is at level 0 already: nothing changed')
    expect(text(run('text.tick', { block: 'td' }).doc, 'td').done).toBe(true)
    expect(text(run('text.tick', { block: 'tk', on: false }).doc, 'tk').done).toBeUndefined()
    expect(() => compileNote(MIXED, 'text.tick', { block: 'p1' }, context(MIXED))).toThrow('p1 is a paragraph, not a to-do')
  })
})

describe('moving and removing', () => {
  it('block.move puts a block after or before another, worked out as if it were not there', () => {
    const later = run('block.move', { block: 'h1', after: 'p2' })
    expect(kids(later.doc).slice(0, 3)).toEqual(['p1', 'p2', 'h1'])
    const earlier = run('block.move', { block: 'qt', before: 'the first paragraph' })
    expect(kids(earlier.doc).slice(0, 3)).toEqual(['h1', 'qt', 'p1'])
    const across = run('block.move', { block: 'p1', at: 'top', page: 2 })
    expect(kids(across.doc, 'fc')[0]).toBe('p1')
    expect(() => compileNote(MIXED, 'block.move', { block: 'p1', after: 'p1' }, context(MIXED))).toThrow('cannot go after or before itself')
    expect(() => compileNote(MIXED, 'block.move', { block: 'kk', after: 'p1' }, context(MIXED))).toThrow('kk is handwriting, placed on the page')
    // A picture placed on the page goes into the text (step 3: this note's pictures are moved).
    const photo = run('block.move', { block: 'the ripple tank photo', after: 'c1', page: 2 })
    expect(kids(photo.doc, 'fc')).toEqual(['c1', 'gi'])
    expect(photo.doc.block.gi).toMatchObject({ type: 'image', parent: 'fc', asset: 'b7c4' })
    expect('x' in photo.doc.block.gi!).toBe(false)
  })

  it('block.remove takes a block away, never a whole frame', () => {
    const { doc, said } = run('block.remove', { block: 'the quote' })
    expect(doc.block.qt).toBeUndefined()
    expect(said).toBe('removed qt “Every wave is a pattern in motion.”')
    expect(() => compileNote(MIXED, 'block.remove', { block: 'fa' }, context(MIXED))).toThrow('fa is a text frame with 14 blocks in it')
  })
})

describe('tables, maths, diagrams and pictures (step 3)', () => {
  type Table = Extract<Block, { type: 'table' }>
  const withTable = (): { doc: Doc; id: string } => {
    const made = run('table.add', { after: 'p2', words: '| Wave | Speed |\n| --- | --- |\n| Sound | 343 m/s |\n| Light | 3e8 m/s |' })
    return { doc: made.doc, id: made.made[0]! }
  }

  it('table.add puts a table in the text where asked, its header from the line of dashes', () => {
    const { doc, id } = withTable()
    expect(doc.block[id]).toMatchObject({ type: 'table', parent: 'fa', rows: [['Wave', 'Speed'], ['Sound', '343 m/s'], ['Light', '3e8 m/s']], head: true })
    expect(kids(doc).indexOf(id)).toBe(kids(doc).indexOf('p2') + 1)
    expect(() => compileNote(MIXED, 'table.add', { words: 'no table here | and | then\nnothing' }, context(MIXED))).toThrow('no | between cells')
  })

  it('rewrites a table, adds and removes its rows and columns by their words, and changes its look', () => {
    const { doc, id } = withTable()
    const table = (one: Doc): Table => one.block[id] as Table
    const rewritten = run('table.rewrite', { block: 'the table', words: '| Wave | Speed |\n|---|---|\n| Sound | 340 m/s |\n| Light | 3e8 m/s |' }, doc)
    expect(table(rewritten.doc).rows[1]).toEqual(['Sound', '340 m/s'])
    const row = run('table.addRow', { block: id, row: 'Sound', words: '| Wave | Speed |\n| Water | 1480 m/s |' }, doc)
    expect(table(row.doc).rows.map((cells) => cells[0])).toEqual(['Wave', 'Sound', 'Water', 'Light'])
    expect(() => compileNote(doc, 'table.addRow', { block: id, words: 'Water 1480 m/s' }, context(doc))).toThrow('write each new row')
    const column = run('table.addColumn', { block: id, column: 'Wave', words: 'Kind\nlongitudinal\ntransverse' }, doc)
    expect(table(column.doc).rows[0]).toEqual(['Wave', 'Kind', 'Speed'])
    expect(table(run('table.removeRow', { block: id, row: 'last' }, doc).doc).rows).toHaveLength(2)
    expect(table(run('table.removeColumn', { block: id, column: 'Speed' }, doc).doc).rows[0]).toEqual(['Wave'])
    const look = run('table.look', { block: id, design: 'banded', head: false }, doc)
    expect(table(look.doc)).toMatchObject({ look: 'banded' })
    expect(table(look.doc).head).toBeUndefined()
    expect(() => compileNote(MIXED, 'table.rewrite', { block: 'p1', words: '| a |' }, context(MIXED))).toThrow('p1 is a paragraph, not a table')
  })

  it('maths: a formula added with its $ signs taken off, rewritten, its old value gone; a broken one refused with why', () => {
    const added = run('maths.add', { after: 'p1', words: '$$E_k = \\frac{1}{2} m v^2$$' })
    expect(added.doc.block[added.made[0]!]).toMatchObject({ type: 'math', parent: 'fa', tex: 'E_k = \\frac{1}{2} m v^2' })
    const rewritten = run('maths.rewrite', { block: 'mc', words: '\\sum_{x=1}^{20} x' })
    expect(rewritten.doc.block.mc).toMatchObject({ tex: '\\sum_{x=1}^{20} x' })
    expect('value' in rewritten.doc.block.mc!).toBe(false)
    // A formula placed on the page is rewritten too.
    expect(run('maths.rewrite', { block: 'mf', words: '\\int_0^2 x \\, dx' }).doc.block.mf).toMatchObject({ tex: '\\int_0^2 x \\, dx' })
    expect(() => compileNote(MIXED, 'maths.add', { words: '\\frac{1}{2' }, context(MIXED))).toThrow('The formula cannot go in: A { is never closed')
  })

  it('diagrams: a flowchart added with its slips mended, for Mermaid to read at the door; another kind refused; a diagram keeps its kind', () => {
    const added = run('diagram.add', { after: 'p1', words: 'flowchart LR\n  A[Force (F)] -> B[Motion]' })
    const src = (added.doc.block[added.made[0]!] as { src: string }).src
    expect(src).toBe('flowchart LR\n  A["Force (F)"] --> B[Motion]')
    expect(added.diagrams).toEqual([src])
    expect(() => compileNote(MIXED, 'diagram.add', { words: 'mindmap\n  root' }, context(MIXED))).toThrow('The diagram cannot go in: Write a flowchart, a pie or an xychart, not a mindmap.')
    // A pie's slices on one line, parted by commas: a line each (round 2 of the note test).
    const pie = run('diagram.add', { words: 'pie title A day\n    "Sleep": 8, "Work": 8, "Free": 8' })
    expect((pie.doc.block[pie.made[0]!] as { src: string }).src).toBe('pie title A day\n  "Sleep": 8\n  "Work": 8\n  "Free": 8')
    // The sequence diagram on page 1 may stay one.
    expect(run('diagram.rewrite', { block: 'df', words: 'sequenceDiagram\n  Student->>Teacher: Why?' }).doc.block.df).toMatchObject({ src: 'sequenceDiagram\n  Student->>Teacher: Why?' })
  })

  it("pictures: one of another note added with its asset, one this note has moved instead, a caption and a description written", () => {
    const pictures = [
      { hash: 'aa11', meta: { mime: 'image/png', w: 800, h: 600, bytes: 1000 }, alt: 'Circuit with a battery', note: 'Electronics' },
      { hash: 'b7c4', meta: { mime: 'image/jpeg', bytes: 512000 }, alt: 'Ripple tank photo', note: 'Waves', here: 'gi' },
    ]
    const compiled = compileNote(MIXED, 'picture.add', { picture: 'the circuit from my Electronics note', after: 'p1', words: 'A simple circuit' }, { ...context(MIXED), pictures })
    expect(compiled.ops[0]).toEqual({ op: 'asset', hash: 'aa11', meta: pictures[0]!.meta })
    expect(compiled.assets).toEqual(['aa11'])
    const doc = apply(MIXED, compiled.ops).doc
    expect(doc.block[compiled.made[0]!]).toMatchObject({ type: 'image', parent: 'fa', asset: 'aa11', alt: 'Circuit with a battery', caption: 'A simple circuit' })
    expect(() => compileNote(MIXED, 'picture.add', { picture: 'the ripple tank photo' }, { ...context(MIXED), pictures })).toThrow('block: move block=gi')
    expect(run('picture.caption', { block: 'gi', words: 'A ripple tank\nfrom above' }).doc.block.gi).toMatchObject({ caption: 'A ripple tank from above' })
    expect(run('picture.describe', { block: 'the picture on page 1', words: 'A sine wave' }).doc.block.ic).toMatchObject({ alt: 'A sine wave' })
  })
})
