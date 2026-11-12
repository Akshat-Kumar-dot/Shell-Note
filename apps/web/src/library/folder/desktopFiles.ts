// The library's files in the desktop app: a folder on this computer, through
// the app's own commands (apps/desktop/src-tauri/src/library.rs). The page
// never names a folder. It says which of two it means: "shared", the folder
// the person chose in the system's dialog, or "own", this device's copies in
// the app's data folder; the Rust side keeps the choice, and refuses any path
// that would leave the folder.
import { invoke } from '@tauri-apps/api/core'
import type { FileInfo, Files } from '@shellnote/library'

export class DesktopFiles implements Files {
  constructor(private readonly rootName: 'shared' | 'own') {}

  list(): Promise<FileInfo[]> {
    return invoke<FileInfo[]>('library_list', { rootName: this.rootName })
  }

  async info(path: string): Promise<FileInfo | undefined> {
    return (await invoke<FileInfo | null>('library_info', { rootName: this.rootName, path })) ?? undefined
  }

  async read(path: string): Promise<Uint8Array> {
    return new Uint8Array(await invoke<ArrayBuffer>('library_read', { rootName: this.rootName, path }))
  }

  async write(path: string, bytes: Uint8Array): Promise<void> {
    // The bytes go as they are, not as text; the place in headers, which hold plain letters only.
    await invoke('library_write', bytes, { headers: { 'x-root': this.rootName, 'x-path': encodeURIComponent(path) } })
  }

  async move(from: string, to: string): Promise<void> {
    await invoke('library_move', { rootName: this.rootName, from, to })
  }

  async remove(path: string): Promise<void> {
    await invoke('library_remove', { rootName: this.rootName, path })
  }

  async makeFolder(path: string): Promise<void> {
    await invoke('library_make_folder', { rootName: this.rootName, path })
  }
}

/** The folder the library is kept in, as the person reads it; undefined while the app keeps the notes itself. */
export async function libraryFolder(): Promise<string | undefined> {
  return (await invoke<string | null>('library_folder')) ?? undefined
}

/** Ask the person for a folder, in the system's dialog. Undefined when they close it. */
export async function chooseLibraryFolder(): Promise<string | undefined> {
  return (await invoke<string | null>('library_choose')) ?? undefined
}

/** Keep the notes in the app again. The folder and all in it stay as they are. */
export async function forgetLibraryFolder(): Promise<void> {
  await invoke('library_forget')
}
