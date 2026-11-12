// The bytes of a note's pictures, kept beside the document while it is open.
// Core stores only each picture's metadata (doc.asset), keyed by the SHA-256
// of its bytes. This store keeps the bytes and gives each picture a local URL,
// so pictures show without the note loading anything from the internet.
import { hashBytes, type Asset } from '@shellnote/core'

/** The kinds of picture ShellNote takes: formats every browser shows. SVG is left out, since an SVG file can carry scripts. */
export const PICTURE_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']

/** The largest picture taken: 50 MiB. */
export const MAX_PICTURE_BYTES = 50 * 1024 * 1024

/** The video files a note takes: those Edge and other browsers play. */
export const VIDEO_TYPES: readonly string[] = ['video/mp4', 'video/webm']
/** The largest video taken: 300 MiB; a note lives in the browser's storage. */
export const MAX_VIDEO_BYTES = 300 * 1024 * 1024

/**
 * The type a note's picture or video is kept under in the page: its own when it is a kind ShellNote takes, else plain
 * bytes. A note can be someone else's file, and its file says what each asset is: one called an SVG picture or a web
 * page would get an address of this site's own, and opened by that address (a browser's "Open image in new tab") its
 * script would run as ShellNote, with the notes and the keys in reach. Plain bytes are shown as nothing and run as
 * nothing.
 */
export function shownType(mime: string): string {
  return PICTURE_TYPES.includes(mime) || VIDEO_TYPES.includes(mime) ? mime : 'application/octet-stream'
}

/** A picture ready to add: its key, and its metadata for doc.asset. */
export interface NewPicture {
  hash: string
  meta: Asset
}

/** The pictures among pasted or dropped files. */
export function pictureFiles(data: DataTransfer | null): File[] {
  return Array.from(data?.files ?? []).filter((file) => PICTURE_TYPES.includes(file.type))
}

export class AssetStore {
  readonly #blobs = new Map<string, Blob>()
  #urls: Readonly<Record<string, string>> = {}
  readonly #listeners = new Set<() => void>()

  /**
   * Keep a picture's bytes, and resolve to its key and metadata. The same
   * picture kept twice is kept once. Rejects, with a reason a person can
   * read, a file that is not a picture ShellNote can show.
   */
  async add(file: Blob): Promise<NewPicture> {
    if (!PICTURE_TYPES.includes(file.type)) {
      throw new Error(`Only PNG, JPEG, GIF, WebP and AVIF pictures can be added, not ${file.type || 'this file'}.`)
    }
    if (file.size > MAX_PICTURE_BYTES) {
      throw new Error(`This picture is ${Math.ceil(file.size / 2 ** 20)} MiB. The largest that can be added is 50 MiB.`)
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    const hash = await hashBytes(bytes)
    // A copy, so a file changed on disk later cannot change the note.
    const blob = new Blob([bytes], { type: file.type })
    const url = this.#urls[hash] ?? URL.createObjectURL(blob)
    let size: { w: number; h: number }
    try {
      size = await naturalSize(url)
    } catch {
      if (this.#urls[hash] !== url) URL.revokeObjectURL(url)
      throw new Error('This picture could not be read. The file may be damaged.')
    }
    if (this.#urls[hash] === undefined) {
      this.#blobs.set(hash, blob)
      this.#urls = { ...this.#urls, [hash]: url }
      this.#emit()
    } else if (this.#urls[hash] !== url) {
      // The same picture was added twice at once, and the other one got here first.
      URL.revokeObjectURL(url)
    }
    const known = size.w > 0 && size.h > 0 ? { w: size.w, h: size.h } : {}
    return { hash, meta: { mime: file.type, ...known, bytes: bytes.length } }
  }

  /**
   * Keep a video file's bytes, and resolve to its key and metadata, as add does for a picture. Rejects, with a reason
   * a person can read, a file that is not an MP4 or WebM video, or too big.
   */
  async addVideo(file: Blob): Promise<NewPicture> {
    if (!VIDEO_TYPES.includes(file.type)) throw new Error(`Only MP4 and WebM videos can be added, not ${file.type || 'this file'}.`)
    if (file.size > MAX_VIDEO_BYTES) throw new Error(`This video is ${Math.ceil(file.size / 2 ** 20)} MiB. The largest that can be added is 300 MiB: a shorter clip, perhaps.`)
    const bytes = new Uint8Array(await file.arrayBuffer())
    const hash = await hashBytes(bytes)
    if (this.#urls[hash] === undefined) {
      const blob = new Blob([bytes], { type: file.type })
      this.#blobs.set(hash, blob)
      this.#urls = { ...this.#urls, [hash]: URL.createObjectURL(blob) }
      this.#emit()
    }
    return { hash, meta: { mime: file.type, bytes: bytes.length } }
  }

  /**
   * Keep a picture's bytes read back from the browser's copy or a file, under
   * the key the note gives them. With `check`, the bytes must hash to that
   * key; resolves to false, keeping nothing, when they do not (the file was
   * damaged).
   */
  async put(hash: string, bytes: Blob, mime: string, check = false): Promise<boolean> {
    if (this.#urls[hash] !== undefined) return true
    if (check && (await hashBytes(new Uint8Array(await bytes.arrayBuffer()))) !== hash) return false
    // Never under a type the note's file made up (shownType), whatever type the bytes came with.
    const type = shownType(mime)
    const blob = bytes.type === type ? bytes : new Blob([bytes], { type })
    if (this.#urls[hash] !== undefined) return true
    this.#blobs.set(hash, blob)
    this.#urls = { ...this.#urls, [hash]: URL.createObjectURL(blob) }
    this.#emit()
    return true
  }

  /** A picture's bytes, for saving. */
  blob(hash: string): Blob | undefined {
    return this.#blobs.get(hash)
  }

  /** A local URL that shows the picture, while the store is open. */
  url(hash: string): string | undefined {
    return this.#urls[hash]
  }

  /** Listen for pictures being added. Returns the function that stops listening. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** Every picture's URL by key, for React's useSyncExternalStore. */
  snapshot = (): Readonly<Record<string, string>> => this.#urls

  /** Free every picture's memory, when the note is closed. */
  close(): void {
    for (const url of Object.values(this.#urls)) URL.revokeObjectURL(url)
    this.#urls = {}
    this.#blobs.clear()
    this.#emit()
  }

  #emit(): void {
    for (const listener of [...this.#listeners]) listener()
  }
}

/**
 * A picture's width and height in pixels, once the browser has read it.
 * The load event rather than decode(), which a browser may put off while the
 * page is hidden.
 */
function naturalSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ w: image.naturalWidth, h: image.naturalHeight })
    image.onerror = () => reject(new Error('The picture could not be read.'))
    image.src = url
  })
}
