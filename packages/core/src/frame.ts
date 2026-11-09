// From an editor's view of a frame to operations. The editor holds a frame's
// blocks as the person types; frameOps says what core must do to match, with
// the smallest operations: a splice for typed text, add and remove for Enter
// and Backspace, update for a role or style, move for a reordering.
import { spliceFor } from './splice.js'
import type { Block, ChildBlock, Doc, Frame, Id, TextBlock } from './schema/doc.js'
import type { Op } from './schema/ops.js'

type Draft<T> = T extends unknown ? Omit<T, 'r' | 'parent'> : never

/** A child block as an editor knows it: everything but its revision and its frame. */
export type ChildDraft = Draft<ChildBlock>

/**
 * The operations that make `frameId`'s blocks match `next`, in order.
 * Blocks not in `next` are removed; blocks new to the document are added
 * whole; a block that moved, here or from another frame, is moved; a text
 * block whose words, role, indent, style or tick changed gets a splice and an
 * update, and so does a picture's or table's caption, typed under it. A table
 * whose cells, header, column widths, width or look changed gets an update of
 * them. Math and diagram blocks, and a picture's asset and description, keep
 * their content: the editor does not change them.
 */
export function frameOps(doc: Doc, frameId: Id, next: readonly ChildDraft[]): Op[] {
  const frame = doc.block[frameId] as Frame | undefined
  if (frame?.type !== 'frame') throw new Error(`${frameId} is not a frame`)
  const ops: Op[] = []
  const wanted = new Set(next.map((draft) => draft.id))

  let kids = frame.kids.filter((id) => {
    if (wanted.has(id)) return true
    ops.push({ op: 'remove', id })
    return false
  })

  next.forEach((draft, i) => {
    const at = kids.indexOf(draft.id)
    if (at === i) return
    if (at === -1 && doc.block[draft.id] === undefined) {
      ops.push({ op: 'add', block: { ...draft, r: 0, parent: frameId } as Block, at: i })
    } else {
      ops.push({ op: 'move', id: draft.id, to: { parent: frameId, at: i } })
      if (at !== -1) kids = kids.filter((id) => id !== draft.id)
    }
    kids = [...kids.slice(0, i), draft.id, ...kids.slice(i)]
  })

  for (const draft of next) {
    const old = doc.block[draft.id]
    if (old?.type === 'table' && draft.type === 'table') {
      const set: Record<string, unknown> = {}
      if (JSON.stringify(draft.rows) !== JSON.stringify(old.rows)) set.rows = draft.rows
      if ((draft.head ?? false) !== (old.head ?? false)) set.head = draft.head ? true : null
      // Its size and look, in the same update: a column added or taken away changes the rows and the widths at once.
      if (JSON.stringify(draft.cols ?? null) !== JSON.stringify(old.cols ?? null)) set.cols = draft.cols ?? null
      if (draft.width !== old.width) set.width = draft.width ?? null
      if (draft.look !== old.look) set.look = draft.look ?? null
      if (Object.keys(set).length > 0) ops.push({ op: 'update', id: draft.id, set })
    }
    if ((old?.type === 'image' && draft.type === 'image') || (old?.type === 'table' && draft.type === 'table')) {
      const caption = draft.caption ?? ''
      if (caption !== (old.caption ?? '')) ops.push(spliceFor(draft.id, 'caption', old.caption ?? '', caption))
      continue
    }
    if (old?.type !== 'text' || draft.type !== 'text') continue
    if (draft.md !== old.md) ops.push(spliceFor(draft.id, 'md', old.md, draft.md))
    const set = textChanges(old, draft)
    if (Object.keys(set).length > 0) ops.push({ op: 'update', id: draft.id, set })
  }
  return ops
}

function textChanges(old: TextBlock, draft: Extract<ChildDraft, { type: 'text' }>): Record<string, unknown> {
  const set: Record<string, unknown> = {}
  if (draft.role !== old.role) set.role = draft.role
  if (draft.indent !== old.indent) set.indent = draft.indent
  const style = sortedKeys(draft.style)
  if (JSON.stringify(style) !== JSON.stringify(sortedKeys(old.style))) set.style = Object.keys(style).length > 0 ? style : null
  if ((draft.done ?? false) !== (old.done ?? false)) set.done = draft.done ? true : null
  return set
}

/** A style with its keys in order and no empty fields, so two can be compared as text. */
function sortedKeys(style: TextBlock['style']): Record<string, string> {
  const out: Record<string, string> = {}
  const fields: Record<string, string | undefined> = style ?? {}
  for (const key of Object.keys(fields).sort()) {
    const value = fields[key]
    if (value !== undefined) out[key] = value
  }
  return out
}
