// The working copy apply() edits while it runs. The input document is never
// modified: the first write to a map copies that map (not the blocks in it),
// so every unchanged block is shared between the old and the new document.
import type { Asset, Block, Clip, Doc, Id, Media, Page, PenOverrides, ProgramSource } from './schema/doc.js'
import { has } from './util.js'
import type { ContentField } from './validate/content.js'
import { ValidationError } from './validate/errors.js'

export class Draft {
  readonly doc: Doc
  readonly rev: number
  /** Ids of blocks and pages that changed, and the document id for document-level changes. */
  readonly changed = new Set<Id>()
  /** Content fields set in this transaction, for the layer 3 checks. */
  readonly edited = new Map<Id, Set<ContentField>>()
  private ownBlocks = false
  private ownPages = false
  private ownAssets = false

  constructor(
    readonly base: Doc,
    private readonly baseRev: number | undefined,
  ) {
    this.rev = base.rev + 1
    this.doc = { ...base, rev: this.rev }
  }

  block(id: Id): Block | undefined {
    return has(this.doc.block, id) ? this.doc.block[id] : undefined
  }

  page(id: Id): Page | undefined {
    return has(this.doc.page, id) ? this.doc.page[id] : undefined
  }

  asset(hash: string): Asset | undefined {
    return has(this.doc.asset, hash) ? this.doc.asset[hash] : undefined
  }

  /** Store a block, stamping `r` with this transaction's rev. */
  putBlock(block: Block): void {
    if (!this.ownBlocks) {
      this.doc.block = { ...this.doc.block }
      this.ownBlocks = true
    }
    this.doc.block[block.id] = { ...block, r: this.rev }
    this.changed.add(block.id)
  }

  dropBlock(id: Id): void {
    if (!this.ownBlocks) {
      this.doc.block = { ...this.doc.block }
      this.ownBlocks = true
    }
    delete this.doc.block[id]
    this.changed.add(id)
    this.edited.delete(id)
  }

  putPage(page: Page): void {
    if (!this.ownPages) {
      this.doc.page = { ...this.doc.page }
      this.ownPages = true
    }
    this.doc.page[page.id] = page
    this.changed.add(page.id)
  }

  dropPage(id: Id): void {
    if (!this.ownPages) {
      this.doc.page = { ...this.doc.page }
      this.ownPages = true
    }
    delete this.doc.page[id]
    this.changed.add(id)
  }

  putAsset(hash: string, asset: Asset): void {
    this.ownAssetMap()
    this.doc.asset[hash] = asset
    this.changed.add(this.doc.id)
  }

  dropAsset(hash: string): void {
    this.ownAssetMap()
    delete this.doc.asset[hash]
    this.changed.add(this.doc.id)
  }

  setPages(pages: Id[]): void {
    this.doc.pages = pages
    this.changed.add(this.doc.id)
  }

  /** The document's own fields; `pen: null` removes the note's pen switches, and so on. */
  setDocFields(fields: { title?: string; rules?: string[]; pen?: PenOverrides | null; media?: Media[] | null; clips?: Clip[] | null; programs?: ProgramSource[] | null }): void {
    if (fields.title !== undefined) this.doc.title = fields.title
    if (fields.rules !== undefined) this.doc.rules = fields.rules
    if (fields.pen === null) delete this.doc.pen
    else if (fields.pen !== undefined) this.doc.pen = fields.pen
    if (fields.media === null || fields.media?.length === 0) delete this.doc.media
    else if (fields.media !== undefined) this.doc.media = fields.media
    if (fields.clips === null || fields.clips?.length === 0) delete this.doc.clips
    else if (fields.clips !== undefined) this.doc.clips = fields.clips
    if (fields.programs === null || fields.programs?.length === 0) delete this.doc.programs
    else if (fields.programs !== undefined) this.doc.programs = fields.programs
    this.changed.add(this.doc.id)
  }

  markEdited(id: Id, field: ContentField): void {
    const fields = this.edited.get(id) ?? new Set<ContentField>()
    fields.add(field)
    this.edited.set(id, fields)
  }

  /**
   * For AI and MCP edits: refuse to touch a block that changed
   * after the edit was prepared, so it cannot overwrite what the user typed.
   */
  checkFresh(id: Id): void {
    if (this.baseRev === undefined) return
    const before = has(this.base.block, id) ? this.base.block[id] : undefined
    if (before && before.r > this.baseRev) {
      throw new ValidationError(
        'stale',
        `Block ${id} changed after this edit was prepared (edit based on rev ${this.baseRev}, block changed at rev ${before.r}). Read it again and redo the edit.`,
        { ids: [id] },
      )
    }
  }

  private ownAssetMap(): void {
    if (!this.ownAssets) {
      this.doc.asset = { ...this.doc.asset }
      this.ownAssets = true
    }
  }
}
