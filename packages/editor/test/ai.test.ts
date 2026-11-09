// The AI from the editor, without a browser: an edit is one undo step, a note
// changed meanwhile is never overwritten, Stop and a refusal change nothing,
// Ask never changes the note, and the log can undo an edit while its blocks
// are as it left them.
import { makeAliases, type CompleteRequest, type Model, type Selection, type StepProgress, type TextBlock } from '@shellnote/core'
import { describe, expect, it } from 'vitest'
import { PHYSICS } from '../../core/test/fixtures/index.js'
import { content } from '../../core/test/helpers.js'
import { aiAsk, aiEdit, EditorStore, forPerson, insertAnswer, isLatest, STALE, undoEdit, workingText } from '../src/index.js'

const HEADING: Selection = { blocks: ['t1'] }

/** A model that answers with these replies in turn, after `wait` if given. */
function model(replies: string[], wait?: Promise<void>, seen: CompleteRequest[] = []): Model {
  return {
    name: 'test:model',
    caps: { jsonSchema: true, inlineContent: false, vision: false, opSet: 'full' },
    complete: async (request) => {
      seen.push(request)
      await wait
      if (request.signal?.aborted) throw new Error('aborted')
      return { text: replies.shift() ?? '{"ops":[{"op":"none","why":"No more replies."}]}', tokensIn: 900, tokensOut: 20, ms: 5 }
    },
  }
}

/** The heading made blue, in the aliases the model sees. */
function blue(selection: Selection = HEADING): string {
  const alias = makeAliases(PHYSICS, selection).alias('t1')
  return JSON.stringify({ ops: [{ op: 'style', ids: [alias], set: [{ color: 'blue' }] }] })
}

const colour = (store: EditorStore, id: string): string | undefined => (store.doc.block[id] as TextBlock).style?.color

function chosen(selection: Selection = HEADING): EditorStore {
  const store = new EditorStore(PHYSICS)
  store.select(selection, 'objects')
  return store
}

