import type { z } from 'zod'

/** What went wrong. Each code comes with a hint that says how to fix it. */
export type ErrorCode =
  | 'bad_shape' // a field is missing, unknown or of the wrong kind
  | 'unknown_id' // no block, page or asset with that id
  | 'duplicate_id' // the id is already used in this document
  | 'wrong_type' // the operation does not fit this kind of block
  | 'bad_ref' // a reference points at the wrong kind of thing
  | 'bad_range' // an index or text range is out of bounds
  | 'bad_field' // this field cannot be set this way
  | 'not_empty' // a frame or page is added empty, then filled
  | 'in_use' // still referenced, so it cannot be removed
  | 'last_page' // a document keeps at least one page
  | 'stale' // the block changed after the edit was prepared
  | 'content' // LaTeX, Mermaid or Markdown did not pass its check
  | 'bad_doc' // the document as a whole is inconsistent
  | 'too_new' // the file comes from a newer version of the app
  // Teaching errors for a model's reply:
  | 'not_json' // the reply is not JSON
  | 'no_ops' // the reply holds no operation
  | 'too_many' // more operations than this model may send at once
  | 'unknown_op' // an operation name not on the list
  | 'bad_value' // a field or value not on its list
  | 'no_change' // the operations would leave the note as it is
  | 'not_ready' // an operation that arrives in a later phase
  | 'scope' // an AI edit would change or add outside what was selected

/**
 * Thrown by apply() and the validators. `hint` is written so that a person, or
 * a small model on its one retry, can fix the problem without other context.
 */
export class ValidationError extends Error {
  override readonly name = 'ValidationError'

  constructor(
    readonly code: ErrorCode,
    readonly hint: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(`${code}: ${hint}`)
  }

  /** The same error, noting which operation of a transaction (counting from 0) failed. */
  inOp(index: number): ValidationError {
    return new ValidationError(this.code, this.hint, { ...this.details, op: index })
  }

 /** The teaching-error shape of : { error,...details, hint }. */
  toJSON(): Record<string, unknown> {
    return { error: this.code, ...this.details, hint: this.hint }
  }
}

/** A short, readable summary of a Zod failure: the first issue, with its path. */
export function zodHint(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return 'Invalid value.'
  const path = issue.path.map(String).join('.')
  return path ? `${path}: ${issue.message}` : issue.message
}
