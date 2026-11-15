// What the command box needs of the commands: how it asks for each input a command cannot do without, and the finder's
// list of the commands nearest some words, best first.
import { describe, expect, it } from 'vitest'
import { APP_COMMANDS } from '../../src/command/app.js'
import { Finder } from '../../src/command/finder.js'
import { asksOf } from '../../src/command/spec.js'

const spec = (name: string) => APP_COMMANDS.find((one) => one.name === name)!

describe('what the command box asks for', () => {
  it('a choice, a switch or words: the inputs a command cannot do without, in order', () => {
    expect(asksOf(spec('settings.theme'))).toEqual([{ field: 'look', kind: 'choice', values: ['system', 'light', 'dark'] }])
    expect(asksOf(spec('settings.paper'))).toEqual([{ field: 'on', kind: 'switch' }])
    expect(asksOf(spec('note.rename'))).toEqual([{ field: 'name', kind: 'words' }])
    expect(asksOf(spec('layout.look'))).toEqual([{ field: 'shell', kind: 'choice', values: ['flat', 'islands', 'dock'] }])
  })

  it('nothing to ask for a command that needs nothing', () => {
    expect(asksOf(spec('library.open'))).toEqual([])
    expect(asksOf(spec('layout.reset'))).toEqual([])
  })

  it('no way to ask for an input a box cannot hold: the command is not offered there', () => {
    expect(asksOf(spec('folder.rename'))).toBeUndefined()
  })
})

describe("the finder's nearest commands", () => {
  const finder = new Finder(APP_COMMANDS)

  it('ranks what is near some words, best first, with the inputs the words give', () => {
    const near = finder.nearest('make the paper dark')
    expect(near[0]?.command).toBe('settings.paper')
    expect(finder.nearest('switch to the dock layout')[0]).toMatchObject({ command: 'layout.look', input: { shell: 'dock' } })
  })

  it('gives no more than it is asked for, and nothing for words of no command', () => {
    expect(finder.nearest('open the settings', 2).length).toBeLessThanOrEqual(2)
    expect(finder.nearest('banana')).toEqual([])
  })
})
