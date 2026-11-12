// The person's pen profile (core's schema/profile.ts) lives in the library
//: read once as the app starts into the
// editor's penProfile, which the pen learns from, and kept again each time it
// changes: a recording taught, a correction undone, the profile forgotten.
import { penProfile } from '@shellnote/editor'
import type { LibraryStore } from '@shellnote/library'

/** Read the profile into the pen, then keep every change to it, one write after another. */
export async function loadPenProfile(library: LibraryStore): Promise<void> {
  let writing = Promise.resolve()
  const keep = (): void => {
    const profile = penProfile.value
    writing = writing.then(() => library.setPenProfile(profile)).catch((error: unknown) => console.warn('shellnote: the pen profile could not be kept', error))
  }
  try {
    const kept = await library.penProfile()
    // One set meanwhile (taught on this page before the library was read) is newer, and is kept instead.
    if (penProfile.value) keep()
    else if (kept) penProfile.set(kept)
  } catch (error) {
    console.warn('shellnote: the pen profile could not be read', error)
  }
  penProfile.subscribe(keep)
}
