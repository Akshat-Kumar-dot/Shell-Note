// The command finder's four steps: the exact standard form, typos and
// overlap, meaning through an embedding the caller passes in, and the closest
// three when nothing is clearly ahead. Inputs are read from the words.
import { describe, expect, it, vi } from 'vitest'
import { APP_COMMANDS, APP_LIMITS } from '../../src/command/app.js'
import { Finder, type Embedder } from '../../src/command/finder.js'

const finder = new Finder(APP_COMMANDS, APP_LIMITS)

describe('step 1: the standard form', () => {
  it('finds a command whatever the order, endings and filler', () => {
    expect(finder.findNow('Closes the Note')).toMatchObject({ kind: 'found', command: 'note.close', by: 'key', score: 1 })
    expect(finder.findNow('note close')).toMatchObject({ kind: 'found', command: 'note.close', by: 'key' })
    expect(finder.findNow('please empty the trash')).toMatchObject({ kind: 'found', command: 'bin.empty', by: 'key' })
  })

  it('reads inputs from the words: values, a pair, a number, a switch', () => {
    expect(finder.findNow('use a blue pencil')).toMatchObject({ kind: 'found', command: 'pen.set', input: { kind: 'pencil', colour: 'blue' } })
    expect(finder.findNow('make the pen extra fine')).toMatchObject({ kind: 'found', command: 'pen.set', input: { width: 'extra-fine' } })
    // A real model's words (19 October): the values of pen.set's own inputs count for it, not against it.
    expect(finder.findNow('use a red marker with a broad width')).toMatchObject({ kind: 'found', command: 'pen.set', input: { kind: 'marker', colour: 'red', width: 'broad' } })
    expect(finder.findNow('zoom to 150%')).toMatchObject({ kind: 'found', command: 'screen.zoom', input: { percent: 150 } })
    expect(finder.findNow('zoom in')).toMatchObject({ kind: 'found', command: 'screen.zoom', input: { step: 'in' } })
    expect(finder.findNow('go to page 3')).toMatchObject({ kind: 'found', command: 'screen.page', input: { page: 3 } })
    expect(finder.findNow('enter full screen')).toMatchObject({ kind: 'found', command: 'screen.fullscreen', input: { on: true } })
    expect(finder.findNow('leave full screen')).toMatchObject({ kind: 'found', command: 'screen.fullscreen', input: { on: false } })
  })

  it('says which inputs the command still needs', () => {
    expect(finder.findNow('open the note')).toMatchObject({ kind: 'found', command: 'note.open', input: {}, missing: ['note'] })
    expect(finder.findNow('close the note')).toMatchObject({ missing: [] })
  })

  it('never takes a number a field refuses: 900 % is no zoom', () => {
    expect(finder.findNow('zoom to 900%')).toMatchObject({ kind: 'found', command: 'screen.zoom', input: {} })
  })
})

describe('two commands with the same roots', () => {
  it('are told apart by the words as written: "settings" is "set" as a root, never as a word', () => {
    expect(finder.findNow('pen set')).toMatchObject({ kind: 'found', command: 'pen.set', by: 'key' })
    expect(finder.findNow('settings pen')).toMatchObject({ kind: 'found', command: 'settings.pen', by: 'key' })
    expect(finder.findNow('note blocks')).toMatchObject({ kind: 'found', command: 'note.blocks' })
    expect(finder.findNow('note block')).toMatchObject({ kind: 'found', command: 'note.block' })
  })

  it('rank the one sharing more of the words first when nothing is clear', () => {
    const result = finder.findNow('settings')
    expect(result.kind).toBe('unclear')
    if (result.kind !== 'unclear') return
    expect(result.closest.map((c) => ('command' in c ? c.command : '!'))).toContain('settings.open')
    expect(result.closest.map((c) => ('command' in c ? c.command : '!'))).not.toContain('pen.set')
  })
})

