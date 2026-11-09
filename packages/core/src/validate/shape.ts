// Validation layer 1: shape. Wraps the Zod schemas so that
// each failure names the thing that failed and says how to fix it.
import { z } from 'zod'
import {
  Asset,
  BLOCK_SHAPES,
  DocFields,
  Hash,
  Id,
  Page,
  SCHEMA_VERSION,
  type Block,
  type BlockType,
  type Doc,
} from '../schema/doc.js'
import { has, isRecord } from '../util.js'
import { ValidationError, zodHint } from './errors.js'

const BLOCK_TYPES = Object.keys(BLOCK_SHAPES).join(', ')

/** Parse `value` with `schema`, or throw `bad_shape` naming `where`. */
export function parseWith<T>(schema: z.ZodType<T>, value: unknown, where: string): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  throw new ValidationError('bad_shape', `${where}: ${zodHint(result.error)}`)
}

/**
 * Check one block. Returns the same object (not a copy), typed as a Block, so
 * large stroke lists are never duplicated by validation.
 */
export function checkBlock(value: unknown): Block {
  blockSchema(value)
  return value as Block
}

/** A checked copy of a block with its fields in schema order, as files store them. */
export function canonicalBlock(value: unknown): Block {
  const { schema, where } = blockSchema(value)
  return parseWith(schema, value, where) as Block
}

/** The schema variant for a block, after checks that give clearer hints than Zod's. */
function blockSchema(value: unknown): { schema: z.ZodType; where: string } {
  if (!isRecord(value)) throw new ValidationError('bad_shape', 'A block must be an object.')
  const where = typeof value.id === 'string' ? `Block ${value.id}` : 'Block'
  const type = value.type
  const shapes = typeof type === 'string' && has(BLOCK_SHAPES, type) ? BLOCK_SHAPES[type as BlockType] : undefined
  if (!shapes) {
    throw new ValidationError('bad_shape', `${where}: unknown type ${JSON.stringify(type)}. Use one of: ${BLOCK_TYPES}.`)
  }
  const inFrame = has(value, 'parent')
  const onPage = has(value, 'page')
  if (!shapes.child && inFrame) {
    throw new ValidationError('bad_shape', `${where}: ${type} blocks are placed on a page. Give page, x, y, w and h, not parent.`)
  }
  if (!shapes.free && (onPage || !inFrame)) {
    throw new ValidationError('bad_shape', `${where}: ${type} blocks sit inside a frame. Give parent, not page, x, y, w and h.`)
  }
  if (inFrame && onPage) {
    throw new ValidationError(
      'bad_shape',
      `${where} is either inside a frame (parent) or on a page (page, x, y, w, h), not both.`,
    )
  }
  const schema = inFrame ? shapes.child! : shapes.free!
  parseWith(schema, value, where)
  rejectUndefined([value, value.style, ...(Array.isArray(value.strokes) ? value.strokes : [])], where)
  return { schema, where }
}

// Zod lets an optional field hold `undefined`. A saved file cannot, so a
// document with one would not survive save and load unchanged.
function rejectUndefined(objects: unknown[], where: string): void {
  for (const object of objects) {
    if (!isRecord(object)) continue
    for (const [key, value] of Object.entries(object)) {
      if (value === undefined) {
        throw new ValidationError('bad_shape', `${where}: ${key} is undefined. Leave the field out instead.`)
      }
    }
  }
}

export function checkPage(value: unknown): Doc['page'][string] {
  const where = isRecord(value) && typeof value.id === 'string' ? `Page ${value.id}` : 'Page'
  parseWith(Page, value, where)
  return value as Doc['page'][string]
}

export function checkAsset(value: unknown, hash: string): Doc['asset'][string] {
  parseWith(Asset, value, `Asset ${hash}`)
  return value as Doc['asset'][string]
}

// The document without its maps' contents; those are checked one entry at a time.
const Envelope = z.strictObject({
  v: z.literal(SCHEMA_VERSION),
  id: Id,
  rev: z.int().nonnegative(),
  pages: z.array(Id),
  page: z.record(Id, z.unknown()),
  block: z.record(Id, z.unknown()),
  asset: z.record(Hash, z.unknown()),
  ...DocFields.shape,
})

/** Check the shape of a whole document, entry by entry. */
export function checkDocShape(value: unknown): Doc {
  parseWith(Envelope, value, 'Document')
  const doc = value as Doc
  for (const page of Object.values(doc.page)) checkPage(page)
  for (const block of Object.values(doc.block)) checkBlock(block)
  for (const [hash, asset] of Object.entries(doc.asset)) checkAsset(asset, hash)
  return doc
}
