// What the model is told. Snapshot files in __snapshots__/ were read by hand.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { render, rulebook } from '../../../scripts/build-rules.mjs'
import {
  cleanContent,
  contentTask,
  letters,
  linkIn,
  makeAliases,
  parseReply,
  plainText,
  parseInline,
  refersBack,
  RULEBOOK,
  systemPrompt,
  userPrompt,
  type AiOp,
  type Selection,
} from '../src/index.js'
import { MIXED, PHYSICS } from './fixtures/index.js'

/** A selection of words inside a block, found by their text. */
function words(block: string, text: string, doc = PHYSICS): NonNullable<Selection['range']> {
  const b = doc.block[block]
  const plain = b?.type === 'text' ? plainText(parseInline(b.md)) : ''
  const start = plain.indexOf(text)
  return { block, start, end: start + text.length }
}

describe('aliases', () => {
  it('name the selection a, b, … in reading order, then one neighbour on each side', () => {
    const aliases = makeAliases(MIXED, { blocks: ['p2', 'p1'] })
    expect(aliases.selected).toEqual([
      { alias: 'a', id: 'p1' },
      { alias: 'b', id: 'p2' },
    ])
    expect(aliases.near).toEqual([
      { alias: 'c', id: 'h1', side: 'before' },
      { alias: 'd', id: 'l1', side: 'after' },
    ])
    expect(aliases.refs).toEqual(['a', 'b', 'c', 'd'])
    expect(aliases.id('d')).toBe('l1')
  })

  it('go past z', () => {
    expect([0, 25, 26, 27, 701, 702].map(letters)).toEqual(['a', 'z', 'aa', 'ab', 'zz', 'aaa'])
  })
})

describe('the prompt', () => {
  it('has a fixed prefix that depends only on the operation set and shape', async () => {
    const small = systemPrompt({ set: 'small', shape: 'list', maxOps: 1 })
    expect(systemPrompt({ set: 'small', shape: 'list', maxOps: 1 })).toBe(small)
    expect(small).not.toContain('convert')
    expect(systemPrompt({ set: 'full', shape: 'list', maxOps: 8 })).toContain('- calc:')
    await expect(small).toMatchFileSnapshot('./__snapshots__/prompt.system.small.txt')
  })

  it('in one-call mode, asks for the content inline, with the rules for each kind', () => {
    const inline = systemPrompt({ set: 'small', shape: 'list', maxOps: 1, inline: true })
    expect(inline).toContain('put the new content in "content"')
    expect(inline).not.toContain('written next')
    expect(inline).toContain('Mermaid')
    expect(inline).toContain('"content":"A push or a pull changes how things move."')
  })

  it('shows the selection, the selected words, the neighbours and the notebook rules', async () => {
    const selection: Selection = { blocks: ['t1', 't2'], range: words('t2', 'force') }
    const user = userPrompt({ doc: PHYSICS, selection, aliases: makeAliases(PHYSICS, selection), instruction: 'make the heading blue and bigger' })
    await expect(user).toMatchFileSnapshot('./__snapshots__/prompt.user.physics.txt')
  })

  it('adds earlier edits only when the request refers back', () => {
    const selection: Selection = { blocks: ['t2'] }
    const input = { doc: PHYSICS, selection, aliases: makeAliases(PHYSICS, selection), recent: ['style a: color blue'] }
    expect(userPrompt({ ...input, instruction: 'same for this one' })).toContain('EARLIER\nstyle a: color blue')
    expect(userPrompt({ ...input, instruction: 'make it red' })).not.toContain('EARLIER')
    expect(refersBack('do that again')).toBe(true)
  })

  it('marks a region as HERE', () => {
    const selection: Selection = { blocks: [], here: { page: 'p1', x: 2000, y: 24000, w: 8000, h: 3000 } }
    const user = userPrompt({ doc: PHYSICS, selection, aliases: makeAliases(PHYSICS, selection), instruction: 'add a formula' })
    expect(user).toBe('PAGE 1/1\nHERE: an empty area of the page\nNOTEBOOK RULES\n- Headings are blue.\nASK\nadd a formula')
  })
})

describe('the content step', () => {
  const selection: Selection = { blocks: ['t1', 't2', 'm1'] }
  const aliases = makeAliases(PHYSICS, selection)
  const task = (op: AiOp, sel = selection, instruction = 'do it') => contentTask({ doc: PHYSICS, op, aliases, selection: sel, instruction })

  it('sends the topic guide that fits what is written', () => {
    expect(task({ op: 'rewrite', id: 'b' })?.prompt.system).toBe(RULEBOOK.topics.text)
    expect(task({ op: 'rewrite', id: 'c' })?.kind).toBe('math')
    expect(task({ op: 'insert', at: 'after', ref: 'a', kind: 'diagram' })?.prompt.system).toBe(RULEBOOK.topics.diagram)
    expect(task({ op: 'convert', ids: ['a', 'b'], into: 'steps' })?.kind).toBe('items')
    expect(task({ op: 'delete', ids: ['a'] })).toBeUndefined()
  })

  it('rewrites only the selected words when some are selected', () => {
    // The words are their own item (protocol v1.1): a t1, b the words in t2, c m1.
    const withWords: Selection = { ...selection, range: words('t2', 'force') }
    const ranged = contentTask({ doc: PHYSICS, op: { op: 'rewrite', id: 'b' }, aliases: makeAliases(PHYSICS, withWords), selection: withWords, instruction: 'do it' })
    expect(ranged?.prompt.user).toContain('SELECTED TEXT\nforce\n')
    expect(ranged?.prompt.system).toContain('Rewrite only the SELECTED TEXT')
  })

  it('needs no call for a link whose address is in the request', () => {
    expect(linkIn('link this to https://example.com/waves please')).toBe('https://example.com/waves')
    const op = parseReply('{"op":"mark","id":"b","set":[{"link":true}]}', {
      set: 'small',
      selected: ['a', 'b', 'c'],
      refs: ['a', 'b', 'c'],
      here: false,
      maxOps: 1,
      inline: false,
      shape: 'list',
    })[0]!
    expect(contentTask({ doc: PHYSICS, op, aliases, selection, instruction: 'link it', href: 'https://x.org' })).toBeUndefined()
    expect(contentTask({ doc: PHYSICS, op, aliases, selection, instruction: 'link it to the course page' })?.kind).toBe('link')
  })

  it('tidies what a small model wraps around its content', () => {
    expect(cleanContent('text', 'Sure! Here is the new text:\n"A push changes motion."')).toBe('A push changes motion.')
    expect(cleanContent('math', '$$\\frac{1}{2} m v^2$$')).toBe('\\frac{1}{2} m v^2')
    expect(cleanContent('diagram', '```mermaid\nflowchart LR\n  A --> B\n```')).toBe('flowchart LR\n  A --> B')
    expect(cleanContent('items', '1. Measure\n2. Divide\n- Check')).toBe('Measure\nDivide\nCheck')
    // Block syntax on one line of text: the words are kept, the marker goes.
    expect(cleanContent('text', '## Forces in balance')).toBe('Forces in balance')
    expect(cleanContent('text', '- Surface waves')).toBe('Surface waves')
    expect(cleanContent('text', '**Bold** start, #1 and 3.14 stay')).toBe('**Bold** start, #1 and 3.14 stay')
  })
})

describe('the rulebook', () => {
  it('in code matches its Markdown source (run `corepack pnpm rules` after editing rules/*.md)', () => {
    const generated = readFileSync(new URL('../src/ai/rulebook.generated.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    expect(generated).toBe(render(rulebook()))
  })
})
