// Stop ends an AI edit with the note as it was; Ask answers in words and
// never changes the note.
import { describe, expect, it } from 'vitest'
import { answerBlocks, answerOps, apply, askPrompt, LogEntry, makeAliases, outsideScope, runAsk, runEdit, type CompleteRequest, type Frame, type Model, type Part } from '../src/index.js'
import { PHYSICS } from './fixtures/index.js'

const caps = { jsonSchema: true, inlineContent: false, vision: false, opSet: 'small' as const }

describe('Stop', () => {
  it('before the first call: no call, the note as it was, the log says stopped', async () => {
    const stop = new AbortController()
    stop.abort()
    const asked: CompleteRequest[] = []
    const model: Model = { name: 'm', caps, complete: async (req) => (asked.push(req), { text: '{"op":"delete","ids":["a"]}', tokensIn: 1, tokensOut: 1, ms: 1 }) }
    const out = await runEdit({ doc: PHYSICS, selection: { blocks: ['t2'] }, instruction: 'get rid of this paragraph please', model, tier0: false, signal: stop.signal })
    expect(asked).toHaveLength(0)
    expect(out).toMatchObject({ stopped: true, doc: PHYSICS, calls: 0, log: { result: 'stopped' } })
    expect(LogEntry.parse(out.log).result).toBe('stopped')
  })

  it('during a call: the call ends, nothing is applied, and the model gets the signal', async () => {
    const stop = new AbortController()
    let signal: unknown
    const model: Model = {
      name: 'm',
      caps,
      async complete(req) {
        signal = req.signal
        stop.abort()
        throw new Error('The operation was aborted.')
      },
    }
    const out = await runEdit({ doc: PHYSICS, selection: { blocks: ['t2'] }, instruction: 'say it more simply', model, tier0: false, signal: stop.signal })
    expect(signal).toBe(stop.signal)
    expect(out).toMatchObject({ stopped: true, doc: PHYSICS, log: { result: 'stopped' } })
  })

  it('between the choice and the content step: the words are never asked for', async () => {
    const stop = new AbortController()
    const replies = ['{"op":"rewrite","id":"a"}', 'A push changes how things move.']
    let calls = 0
    const model: Model = {
      name: 'm',
      caps,
      async complete() {
        calls++
        const text = replies.shift() ?? ''
        if (calls === 1) stop.abort()
        return { text, tokensIn: 100, tokensOut: 10, ms: 1 }
      },
    }
    const out = await runEdit({ doc: PHYSICS, selection: { blocks: ['t2'] }, instruction: 'say it more simply', model, tier0: false, signal: stop.signal })
    expect(calls).toBe(1)
    expect(out).toMatchObject({ stopped: true, doc: PHYSICS })
  })

  it('makes no difference to an edit that finished first', async () => {
    const stop = new AbortController()
    const model: Model = { name: 'm', caps, complete: async () => ({ text: '{"ops":[{"op":"style","ids":["a"],"set":[{"color":"red"}]}]}', tokensIn: 1, tokensOut: 1, ms: 1 }) }
    const out = await runEdit({ doc: PHYSICS, selection: { blocks: ['t1'] }, instruction: 'make the heading stand out', model, tier0: false, signal: stop.signal })
    stop.abort()
    expect(out.stopped).toBeUndefined()
    expect(out.doc.block.t1).toMatchObject({ style: { color: 'red' } })
  })
})