describe('names given in plain words (the agent test, 19 October 2026)', () => {
  it('reads a name in quotes, or after called, named or titled, its case kept', () => {
    expect(finder.findNow('note rename "Optics"')).toMatchObject({ kind: 'found', command: 'note.rename', input: { name: 'Optics' }, missing: [] })
    expect(finder.findNow('new folder called Physics')).toMatchObject({ kind: 'found', command: 'folder.new', input: { name: 'Physics' } })
    expect(finder.findNow('a new note called Waves')).toMatchObject({ kind: 'found', command: 'note.new', input: { name: 'Waves' } })
    expect(finder.findNow('create a folder named "Unit 2"')).toMatchObject({ kind: 'found', command: 'folder.new', input: { name: 'Unit 2' } })
  })

  it('takes "the note called Waves" as the note to act on, never as the new name, so a rename still asks for one', () => {
    expect(finder.findNow('rename the note called Waves to Optics')).toMatchObject({ kind: 'found', command: 'note.rename', input: { note: 'Waves' }, missing: ['name'] })
  })

  it('never takes an apostrophe for a quote', () => {
    const result = finder.findNow("I am done with this note's page, close it")
    expect(result.kind === 'found' ? result.input : result.kind === 'unclear' ? result.closest[0] : {}).not.toMatchObject({ name: expect.anything() })
  })
})

describe('step 2: typos and overlap', () => {
  it('forgives a typo', () => {
    expect(finder.findNow('clsoe the note')).toMatchObject({ kind: 'found', command: 'note.close', by: 'letters' })
    expect(finder.findNow('use a pencel')).toMatchObject({ kind: 'found', command: 'pen.set', input: { kind: 'pencil' } })
  })
})

describe('what the agent cannot do', () => {
  it('is answered plainly, with the reason', () => {
    const result = finder.findNow('set my api key')
    expect(result.kind).toBe('impossible')
    expect(result.kind === 'impossible' && result.why).toMatch(/API key/u)
  })
})

describe('step 4: nothing clearly ahead', () => {
  it('gives the closest three, each with what it does and its inputs, never a guess', () => {
    const result = finder.findNow('do the thing with the stuff')
    expect(result.kind).toBe('unclear')
    if (result.kind !== 'unclear') return
    expect(result.closest).toHaveLength(3)
    for (const candidate of result.closest) {
      if ('limit' in candidate) continue
      expect(candidate.does.length).toBeGreaterThan(5)
      expect(candidate.input).toMatchObject({ type: 'object' })
    }
  })
})

describe('step 3 without its model', () => {
  it('goes on by words alone when the embedding model cannot answer (LM Studio closed), never throwing', async () => {
    const finder = new Finder(APP_COMMANDS, APP_LIMITS)
    const gone: Embedder = async () => Promise.reject(new Error('LM Studio is closed'))
    expect(await finder.find('shut this page', gone)).toEqual(finder.findNow('shut this page'))
    expect(await finder.prepareMeaning(gone)).toBe(false)
  })
})

describe('step 3: meaning', () => {
  /** A stand-in embedding: words counted on a few meanings, "shut" meaning close. */
  const MEANINGS: Record<string, string> = { close: 'close', shut: 'close', note: 'note', page: 'note', open: 'open', library: 'library', pencil: 'pen', pen: 'pen' }
  const DIMENSIONS = [...new Set(Object.values(MEANINGS))]
  const embed: Embedder = vi.fn(async (texts: readonly string[]) =>
    texts.map((text) => {
      const vector = DIMENSIONS.map(() => 0)
      for (const word of text.toLowerCase().match(/[a-z]+/gu) ?? []) {
        const meaning = MEANINGS[word]
        if (meaning) vector[DIMENSIONS.indexOf(meaning)]! += 1
      }
      return vector
    }),
  )

  it('finds what the words did not: "shut this page" is note.close', async () => {
    expect(finder.findNow('shut this page').kind).toBe('unclear')
    expect(await finder.find('shut this page', embed)).toMatchObject({ kind: 'found', command: 'note.close', by: 'meaning' })
  })

  it('is asked only when steps 1 and 2 leave it unclear, and embeds the table once', async () => {
    const local = new Finder(APP_COMMANDS, APP_LIMITS)
    const calls = vi.fn(embed)
    await local.find('close the note', calls)
    expect(calls).not.toHaveBeenCalled()
    await local.find('shut this page', calls)
    await local.find('shut the page', calls)
    // The table once, then one call per request.
    expect(calls).toHaveBeenCalledTimes(3)
  })
})
