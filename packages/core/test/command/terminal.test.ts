// The terminal's language: blocks, lines and where each goes, inputs as written.
import { describe, expect, it } from 'vitest'
import { APP_COMMANDS } from '../../src/command/app.js'
import { argsOf, blocksOf, exampleLine, linesOf, parseLine, POSITIONAL, stepsOf, terminalGuide, typed } from '../../src/command/terminal.js'

const spec = (name: string) => APP_COMMANDS.find((command) => command.name === name)!

describe("a model's reply", () => {
  it('runs only what is inside ```wn blocks, in order', () => {
    const reply = 'I will do it.\n```wn\npen.set kind=pencil\n\n# a note\nlook\n```\nthen\n```wn\nedit.undo\n```\n```js\nalert(1)\n```'
    const { blocks, unclosed } = blocksOf(reply)
    expect(unclosed).toBe(false)
    expect(blocks.map(linesOf)).toEqual([['pen.set kind=pencil', 'look'], ['edit.undo']])
  })

  it('opens a block written ```WN or ``` wn, as small models write it, and nothing else', () => {
    expect(blocksOf('```WN\ntool.choose tool=pen\n```').blocks).toEqual([['tool.choose tool=pen']])
    expect(blocksOf('``` wn \ntool.choose tool=pen\n```').blocks).toEqual([['tool.choose tool=pen']])
    expect(blocksOf('```wnx\ntool.choose tool=pen\n```').blocks).toEqual([])
    expect(blocksOf('```js\ntool.choose tool=pen\n```').blocks).toEqual([])
  })

  it('gives a text or list line the words under it, up to end, as written: nothing in them read as a line', () => {
    const block = ['text: add heading after="the second paragraph" level=2', "  Newton's laws", 'end', 'text: rewrite block=p3', 'He said "go", then `stop`.', '', 'pen: use a red pencil', 'done the end', 'END', 'pen: use a blue pencil', 'done wrote them']
    expect(stepsOf(block)).toEqual([
      { line: 'text: add heading after="the second paragraph" level=2', words: "Newton's laws" },
      { line: 'text: rewrite block=p3', words: 'He said "go", then `stop`.\n\npen: use a red pencil\ndone the end' },
      { line: 'pen: use a blue pencil' },
      { line: 'done wrote them' },
    ])
    // A line of another area never takes words; one of a word area with no end after it takes none.
    expect(stepsOf(['pen: use a red pencil', 'end'])).toEqual([{ line: 'pen: use a red pencil' }, { line: 'end' }])
    expect(stepsOf(['text: look block=p2 size=l', 'done'])).toEqual([{ line: 'text: look block=p2 size=l' }, { line: 'done' }])
    expect(parseLine('end')).toMatchObject({ kind: 'wrong' })
  })

  it('reads the words lines as the person\'s models wrote them: no end, the page\'s +words copied, words in quotes', () => {
    // Qwen3-VL-8B, the note check of 24 October 2026: the words, then done, no end.
    expect(stepsOf(['text: add role=paragraph after=p2', 'Waves can reflect off walls.', 'done added a paragraph'])).toEqual([
      { line: 'text: add role=paragraph after=p2', words: 'Waves can reflect off walls.' },
      { line: 'done added a paragraph' },
    ])
    // Two lines with words, neither with an end: each its own, the next line taking words ending the first's.
    expect(stepsOf(['text: add role=heading after=p2', 'Summary', 'list: add after=$1', 'crest', 'trough', 'done'])).toEqual([
      { line: 'text: add role=heading after=p2', words: 'Summary' },
      { line: 'list: add after=$1', words: 'crest\ntrough' },
      { line: 'done' },
    ])
    // An end belongs to its own line: never one after the next line that takes words.
    expect(stepsOf(['text: add at=top', 'One', 'list: add after=$1', 'two', 'end'])).toEqual([
      { line: 'text: add at=top', words: 'One' },
      { line: 'list: add after=$1', words: 'two' },
    ])
    // Gemma 4 E4B: the page's +words on the line, with the words after it, or inputs after it.
    expect(stepsOf(['text: rewrite block=h1 +words Chapter 3: Waves and Sound', 'done'])).toEqual([{ line: 'text: rewrite block=h1', words: 'Chapter 3: Waves and Sound' }, { line: 'done' }])
    expect(stepsOf(['list: add +words style=todo after="p1"', 'Buy batteries', 'Test the speaker', 'done'])).toEqual([{ line: 'list: add style=todo after="p1"', words: 'Buy batteries\nTest the speaker' }, { line: 'done' }])
    expect(stepsOf(['list: add item +words Light [after=l1]'])).toEqual([{ line: 'list: add item [after=l1]', words: 'Light' }])
    // Qwen3-VL-8B, the rerun: +words written as a field.
    expect(stepsOf(['text: rewrite block=h1 +words="Chapter 3: Waves and Sound"', 'done'])).toEqual([{ line: 'text: rewrite block=h1', words: 'Chapter 3: Waves and Sound' }, { line: 'done' }])
    // Words in quotes after the inputs, with no field before them.
    expect(stepsOf(['text: rewrite block=p1 "Waves carry energy, not matter."', 'done'])).toEqual([{ line: 'text: rewrite block=p1', words: 'Waves carry energy, not matter.' }, { line: 'done' }])
    expect(stepsOf(['text: add after="the second paragraph"', 'end'])).toEqual([{ line: 'text: add after="the second paragraph"', words: '' }])
    // A line of the terminal's own after a line that takes no words is never words.
    expect(stepsOf(['text: look block=h1 colour=red', 'screen: zoom percent=150', 'done'])).toEqual([{ line: 'text: look block=h1 colour=red' }, { line: 'screen: zoom percent=150' }, { line: 'done' }])
  })

  it('reads content written on the line after its inputs, and words in quotes after +words whole (round 2 of the note test)', () => {
    // Gemma 4 E4B and Qwen3-VL-8B, round 1: the x=1 inside the LaTeX is no input.
    expect(stepsOf(['maths: rewrite block=mc \\sum_{x=1}^{20} x', 'done'])).toEqual([{ line: 'maths: rewrite block=mc', words: '\\sum_{x=1}^{20} x' }, { line: 'done' }])
    expect(stepsOf(['maths: rewrite block=mc +words "\\sum_{x=1}^{20} x"', 'done'])).toEqual([{ line: 'maths: rewrite block=mc', words: '\\sum_{x=1}^{20} x' }, { line: 'done' }])
    expect(stepsOf(['table: add row block=t1 | Water | 1480 m/s |'])).toEqual([{ line: 'table: add row block=t1', words: '| Water | 1480 m/s |' }])
    // An inputs-only line, and inputs written as JSON, stay as they are.
    expect(stepsOf(['table: style block=t1 design=banded'])).toEqual([{ line: 'table: style block=t1 design=banded' }])
    // Never read so that something else runs (round 2's measure): junk before the content, or an input after it.
    expect(stepsOf(['maths: add +KE = 1/2 m v^2 after=p1'])[0]!.words).not.toBe('v^2 after=p1')
    expect(stepsOf(['maths: add after=p1 E = mc^2 page=1'])).toEqual([{ line: 'maths: add after=p1 E = mc^2 page=1' }])
    // block X: … is not read as block=X: block t1: remove the row with "Light" took the whole table away.
    expect(parseLine('block t1: remove the row with "Light"')).not.toMatchObject({ given: { block: 't1' } })
  })

  it('reads a fence written inside a block, under a line that takes words, as those words (step 3)', () => {
    const reply = '```wn\ndiagram: add after=p2\n```mermaid\nflowchart LR\n  A --> B\n```\nend\ndone a flowchart\n```\nAfter the block.'
    const { blocks, unclosed } = blocksOf(reply)
    expect(unclosed).toBe(false)
    expect(blocks).toHaveLength(1)
    expect(stepsOf(blocks[0]!)).toEqual([{ line: 'diagram: add after=p2', words: 'flowchart LR\nA --> B' }, { line: 'done a flowchart' }])
    // With no end after the fence: the words still end at done.
    expect(stepsOf(blocksOf('```wn\nmaths: add after=p2\n```latex\nE = mc^2\n```\ndone\n```').blocks[0]!)).toEqual([{ line: 'maths: add after=p2', words: 'E = mc^2' }, { line: 'done' }])
    // A fence after a line that takes no words still ends the block.
    expect(blocksOf('```wn\npen: use a red pencil\n```js\nalert(1)\n```').blocks).toEqual([['pen: use a red pencil']])
    // The area said in its own words takes words too.
    expect(stepsOf(['formula: add after=p2', 'F = ma', 'end'])).toEqual([{ line: 'formula: add after=p2', words: 'F = ma' }])
  })

  it('runs nothing from a block never closed, and says so', () => {
    expect(blocksOf('```wn\npen.set kind=pencil')).toEqual({ blocks: [], unclosed: true })
  })

  it('takes a done written after a line\'s inputs for a done line of its own, and only there', () => {
    expect(linesOf(['chat: make=table put=pad done set the chat to tables'])).toEqual(['chat: make=table put=pad', 'done set the chat to tables'])
    expect(linesOf(['settings: open them option=look value=dark done switched to dark'])).toEqual(['settings: open them option=look value=dark', 'done switched to dark'])
    expect(linesOf(['note: rename name="done list"'])).toEqual(['note: rename name="done list"'])
    expect(linesOf(['note: mark as done'])).toEqual(['note: mark as done'])
    expect(linesOf(['done set it, then done'])).toEqual(['done set it, then done'])
  })

  it('runs a block left open after its done line: the model ended there, nothing was cut off', () => {
    expect(blocksOf('```wn\nnote: make a new note name="Waves"\ndone made the note Waves\n')).toEqual({ blocks: [['note: make a new note name="Waves"', 'done made the note Waves', '']], unclosed: false })
    expect(blocksOf('```wn\ndone made it\npen.set kind=pen')).toMatchObject({ blocks: [], unclosed: true })
  })
})

