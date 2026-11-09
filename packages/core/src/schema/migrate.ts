import { parseInline, serializeInline } from '../markdown/inline.js'
import { isRecord } from '../util.js'
import { ValidationError } from '../validate/errors.js'
import { SCHEMA_VERSION } from './doc.js'

type RawDoc = Record<string, unknown>

/**
 * MIGRATIONS[n] turns a version-n document into version n + 1. Every schema
 * change adds one entry and raises SCHEMA_VERSION.
 */
const MIGRATIONS: Partial<Record<number, (doc: RawDoc) => RawDoc>> = {
  1: (doc) => (isRecord(doc.block) ? { ...doc, block: Object.fromEntries(Object.entries(doc.block).map(([id, block]) => [id, upgradeBlock(block)])) } : doc),
  // Version 2 to 3 (the pen): everything version 2 holds means the same in version 3.
  2: (doc) => doc,
  // Version 3 to 4 (other programs' places, stage 4): only new, optional fields; version 3 means the same.
  3: (doc) => doc,
}

/**
 * Version 1 to 2: words may now be underlined, written small below or above
 * the line, or given their own size or font, in spans such as
 * [words]{.underline} that version 1 read as plain text. Text that only looks
 * like such a span keeps reading as text: it is written again, which escapes
 * its brackets. Every other piece of text keeps its own form.
 */
function upgradeBlock(block: unknown): unknown {
  if (!isRecord(block)) return block
  const out: Record<string, unknown> = { ...block }
  if (block.type === 'text') out.md = upgradeMd(block.md)
  if ((block.type === 'image' || block.type === 'table') && block.caption !== undefined) out.caption = upgradeMd(block.caption)
  if (block.type === 'table' && Array.isArray(block.rows)) out.rows = block.rows.map((row: unknown) => (Array.isArray(row) ? row.map(upgradeMd) : row))
  return out
}

/** Version 1's words, unchanged in meaning under version 2's grammar. */
export function upgradeMd(md: unknown): unknown {
  if (typeof md !== 'string' || !md.includes(']{')) return md
  const old = parseInline(md, { version: 1 })
  return JSON.stringify(old) === JSON.stringify(parseInline(md)) ? md : serializeInline(old)
}

/** Bring a parsed document file up to the current schema version. */
export function migrate(raw: unknown): unknown {
  if (!isRecord(raw) || typeof raw.v !== 'number' || !Number.isInteger(raw.v) || raw.v < 1) {
    throw new ValidationError('bad_doc', 'This is not a notes document: it has no schema version "v".')
  }
  if (raw.v > SCHEMA_VERSION) {
    throw new ValidationError(
      'too_new',
      `This document uses schema version ${raw.v}, and this app reads up to version ${SCHEMA_VERSION}. Update the app to open it.`,
    )
  }
  let doc: RawDoc = raw
  for (let v = raw.v; v < SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v]
    if (!step) throw new ValidationError('bad_doc', `There is no migration from schema version ${v}.`)
    doc = { ...step(doc), v: v + 1 }
  }
  return doc
}
