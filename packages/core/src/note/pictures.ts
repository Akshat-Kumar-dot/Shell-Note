// Pictures in note control (step 3;, 24 October 2026): only pictures the person already has, from the person's other
// notes in the library (which keeps each picture once, by the SHA-256 of its bytes, so it goes into this note with no
// file). A model sees no picture: it names one by its description, its caption or the note it is in ("the circuit
// photo from my Electronics note"). Never a guess: two that fit are offered, none that fits says what there is. A
// picture this note shows already is moved (block: move), not added again.
import type { Asset } from '../schema/doc.js'

/** A picture the agent may place: its bytes' hash and metadata, its words, and the note it is in. */
export interface PictureSource {
  hash: string
  meta: Asset
  alt?: string
  caption?: string
  /** The note it is in, by its title. */
  note: string
  /** In the note open now, by its block's id: then it is moved, not added. */
  here?: string
}

export type PictureFound = { ok: true; source: PictureSource } | { ok: false; why: string }

const plain = (text: string): string => text.normalize('NFKC').toLowerCase().replace(/[“”"'‘’]/gu, '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/gu, ' ').trim()
/** Words that name no picture in particular: "the photo", "a picture of". */
const LOOSE = new Set('the a an my this that of picture pictures photo photos image images figure drawing diagram from in on note notes'.split(' '))
const wordsIn = (text: string): string[] => plain(text).split(' ').filter((word) => word !== '' && !LOOSE.has(word))

/** A picture in a list of those that fit: its words and its note. */
const offer = (one: PictureSource): string => `“${one.alt ?? one.caption ?? 'no description'}” in “${one.note}”${one.here ? ` (${one.here}, in this note)` : ''}`

/** "… from my Electronics note", "… in the note Electronics": the note named, and the rest. */
function noteNamed(written: string): { words: string; note?: string } {
  const at = /^(.*?)\s+(?:from|in|of)\s+(?:my\s+|the\s+)?(?:note\s+(?:called\s+|named\s+)?["“']?(.+?)["”']?|["“']?(.+?)["”']?\s+note)$/iu.exec(written.trim())
  return at ? { words: at[1]!, note: (at[2] ?? at[3])!.trim() } : { words: written }
}

/** The picture a model names, among those it may place. */
export function pictureFrom(written: string, sources: readonly PictureSource[]): PictureFound {
  const said = noteNamed(written)
  const fromNote = said.note === undefined ? sources : sources.filter((one) => plain(one.note) === plain(said.note!) || plain(one.note).startsWith(plain(said.note!)))
  if (said.note !== undefined && fromNote.length === 0) {
    const notes = [...new Set(sources.map((one) => one.note))].slice(0, 8)
    return { ok: false, why: `No note "${said.note}" has a picture.${notes.length > 0 ? ` Notes with pictures: ${notes.map((note) => `“${note}”`).join(', ')}.` : ' No note in the library has one.'}` }
  }
  const wanted = plain(said.words)
  const words = wordsIn(said.words)
  const textOf = (one: PictureSource): string[] => [one.alt, one.caption].filter((text): text is string => text !== undefined && text.trim() !== '').map(plain)
  // Its description or caption whole, then how one starts, then every word of the request in one.
  const whole = fromNote.filter((one) => textOf(one).some((text) => text === wanted))
  const starting = wanted.length >= 3 ? fromNote.filter((one) => textOf(one).some((text) => text.startsWith(wanted))) : []
  const every = words.length > 0 ? fromNote.filter((one) => textOf(one).some((text) => words.every((word) => text.split(' ').some((other) => other === word || other.startsWith(word))))) : []
  // Only the note named, when the words name no picture of it in particular: its one picture.
  const only = words.length === 0 && said.note !== undefined ? fromNote : []
  const fits = [whole, starting, every, only].find((list) => list.length > 0) ?? []
  // The same picture in two notes is one picture.
  const unique = [...new Map(fits.map((one) => [one.hash, one])).values()]
  if (unique.length === 1) {
    const one = fits.find((fit) => fit.here) ?? unique[0]!
    if (one.here) return { ok: false, why: `This note shows that picture already (${one.here}): block: move block=${one.here} puts it where you want; picture: add is for a picture of another note.` }
    return { ok: true, source: one }
  }
  if (unique.length > 1) return { ok: false, why: `${unique.length} pictures fit "${written}": ${unique.slice(0, 6).map(offer).join('; ')}. Name one by more of its words, or with its note: … from the note "…".` }
  const some = sources.filter((one) => !one.here).slice(0, 8)
  return { ok: false, why: `No picture the agent may place fits "${written}".${some.length > 0 ? ` Pictures in the library: ${some.map(offer).join('; ')}.` : ' The library has no picture outside this note.'}` }
}