describe('a line', () => {
  it('goes where its first word says', () => {
    expect(parseLine('find open a new note')).toEqual({ kind: 'find', words: 'open a new note' })
    expect(parseLine('do use a blue pencil')).toEqual({ kind: 'do', words: 'use a blue pencil' })
    expect(parseLine('look')).toEqual({ kind: 'look' })
    // The page as text (note control, step 1): the page in view, or the one named.
    expect(parseLine('look page')).toEqual({ kind: 'look', page: 'view' })
    expect(parseLine('look page 2')).toEqual({ kind: 'look', page: 2 })
    expect(parseLine('look: page 2')).toEqual({ kind: 'look', page: 2 })
    expect(parseLine('block b3')).toEqual({ kind: 'block', id: 'b3' })
    // block is an area too since note control's step 2: with a colon, or more than an id, it is the area's line.
    expect(parseLine('block: move block=p2 before=p1')).toMatchObject({ kind: 'area', area: 'block', given: { block: 'p2', before: 'p1' } })
    expect(parseLine('block remove block=p2')).toMatchObject({ kind: 'area', area: 'block' })
    expect(parseLine('blocks')).toEqual({ kind: 'blocks' })
    expect(parseLine('blocks 2')).toEqual({ kind: 'blocks', page: 2 })
    expect(parseLine('blocks two')).toMatchObject({ kind: 'wrong' })
    expect(parseLine('op {"op":"remove","id":"b3"}')).toEqual({ kind: 'op', op: { op: 'remove', id: 'b3' } })
    expect(parseLine('pen.set kind=pencil colour=blue')).toEqual({ kind: 'command', name: 'pen.set', input: { kind: 'pencil', colour: 'blue' } })
    expect(parseLine('use a blue pencil')).toEqual({ kind: 'do', words: 'use a blue pencil' })
  })

  it('says what is wrong with a line it cannot read', () => {
    expect(parseLine('find')).toMatchObject({ kind: 'wrong' })
    expect(parseLine('op {not json')).toMatchObject({ kind: 'wrong' })
    expect(parseLine('note.rename name="unclosed')).toMatchObject({ kind: 'wrong' })
  })
})