describe('an AI edit from the editor', () => {
  it('is one undo step, logged with its tokens, and undone whole', async () => {
    const store = chosen()
    const edit = await aiEdit(store, { instruction: 'make the heading blue', model: model([blue()]), tier0: false })
    expect(colour(store, 't1')).toBe('blue')
    expect(edit.entry).toMatchObject({ result: 'applied', source: 'app', tokensIn: 900, tokensOut: 20, targets: ['t1'] })
    expect(edit.message).toBeUndefined()
    expect(store.selection).toEqual(HEADING)
    store.undo()
    expect(content(store.doc)).toEqual(content(PHYSICS))
    expect(store.canRedo).toBe(true)
  })

  it('changes nothing when the block was typed in while the model worked', async () => {
    const store = chosen()
    let answer!: () => void
    const pending = aiEdit(store, { instruction: 'make the heading blue', model: model([blue()], new Promise((done) => (answer = done))), tier0: false })
    store.apply([{ op: 'update', id: 't1', set: { md: "Newton's three laws" } }], { origin: 'typing' })
    answer()
    const edit = await pending
    expect(edit.message).toBe(STALE)
    expect(edit.entry).toMatchObject({ result: 'failed', error: STALE })
    expect(edit.undo).toBeUndefined()
    expect(colour(store, 't1')).toBeUndefined()
    expect((store.doc.block.t1 as TextBlock).md).toBe("Newton's three laws")
  })

  it('still applies when only another block changed meanwhile', async () => {
    const store = chosen()
    let answer!: () => void
    const pending = aiEdit(store, { instruction: 'make the heading blue', model: model([blue()], new Promise((done) => (answer = done))), tier0: false })
    store.apply([{ op: 'update', id: 'm1', set: { tex: 'F = ma' } }], { origin: 'typing' })
    answer()
    expect((await pending).undo).toBeDefined()
    expect(colour(store, 't1')).toBe('blue')
  })

  it('says why, and changes nothing, when the model declines or Stop is pressed', async () => {
    const store = chosen()
    const declined = await aiEdit(store, { instruction: 'ok so', model: model(['{"ops":[{"op":"none","why":"Unclear: what should change?"}]}']), tier0: false })
    expect(declined.message).toBe('Unclear: what should change?')
    // A reason cut at the reply's limit of 80 characters ends with "…", not on half a word (as the person
    // saw).
    const long = 'A graph of nodes and edges, such as a network or a tree, is a diagram. You must '
    const cut = await aiEdit(store, { instruction: 'ok so', model: model([JSON.stringify({ ops: [{ op: 'none', why: long }] })]), tier0: false })
    expect(cut.message).toBe('A graph of nodes and edges, such as a network or a tree, is a diagram. You must…')
    const stop = new AbortController()
    const pending = aiEdit(store, { instruction: 'make the heading blue', model: model([blue()], Promise.resolve().then(() => stop.abort())), signal: stop.signal, tier0: false })
    const stopped = await pending
    expect(stopped.message).toBe('Stopped. Nothing was changed.')
    expect(stopped.entry.result).toBe('stopped')
    expect(store.doc).toEqual(PHYSICS)
    expect(store.canUndo).toBe(false)
  })

  it('is still the latest step when the layout it set off joins it, so Undo takes back both', async () => {
    const store = chosen()
    const edit = await aiEdit(store, { instruction: 'make the heading blue', model: model([blue()]), tier0: false })
    // The editor measures the frame again and joins its height to the edit's step.
    store.apply([{ op: 'update', id: 'f1', set: { h: 2848 } }], { origin: 'layout', join: true })
    expect(isLatest(store, edit.undo!)).toBe(true)
    expect(undoEdit(store, edit.undo!)).toBe(true)
    expect(content(store.doc)).toEqual(content(PHYSICS))

    const again = await aiEdit(store, { instruction: 'make the heading blue', model: model([blue()]), tier0: false })
    store.apply([{ op: 'update', id: 'm1', set: { tex: 'F = ma' } }], { origin: 'typing' })
    expect(isLatest(store, again.undo!)).toBe(false)
  })

  it('can be undone from the log while its blocks are as it left them', async () => {
    const store = chosen()
    const edit = await aiEdit(store, { instruction: 'make the heading blue', model: model([blue()]), tier0: false })
    // Another change after it, elsewhere: the edit is not the latest step, but its block is as it left it.
    store.apply([{ op: 'update', id: 'm1', set: { tex: 'F = ma' } }], { origin: 'typing' })
    expect(undoEdit(store, edit.undo!)).toBe(true)
    expect(colour(store, 't1')).toBeUndefined()
    expect((store.doc.block.m1 as { tex: string }).tex).toBe('F = ma')

    const again = await aiEdit(store, { instruction: 'make the heading blue', model: model([blue()]), tier0: false })
    store.apply([{ op: 'update', id: 't1', set: { md: 'Laws' } }], { origin: 'typing' })
    expect(undoEdit(store, again.undo!)).toBe(false)
    expect(colour(store, 't1')).toBe('blue')
  })
})

