// The note's commands on the door (note control, step 2): each made into the note's own operations by core's
// compile.ts and applied through the store, as a person's typing is, so it is saved, synced and undone alike. One
// request is one step of Undo: its first change starts the step, the others join it. The blocks a
// request makes are kept in order, for $1, $2 in its later lines. Since step 3, what core cannot do is done here
// before anything is applied: Mermaid reads each diagram (as the AI box has it read), and a picture of another note
// has its bytes brought from the library.
import { compileNote, idTaken, NOTE_COMMANDS, type Doc, type NoteInput, type PictureSource } from '@shellnote/core'
import { checkDiagram } from '../diagram.js'
import { logChoice } from './choices.js'
import { drawnBoxes } from './view.js'
import type { Commands, Places } from './run.js'

/** The request the note's commands run for: what it made so far, a list a line, and whether it changed the note yet. */
interface Request {
  made: string[][]
  changed: boolean
  page?: number
}
let request: Request = { made: [], changed: false }

/**
 * A new request begins (the model asked, or lines typed and sent): its changes are one step of Undo, and its $1 the
 * first block it makes. The page it is about, when known: else the page in view as each line runs.
 */
export function beginNoteRequest(page?: number): void {
  request = { made: [], changed: false, ...(page !== undefined ? { page } : {}) }
}

/** The page in view, from 1. */
const inView = (places: Required<Pick<Places, 'note'>>): number => {
  const store = places.note.store
  return store.pageInView ? Math.max(1, store.doc.pages.indexOf(store.pageInView) + 1) : 1
}

/** This note's own pictures, so that one named is moved, never added again (pictures.ts). */
const ownPictures = (doc: Doc): PictureSource[] =>
  Object.values(doc.block).flatMap((block) => {
    const meta = block.type === 'image' ? doc.asset[block.asset] : undefined
    return block.type === 'image' && meta ? [{ hash: block.asset, meta, note: doc.title, here: block.id, ...(block.alt ? { alt: block.alt } : {}), ...(block.caption ? { caption: block.caption } : {}) }] : []
  })

export function defineContent(commands: Commands): void {
  for (const spec of NOTE_COMMANDS) {
    commands.define(spec.name, ['note'], async (input, places) => {
      // Read-only here (another window edits the note), as every command that changes the note is.
      if (places.workspace && !places.workspace.editing()) throw new Error('This note is read-only here: it is being edited in another window.')
      const store = places.note.store
      // The library's pictures, read only for a line that places one.
      const pictures = spec.name === 'picture.add' ? [...ownPictures(store.doc), ...((await places.pictures?.list()) ?? [])] : undefined
      const doc = store.doc
      // $n: after names the last block line n made (after a whole list), any other the first.
      const after = input.after !== undefined && /^\$\d+$/u.test(String(input.after)) ? request.made[Number(String(input.after).slice(1)) - 1]?.at(-1) : undefined
      const compiled = compileNote(doc, spec.name, { ...(input as NoteInput), ...(after ? { after } : {}) }, {
        page: request.page ?? inView(places),
        drawn: drawnBoxes(doc),
        made: request.made.map((ids) => ids[0]!),
        taken: (id) => idTaken(doc, id),
        ...(pictures ? { pictures } : {}),
      })
      // Mermaid reads each diagram before it goes in: one it cannot read is refused with why, nothing applied.
      for (const src of compiled.diagrams ?? []) {
        const wrong = await checkDiagram(src)
        if (wrong !== null) throw new Error(`The diagram cannot go in: ${wrong}`)
      }
      // A picture's bytes, from the library, kept with this note before its block shows it.
      for (const hash of compiled.assets ?? []) {
        if (store.assets.blob(hash)) continue
        const bytes = await places.pictures?.bytes(hash)
        if (!bytes) throw new Error('That picture could not be read from the library: nothing was added.')
        await store.assets.add(bytes)
      }
      // The note may have changed while Mermaid or the library was read: the ops were made for the note as it was.
      if (store.doc !== doc) throw new Error('The note changed while this line was checked: nothing was added. Write it again.')
      if (compiled.ops.length > 0) {
        store.apply(compiled.ops, { origin: 'agent', ...(request.changed ? { join: true } : {}) })
        request.changed = true
      }
      if (compiled.made.length > 0) request.made.push(compiled.made)
      // The shape a recipe or the shape rules chose, its features only, for the choices log.
      if (compiled.choice && compiled.ops.length > 0) logChoice(store, compiled.choice, compiled.made)
      return compiled.said
    })
  }
}
