// The app's commands are well formed: area.verb names, inputs only from the
// shared vocabulary (a field means the same everywhere), examples that
// pass their own checks, every way of saying a command finds it, and what cannot
// be undone asks first.
import { describe, expect, it } from 'vitest'
import { APP_COMMANDS, APP_LIMITS } from '../../src/command/app.js'
import { Finder } from '../../src/command/finder.js'
import { bare, checkInput, COMMAND_NAME, describe as describeCommand, FIELDS, isNumber, valuesOf } from '../../src/command/spec.js'
import type { z } from 'zod'

const shapeOf = (name: string): Record<string, z.ZodType> => APP_COMMANDS.find((spec) => spec.name === name)!.input.shape as Record<string, z.ZodType>

describe('the app commands', () => {
  it('are named area.verb, each once', () => {
    const names = APP_COMMANDS.map((spec) => spec.name)
    for (const name of names) expect(name).toMatch(COMMAND_NAME)
    expect(new Set(names).size).toBe(names.length)
  })

  it('take only fields of the shared vocabulary, each the vocabulary’s own', () => {
    for (const spec of APP_COMMANDS) {
      for (const [field, schema] of Object.entries(spec.input.shape as Record<string, z.ZodType>)) {
        expect(Object.keys(FIELDS), `${spec.name}.${field}`).toContain(field)
        expect(bare(schema), `${spec.name}.${field}`).toBe(FIELDS[field as keyof typeof FIELDS])
      }
    }
  })

  it('give an example that passes their own check, and refuse a field they do not have', () => {
    for (const spec of APP_COMMANDS) {
      expect(spec.input.safeParse(spec.example).success, spec.name).toBe(true)
      expect(spec.input.safeParse({ ...spec.example, nonsense: 1 }).success, spec.name).toBe(false)
    }
  })

  it('are said at least three ways, each {field} one of theirs that a word can fill', () => {
    for (const spec of APP_COMMANDS) {
      expect(spec.says.length, spec.name).toBeGreaterThanOrEqual(3)
      for (const text of spec.says) {
        for (const [, field] of text.matchAll(/\{([a-z]+)\}/gu)) {
          const schema = shapeOf(spec.name)[field!]
          expect(schema, `${spec.name}: "${text}"`).toBeDefined()
          expect(valuesOf(schema!) !== undefined || isNumber(schema!), `${spec.name}: "${text}"`).toBe(true)
        }
      }
    }
  })

  it('are each found from every way they are said, an example in each {field}', () => {
    const finder = new Finder(APP_COMMANDS, APP_LIMITS)
    for (const spec of APP_COMMANDS) {
      const shape = shapeOf(spec.name)
      for (const text of spec.says) {
        const said = text.replace(/\{([a-z]+)\}/gu, (_, field: string) => String(spec.example[field] ?? valuesOf(shape[field]!)?.[0] ?? 2))
        const result = finder.findNow(said)
        expect(result.kind === 'found' && result.command, `"${said}"`).toBe(spec.name)
      }
    }
    // Every way of saying every command: about 3 s alone, longer while the other test files run beside it.
  }, 15_000)

  it('ask first exactly when they cannot be undone', () => {
    const asking = APP_COMMANDS.filter((spec) => spec.asks).map((spec) => spec.name)
    expect(asking.sort()).toEqual(['ai.send', 'bin.deleteForever', 'bin.empty', 'chat.send', 'file.saveAs', 'pen.forget', 'web.open'])
  })

  it("put under high review exactly the agent using the app's own AI, each saying why", () => {
    const watched = APP_COMMANDS.filter((spec) => spec.review !== undefined)
    expect(watched.map((spec) => spec.name).sort()).toEqual(['ai.send', 'chat.send'])
    for (const spec of watched) expect(spec.review).toMatch(/the app's own AI/u)
  })

  it('are described to the model with their inputs as JSON Schema', () => {
    const shown = describeCommand(APP_COMMANDS.find((spec) => spec.name === 'pen.set')!)
    expect(shown.command).toBe('pen.set')
    expect(shown.input).toMatchObject({ type: 'object', properties: { kind: { enum: ['pen', 'pencil', 'fountain', 'marker'] } } })
    expect(shown.example).toEqual({ kind: 'pencil', colour: 'blue', width: 'fine' })
  })

  it('have limits each said three ways or more, with a reason', () => {
    for (const limit of APP_LIMITS) {
      expect(limit.says.length).toBeGreaterThanOrEqual(3)
      expect(limit.why.length).toBeGreaterThan(10)
    }
  })
})

// For security, no command ever controls the program panel: other programs on a panel stay the person's, and no
// command opens, moves or acts on that panel.
describe('no command reaches the program panel', () => {
  it('no command is named for it or for other programs', () => {
    expect(APP_COMMANDS.filter((spec) => /^(program|apps?)\./u.test(spec.name)).map((spec) => spec.name)).toEqual([])
  })
  it('no input can name it', () => {
    for (const [field, schema] of Object.entries(FIELDS)) expect(valuesOf(schema) ?? [], field).not.toContain('program')
  })
  it('full view refuses it', () => {
    const full = APP_COMMANDS.find((spec) => spec.name === 'panel.full')!
    expect(checkInput(full, { pane: 'program' }).ok).toBe(false)
    expect(checkInput(full, { pane: 'video' }).ok).toBe(true)
  })
})
