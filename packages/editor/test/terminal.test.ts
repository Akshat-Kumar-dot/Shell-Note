// The terminal's lines, run through the app's own door, and a model writing them (a stand-in, scripted).
import type { CompleteRequest, Model } from '@shellnote/core'
import { afterEach, describe, expect, it } from 'vitest'
import { PHYSICS } from '../../core/test/fixtures/index.js'
import { commands } from '../src/commands/index.js'
import { CHOICE_DEFAULTS, penChoice } from '../src/ink/settings.js'
import { EditorStore } from '../src/store.js'
import { agentRun } from '../src/terminal/agent.js'
import { outputText, runLines } from '../src/terminal/run.js'
import { plainState } from '../src/terminal/state.js'

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

describe('lines', () => {
  it('run in order through the door: plain words, a command, a value alone, look', async () => {
    const store = open()
    const out = await runLines(['use a red marker', 'pen.set width=broad', 'tool.choose eraser', 'look'], { commands, ask: yes })
    expect(out.map((o) => o.ok)).toEqual([true, true, true, true])
    expect(out[0]!.text).toBe('pen.set: pen: marker, fine, red')
    expect(store.tool).toBe('eraser')
    expect(out[3]!.text).toMatch(/^tool eraser · pen marker, broad, red/u)
  })

  it('stop at the first that fails, and say how to write it', async () => {
    const store = open()
    const out = await runLines(['tool.choose tool=crayon', 'tool.choose pen'], { commands, ask: yes })
    expect(out).toHaveLength(1)
    expect(out[0]!.ok).toBe(false)
    expect(out[0]!.text).toContain('Its inputs: tool (type|select|free|pen|highlighter|eraser)')
    expect(out[0]!.text).toContain('Write it as: tool.choose tool=select')
    expect(store.tool).toBe('type')
    // A value under a field the command lacks, that one of its fields lists, is read there (note control, step 4).
    const named = await runLines(['tool.choose type=eraser'], { commands, ask: yes })
    expect(named[0]!.ok).toBe(true)
    expect(store.tool).toBe('eraser')
    // A value that fits another command says so.
    const marker = await runLines(['tool.choose tool=marker'], { commands, ask: yes })
    expect(marker[0]!.text).toContain(`"marker" fits pen.set's kind: write pen.set kind=marker`)
  })

  it('read every line of a block first: none runs when one cannot be read, and each that cannot says why, at once', async () => {
    const store = open()
    const out = await runLines(['tool.choose tool=pen', 'tool.choose tool=crayon', 'pen.set colour=nope', 'done'], { commands, ask: yes })
    expect(out.map((o) => [o.line, o.ok])).toEqual([
      ['tool.choose tool=crayon', false],
      ['pen.set colour=nope', false],
    ])
    expect(out[1]!.text).toContain('Nothing in this block ran: these 2 lines cannot be read. Write the whole block again, every line, these mended.')
    // The first line, readable, did not run either.
    expect(store.tool).toBe('type')
    // A line failing as it runs still stops the block there, what ran before it kept.
    const ran = await runLines(['tool.choose tool=pen', 'video.play', 'tool.choose tool=eraser'], { commands, ask: yes })
    expect(ran.map((o) => o.ok)).toEqual([true, false])
    expect(store.tool).toBe('pen')
  })

  it('read the forms small models write, where they have one meaning', async () => {
    open()
    const out = await runLines(['eraser: set [size=small]', 'highlighter: set colour=green|broad', 'pen set colour=blue', 'tool.choose tool=select|pen'], { commands, ask: yes })
    // The fourth, a list of values, is not read: nothing ran, and it says to write one.
    expect(out.map((o) => o.line)).toEqual(['tool.choose tool=select|pen'])
    expect(out[0]!.text).toContain('tool=select|pen is the list of its values: write one, as tool=select')
    const fixed = await runLines(['eraser: set [size=small]', 'highlighter: set colour=green|broad', 'pen set colour=blue'], { commands, ask: yes })
    expect(fixed.map((o) => o.text)).toEqual(['eraser.set: eraser: whole strokes, small', 'highlighter.set: highlighter: broad, green', 'pen.set: pen: pen, fine, blue'])
    expect(penChoice.value.color).toBe('blue')
  })

  it("run the note's own operations, an id given to what is added", async () => {
    const store = open()
    const frame = Object.values(store.doc.block).find((block) => block.type === 'frame')!
    const out = await runLines([`op {"op":"add","block":{"type":"text","parent":"${frame.id}","role":"h2","indent":0,"md":"Added by a line"}}`], { commands, ask: yes })
    expect(out[0]).toMatchObject({ ok: true })
    const id = /add (\S+)$/u.exec(out[0]!.text)![1]!
    expect(store.doc.block[id]).toMatchObject({ type: 'text', role: 'h2', md: 'Added by a line' })
    expect(store.canUndo).toBe(true)
  })

  it('refuse a bad operation with the reason, changing nothing', async () => {
    const store = open()
    const before = store.doc
    const out = await runLines(['op {"op":"remove","id":"nothere"}'], { commands, ask: yes })
    expect(out[0]!.ok).toBe(false)
    expect(store.doc).toBe(before)
  })

  it("refuse the note's own operations while another window edits the note, as every command does", async () => {
    const store = open()
    const before = store.doc
    const readOnly = commands.provide('workspace', { zoom: () => 1, setZoom: () => undefined, close: async () => undefined, save: async () => '', openFile: async () => '', newNote: async () => ({ id: '', title: '' }), rename: () => undefined, editing: () => false, entry: () => undefined, ready: () => true, openSettings: () => undefined, undoAi: () => '', editHere: () => '' })
    try {
      const frame = Object.values(store.doc.block).find((block) => block.type === 'frame')!
      const out = await runLines([`op {"op":"add","block":{"type":"text","parent":"${frame.id}","role":"p","indent":0,"md":"Not here"}}`], { commands, ask: yes })
      expect(out[0]).toMatchObject({ ok: false, text: 'This note is read-only here: it is being edited in another window.' })
      expect(store.doc).toBe(before)
    } finally {
      readOnly()
    }
  })

  it('say plainly what cannot be done, and what is unclear', async () => {
    open()
    expect((await runLines(['do set my api key'], { commands, ask: yes }))[0]!.text).toMatch(/^cannot: .*API key/su)
    expect((await runLines(['do the thing'], { commands, ask: yes }))[0]!.text).toMatch(/^not sure; the closest:/u)
  })

  it('print for the model with the state after', () => {
    expect(outputText([{ line: 'look', ok: true, text: 'tool pen' }], 'tool pen')).toBe('[1] look\n    ✓ tool pen\nstate: tool pen')
  })

  it('print, on the small models\' page, that a line changed nothing', () => {
    const same = { line: 'pen: set colour=ink', ok: true, text: 'pen.set: pen: pen, fine, ink', same: true as const }
    expect(outputText([same], 'tool pen', 'small')).toContain('pen.set: pen: pen, fine, ink (no change: this was already so)')
    expect(outputText([same], 'tool pen')).not.toContain('no change')
  })

  it('give the state in plain sentences for the small models\' page, each line its own', () => {
    const state = [
      'screen: a sample note, not kept',
      'tool pen · pen pencil, fine, red · highlighter medium, yellow · eraser whole strokes, medium · undo no, redo yes',
      'zoom 100 % · side panel open on timer · bars tools float, format top · full view notes · full screen off',
      'timer: countdown of 25:00, 25:00 left, not started',
      'AI box open, to ask',
      'AI chat: 1 turn · next: table, into the scratch pad',
      'videos: "YouTube aircAruvnKk" (YsLz6bC4) · none shown · times beside the lines on',
      'note "Chapter 3: Waves" (w0) · 3 pages',
      'library: the top · last edited, newest first · 1 folder, 0 notes: folder "Physics" (4pVfU54t)',
      'something new',
    ].join('\n')
    expect(plainState(state).split('\n')).toEqual([
      'The screen shows a sample note, not kept.',
      'The tool in use is pen. The pen is a fine red pencil. The highlighter is medium and yellow. The eraser takes whole strokes and is medium. There is nothing to undo, and one to redo.',
      'Zoom is 100 %. The side panel is open, on its timer tab. The tools bar is floating, the format bar at the top. Full view is on: the notes alone. Full screen is off.',
      'The timer is a countdown of 25:00, 25:00 left, not started.',
      'The AI box is open, to ask.',
      'The AI chat has had 1 turn; next it makes: table, into the scratch pad.',
      'The note\'s videos: "YouTube aircAruvnKk" (YsLz6bC4). None is shown. The times beside the lines are on.',
      'The open note is "Chapter 3: Waves" (w0), with 3 pages.',
      'The library shows the top, sorted by last edited, newest first; it holds 1 folder, 0 notes: folder "Physics" (4pVfU54t).',
      'something new',
    ])
    expect(plainState('tool type · pen pen, extra-fine, ink · highlighter broad, green · eraser part strokes, large · undo yes, redo no')).toContain('The pen is an extra-fine ink pen.')
  })

  it('print an output the same as one before it once (a model wrote blocks 40 times, 45,000 tokens, 20 October 2026)', () => {
    const list = { line: 'blocks', ok: true, text: 'page 1\n  h1 · heading 1' }
    expect(outputText([list, list, { line: 'look', ok: true, text: 'tool pen' }, list], 'tool pen')).toBe(
      '[1] blocks\n    ✓ page 1\n        h1 · heading 1\n[2] blocks\n    ✓ the same as [1]\n[3] look\n    ✓ tool pen\n[4] blocks\n    ✓ the same as [1]\nstate: tool pen',
    )
  })
})

