// No call to the model at all: a request the finder knows word for word, for a command that only changes
// the view or the tools, runs by code; anything else goes to the model.
import { describe, expect, it } from 'vitest'
import { ALONE, aloneOf } from '../../src/command/alone.js'
import { APP_COMMANDS, APP_LIMITS } from '../../src/command/app.js'
import { Finder } from '../../src/command/finder.js'

const finder = new Finder(APP_COMMANDS, APP_LIMITS)

describe('a request run by the app alone', () => {
  it('is one the finder knows word for word, its values in their places', () => {
    expect(aloneOf(finder, 'Pick the eraser.')).toEqual({ command: 'tool.choose', input: { tool: 'eraser' } })
    expect(aloneOf(finder, 'Put the format bar on the left.')).toEqual({ command: 'bar.place', input: { bar: 'format', place: 'left' } })
    expect(aloneOf(finder, 'Go to page 2.')).toEqual({ command: 'screen.page', input: { page: 2 } })
  })

  it('never when a word is left unexplained, or two steps are asked (the agent test, 24 October 2026)', () => {
    // Matched by letters, not word for word: "thick" was not read, "Old" is no word of note.delete's.
    expect(aloneOf(finder, 'Change my pen to thick purple.')).toBeUndefined()
    expect(aloneOf(finder, 'Delete the Old note.')).toBeUndefined()
    expect(aloneOf(finder, 'Switch to a red marker and go full screen.')).toBeUndefined()
  })

  it('never for a command that changes a note, the library, a file or the history, however it matches', () => {
    // Word for word, and wrong, on the requests Gemma 4 E4B wrote: "Deleted notes" is not note.delete.
    expect(aloneOf(finder, 'Deleted notes')).toBeUndefined()
    expect(aloneOf(finder, 'Undo my undo')).toBeUndefined()
    expect(aloneOf(finder, 'Make a new note called Waves.')).toBeUndefined()
    for (const name of ['note.delete', 'note.new', 'folder.delete', 'edit.undo', 'bin.empty', 'file.save', 'ai.send', 'pen.forget', 'video.remove']) expect(ALONE.has(name), name).toBe(false)
    for (const name of ALONE) expect(APP_COMMANDS.some((spec) => spec.name === name), name).toBe(true)
  })

  it('never for a question, words put into the note, or what the app cannot do', () => {
    expect(aloneOf(finder, 'Is the side panel open?')).toBeUndefined()
    expect(aloneOf(finder, "Write 'hello world' at the top of this note.")).toBeUndefined()
    expect(aloneOf(finder, 'Set my API key.')).toBeUndefined()
  })
})
