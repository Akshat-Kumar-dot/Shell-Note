// The area router: the model names the area and the operation in plain words, with
// any inputs; code picks the command inside the area from the verb meaning table, the inputs and, when given, meaning.
import { describe, expect, it } from 'vitest'
import { COMMANDS } from '../../src/command/all.js'
import { AREAS, areaOf, operationOf, STRICT, VERBS } from '../../src/command/lexicon.js'
import { route } from '../../src/command/router.js'
import { parseLine } from '../../src/command/terminal.js'

const found = async (area: string, words: string, given: Record<string, unknown> = {}) => {
  const routed = await route(area, words, given)
  return routed.kind === 'found' ? routed.command : routed.kind
}

describe('the tables', () => {
  it('give every command a list and every area a hint, and name no command that is not', () => {
    for (const spec of COMMANDS) expect(VERBS[spec.name], spec.name).toBeDefined()
    for (const name of Object.keys(VERBS)) expect(COMMANDS.some((spec) => spec.name === name), name).toBe(true)
    for (const area of new Set(COMMANDS.map((spec) => spec.name.split('.')[0]!))) expect(AREAS[area]?.hint, area).toBeTruthy()
    for (const name of STRICT) expect(COMMANDS.some((spec) => spec.name === name), name).toBe(true)
  })

  it('read an area said its own way', () => {
    expect(areaOf('video')).toBe('video')
    expect(areaOf('trash')).toBe('bin')
    expect(areaOf('Recycle Bin')).toBe('bin')
    expect(areaOf('youtube')).toBe('video')
    expect(areaOf('sidebar')).toBe('panel')
    expect(areaOf('dark mode')).toBe('settings')
    expect(areaOf('banana')).toBeUndefined()
  })
})

describe('the verb, inside one area', () => {
  it('from the verb meaning table: the longest phrase first', async () => {
    expect(await found('video', 'play from', { seconds: '120' })).toBe('video.playFrom')
    expect(await found('video', 'stop')).toBe('video.pause')
    expect(await found('timer', 'stop')).toBe('timer.stop')
    expect(await found('note', 'get rid of')).toBe('note.delete')
    expect(await found('bin', 'bring back', { item: 'Waves' })).toBe('bin.restore')
    expect(await found('edit', 'undo my undo')).toBe('edit.redo')
    expect(await found('timer', 'start a countdown', { minutes: '10' })).toBe('timer.start')
  })

  it('from the inputs given: only commands that take them', async () => {
    // video.play takes no seconds: start with seconds is playing from there.
    expect(await found('video', 'start', { seconds: '120' })).toBe('video.playFrom')
    expect(await found('video', 'start')).toBe('video.play')
  })

  it('reads inputs from the words as well as those given', async () => {
    expect(await route('pen', 'use a red pencil', {})).toMatchObject({ kind: 'found', command: 'pen.set', input: { kind: 'pencil', colour: 'red' } })
    expect(await route('note', 'make a new note', { name: 'Waves' })).toMatchObject({ kind: 'found', command: 'note.new', input: { name: 'Waves' } })
  })

  it('says what is still needed rather than running without it', async () => {
    expect(await route('note', 'rename')).toMatchObject({ kind: 'found', command: 'note.rename', missing: ['name'] })
  })
})

