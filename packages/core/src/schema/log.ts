// The edit log: one entry per AI edit. It is stored on the
// device beside the document, never inside it, so sharing a note does not
// share its prompt history.
import { z } from 'zod'
import { Id } from './doc.js'

export const LogEntry = z.strictObject({
  /** When, in milliseconds since 1970. */
  at: z.int(),
  source: z.enum(['app', 'mcp', 'bench']),
  /** The model that chose the operation, or "tier0" when code did. */
  model: z.string(),
  /** The rulebook version the model was given. */
  rulebook: z.string(),
  instruction: z.string(),
  /** The selected blocks. */
  targets: z.array(Id),
  /** The operations chosen, with real ids in place of aliases. */
  ops: z.array(z.record(z.string(), z.unknown())),
  /** stopped: the person pressed Stop. answered: an Ask, which never changes the note. */
  result: z.enum(['applied', 'unchanged', 'declined', 'failed', 'stopped', 'answered']),
  /** A teaching error or failure, when there was one. */
  error: z.string().optional(),
  tier: z.union([z.literal(0), z.literal(1)]),
  calls: z.int().nonnegative(),
  retries: z.int().nonnegative(),
  tokensIn: z.int().nonnegative(),
  tokensOut: z.int().nonnegative(),
  /** Of tokensOut, the tokens spent thinking, when the server said. */
  thinking: z.int().nonnegative().optional(),
  /** What the calls cost, in US dollars, when the server said (OpenRouter does). */
  cost: z.number().nonnegative().optional(),
  ms: z.int().nonnegative(),
})
export type LogEntry = z.infer<typeof LogEntry>

/** A log entry as one short line, for the model's EARLIER section: "style color=blue size=l". */
export function logLine(entry: LogEntry): string {
  return entry.ops
    .map((op) =>
      Object.entries(op)
        .filter(([key]) => !['op', 'id', 'ids', 'ref', 'content'].includes(key))
        .reduce((line, [key, value]) => `${line} ${key}=${String(value)}`, String(op.op)),
    )
    .join('; ')
}
