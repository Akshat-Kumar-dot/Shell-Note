// The contract: everything an assistant, or the app that runs it, may come
// to rely on. It is written down in contract.json, and a test holds the
// server to it: what is there stays, with its name, its place and its
// meaning, and anything new is an addition. So a feature added to ShellNote
// can never break an assistant that was set up before it.
import { z } from 'zod'
import { CONTRACT, TOPICS } from './guide.js'
import { INSTRUCTIONS, TOOLS } from './tools/index.js'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type Schema = { [key: string]: Json }

export interface Contract {
  contract: number
  instructions: string
  topics: string[]
  tools: { name: string; title: string; description: string; readOnly: boolean; input: Schema }[]
}

/** The contract as the server keeps it now. */
export function contract(): Contract {
  return {
    contract: CONTRACT,
    instructions: INSTRUCTIONS,
    topics: [...TOPICS],
    tools: TOOLS.map((tool) => ({ name: tool.name, title: tool.title, description: tool.description, readOnly: tool.readOnly, input: z.toJSONSchema(tool.input) as Schema })),
  }
}

const isSchema = (value: Json | undefined): value is Schema => typeof value === 'object' && value !== null && !Array.isArray(value)
const strings = (value: Json | undefined): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])

/** Limits that may only widen: [the key, whether a larger value is the wider one]. */
const LIMITS: [string, boolean][] = [
  ['maximum', true],
  ['maxLength', true],
  ['maxItems', true],
  ['minimum', false],
  ['minLength', false],
  ['minItems', false],
]

/** What `now` takes away from, or narrows in, what `old` took: a call that was right before must be right still. */
function narrowed(old: Schema, now: Schema, where: string): string[] {
  const out: string[] = []
  if (JSON.stringify(old.type) !== JSON.stringify(now.type)) out.push(`${where}: its type was ${JSON.stringify(old.type)} and is ${JSON.stringify(now.type)}`)
  const [before, after] = [strings(old.enum), strings(now.enum)]
  for (const value of before) if (!after.includes(value)) out.push(`${where}: the value ${JSON.stringify(value)} was taken away`)
  if (before.length === 0 && after.length > 0) out.push(`${where}: it took any value and now takes a list`)
  for (const [key, larger] of LIMITS) {
    const [was, is] = [old[key], now[key]]
    if (typeof is !== 'number') continue
    if (typeof was !== 'number' || (larger ? is < was : is > was)) out.push(`${where}: ${key} was ${String(was)} and is ${is}`)
  }
  const required = strings(old.required)
  for (const name of strings(now.required)) if (!required.includes(name)) out.push(`${where}: "${name}" must now be given`)
  const [oldProps, nowProps] = [isSchema(old.properties) ? old.properties : {}, isSchema(now.properties) ? now.properties : {}]
  for (const [name, schema] of Object.entries(oldProps)) {
    const next = nowProps[name]
    if (!isSchema(next)) out.push(`${where}: "${name}" was taken away`)
    else if (isSchema(schema)) out.push(...narrowed(schema, next, `${where}.${name}`))
  }
  if (isSchema(old.items) && isSchema(now.items)) out.push(...narrowed(old.items, now.items, `${where}[]`))
  if (old.additionalProperties !== false && now.additionalProperties === false) out.push(`${where}: it took other fields and no longer does`)
  return out
}

/** The names of what is in `now` and was not in `old`: tools, arguments, values and topics. */
function added(old: Contract, now: Contract): string[] {
  const out = now.topics.filter((topic) => !old.topics.includes(topic)).map((topic) => `topic ${topic}`)
  for (const tool of now.tools) {
    const was = old.tools.find((each) => each.name === tool.name)
    if (!was) out.push(`tool ${tool.name}`)
    else if (JSON.stringify(was.input) !== JSON.stringify(tool.input)) out.push(`arguments of ${tool.name}`)
  }
  return out
}

/**
 * How `now` breaks what `old` promised; empty when it only adds. Words
 * (titles, descriptions, the instructions) may be made clearer: they are not
 * a promise of shape.
 */
export function breaks(old: Contract, now: Contract): string[] {
  const out: string[] = []
  if (now.contract < old.contract) out.push(`the contract's number went down, from ${old.contract} to ${now.contract}`)
  for (const topic of old.topics) if (!now.topics.includes(topic)) out.push(`the guide topic "${topic}" was taken away`)
  old.tools.forEach((tool, at) => {
    const next = now.tools[at]
    if (next?.name !== tool.name) {
      out.push(now.tools.some((each) => each.name === tool.name) ? `the tool ${tool.name} moved: tools keep their order, and new ones go at the end` : `the tool ${tool.name} was taken away or renamed`)
      return
    }
    if (tool.readOnly && !next.readOnly) out.push(`${tool.name} only read, and now changes things`)
    out.push(...narrowed(tool.input, next.input, tool.name))
  })
  const more = added(old, now)
  if (more.length > 0 && now.contract <= old.contract) out.push(`something was added (${more.join('; ')}), so the contract's number goes up: raise CONTRACT in guide.ts`)
  return out
}
