// Pictures in note control (step 3): a picture of another note named by its words or its note, never guessed; one this
// note shows already is moved, not added again.
import { describe, expect, it } from 'vitest'
import { pictureFrom, type PictureSource } from '../../src/note/pictures.js'

const meta = { mime: 'image/png', w: 800, h: 600, bytes: 1000 }
const SOURCES: PictureSource[] = [
  { hash: 'aa11', meta, alt: 'Circuit with a battery and a bulb', note: 'Electronics' },
  { hash: 'bb22', meta, alt: 'Ripple tank photo', note: 'Waves', here: 'gi' },
  { hash: 'cc33', meta, caption: 'The **double slit**', note: 'Optics' },
  { hash: 'dd44', meta, alt: 'Circuit board close up', note: 'Electronics' },
  { hash: 'ee55', meta, alt: 'Prism', note: 'Light notes' },
]

const found = (written: string): string => {
  const one = pictureFrom(written, SOURCES)
  return one.ok ? one.source.hash : one.why
}

describe('a picture named in words', () => {
  it('by its description or caption, whole, how it starts, or every word of it', () => {
    expect(found('Circuit with a battery and a bulb')).toBe('aa11')
    expect(found('the double slit')).toBe('cc33')
    expect(found('the battery and bulb circuit')).toBe('aa11')
    expect(found('prism')).toBe('ee55')
  })

  it('with its note, which narrows it, or its note alone when the note has one picture', () => {
    expect(found('the circuit board from my Electronics note')).toBe('dd44')
    expect(found('the picture in the Light notes note')).toBe('ee55')
    expect(found('the photo from the note Optics')).toBe('cc33')
  })

  it('offers both when two fit, and says what there is when none does', () => {
    expect(found('the circuit')).toMatch(/^2 pictures fit "the circuit": “Circuit with a battery and a bulb” in “Electronics”; “Circuit board close up” in “Electronics”/u)
    expect(found('a volcano')).toMatch(/^No picture the agent may place fits "a volcano"\. Pictures in the library: /u)
    expect(found('the circuit from my Chemistry note')).toMatch(/^No note "Chemistry" has a picture\./u)
  })

  it('moves one this note shows already, never adding it twice', () => {
    expect(found('the ripple tank photo')).toMatch(/This note shows that picture already \(gi\): block: move block=gi/u)
  })
})