describe('a model writing the lines', () => {
  /** A stand-in model that replies from a script, and records what it was sent. */
  function scripted(replies: string[]): Model & { sent: CompleteRequest[] } {
    const sent: CompleteRequest[] = []
    return {
      name: 'scripted',
      caps: { jsonSchema: false, inlineContent: false, vision: false, opSet: 'small' },
      sent,
      complete: async (request) => {
        sent.push({ ...request, messages: request.messages.map((message) => ({ ...message })) })
        return { text: replies.shift() ?? 'Done.', tokensIn: 0, tokensOut: 0, ms: 0 }
      },
    }
  }

  it('runs each block, sends the output back, and ends at a reply with no block', async () => {
    const store = open()
    const model = scripted(['```wn\ntool.choose tool=crayon\n```', '```wn\ntool.choose tool=pen\npen.set colour=blue\n```', 'The pen is blue.'])
    const replies: string[] = []
    const end = await agentRun('I want to write in blue now.', { model, commands, ask: yes, onReply: (text) => replies.push(text), onOutput: () => undefined })
    expect(end).toBe('done')
    expect(replies).toHaveLength(3)
    expect(store.tool).toBe('pen')
    expect(penChoice.value.color).toBe('blue')
    // The first block's failure went back, with how to write it.
    expect(String(model.sent[1]!.messages.at(-1)!.content)).toContain('Write it as: tool.choose tool=select')
    expect(String(model.sent[0]!.messages[0]!.content)).toContain('You control ShellNote')
  })

  it('runs a request the app knows word for word by code, with no call, when it only changes the view or the tools', async () => {
    const store = open()
    const model = scripted(['never asked'])
    const shown: string[] = []
    expect(await agentRun('Pick the eraser.', { model, commands, ask: yes, onReply: () => undefined, onOutput: (outputs) => shown.push(...outputs.map((o) => `${o.line}: ${o.text}`)) })).toBe('code')
    expect(model.sent).toHaveLength(0)
    expect(store.tool).toBe('eraser')
    expect(shown).toEqual(['tool.choose tool=eraser: tool: eraser'])
    // One that changes the note goes to the model, however well the words match.
    const asked = scripted(['```wn\ndone\n```'])
    await agentRun('Undo that.', { model: asked, commands, ask: yes, onReply: () => undefined, onOutput: () => undefined })
    expect(asked.sent.length).toBeGreaterThan(0)
  })

  it('tells the model a block it never closed ran nothing', async () => {
    open()
    const model = scripted(['```wn\ntool.choose tool=pen', 'Sorry.'])
    await agentRun('pen', { model, commands, ask: yes, onReply: () => undefined, onOutput: () => undefined })
    expect(String(model.sent[1]!.messages.at(-1)!.content)).toContain('never closed: nothing in it ran')
  })

  it('ends when the model writes done, running nothing after it', async () => {
    const store = open()
    const model = scripted(['```wn\ntool.choose tool=pen\ndone chose the pen\ntool.choose tool=eraser\n```', 'never asked'])
    expect(await agentRun('the pen', { model, commands, ask: yes, onReply: () => undefined, onOutput: () => undefined })).toBe('done')
    expect(store.tool).toBe('pen')
    expect(model.sent).toHaveLength(1)
  })

  it('tells the model before it starts that a question is answered, and what of the note is not built yet', async () => {
    open()
    const first = async (request: string): Promise<string> => {
      const model = scripted(['```wn\ndone\n```'])
      await agentRun(request, { model, commands, ask: yes, onReply: () => undefined, onOutput: () => undefined })
      return String(model.sent[0]!.messages[1]!.content)
    }
    expect(await first('Is the side panel open?')).toContain('This asks a question')
    expect(await first('How many pages does this note have?')).toContain('This asks a question')
    // "Can you…?" asks for a change, not an answer.
    expect(await first('Can you zoom in a bit?')).not.toContain('This asks a question')
    // Text is written by the note's commands now (step 2), and pictures, maths and diagrams (step 3): no notice; drawing
    // in the note is a later step.
    expect(await first("Write 'hello world' at the top of this note.")).not.toContain('not built yet')
    expect(await first('Put a photo of a ripple tank in the note.')).not.toContain('not built yet')
    expect(await first('Add the formula for kinetic energy under the first paragraph.')).not.toContain('not built yet')
    expect(await first('Draw a sketch of a wave in the note.')).toContain('a later step, not built yet')
    expect(await first('Add this YouTube video beside my note: https://www.youtube.com/watch?v=aircAruvnKk')).not.toContain('not built yet')
  })

  it("gives a request about the note's text the page it is about, and the whole words of the blocks it names; one about the app nothing more", async () => {
    open()
    const first = async (request: string): Promise<string> => {
      const model = scripted(['```wn\ndone\n```'])
      await agentRun(request, { model, commands, ask: yes, onReply: () => undefined, onOutput: () => undefined })
      return String(model.sent[0]!.messages[1]!.content)
    }
    const rewrite = await first('Make the first paragraph shorter.')
    expect(rewrite).toContain('The page the request is about:\npage 1 of 1 of note')
    expect(rewrite).toMatch(/The whole words of the blocks the request names:\n {2}t2 {2}“An object at rest stays at rest unless a force[^”]*”/u)
    expect(await first('Put the format bar on the left, where it was.')).not.toContain('The page the request is about')
  })

  it('tells a model that wrote its lines outside a block that nothing ran, once; a plain answer ends', async () => {
    const store = open()
    const loose = scripted(['<|tool_call>call:tool: choose tool=eraser done picked the eraser tool', '```wn\ntool.choose tool=eraser\ndone the eraser\n```', 'never asked'])
    expect(await agentRun('Pick the eraser, I need to fix a word.', { model: loose, commands, ask: yes, onReply: () => undefined, onOutput: () => undefined })).toBe('done')
    expect(String(loose.sent[1]!.messages.at(-1)!.content)).toContain('lines run only inside a block')
    expect(store.tool).toBe('eraser')
    const plain = scripted(['The note has 3 pages.', 'never asked'])
    expect(await agentRun('How many pages?', { model: plain, commands, ask: yes, onReply: () => undefined, onOutput: () => undefined })).toBe('done')
    expect(plain.sent).toHaveLength(1)
  })

  it('marks a line that set what was so already, and gives the small models\' page its state in sentences', async () => {
    open()
    const before = await runLines(['tool.choose tool=pen'], { commands, ask: yes })
    expect(before[0]!.same).toBeUndefined()
    const again = await runLines(['tool.choose tool=pen', 'note.blocks'], { commands, ask: yes })
    expect(again[0]!.same).toBe(true)
    // A command whose effect the state does not show is never marked, whatever it did.
    expect(again[1]!.same).toBeUndefined()
    const model = scripted(['```wn\ndone\n```'])
    await agentRun('Use the pen for a while.', { model, commands, ask: yes, page: 'small', onReply: () => undefined, onOutput: () => undefined })
    expect(String(model.sent[0]!.messages[1]!.content)).toMatch(/The app now: .*The tool in use is pen\./su)
    const overall = scripted(['```wn\ndone\n```'])
    await agentRun('Use the pen for a while.', { model: overall, commands, ask: yes, onReply: () => undefined, onOutput: () => undefined })
    expect(String(overall.sent[0]!.messages[1]!.content)).toMatch(/The app now: .*tool pen ·/su)
  })

  it('sends done alone back once for a request asking for a change, never for a question', async () => {
    const store = open()
    const lazy = scripted(['```wn\ndone the pen\n```', '```wn\ntool.choose tool=pen\ndone the pen\n```', 'never asked'])
    expect(await agentRun('Use the pen for a while.', { model: lazy, commands, ask: yes, onReply: () => undefined, onOutput: () => undefined })).toBe('done')
    expect(lazy.sent).toHaveLength(2)
    expect(String(lazy.sent[1]!.messages.at(-1)!.content)).toContain('Nothing changed for this request')
    expect(store.tool).toBe('pen')
    const asked = scripted(['```wn\ndone the pen, in ink\n```', 'never asked'])
    expect(await agentRun('Which pen is it?', { model: asked, commands, ask: yes, onReply: () => undefined, onOutput: () => undefined })).toBe('done')
    expect(asked.sent).toHaveLength(1)
  })

  it('stops a model repeating itself with nothing changing, after its last turn, and when stopped', async () => {
    open()
    const repeating = scripted(Array.from({ length: 20 }, () => '```wn\nlook\n```'))
    expect(await agentRun('look forever', { model: repeating, commands, ask: yes, onReply: () => undefined, onOutput: () => undefined })).toBe('repeated')
    expect(repeating.sent).toHaveLength(2)
    const busy = scripted(Array.from({ length: 20 }, (_, i) => `\`\`\`wn\ntool.choose tool=${i % 2 === 0 ? 'pen' : 'eraser'}\n\`\`\``))
    expect(await agentRun('switch forever', { model: busy, commands, ask: yes, maxTurns: 3, onReply: () => undefined, onOutput: () => undefined })).toBe('turns')
    expect(await agentRun('anything', { model: scripted([]), commands, ask: yes, signal: { aborted: true }, onReply: () => undefined, onOutput: () => undefined })).toBe('stopped')
  })
})
