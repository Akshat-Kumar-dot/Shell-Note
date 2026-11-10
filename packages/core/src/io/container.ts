// The file format (docs/file-format.md). One document is one zip file:
//
//   doc.json              everything except the blocks
//   pages/<pageId>.json   the blocks on one page
//   assets/<hash>         image bytes
//   sync.json             only in a library kept in a synced folder: what this version has seen (sync/lineage.ts)
//
// Unzipped, the same layout is a folder, which the desktop app and the MCP
// server can use directly. Splitting blocks by page means a folder save only
// rewrites the pages that changed. Files are written in a fixed key order, so
// the same document always gives the same bytes.
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { Asset, Id, Page, PenOverrides, type Block, type Doc } from '../schema/doc.js'
import { has, isRecord } from '../util.js'
import { parseDoc } from '../validate/doc.js'
import { lineageText, readLineage, type Lineage } from '../sync/lineage.js'
import { ValidationError } from '../validate/errors.js'
import { canonicalBlock, parseWith } from '../validate/shape.js'

/** The document as the folder form: file path → JSON text. Assets are not included. */
export function toFiles(doc: Doc): Record<string, string> {
  const pages = doc.pages.map((id) => [id, parseWith(Page, doc.page[id], `Page ${id}`)] as const)
  const assets = Object.keys(doc.asset)
    .sort()
    .map((hash) => [hash, parseWith(Asset, doc.asset[hash], `Asset ${hash}`)] as const)
  const head = [
    `"v": ${doc.v}`,
    `"id": ${JSON.stringify(doc.id)}`,
    `"title": ${JSON.stringify(doc.title)}`,
    `"rev": ${doc.rev}`,
    `"pages": ${JSON.stringify(doc.pages)}`,
    `"page": ${entryLines(pages)}`,
    `"asset": ${entryLines(assets)}`,
    `"rules": ${doc.rules.length === 0 ? '[]' : `[\n${doc.rules.map((rule) => `    ${JSON.stringify(rule)}`).join(',\n')}\n  ]`}`,
    ...(doc.pen ? [`"pen": ${JSON.stringify(parseWith(PenOverrides, doc.pen, 'The pen switches'))}`] : []),
    // The videos beside the note and their marks (17 October 2026), as apply checked them.
    ...(doc.media ? [`"media": ${JSON.stringify(doc.media)}`] : []),
    ...(doc.clips ? [`"clips": ${JSON.stringify(doc.clips)}`] : []),
    ...(doc.programs ? [`"programs": ${JSON.stringify(doc.programs)}`] : []),
  ]
  const files: Record<string, string> = { 'doc.json': `{\n${head.map((line) => `  ${line}`).join(',\n')}\n}\n` }
  for (const [id, page] of pages) {
    const blocks = blocksOnPage(doc, page.free).map((block) => [block.id, canonicalBlock(block)] as const)
    files[`pages/${id}.json`] = `{\n  "block": ${entryLines(blocks)}\n}\n`
  }
  return files
}

/** Read the folder form back. Migrates and checks the document. */
export function fromFiles(files: Readonly<Record<string, string>>): Doc {
  const head = readJson(files, 'doc.json')
  if (!isRecord(head)) throw new ValidationError('bad_doc', 'doc.json must hold a JSON object.')
  const block: Record<string, unknown> = {}
  const storedIn = new Map<string, string>()
  for (const pageId of Array.isArray(head.pages) ? head.pages : []) {
    if (!Id.safeParse(pageId).success) continue // the full check below reports it
    const path = `pages/${pageId as string}.json`
    const file = readJson(files, path)
    if (!isRecord(file) || !isRecord(file.block)) throw new ValidationError('bad_doc', `${path} must hold an object with a "block" map.`)
    for (const [id, value] of Object.entries(file.block)) {
      if (!Id.safeParse(id).success) throw new ValidationError('bad_doc', `${path} holds a block with the invalid id ${JSON.stringify(id)}.`)
      if (has(block, id)) throw new ValidationError('bad_doc', `Block ${id} is stored twice, in ${storedIn.get(id)} and ${path}.`)
      block[id] = value
      storedIn.set(id, path)
    }
  }
  const { page, asset, ...rest } = head
  const doc = parseDoc({ ...rest, page, block, asset })
  for (const [id, path] of storedIn) {
    const on = pageOf(doc, doc.block[id]!)
    if (path !== `pages/${on}.json`) throw new ValidationError('bad_doc', `Block ${id} is stored in ${path}, but it is on page ${on}.`)
  }
  return doc
}

export interface Opened {
  doc: Doc
  /** Image bytes by hash, for the assets the document lists. */
  assets: Record<string, Uint8Array>
  /** What the file says of its past, when it comes from a library kept in a synced folder. */
  lineage?: Lineage
}

