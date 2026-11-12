// Save and Open: the note as one .shellnote file, a zip in the format of
// docs/file-format.md, and the copy that lasts. Where the browser has the
// File System Access API (Chrome, Edge), Save asks once where to put the file
// and then writes to the same file again; elsewhere Save downloads a copy and
// Open uses the browser's file input.
import { pack, unpack, type Doc, type Opened } from '@shellnote/core'
import type { AssetStore } from '@shellnote/editor'
import { EXTENSION, fileName } from '@shellnote/library'

const TYPES = [{ description: 'shellnote note', accept: { 'application/zip': [EXTENSION] } }]
const OPENS = TYPES

/** The parts of the File System Access API this file uses. Only Chromium browsers have it. */
interface Pickers {
  showSaveFilePicker?: (options: { suggestedName: string; types: typeof TYPES }) => Promise<FileSystemFileHandle>
  showOpenFilePicker?: (options: { types: typeof OPENS; multiple: false }) => Promise<FileSystemFileHandle[]>
}
type Permission = 'granted' | 'denied' | 'prompt'
interface Permitted {
  queryPermission?: (options: { mode: 'readwrite' }) => Promise<Permission>
  requestPermission?: (options: { mode: 'readwrite' }) => Promise<Permission>
}

/** The note as file bytes, with the pictures its image blocks show. Pictures it no longer shows are left out. */
export async function noteBytes(doc: Doc, assets: AssetStore): Promise<Uint8Array> {
  const shown = new Set(Object.values(doc.block).flatMap((block) => (block.type === 'image' ? [block.asset] : [])))
  const bytes: Record<string, Uint8Array> = {}
  for (const hash of shown) {
    const blob = assets.blob(hash)
    if (blob) bytes[hash] = new Uint8Array(await blob.arrayBuffer())
  }
  return pack(doc, bytes)
}

/** Where a note was saved, or undefined when the person closed the file dialog. */
export type Saved = { name: string; handle?: FileSystemFileHandle } | undefined

/** Save the bytes: to the same file as before when the browser allows it and `saveAs` is not asked for; else to a file the person picks, or a download. */
export async function saveFile(bytes: Uint8Array, title: string, handle: FileSystemFileHandle | undefined, saveAs: boolean): Promise<Saved> {
  // pack() makes a fresh buffer, never a shared one.
  const zip = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' })
  const pickers = window as unknown as Pickers
  if (pickers.showSaveFilePicker) {
    let target = saveAs || !handle || !(await mayWrite(handle)) ? undefined : handle
    if (!target) {
      try {
        target = await pickers.showSaveFilePicker({ suggestedName: fileName(title), types: TYPES })
      } catch (error) {
        if (closed(error)) return undefined
        throw error
      }
    }
    const stream = await target.createWritable()
    await stream.write(zip)
    await stream.close()
    return { name: target.name, handle: target }
  }
  const name = fileName(title)
  const url = URL.createObjectURL(zip)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
  return { name }
}

/** A.shellnote file the person picks, or undefined when they close the dialog. */
export async function pickFile(): Promise<{ file: File; handle?: FileSystemFileHandle } | undefined> {
  const pickers = window as unknown as Pickers
  if (pickers.showOpenFilePicker) {
    try {
      const [handle] = await pickers.showOpenFilePicker({ types: OPENS, multiple: false })
      return handle ? { file: await handle.getFile(), handle } : undefined
    } catch (error) {
      if (closed(error)) return undefined
      throw error
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = EXTENSION
    input.addEventListener('change', () => resolve(input.files?.[0] ? { file: input.files[0] } : undefined))
    input.addEventListener('cancel', () => resolve(undefined))
    input.click()
  })
}

/** Read a file as a note: checked, and brought up to date. Throws a ValidationError with a hint when it is not a note. */
export async function readNote(file: Blob): Promise<Opened> {
  return unpack(new Uint8Array(await file.arrayBuffer()))
}

/** True when Save may write to a file picked before, asking the person again if the browser wants that. */
async function mayWrite(handle: FileSystemFileHandle): Promise<boolean> {
  const permitted = handle as FileSystemFileHandle & Permitted
  if (!permitted.queryPermission) return true
  const mode = { mode: 'readwrite' } as const
  return (await permitted.queryPermission(mode)) === 'granted' || (await permitted.requestPermission?.(mode)) === 'granted'
}

/** The person closed the file dialog. */
function closed(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
