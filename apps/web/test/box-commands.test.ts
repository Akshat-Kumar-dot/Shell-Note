// The command box's own list: every command whose inputs the box can ask for is named there, by a name of its own and
// an icon, or left out on purpose with the reason; each choice a line makes is one its command takes.
import { asksOf, COMMANDS, valuesOf } from '@shellnote/core'
import { describe, expect, it } from 'vitest'
import { BOX, linesOf, NOT_IN_THE_BOX } from '../src/shell/boxCommands.js'

type Field = Parameters<typeof valuesOf>[0]
const byName = new Map(COMMANDS.map((spec) => [spec.name, spec]))
const shapeOf = (name: string): Record<string, Field> => (byName.get(name)?.input.shape ?? {}) as Record<string, Field>
/** The commands whose inputs the box can ask a person for. */
const askable = COMMANDS.filter((spec) => asksOf(spec) !== undefined).map((spec) => spec.name)
const named = Object.keys(BOX)

describe("the command box's list", () => {
  it('names every command whose inputs it can ask for, or leaves it out on purpose', () => {
    expect(askable.filter((name) => !(name in BOX) && !(name in NOT_IN_THE_BOX))).toEqual([])
  })

  it('names only commands the app has and the box can ask the inputs of, each on one list', () => {
    expect(named.filter((name) => !askable.includes(name))).toEqual([])
    expect(Object.keys(NOT_IN_THE_BOX).filter((name) => !byName.has(name))).toEqual([])
    expect(named.filter((name) => name in NOT_IN_THE_BOX)).toEqual([])
  })

  it('gives each line a name of its own and an icon', () => {
    const titles = named.flatMap((name) => linesOf(name).map((line) => line.title))
    expect(titles.filter((title, index) => titles.indexOf(title) !== index)).toEqual([])
    for (const name of named) {
      expect(linesOf(name).length, name).toBeGreaterThan(0)
      for (const line of linesOf(name)) {
        expect(line.title.trim(), name).not.toBe('')
        expect(line.icon, line.title).toBeTruthy()
      }
    }
  })

  it('makes only choices its command takes, and narrows a list only to its own values', () => {
    for (const name of named) {
      const shape = shapeOf(name)
      for (const line of linesOf(name)) {
        for (const [field, value] of Object.entries(line.input ?? {})) {
          const schema = shape[field]
          expect(schema, `${line.title}: ${field}`).toBeDefined()
          if (schema) expect(schema.safeParse(value).success, `${line.title}: ${field} = ${String(value)}`).toBe(true)
        }
        for (const [field, values] of Object.entries(line.values ?? {})) {
          const schema = shape[field]
          const own = schema ? (valuesOf(schema) ?? []) : []
          expect(values.length, `${line.title}: ${field}`).toBeGreaterThan(0)
          expect(values.filter((value) => !own.includes(value)), `${line.title}: ${field}`).toEqual([])
        }
      }
    }
  })

  it('says why it leaves each one out', () => {
    for (const [name, why] of Object.entries(NOT_IN_THE_BOX)) expect(why.trim(), name).not.toBe('')
  })
})