describe('never a guess', () => {
  it('offers the area\'s few commands when two fit the words alike', async () => {
    const routed = await route('settings', 'change')
    expect(routed.kind).toBe('unclear')
    expect(routed.kind === 'unclear' && routed.options.length).toBeGreaterThan(1)
  })

  it('runs what cannot be undone only on its words whole', async () => {
    expect(await found('bin', 'empty')).toBe('bin.empty')
    expect(await found('bin', 'empty the trash')).toBe('bin.empty')
    const loose = await route('bin', 'empty everything in it right now for me')
    expect(loose.kind).toBe('unclear')
    expect(loose.kind === 'unclear' && loose.options).toContain('bin.empty')
  })

  it('looks in the other areas for inputs that fit none of this one', async () => {
    const routed = await route('pen', 'change', { erase: 'part' })
    expect(routed).toMatchObject({ kind: 'elsewhere', options: ['eraser.set'] })
  })

  it('lets a clear verb win over inputs written under the wrong name, and reads name= as the thing it acts on', async () => {
    // "move" is folder.move's, which takes folder, not name: never folder.new, which takes name. The name is the folder
    // moved (24 October 2026; until then it was offered, with how to write it).
    expect(await route('folder', 'move', { name: 'Receipts', into: 'Year 2023' })).toMatchObject({ kind: 'found', command: 'folder.move', input: { folder: 'Receipts', into: 'Year 2023' } })
  })

  it('decides by inputs alone only through one of a short list of values, never a bare switch', async () => {
    expect(await found('pen', '', { kind: 'pencil' })).toBe('pen.set')
    expect((await route('video', '', { on: 'off' })).kind).toBe('unclear')
  })

  it('reads lines as the agent test found models write them (20 October 2026)', async () => {
    // The verb as the command's name spells it, an area word that is a verb there, a phrase over inputs given wrongly.
    expect(await found('screen', 'fullscreen', { on: 'true' })).toBe('screen.fullscreen')
    // view is no area since pick fv: full view is the panel's, and the model is told the areas.
    expect(await route('view', 'full', { on: 'on' })).toEqual({ kind: 'no-area', given: 'view' })
    expect(await found('bin', 'deleteForever', { item: 'Waves' })).toBe('bin.deleteForever')
    expect(await route('bin', 'delete all', { item: 'all' })).toMatchObject({ kind: 'unclear', options: ['bin.empty'] })
    // Never a new note for a close: "note" begins note.new's "note down" but is no verb, and an id is never split.
    expect(await route('note', 'close note w9Q52aDQ', { name: 'w9Q52aDQ' })).toMatchObject({ kind: 'unclear', options: ['note.close'] })
    expect(await found('video', 'playFrom', { seconds: '30' })).toBe('video.playFrom')
    // A phrase begun counts only when the words it lacks are small linking words: "open" begins note.new's "open a new
    // note", which lacks "new", the word that makes it note.new (the baseline, 20 October 2026, made a note of it).
    // And name= is the note opened, by its name: note.open takes no new name, and one note.
    expect(await route('note', 'open Chapter 3: Waves', { name: 'Chapter 3: Waves' })).toMatchObject({ kind: 'found', command: 'note.open', input: { note: 'Chapter 3: Waves' } })
    expect(await found('video', 'start', { seconds: '120' })).toBe('video.playFrom')
    // Words that are only the values given are no operation: "ask" was mode=ask's, read as ai.send's verb.
    const ask = await route('ai', 'ask', { mode: 'ask' })
    expect(ask.kind === 'unclear' && ask.options).toEqual(expect.arrayContaining(['ai.open', 'ai.send']))
    expect(await found('pen', 'pencil', { kind: 'pencil' })).toBe('pen.set')
    // An input of a short list decides alone only with a value on the list: option=look is none of settings.pen's.
    const look = await route('settings', 'open them look light mine', { option: 'look', value: 'light', scope: 'mine' })
    expect(look.kind === 'found' ? look.command : look.kind).not.toBe('settings.pen')
    // A value given by name is no word of the operation: one verb, whatever the name's length.
    expect(await found('video', 'remove But what is a neural network?', { video: 'But what is a neural network?' })).toBe('video.remove')
    // A switch said with the verb counts for the commands that take one: never video.seek's "set the time".
    expect(await found('video', 'set times off')).not.toBe('video.seek')
    expect(await found('video', 'turn the times off')).toBe('video.times')
    // The area's own name never a verb ("settings" has the root of "set"), nor "open" a switch's on.
    expect(await found('settings', 'open the settings')).toBe('settings.open')
    // No verb: every command of the area offered, not only those taking the inputs.
    const bare = await route('panel', 'side', { on: 'off' })
    expect(bare.kind === 'unclear' && bare.options).toEqual(expect.arrayContaining(['panel.hide', 'panel.show', 'panel.full']))
  })

  it('reads what the latest agent runs failed on, where it has one meaning', async () => {
    const line = async (text: string) => {
      const parsed = parseLine(text)
      if (parsed.kind !== 'area') return parsed.kind
      const routed = await route(parsed.area, parsed.words, parsed.given)
      return routed.kind === 'found' ? { command: routed.command, input: routed.input, missing: routed.missing } : routed.kind
    }
    // A number only one command of the area takes says which; a switch still never does.
    expect(await line('screen: page=2')).toEqual({ command: 'screen.page', input: { page: 2 }, missing: [] })
    expect(await line('select: page=1 x=100 y=200 w=150 h=50')).toMatchObject({ command: 'select.area', missing: [] })
    expect(await line('timer: minutes=10')).toBe('unclear')
    expect(await line('video: on=off')).toBe('unclear')
    // name= for the thing a command acts on, when it takes no new name and one such thing.
    expect(await line('folder: delete name="Temp"')).toMatchObject({ command: 'folder.delete', input: { folder: 'Temp' } })
    expect(await line('folder: rename name="Physics" into="Optics"')).toBe('unclear')
    // The words the verb leaves, for the one input still needed that is written in, never one chosen from a list.
    expect(await line('video: remove YouTube aircAruvnKk')).toEqual({ command: 'video.remove', input: { video: 'aircAruvnKk' }, missing: [] })
    expect(await line('video: remove it')).toMatchObject({ command: 'video.remove', missing: ['video'] })
    expect(await line('tool: use a red pencil')).toMatchObject({ missing: ['tool'] })
    expect(await line('bar: place=top')).toMatchObject({ command: 'bar.place', missing: ['bar'] })
  })

  it('reads the three misses of the day\'s 458 lines that have one meaning', async () => {
    const line = async (text: string) => {
      const parsed = parseLine(text)
      if (parsed.kind !== 'area') return parsed.kind
      const routed = await route(parsed.area, parsed.words, parsed.given)
      return routed.kind === 'found' ? { command: routed.command, input: routed.input, missing: routed.missing } : routed.kind
    }
    // Another area's command named by its own phrase whole: full view is the panel's.
    expect(await line('screen: full view on=on')).toMatchObject({ command: 'panel.full', input: { on: true } })
    // Not when the words are one word, or fit more than one command elsewhere.
    expect(await line('chat: open chat')).toBe('unclear')
    // An area of one command, whatever the line's length.
    expect(await line('eraser: whole strokes and medium size')).toEqual({ command: 'eraser.set', input: { erase: 'whole', size: 'medium' }, missing: [] })
    // into folder=Physics is the folder put into.
    expect(await line('note: move note=Optics into folder=Physics')).toEqual({ command: 'note.move', input: { note: 'Optics', into: 'Physics' }, missing: [] })
    expect(parseLine('note.move note=Optics into the folder="Unit 2"')).toEqual({ kind: 'command', name: 'note.move', input: { note: 'Optics', into: 'Unit 2' } })
  })

  it("runs an operation of a sibling note area, when only one has it", async () => {
    expect(await route('text', 'remove', { block: 'p2' })).toMatchObject({ kind: 'found', command: 'block.remove', input: { block: 'p2' } })
    expect(await route('text', 'add', { style: 'bullet', after: 'qt', words: 'crest' })).toMatchObject({ kind: 'found', command: 'list.add' })
    expect(await route('list', 'move', { block: 'l1', after: 'p1' })).toMatchObject({ kind: 'found', command: 'block.move' })
    // An app area keeps its own way: no sibling there.
    expect((await route('pen', 'remove', { block: 'p2' })).kind).not.toBe('found')
  })

  it('runs a recipe named as a role, and shows a page named alone in the page area (the note test, 25 October 2026)', async () => {
    expect(await route('text', 'add', { role: 'summary', at: 'end', words: 'a\nb' })).toMatchObject({ kind: 'found', command: 'recipe.summary', input: { at: 'end', words: 'a\nb' } })
    expect(await route('text', 'add', { role: 'qa', after: 'qt' })).toMatchObject({ kind: 'found', command: 'recipe.qa', missing: ['words'] })
    expect(await route('page', '1', { page: '1' })).toMatchObject({ kind: 'found', command: 'screen.page', input: { page: 1 } })
    expect(await route('page', 'look 3', { page: '3' })).toMatchObject({ kind: 'found', command: 'screen.page' })
    expect((await route('page', 'remove', { page: '3' })).kind === 'found' && (await route('page', 'remove', { page: '3' }) as { command: string }).command).toBe('page.remove')
  })

  it('says so for an area that is none', async () => {
    expect(await route('banana', 'peel')).toEqual({ kind: 'no-area', given: 'banana' })
  })

  it('offers instead of running for a long sentence that names verbs in passing', async () => {
    const routed = await route('note', 'if the file updates from another device can I still edit my current draft without losing work')
    expect(routed.kind).toBe('unclear')
  })
})

