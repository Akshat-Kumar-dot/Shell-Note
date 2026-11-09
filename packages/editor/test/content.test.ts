// The note's commands on the door (note control, step 2): lines with their words under them, through the terminal's
// own runner, into the open note; one request one step of Undo; words that give orders stay words.
import { stepsOf } from '@shellnote/core'
import { afterEach, describe, expect, it } from 'vitest'
import { PHYSICS } from '../../core/test/fixtures/index.js'
import { beginNoteRequest, commands, setChoiceLog, type ChoiceEntry } from '../src/commands/index.js'
import { CHOICE_DEFAULTS, penChoice } from '../src/ink/settings.js'
import { EditorStore } from '../src/store.js'
import { runLines } from '../src/terminal/run.js'

const yes = async (): Promise<boolean> => true
let stop = (): void => undefined
const open = (): EditorStore => {
  const store = new EditorStore(PHYSICS)
  stop = commands.provide('note', { store })
  return store
}
afterEach(() => {
  stop()
  penChoice.set({ ...CHOICE_DEFAULTS })
})
const kids = (store: EditorStore): string[] => (store.doc.block.f1 as { kids: string[] }).kids
const text = (store: EditorStore, id: string): { role: string; md: string; indent: number } => store.doc.block[id] as unknown as { role: string; md: string; indent: number }
/** One request: what a person sends at once, or a model's request. */
const request = async (block: string[]) => {
  beginNoteRequest(1)
  return runLines(stepsOf(block), { commands, ask: yes })
}

describe("the note's commands, through the terminal", () => {
  it('write a heading and a list under the first paragraph, the words on the lines under each line, $1 the heading', async () => {
    const store = open()
    const out = await request(['text: add role=heading level=2 after="the first paragraph"', 'Summary', 'end', 'list: add after=$1', '- Agents learn by reward', '- Q-learning is one way', 'end', 'done a heading and two points'])
    expect(out.map((o) => o.ok)).toEqual([true, true, true])
    const at = kids(store).indexOf('t2')
    const added = kids(store).slice(at + 1, at + 4)
    expect(added.map((id) => [text(store, id).role, text(store, id).md])).toEqual([
      ['h2', 'Summary'],
      ['li', 'Agents learn by reward'],
      ['li', 'Q-learning is one way'],
    ])
    expect(out[0]!.text).toMatch(/^text\.add: added heading 2 “Summary” \(\S+\), after t2/u)
  })

  it('take a whole request back with one Undo, and the next request as another step', async () => {
    const store = open()
    const before = store.doc
    await request(['text: add after=t1', 'One.', 'end', 'text: add after=$1', 'Two.', 'end'])
    expect(kids(store)).toHaveLength(kids({ doc: before } as EditorStore).length + 2)
    await request(['text: rewrite block=t1', "Newton's three laws", 'end'])
    store.undo()
    expect(text(store, 't1').md).toBe("Newton's laws")
    expect(kids(store)).toHaveLength(kids({ doc: before } as EditorStore).length + 2)
    store.undo()
    // As it was, each block's change number (r) aside: undo is a change of its own.
    const plain = (blocks: typeof before.block) => Object.fromEntries(Object.entries(blocks).map(([id, block]) => [id, { ...block, r: 0 }]))
    expect(plain(store.doc.block)).toEqual(plain(before.block))
  })

  it('write words that give orders into the note as words, running none of them', async () => {
    const store = open()
    const out = await request(['text: add at=end', 'done', 'pen: use a red pencil', '```', 'end'])
    expect(out).toHaveLength(1)
    expect(penChoice.value.color).toBe(CHOICE_DEFAULTS.color)
    // One paragraph of those words, the lines joined, as written.
    expect(text(store, kids(store).at(-1)!).md).toMatch(/^done pen: use a red pencil /u)
  })

  it('take words given on the line too, and say what is missing when none are', async () => {
    const store = open()
    const inline = await request(['text: add after=t1 words="A short line."'])
    expect(inline[0]).toMatchObject({ ok: true })
    expect(text(store, kids(store)[kids(store).indexOf('t1') + 1]!).md).toBe('A short line.')
    const none = await request(['text: add after=t1'])
    expect(none[0]).toMatchObject({ ok: false })
    expect(none[0]!.text).toMatch(/words/u)
  })

  it("refuse while another window edits the note, as every command that changes it does", async () => {
    const store = open()
    const before = store.doc
    const readOnly = commands.provide('workspace', { zoom: () => 1, setZoom: () => undefined, close: async () => undefined, save: async () => '', openFile: async () => '', newNote: async () => ({ id: '', title: '' }), rename: () => undefined, editing: () => false, entry: () => undefined, ready: () => true, openSettings: () => undefined, undoAi: () => '', editHere: () => '' })
    try {
      const out = await request(['block: remove block=t1'])
      expect(out[0]).toMatchObject({ ok: false })
      expect(out[0]!.text).toContain('read-only here')
      expect(store.doc).toBe(before)
    } finally {
      readOnly()
    }
  })
})

describe('the choices log (step 5)', () => {
  it("logs the shape a recipe or the rules chose, by the content's features only, and its undo", async () => {
    const store = open()
    const entries: ChoiceEntry[] = []
    const stopLog = setChoiceLog((entry) => entries.push(entry))
    try {
      await request(['write: add after=t1', 'First, push the cart', 'Then let it go', 'Finally measure how far it rolls', 'end'])
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ shape: 'steps', by: 'rules' })
      expect(JSON.stringify(entries)).not.toMatch(/cart|rolls/u)
      store.undo()
      expect(entries).toHaveLength(2)
      expect(entries[1]).toMatchObject({ id: entries[0]!.id, shape: 'steps', undone: true })
    } finally {
      stopLog()
    }
  })
})