/** The document as one zip file. Images an image block uses must have their bytes in `assets`. `lineage` goes in as sync.json. */
export function pack(doc: Doc, assets: Readonly<Record<string, Uint8Array>> = {}, lineage?: Lineage): Uint8Array {
  const zip: Zippable = {}
  for (const [path, text] of Object.entries(toFiles(doc))) zip[path] = strToU8(text)
  if (lineage) zip[SYNC_PATH] = strToU8(lineageText(lineage))
  for (const hash of Object.keys(doc.asset).sort()) {
    const bytes = has(assets, hash) ? assets[hash] : undefined
    // Images and videos are compressed already, so they are stored as they are.
    if (bytes) zip[`assets/${hash}`] = [bytes, { level: 0 }]
    else if (Object.values(doc.block).some((b) => b.type === 'image' && b.asset === hash) || doc.media?.some((m) => m.kind === 'file' && m.asset === hash) || Object.values(doc.block).some((b) => b.type === 'ink' && b.strokes.some((stroke) => stroke.pm?.pic === hash))) {
      throw new ValidationError('bad_doc', `Asset ${hash} has no bytes to save. Load it before saving.`)
    }
  }
  return zipSync(zip, { level: 6, mtime: FIXED_TIME })
}

/**
 * Open a zip file written by pack(). Files that are not part of the format are ignored. With `assets: false` the
 * images' bytes are not read: enough to list a note, or to see whether it changed.
 */
export function unpack(bytes: Uint8Array, options: { assets?: boolean } = {}): Opened {
  let entries: Record<string, Uint8Array>
  let count = 0
  let total = 0
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        if (!KNOWN_PATH.test(file.name) || (options.assets === false && file.name.startsWith('assets/'))) return false
        total += file.originalSize
        if (++count > LIMITS.files || total > LIMITS.total || (file.name.endsWith('.json') && file.originalSize > LIMITS.json)) {
          throw new ValidationError('bad_doc', 'This file is too large to open safely.')
        }
        return true
      },
    })
  } catch (error) {
    if (error instanceof ValidationError) throw error
    throw new ValidationError('bad_doc', 'This is not a notes file: it could not be read as a zip archive.')
  }
  const files: Record<string, string> = {}
  const found: Record<string, Uint8Array> = {}
  for (const [path, data] of Object.entries(entries)) {
    if (path.startsWith('assets/')) found[path.slice('assets/'.length)] = data
    else files[path] = strFromU8(data)
  }
  const lineage = readLineage(has(files, SYNC_PATH) ? files[SYNC_PATH] : undefined)
  const doc = fromFiles(files)
  const assets: Record<string, Uint8Array> = {}
  for (const hash of Object.keys(doc.asset)) if (has(found, hash)) assets[hash] = found[hash]!
  return { doc, assets, ...(lineage ? { lineage } : {}) }
}

// ----- details ----------------------------------------------------------------

/** Every entry the format uses. Anything else in a zip is skipped, never read. */
const SYNC_PATH = 'sync.json'
const KNOWN_PATH = /^(doc\.json|sync\.json|pages\/[A-Za-z0-9][A-Za-z0-9_-]{0,31}\.json|assets\/[0-9a-f]{4,64})$/
const LIMITS = { files: 100_000, json: 64 * 2 ** 20, total: 2 ** 30 }
/** A fixed timestamp, so the same document always packs to the same bytes. */
const FIXED_TIME = new Date(2000, 0, 1)
/** The byte-order mark, U+FEFF. */
const BOM = String.fromCharCode(0xfeff)

/** A JSON object with one entry per line: easy to read, and diffs stay small. */
function entryLines(entries: readonly (readonly [string, unknown])[]): string {
  if (entries.length === 0) return '{}'
  return `{\n${entries.map(([key, value]) => `    ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(',\n')}\n  }`
}

/** The blocks on a page, in its stacking order, each frame followed by its children. */
function blocksOnPage(doc: Doc, free: readonly string[]): Block[] {
  return free.flatMap((id) => {
    const block = doc.block[id]!
    return block.type === 'frame' ? [block, ...block.kids.map((kid) => doc.block[kid]!)] : [block]
  })
}

function pageOf(doc: Doc, block: Block): string {
  if ('page' in block) return block.page
  const frame = doc.block[block.parent]
  return frame && 'page' in frame ? frame.page : ''
}

function readJson(files: Readonly<Record<string, string>>, path: string): unknown {
  const text = has(files, path) ? files[path] : undefined
  if (text === undefined) throw new ValidationError('bad_doc', `This notes file is missing ${path}.`)
  try {
    // A text editor may have added a byte-order mark; JSON does not allow one.
    return JSON.parse(text.startsWith(BOM) ? text.slice(1) : text)
  } catch {
    throw new ValidationError('bad_doc', `${path} is not valid JSON.`)
  }
}