describe('Insert answer', () => {
  const answer = '## Newton\'s first law\n\nAn object keeps its motion unless a force acts.\n\n- at rest stays at rest\n  - unless pushed\n- moving keeps moving\n\n| Law | Says |\n| --- | --- |\n| 1 | inertia |\n\n$$F = ma$$'

  it('turns the answer into blocks: headings, paragraphs, list items, a table, a formula', () => {
    expect(answerBlocks(answer)).toEqual([
      { kind: 'text', content: 'Newton\'s first law', role: 'h2', indent: 0 },
      { kind: 'text', content: 'An object keeps its motion unless a force acts.', role: 'p', indent: 0 },
      { kind: 'text', content: 'at rest stays at rest', role: 'li', indent: 0 },
      { kind: 'text', content: 'unless pushed', role: 'li', indent: 1 },
      { kind: 'text', content: 'moving keeps moving', role: 'li', indent: 0 },
      { kind: 'table', content: '| Law | Says |\n| --- | --- |\n| 1 | inertia |', role: 'p', indent: 0 },
      { kind: 'math', content: 'F = ma', role: 'p', indent: 0 },
    ])
  })

  it('makes a fenced Mermaid diagram one diagram block, blank lines in it and all, between the paragraphs round it', () => {
    const answer = 'Before.\n\n```mermaid\nflowchart TD\n  A[Push] --> B[Moves]\n\n  B --> C[Stops]\n```\n\nAfter.'
    expect(answerBlocks(answer)).toEqual([
      { kind: 'text', content: 'Before.', role: 'p', indent: 0 },
      { kind: 'diagram', content: 'flowchart TD\n  A[Push] --> B[Moves]\n\n  B --> C[Stops]', role: 'p', indent: 0 },
      { kind: 'text', content: 'After.', role: 'p', indent: 0 },
    ])
    let n = 0
    const ops = answerOps(PHYSICS, { blocks: ['t2'] }, answer, () => `new${String(++n).padStart(5, '0')}`)
    const doc = apply(PHYSICS, ops).doc
    const made = Object.values(doc.block).find((block) => block.type === 'diagram' && !PHYSICS.block[block.id])
    expect(made).toMatchObject({ type: 'diagram', lang: 'mermaid', src: 'flowchart TD\n  A[Push] --> B[Moves]\n\n  B --> C[Stops]' })
  })

  it('puts them after the selection, or into a Select box, as one edit within its scope', () => {
    let n = 0
    const newId = (): string => `ans${n++}`
    const after = apply(PHYSICS, answerOps(PHYSICS, { blocks: ['t2'] }, answer, newId)).doc
    expect((after.block.f1 as Frame).kids).toEqual(['t1', 't2', 'ans0', 'ans1', 'ans2', 'ans3', 'ans4', 'ans5', 'ans6', 'm1'])
    expect(after.block.ans5).toMatchObject({ type: 'table', head: true, rows: [['Law', 'Says'], ['1', 'inertia']] })

    const box = { page: 'p1', x: 2000, y: 23000, w: 8000, h: 3000 }
    const selection = { blocks: [], here: box }
    const filled = apply(PHYSICS, answerOps(PHYSICS, selection, 'Short answer.', newId)).doc
    const frame = Object.values(filled.block).find((b): b is Frame => b.type === 'frame' && b.id !== 'f1')!
    expect(frame).toMatchObject({ page: 'p1', x: 2000, y: 23000, w: 8000 })
    expect(filled.block[frame.kids[0]!]).toMatchObject({ md: 'Short answer.' })
    expect(outsideScope(PHYSICS, filled, selection, makeAliases(PHYSICS, selection))).toBeNull()
    expect(answerOps(PHYSICS, { blocks: [] }, 'Nowhere to go.', newId)).toEqual([])
  })
})

describe('Ask', () => {
  it('sends the selection in full and the question, and answers in words', async () => {
    const asked: CompleteRequest[] = []
    const model: Model = {
      name: 'writer',
      caps,
      complete: async (req) => (asked.push(req), { text: '  Inertia: things keep doing what they do.\n', tokensIn: 300, tokensOut: 20, thinkingTokens: 5, cost: 0.0002, ms: 4 }),
    }
    const out = await runAsk({ doc: PHYSICS, selection: { blocks: ['t2'] }, question: 'explain this simply', model })
    expect(out.answer).toBe('Inertia: things keep doing what they do.')
    expect(asked[0]!.schema).toBeUndefined()
    expect(asked[0]!.messages[0]!.content).toContain('Answer a question about the part of a note the person selected')
    expect(asked[0]!.messages[1]!.content).toBe(askPrompt(PHYSICS, { blocks: ['t2'] }, 'explain this simply'))
    expect(asked[0]!.messages[1]!.content).toContain('SELECTED\na p An object at rest stays at rest unless a **force** acts on it.\nNEAR\nb before: h2 Newton\'s laws\nc after: math F = ma\nNOTEBOOK RULES\n- Headings are blue.\nQUESTION\nexplain this simply')
    expect(out).toMatchObject({ tokensIn: 300, tokensOut: 20, thinking: 5, cost: 0.0002 })
    expect(LogEntry.parse(out.log)).toMatchObject({ result: 'answered', model: 'writer', instruction: 'explain this simply', targets: ['t2'], ops: [], calls: 1, thinking: 5, cost: 0.0002 })
  })

  it('sends a picture with the question to a model that can see it, and to no other', async () => {
    const asked: CompleteRequest[] = []
    const answer = (vision: boolean): Model => ({
      name: 'writer',
      caps: { ...caps, vision },
      complete: async (req) => (asked.push(req), { text: 'A ball rolling down a slope.', tokensIn: 900, tokensOut: 8, ms: 4 }),
    })
    const picture = 'data:image/png;base64,AAAA'
    await runAsk({ doc: PHYSICS, selection: { blocks: ['g1'] }, question: 'what does this show?', model: answer(true), picture })
    expect(asked[0]!.messages[0]!.content).toContain('The picture is attached')
    expect((asked[0]!.messages[1]!.content as Part[])[1]).toEqual({ type: 'image_url', image_url: { url: picture } })
    await runAsk({ doc: PHYSICS, selection: { blocks: ['g1'] }, question: 'what does this show?', model: answer(false), picture })
    expect(JSON.stringify(asked[1]!.messages)).not.toContain('image_url')
  })

  it('stops like an edit', async () => {
    const stop = new AbortController()
    stop.abort()
    const out = await runAsk({ doc: PHYSICS, selection: { blocks: ['t2'] }, question: 'why?', model: { name: 'm', caps, complete: () => Promise.reject(new Error('no call expected')) }, signal: stop.signal })
    expect(out).toMatchObject({ answer: '', stopped: true, log: { result: 'stopped', calls: 0 } })
  })
})
