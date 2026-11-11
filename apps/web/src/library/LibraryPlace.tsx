// Settings, in the desktop app: where the notes are kept. In the app itself,
// or in a folder the person chooses, where each note is a .shellnote file and
// a cloud service that copies the folder keeps every device's notes the same.
// Choosing a folder copies the notes into it, each read back and compared,
// and removes nothing from the app; going back brings in what was made in the
// folder, and leaves the folder as it is. The choice is the person's alone,
// made in the system's own dialog: no command makes it.
import { FolderOpen, FolderSync, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { library, folderLibrary } from './chosen.js'
import { copyLibrary } from './copy.js'
import { chooseLibraryFolder, forgetLibraryFolder } from './folder/desktopFiles.js'

export function LibraryPlace({ beforeChange }: { beforeChange?: (() => Promise<void>) | undefined }) {
  const place = library.place()
  const [doing, setDoing] = useState<string>()
  const [problem, setProblem] = useState<string | undefined>(() => library.problem())

  const progress = (words: string) => (done: number, of: number) => setDoing(`${words} ${done} of ${of}`)

  /** Into a folder: chosen, the notes copied and compared, then the app's page started again on it. */
  const toFolder = async (): Promise<void> => {
    setProblem(undefined)
    try {
      setDoing('Choose a folder…')
      const chosen = await chooseLibraryFolder()
      if (chosen === undefined) {
        setDoing(undefined)
        return
      }
      setDoing('Copying your notes into the folder…')
      await beforeChange?.()
      try {
        const folder = folderLibrary()
        await copyLibrary(library.app, folder, { onProgress: progress('Copying your notes into the folder:') })
        await folder.sync()
      } catch (error) {
        // Not all there: the app goes on keeping the notes itself, as before.
        await forgetLibraryFolder().catch(() => undefined)
        throw error
      }
      location.reload()
    } catch (error) {
      setDoing(undefined)
      setProblem(`Your notes stay in the app: ${(error as Error).message ?? String(error)}`)
    }
  }

  /** Back into the app: what the folder holds is brought in, and the folder left as it is. */
  const toApp = async (): Promise<void> => {
    setProblem(undefined)
    try {
      setDoing('Bringing your notes into the app…')
      await beforeChange?.()
      // The folder's notes are the ones worked on since: where both have a note, the folder's is the later.
      await copyLibrary(library, library.app, { replace: true, onProgress: progress('Bringing your notes into the app:') })
      await forgetLibraryFolder()
      location.reload()
    } catch (error) {
      setDoing(undefined)
      setProblem(`Your notes stay in the folder: ${(error as Error).message ?? String(error)}`)
    }
  }

  return (
    <section className="settings-part">
      <h3>Where your notes are kept</h3>
      <p className="settings-line">
        {place === undefined ? <FolderOpen size={16} aria-hidden /> : <FolderSync size={16} aria-hidden className="ok" />}
        <span data-testid="library-place">{place === undefined ? 'In the app, on this computer.' : `In the folder ${place}: each note is a .shellnote file, and folders are folders.`}</span>
      </p>
      {problem ? (
        <p className="settings-line">
          <TriangleAlert size={16} aria-hidden className="warn" />
          <span>{problem}</span>
        </p>
      ) : null}
      <button type="button" className="button" disabled={doing !== undefined} onClick={() => void (place === undefined ? toFolder() : toApp())}>
        {place === undefined ? 'Keep them in a folder…' : 'Keep them in the app instead'}
      </button>
      {/* Said as it changes, without being a second status line of the dialog's. */}
      <p className="settings-answer" aria-live="polite" data-testid="library-doing">
        {doing ?? ''}
      </p>
      <p className="settings-hint">
        {place === undefined
          ? 'Choose a folder inside OneDrive, Dropbox, Google Drive or iCloud Drive, and choose the same folder on your other devices: your notes are then the same on all of them, and what two devices wrote apart is merged, never lost. Your notes are copied into the folder; nothing is removed from the app.'
          : 'A cloud service that copies this folder keeps your notes the same on every device that uses it. What two devices wrote apart is merged, never lost. The app keeps its own copy of each note on this computer too. Going back to the app brings in what the folder holds, and leaves the folder as it is.'}
      </p>
    </section>
  )
}