describe('lines as the person\'s models wrote them', () => {
  it('a command after do runs as that command, not as plain words', () => {
    expect(parseLine('do folder.new name=Physics')).toEqual({ kind: 'command', name: 'folder.new', input: { name: 'Physics' } })
    expect(parseLine('do note.close')).toEqual({ kind: 'command', name: 'note.close', input: {} })
  })

  it('reads a command written as a call: empty, field=value pairs between commas, or an object as JSON or JavaScript writes it', () => {
    expect(parseLine('note.close()')).toEqual({ kind: 'command', name: 'note.close', input: {} })
    expect(parseLine('note.new(name="Waves", into="Physics")')).toEqual({ kind: 'command', name: 'note.new', input: { name: 'Waves', into: 'Physics' } })
    expect(parseLine("note.new(name='Unit 2, part one')")).toEqual({ kind: 'command', name: 'note.new', input: { name: 'Unit 2, part one' } })
    expect(parseLine('tool.choose({ tool: "pen" })')).toEqual({ kind: 'command', name: 'tool.choose', input: { tool: 'pen' } })
    expect(parseLine("pen.set({kind: 'pencil', colour: 'red'})")).toEqual({ kind: 'command', name: 'pen.set', input: { kind: 'pencil', colour: 'red' } })
    expect(parseLine('select.blocks(blocks=[b1, t4])')).toEqual({ kind: 'command', name: 'select.blocks', input: { blocks: ['b1', 't4'] } })
  })

  it('takes fields given by name among plain words as written, the words keeping their values for the finder', () => {
    expect(parseLine('do set pen colour=red kind=pencil')).toEqual({ kind: 'do', words: 'set pen red pencil', given: { colour: 'red', kind: 'pencil' } })
    // Not a field: left in the words as written.
    expect(parseLine('do zoom=150')).toEqual({ kind: 'do', words: 'zoom=150' })
  })

  it("reads the page's own [field=value], copied as written, as field=value; a list given as a value, and quoted words, as they were", () => {
    expect(parseLine('screen: zoom [percent=90]')).toEqual({ kind: 'area', area: 'screen', words: 'zoom 90', given: { percent: '90' } })
    expect(parseLine('library: sort[by=created][order=newest]')).toMatchObject({ kind: 'area', given: { by: 'created', order: 'newest' } })
    expect(parseLine('note.rename name="Waves, revised" [note=AKLTJcPc]')).toEqual({ kind: 'command', name: 'note.rename', input: { name: 'Waves, revised', note: 'AKLTJcPc' } })
    expect(parseLine('select.blocks blocks=[b1, t4]')).toEqual({ kind: 'command', name: 'select.blocks', input: { blocks: ['b1', 't4'] } })
    expect(parseLine('note.rename name="Plan [a=b]"')).toEqual({ kind: 'command', name: 'note.rename', input: { name: 'Plan [a=b]' } })
  })

  it('reads an area written without its colon as its line, with the plain words kept for when the area is not sure', () => {
    expect(parseLine('video add link=https://www.youtube.com/watch?v=aircAruvnKk')).toEqual({
      kind: 'area',
      area: 'video',
      words: 'add https://www.youtube.com/watch?v=aircAruvnKk',
      given: { link: 'https://www.youtube.com/watch?v=aircAruvnKk' },
      loose: { words: 'video add https://www.youtube.com/watch?v=aircAruvnKk', given: { link: 'https://www.youtube.com/watch?v=aircAruvnKk' } },
    })
    // The area said in its own words, as zoom is the screen's; a line whose first word is no area stays plain words.
    expect(parseLine('zoom [percent=100]')).toMatchObject({ kind: 'area', area: 'zoom', given: { percent: '100' } })
    expect(parseLine('use a blue pencil')).toEqual({ kind: 'do', words: 'use a blue pencil' })
  })

  it("says that a description the terminal printed, copied back, is no line, and how to write it", () => {
    const copied = parseLine('note.open: Open a note · inputs: note (string) · write it as note.open note="Optics"')
    expect(copied).toMatchObject({ kind: 'wrong' })
    expect(copied.kind === 'wrong' && copied.why).toContain("the terminal's description of note.open, not a line")
    // Plain words after a command's name are kept as written, for the finder to read its inputs from.
    expect(parseLine('note.open: Open the note "Chapter 3: Waves"')).toMatchObject({ kind: 'command', name: 'note.open', written: 'Open the note "Chapter 3: Waves"' })
  })

  it("reads a field's list of values with one of them in it as that value, each other value its own field's; never which of a list is meant", () => {
    expect(typed(spec('bar.place'), { bar: 'tools|top' })).toEqual({ bar: 'tools', place: 'top' })
    expect(typed(spec('tool.choose'), { tool: 'select|free|pen' })).toEqual({ tool: 'select|free|pen' })
    expect(typed(spec('bar.place'), { bar: 'tools|format', place: 'top|left' })).toEqual({ bar: 'tools|format', place: 'top|left' })
    // A name is any words: never split.
    expect(typed(spec('note.rename'), { name: 'Pros|Cons' })).toEqual({ name: 'Pros|Cons' })
  })

  it('reads a switch written on, off, yes or no', () => {
    expect(typed(spec('screen.fullscreen'), { [POSITIONAL]: ['on'] })).toEqual({ on: true })
    expect(typed(spec('screen.fullscreen'), { on: 'off' })).toEqual({ on: false })
  })
})

