// How the library lies in its folder: folders are folders, each note is one
// .shellnote file named after its title, Recently deleted is a folder of its
// own, and a hidden folder holds what belongs to the library and to no note:
// thumbnails, the pen profile, and when and from where each deleted item went.
import { idFrom } from '@shellnote/core'
import { EXTENSION, fileName } from '../../storage/files.js'

/** The library's own hidden folder. */
export const HIDDEN = '.shellnote'
/** The folder deleted items wait in, for 30 days. */
export const BIN = 'Recently deleted'
/** The mark that a folder is a ShellNote library: without it, nothing in the folder is taken as deleted. */
export const MARK = `${HIDDEN}/library.json`
export const PEN_PROFILE = `${HIDDEN}/pen-profile.json`
export const previewPath = (note: string): string => `${HIDDEN}/previews/${note}.webp`
/** When a deleted item went, and from where: one small file for each, named after it, so two devices never write the same one for two items. */
export const recordPath = (name: string): string => `${HIDDEN}/deleted/${name}.json`

export const folderOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
export const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
export const join = (folder: string, name: string): string => (folder === '' ? name : `${folder}/${name}`)
export const inBin = (path: string): boolean => path === BIN || path.startsWith(`${BIN}/`)
/** Directly in Recently deleted: the item that was deleted itself, not what a deleted folder holds. */
export const binned = (path: string): boolean => folderOf(path) === BIN
/** Hidden: the library's own folder, and what other programs keep beside (names starting with a dot, as a write's temporary file does). */
export const isHidden = (path: string): boolean => path.split('/').some((part) => part.startsWith('.') || part.startsWith('~$'))
export const isNote = (path: string): boolean => path.toLocaleLowerCase().endsWith(EXTENSION) && !isHidden(path)

/** A folder's id: made from its place, so every device gives the same folder the same id. The top level has none. */
export const folderId = (path: string): string | null => (path === '' ? null : idFrom(`folder:${path}`))

/** A name a folder can have on any system: characters none allows become dashes. */
export function safeName(name: string): string {
  const visible = Array.from(name, (ch) => (ch < ' ' ? ' ' : ch)).join('')
  const safe = visible
    .replace(/[\\/:*?"<>|]+/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^\.+/u, '')
    .replace(/[. ]+$/u, '')
    .slice(0, 100)
  return safe === '' ? 'Untitled folder' : safe
}

/** A note's file name without the extension. */
export const stem = (name: string): string => (name.toLocaleLowerCase().endsWith(EXTENSION) ? name.slice(0, -EXTENSION.length) : name)

/**
 * A name not taken in a folder: the one wanted, then "name 2", "name 3". Names
 * differing only in case count as one, as Windows and macOS take them.
 */
export function freeName(wanted: string, extension: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((name) => name.toLocaleLowerCase()))
  for (let n = 1; ; n++) {
    const name = `${wanted}${n === 1 ? '' : ` ${n}`}${extension}`
    if (!used.has(name.toLocaleLowerCase())) return name
  }
}

/** The file name a note's title asks for, without the extension. */
export const titleStem = (title: string): string => stem(fileName(title))

/** True when a file's name is the one its title asks for, or that with a number after it. */
export function namedFor(name: string, title: string): boolean {
  const wanted = titleStem(title).toLocaleLowerCase()
  const have = stem(name).toLocaleLowerCase()
  return have === wanted || (have.startsWith(`${wanted} `) && /^\d+$/u.test(have.slice(wanted.length + 1)))
}