describe('what a person is told', () => {
  it('in plain words, never the teaching error written for the model', async () => {
    // A size on chosen words, twice: the edit fails, and the message says what to do instead.
    const words: Selection = { blocks: ['t2'], range: { block: 't2', start: 3, end: 9 } }
    const alias = makeAliases(PHYSICS, words).selected[0]!.alias
    const bigger = JSON.stringify({ ops: [{ op: 'style', ids: [alias], set: [{ size: 'l' }] }] })
    const store = chosen(words)
    const edit = await aiEdit(store, { instruction: 'make these bigger', model: model([bigger, bigger]), tier0: false })
    expect(edit.entry.error).toMatch(/^bad_value: /u)
    expect(edit.message).toMatch(/^Size, font, alignment and the kind of line apply to whole paragraphs/u)
    expect(edit.message).not.toMatch(/bad_value|is words|Block /u)
    expect(forPerson('content: Block g2SVFdkS: No HTML. Use **bold**.')).toMatch(/^The model wrote HTML tags, which a note does not hold\. Nothing was changed/u)
    expect(forPerson('scope: Block t9 is outside the selection.')).toMatch(/^The model tried to change something outside what you chose/u)
    expect(forPerson('unknown_id: zz is not on the list.')).toMatch(/^The model's answer did not fit what you chose/u)
  })
})

describe('Ask', () => {
  it('answers in words and never changes the note; Insert answer is one ordinary step', async () => {
    const store = chosen({ blocks: ['t2'] })
    const seen: CompleteRequest[] = []
    const asked = await aiAsk(store, { question: 'what is inertia?', model: model(['Inertia keeps things as they are.\n\n- at rest\n- moving'], undefined, seen) })
    expect(asked.answer).toBe('Inertia keeps things as they are.\n\n- at rest\n- moving')
    expect(asked.log.result).toBe('answered')
    expect(seen[0]!.schema).toBeUndefined()
    expect(store.doc).toEqual(PHYSICS)
    expect(store.canUndo).toBe(false)

    expect(insertAnswer(store, asked.answer, { blocks: ['t2'] })).toBe(true)
    const kids = (store.doc.block.f1 as { kids: string[] }).kids
    const after = kids.slice(kids.indexOf('t2') + 1, kids.indexOf('t2') + 4).map((id) => store.doc.block[id] as TextBlock)
    expect(after.map((block) => [block.role, block.md])).toEqual([
      ['p', 'Inertia keeps things as they are.'],
      ['li', 'at rest'],
      ['li', 'moving'],
    ])
    store.undo()
    expect(content(store.doc)).toEqual(content(PHYSICS))
  })
})

describe('progress while the model works', () => {
  it('says what it does, then how far it has got', () => {
    expect(workingText('edit', null)).toBe('Working on it…')
    expect(workingText('ask', null)).toBe('Thinking…')
    expect(workingText('edit', { step: 'write', thinking: 128, written: 0, text: '' })).toBe('Thinking… 128 tokens')
    expect(workingText('edit', { step: 'write', thinking: 128, written: 40, text: 'Waves' })).toBe('Writing… 40 tokens')
    expect(workingText('ask', { step: 'answer', thinking: 3, written: 9, text: 'Waves' })).toBe('Answering…')
  })

  it('comes from the writing and answering calls only, never the choice, and changes nothing in what is done', async () => {
    /** A model that tells how far it has got, as a streaming server lets it. */
    const telling = (replies: string[]): Model => ({
      name: 'test:model',
      caps: { jsonSchema: true, inlineContent: false, vision: false, opSet: 'full' },
      complete: async (request) => {
        const text = replies.shift() ?? ''
        request.onProgress?.({ thinking: 5, written: 0, text: '' })
        request.onProgress?.({ thinking: 5, written: 1, text })
        return { text, tokensIn: 900, tokensOut: 6, ms: 5 }
      },
    })
    const seen: StepProgress[] = []
    const store = chosen({ blocks: ['t2'] })
    const edit = await aiEdit(store, { instruction: 'say it more simply', model: telling(['{"ops":[{"op":"rewrite","id":"a"}]}', 'A body stays still until a force acts.']), tier0: false, progress: (p) => seen.push(p) })
    expect(edit.undo).toBeDefined()
    expect(seen).toEqual([
      { step: 'write', thinking: 5, written: 0, text: '' },
      { step: 'write', thinking: 5, written: 1, text: 'A body stays still until a force acts.' },
    ])
    seen.length = 0
    const asked = await aiAsk(chosen(), { question: 'what is this?', model: telling(['A heading.']), progress: (p) => seen.push(p) })
    expect(asked.answer).toBe('A heading.')
    expect(seen.map((p) => p.step)).toEqual(['answer', 'answer'])
  })
})