describe('the operations on the instruction page', () => {
  it('each finds its own command, written as the page gives it, bare and with its inputs, never unsure', async () => {
    const value = (v: unknown): string => (Array.isArray(v) ? `[${v.join(',')}]` : typeof v === 'string' && /[\s:]/u.test(v) ? JSON.stringify(v) : String(v))
    const missed: string[] = []
    for (const spec of COMMANDS) {
      const area = spec.name.split('.')[0]!
      const inputs = Object.entries(spec.example).map(([field, v]) => `${field}=${value(v)}`)
      for (const line of [`${area}: ${operationOf(spec.name)}`, [`${area}: ${operationOf(spec.name)}`, ...inputs].join(' ')]) {
        const parsed = parseLine(line)
        const routed = parsed.kind === 'area' ? await route(parsed.area, parsed.words, parsed.given) : undefined
        if (routed?.kind !== 'found' || routed.command !== spec.name) missed.push(`${line} => ${routed?.kind === 'found' ? routed.command : (routed?.kind ?? parsed.kind)}`)
      }
    }
    expect(missed).toEqual([])
  })
})

describe('the line', () => {
  it('reads area: words field=value, and area | words | field=value, the area said its own way', () => {
    expect(parseLine('video: play from seconds=120')).toEqual({ kind: 'area', area: 'video', words: 'play from 120', given: { seconds: '120' } })
    expect(parseLine('video | play from | seconds=120')).toEqual({ kind: 'area', area: 'video', words: 'play from', given: { seconds: '120' } })
    expect(parseLine('trash: empty')).toEqual({ kind: 'area', area: 'trash', words: 'empty', given: {} })
    expect(parseLine('do pen: use a red pencil')).toEqual({ kind: 'area', area: 'pen', words: 'use a red pencil', given: {} })
  })

  it("keeps the terminal's own words its own with a colon, and takes any other one word for an area to be told of", () => {
    expect(parseLine('done: a red pencil')).toEqual({ kind: 'done', summary: 'a red pencil' })
    expect(parseLine('look:')).toEqual({ kind: 'look' })
    expect(parseLine('banana: peel')).toEqual({ kind: 'area', area: 'banana', words: 'peel', given: {} })
  })

  it("reads a command's name with a colon after it as the command", () => {
    expect(parseLine('select.area: page=1 x=100 y=200 w=150 h=50')).toEqual({ kind: 'command', name: 'select.area', input: { page: '1', x: '100', y: '200', w: '150', h: '50' } })
  })

  it('leaves a line that starts with no area as it was', () => {
    expect(parseLine('go to 1:30 in the video')).toEqual({ kind: 'do', words: 'go to 1:30 in the video' })
    expect(parseLine('pen.set kind=pencil')).toMatchObject({ kind: 'command', name: 'pen.set' })
  })
})
