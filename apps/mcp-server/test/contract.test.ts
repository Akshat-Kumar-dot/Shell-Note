// The contract is written down in contract.json, and held: nothing an
// assistant may rely on is taken away or narrowed, and what is added is
// written down in the same change.
//
// After adding to the contract (a tool at the end, an argument that may be
// left out, a value, a guide topic), raise CONTRACT in src/guide.ts and write
// the file again:
//
//   UPDATE_CONTRACT=1 corepack pnpm exec vitest run apps/mcp-server/test/contract.test.ts
//
// It is written only when the change takes nothing away.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { breaks, contract, type Contract } from '../src/contract.js'

const FILE = fileURLToPath(new URL('../contract.json', import.meta.url))
const written = (value: Contract): string => `${JSON.stringify(value, null, 2)}\n`

describe('the contract', () => {
  const now = contract()
  if (process.env.UPDATE_CONTRACT && (!existsSync(FILE) || breaks(JSON.parse(readFileSync(FILE, 'utf8')) as Contract, now).length === 0)) writeFileSync(FILE, written(now))
  const kept = JSON.parse(readFileSync(FILE, 'utf8')) as Contract

  it('takes nothing away from what is written down', () => {
    expect(breaks(kept, now)).toEqual([])
  })

  it('is written down as it is now', () => {
    expect(written(now), 'contract.json is not what the server offers now: see the top of this file').toBe(written(kept))
  })

  it('lists its tools in one order, each with words and a shape, and stays small', () => {
    expect(now.tools.map((tool) => tool.name)).toEqual(['list_notes', 'read_outline', 'read_blocks', 'edit_note', 'get_guide', 'export_note'])
    for (const tool of now.tools) {
      expect(tool.name).toMatch(/^[a-z][a-z_]{2,40}$/u)
      expect(tool.description.length, tool.name).toBeGreaterThan(40)
      expect(tool.input).toMatchObject({ type: 'object', additionalProperties: false })
    }
    // Only edit_note changes anything.
    expect(now.tools.filter((tool) => !tool.readOnly).map((tool) => tool.name)).toEqual(['edit_note'])
    // Every conversation pays for these words: about 1,500 tokens at most.
    expect(JSON.stringify(now.tools).length).toBeLessThan(6000)
  })
})

describe('a change to the contract', () => {
  const base = contract()
  const changed = (change: (draft: Contract) => void): Contract => {
    const draft = structuredClone(base)
    change(draft)
    return draft
  }
  const tool = (draft: Contract, name: string) => draft.tools.find((each) => each.name === name)!
  const props = (draft: Contract, name: string) => tool(draft, name).input.properties as Record<string, Record<string, unknown>>

  it('may make words clearer', () => {
    expect(breaks(base, changed((draft) => (tool(draft, 'list_notes').description = 'Clearer words.')))).toEqual([])
    expect(breaks(base, changed((draft) => (draft.instructions = 'Clearer words.')))).toEqual([])
  })

  it('may add, with the number raised: a tool at the end, an argument that may be left out, a value, a topic', () => {
    const grown = changed((draft) => {
      draft.contract++
      draft.tools.push({ name: 'search_notes', title: 'Search', description: 'x', readOnly: true, input: { type: 'object', properties: {}, additionalProperties: false } })
      props(draft, 'list_notes').folder = { type: 'string' }
      ;(props(draft, 'export_note').format!.enum as string[]).push('docx')
      draft.topics.push('ink')
      props(draft, 'read_blocks').ids!.maxItems = 100
    })
    expect(breaks(base, grown)).toEqual([])
    // The same without raising the number is refused.
    expect(breaks(base, { ...grown, contract: base.contract }).join(' ')).toContain('raise CONTRACT')
  })

  it('may not take away, rename, move or narrow', () => {
    const refused: [string, (draft: Contract) => void][] = [
      ['taken away or renamed', (draft) => (tool(draft, 'read_outline').name = 'get_outline')],
      ['taken away or renamed', (draft) => void draft.tools.splice(1, 1)],
      ['moved', (draft) => void draft.tools.reverse()],
      ['"page" was taken away', (draft) => delete props(draft, 'read_outline').page],
      ['"page" must now be given', (draft) => (tool(draft, 'read_outline').input.required as string[]).push('page')],
      ['the value "text" was taken away', (draft) => (props(draft, 'export_note').format!.enum = ['markdown'])],
      ['maxItems was 50 and is 10', (draft) => (props(draft, 'read_blocks').ids!.maxItems = 10)],
      ['its type was', (draft) => (props(draft, 'edit_note').rev!.type = 'string')],
      ['now changes things', (draft) => (tool(draft, 'export_note').readOnly = false)],
      ['guide topic "math" was taken away', (draft) => (draft.topics = draft.topics.filter((topic) => topic !== 'math'))],
      ['number went down', (draft) => void draft.contract--],
      ['took any value and now takes a list', (draft) => (props(draft, 'edit_note').why!.enum = ['a'])],
    ]
    for (const [words, change] of refused) expect(breaks(base, changed(change)).join(' | '), words).toContain(words)
  })
})
