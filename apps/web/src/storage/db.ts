// A small promise wrapper around IndexedDB, the browser's own database: just
// what the app needs, with no library. Version 1 had two stores: `note`, the
// one open note, and `assets`, pictures' bytes by SHA-256. Version 2 adds the
// library: `notes` (one small entry per note), `docs` (each whole note),
// `previews` (each note's thumbnail), `folders`, and `meta` (what has been
// done once, such as moving the version 1 note into the library). The `note`
// store is kept: the move copies from it and never deletes it. Version 3 adds
// `logs`: each note's AI edit log, kept beside the note and never in its file.
import { inDesktopApp, tabWord } from '@shellnote/editor/host'

const NAME = 'shellnote'
const VERSION = 3
const STORES = ['note', 'assets', 'notes', 'docs', 'previews', 'folders', 'meta', 'logs'] as const
export type StoreName = (typeof STORES)[number]

const opened = new Map<string, Promise<IDBDatabase | undefined>>()

/** What keeps the notes, in what is said when it fails: the browser, or, inside the desktop app, the app. */
const keeper = (): string => (inDesktopApp() ? 'The app' : 'The browser')

/** The database by name; for the old name, undefined when it was never there. */
function database(name = NAME): Promise<IDBDatabase | undefined> {
  let opening = opened.get(name)
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      // The old database is opened at whatever version it has, and only read, so asking for it must not make it.
      const request = name === NAME ? indexedDB.open(name, VERSION) : indexedDB.open(name)
      request.onupgradeneeded = () => {
        if (name !== NAME) {
          request.transaction?.abort()
          return
        }
        // New stores are added; none is ever removed here.
        for (const store of STORES) if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store)
      }
      request.onblocked = () => reject(new Error(`Another ${tabWord()} still has an older ShellNote open. Close or reload it, then reload this ${tabWord()}.`))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => (name === NAME ? reject(request.error ?? new Error(`${keeper()} would not open its storage.`)) : resolve(undefined))
    })
    opened.set(name, opening)
  }
  return opening
}

/** One value, or undefined when there is none. */
export async function get<T>(store: StoreName, key: string, name = NAME): Promise<T | undefined> {
  const db = await database(name)
  if (!db?.objectStoreNames.contains(store)) return undefined
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).get(key)
    request.onsuccess = () => resolve(request.result as T | undefined)
    request.onerror = () => reject(request.error ?? new Error(`${keeper()} could not read ${key}.`))
  })
}

/** Every key in a store. */
export async function keys(store: StoreName): Promise<string[]> {
  const db = (await database())!
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).getAllKeys()
    request.onsuccess = () => resolve(request.result.map(String))
    request.onerror = () => reject(request.error ?? new Error(`${keeper()} could not list what it keeps.`))
  })
}

/** A request's result, once it arrives. Awaiting it keeps its transaction open, so a transaction can read, then write. */
export function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error(`${keeper()} could not read what it keeps.`))
  })
}

/**
 * One transaction over several stores: everything in it is kept, or, if any
 * part fails, nothing is. `work` may await requests made in the transaction
 * (with `result`), and nothing else, or the browser closes the transaction.
 * Resolves with what `work` returns once the browser has written it all.
 */
export async function transact<T>(stores: readonly StoreName[], work: (pick: (store: StoreName) => IDBObjectStore) => Promise<T>): Promise<T> {
  const db = (await database())!
  const transaction = db.transaction(stores, 'readwrite')
  const finished = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error(`${keeper()} could not keep the change.`))
    transaction.onabort = () => reject(transaction.error ?? new Error(`${keeper()} stopped the change, perhaps for want of space. Nothing was changed.`))
  })
  let value: T
  try {
    value = await work((store) => transaction.objectStore(store))
  } catch (error) {
    try {
      transaction.abort()
    } catch {
      // Already finished or aborted.
    }
    await finished.catch(() => {})
    throw error
  }
  await finished
  return value
}
