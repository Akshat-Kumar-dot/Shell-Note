// What a tool is: a name, the words an assistant reads about it, the shape of
// what it takes, and its work. A tool is plain code over a NoteHost: it knows
// nothing of how calls arrive (serve.ts) or where notes are kept (host.ts).
import { ValidationError, type ErrorCode } from '@shellnote/core'
import { z } from 'zod'
import { NoteError, type NoteHost } from '../host.js'

/** What a tool answers: text, always, and the same facts as data for a caller that reads data. */
export interface Answer {
  text: string
  data?: Record<string, unknown>
  /** The call was refused: `text` is the teaching error, as one line of JSON. */
  error?: true
}

export interface Context {
  host: NoteHost
  now: () => number
  /** What the calling program calls itself, when it said. Its own word: a label, never trusted. */
  client?: string
}

export interface Tool {
  name: string
  title: string
  description: string
  /** The shape of its arguments. Unknown arguments are refused. */
  input: z.ZodObject
  /** True when it never changes anything. */
  readOnly: boolean
  /** Runs it. Never throws for a bad call or a note that cannot be had: those are answers too. */
  run(args: unknown, context: Context): Promise<Answer>
}

/** The most characters one answer holds: a longer one is cut, and says how to get the rest. About 15,000 tokens. */
export const MAX_ANSWER = 60_000

/** A note's id as a tool takes it. */
export const NoteId = z.string().min(1).max(64).describe('A note id, as list_notes gives it.')

export function teaching(code: ErrorCode | NoteError['code'], hint: string, details: Record<string, unknown> = {}): Answer {
  return { text: JSON.stringify({ error: code, ...details, hint }), error: true }
}

export function define<Shape extends z.ZodRawShape>(spec: {
  name: string
  title: string
  description: string
  input: Shape
  readOnly: boolean
  run(args: z.infer<z.ZodObject<Shape>>, context: Context): Promise<Answer>
}): Tool {
  const input = z.strictObject(spec.input)
  return {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    input,
    readOnly: spec.readOnly,
    async run(args, context) {
      const parsed = input.safeParse(args ?? {})
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        const where = issue?.path.map(String).join('.')
        return teaching('bad_value', `${spec.name}: ${where ? `${where}: ` : ''}${issue?.message ?? 'the arguments do not fit.'}`)
      }
      try {
        return await spec.run(parsed.data as z.infer<z.ZodObject<Shape>>, context)
      } catch (error) {
        if (error instanceof ValidationError) return { text: JSON.stringify(error.toJSON()), error: true }
        if (error instanceof NoteError) return teaching(error.code, error.message)
        throw error
      }
    },
  }
}

/** Text cut to what one answer holds, at the end of a line, with `more` saying how to get the rest. */
export function fitted(text: string, more: string): string {
  if (text.length <= MAX_ANSWER) return text
  const cut = text.lastIndexOf('\n', MAX_ANSWER)
  return `${text.slice(0, cut > 0 ? cut : MAX_ANSWER)}\n… cut here. ${more}`
}