describe('inputs as written', () => {
  it('reads key=value, quotes, lists and JSON', () => {
    expect(argsOf('name="Unit 2" blocks=[b1, t4] percent=150')).toEqual({ name: 'Unit 2', blocks: ['b1', 't4'], percent: '150' })
    // In single quotes too, as plain-word lines and calls read them (the review of 24 October 2026).
    expect(argsOf("name='Unit 2' into='Physics'")).toEqual({ name: 'Unit 2', into: 'Physics' })
    expect(argsOf("name=it's")).toEqual({ name: "it's" })
    // A list as JSON writes it, which a model often does, gives the same ids.
    expect(argsOf(`blocks=["b1", 't4']`)).toEqual({ blocks: ['b1', 't4'] })
    expect(argsOf('{"name": "Unit 2"}')).toEqual({ name: 'Unit 2' })
    expect(argsOf('{"name": ')).toMatch(/not valid JSON/u)
  })

  it('gives a value written alone the one field it can be', () => {
    expect(argsOf('eraser')).toEqual({ [POSITIONAL]: ['eraser'] })
    expect(argsOf('"eraser"')).toEqual({ [POSITIONAL]: ['eraser'] })
    expect(typed(spec('tool.choose'), { [POSITIONAL]: ['eraser'] })).toEqual({ tool: 'eraser' })
    expect(typed(spec('pen.set'), { [POSITIONAL]: ['marker', 'red'] })).toEqual({ kind: 'marker', colour: 'red' })
    expect(typed(spec('screen.page'), { [POSITIONAL]: ['3'] })).toEqual({ page: 3 })
    // Where it could be more than one field, it is left for the door to refuse.
    expect(typed(spec('note.rename'), { [POSITIONAL]: ['Waves'] })).toEqual({ [POSITIONAL]: ['Waves'] })
  })

  it('makes words the types their fields take', () => {
    expect(typed(spec('screen.zoom'), { percent: '150' })).toEqual({ percent: 150 })
    expect(typed(spec('screen.fullscreen'), { on: 'true' })).toEqual({ on: true })
    expect(typed(spec('select.blocks'), { blocks: 'b1,t4' })).toEqual({ blocks: ['b1', 't4'] })
  })

  it('writes a command from its example', () => {
    expect(exampleLine(spec('tool.choose'))).toBe('tool.choose tool=select')
    expect(exampleLine(spec('folder.new'))).toBe('folder.new name="Unit 2" into=Physics')
  })
})

describe('the instruction page', () => {
  it('names the areas, what each holds, and each operation with its inputs, never what each command does', () => {
    const guide = terminalGuide(APP_COMMANDS)
    expect(guide).toContain('```wn')
    expect(guide).toContain('<area>: <what to do> field=value')
    expect(guide).toMatch(/^video: a video beside the note.* · add link=… · show \[video=…\] · hide · .* · play from seconds=… \[video=…\] · .* · times on=on\|off · remove video=…$/mu)
    expect(guide).toContain('tool: ')
    expect(guide).toContain('choose tool=type|select|free|pen|highlighter|eraser')
    expect(guide).toContain('list blocks [page=…] · inspect block=…')
    // What each command does is not given: the operations' words find them.
    expect(guide).not.toContain('Choose the pen tool and its kind')
    expect(guide).toContain('pen: use a red pencil')
  })
})
