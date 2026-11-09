import type { Doc } from '../schema/doc.js'
import { migrate } from '../schema/migrate.js'
import { ValidationError } from './errors.js'
import { structureProblems } from './refs.js'
import { checkDocShape } from './shape.js'

/** Check a whole document: its shape (layer 1), then its structure (layer 2). */
export function validateDoc(value: unknown): Doc {
  const doc = checkDocShape(value)
  const problems = structureProblems(doc)
  if (problems.length > 0) {
    const more = problems.length > 1 ? `, and ${problems.length - 1} more` : ''
    throw new ValidationError('bad_doc', `The document is inconsistent: ${problems[0]}${more}.`, { problems })
  }
  return doc
}

/** Read a document from parsed JSON: migrate it to the current version, then check it. */
export function parseDoc(value: unknown): Doc {
  return validateDoc(migrate(value))
}
