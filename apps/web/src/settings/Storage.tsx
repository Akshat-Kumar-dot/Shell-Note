// Sync and storage: where the notes are kept (in the app, or a folder the person chooses, which OneDrive or Dropbox
// can carry to their other devices: LibraryPlace.tsx), how much of this browser's or the app's storage they use,
// whether it has agreed not to clear them, and the plain truth that a saved .shellnote file is the copy that lasts.
import { commands, inDesktopApp, inWindowsApp } from '@shellnote/editor'
import { HardDrive, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { lastKeepAnswer } from '../commands.js'
import { library } from '../library/chosen.js'
import { LibraryPlace } from '../library/LibraryPlace.js'
import { SettingsPage, SettingsPart } from './Page.js'

/** A size in bytes, in words. */
function size(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/**
 * Where asking the browser to keep the notes stands. Edge and Chrome never show
 * a question: they answer at once, yes for a site they count as important and a
 * silent no otherwise, so the answer is always shown here, a no too (found in
 * Edge, where the button seemed to do nothing).
 */
type Asking = 'not asked' | 'asking' | 'refused'

export function Storage() {
  const [usage, setUsage] = useState<{ used: number; quota: number }>()
  const [safe, setSafe] = useState<boolean>()
  const [asking, setAsking] = useState<Asking>('not asked')
  // Inside the app the notes are kept by WebView2, the system's web view the app runs in, not by a browser.
  const app = inDesktopApp()
  const keeper = app ? 'WebView2, which the app runs in,' : 'The browser'
  const canAsk = typeof navigator.storage?.persist === 'function'

  useEffect(() => {
    let live = true
    void navigator.storage?.estimate?.().then((estimate) => live && setUsage({ used: estimate.usage ?? 0, quota: estimate.quota ?? 0 }))
    void (navigator.storage?.persisted?.() ?? Promise.resolve(false)).then((persisted) => live && setSafe(persisted))
    return () => {
      live = false
    }
  }, [])

  /** settings.keepStorage, and the browser's answer to it. */
  const askToKeep = async (): Promise<void> => {
    setAsking('asking')
    let kept = false
    try {
      await commands.do('settings.keepStorage')
      kept = lastKeepAnswer()
    } catch {
      // It cannot be asked here: a no.
    }
    setSafe(kept)
    setAsking(kept ? 'not asked' : 'refused')
  }

  return (
    <SettingsPage title="Sync and storage" lead="Where your notes are kept, and how safe that place is.">
      {inWindowsApp() ? <LibraryPlace /> : null}
      <SettingsPart title={app ? 'Storage in the app' : 'Storage in this browser'}>
        <p className="settings-line">
          <HardDrive size={16} aria-hidden />
          <span data-testid="storage-used">{usage ? `Your notes and pictures use ${size(usage.used)}${usage.quota ? ` of about ${size(usage.quota)} ${app ? 'the app may use' : 'this browser allows'}` : ''}.` : 'Measuring…'}</span>
        </p>
        <p className="settings-line">
          {safe ? <ShieldCheck size={16} aria-hidden className="ok" /> : <TriangleAlert size={16} aria-hidden className="warn" />}
          <span>{safe === undefined ? 'Checking…' : safe ? `${keeper} has agreed not to clear them by itself.` : `${keeper} may clear them by itself when space runs low.`}</span>
        </p>
        {safe === false && canAsk ? (
          <button type="button" className="button" disabled={asking === 'asking'} data-command="settings.keepStorage" onClick={() => void askToKeep()}>
            {asking === 'asking' ? 'Asking…' : asking === 'refused' ? 'Ask again' : app ? 'Ask WebView2 to keep them' : 'Ask the browser to keep them'}
          </button>
        ) : null}
        <p className="settings-answer" role="status">
          {asking === 'refused'
            ? app
              ? 'WebView2 said no, for now: it decides by itself, as Edge does, and never asks you. You can ask again later.'
              : 'The browser said no, for now. Edge and Chrome never ask you: they decide by themselves, and say yes to a site they count as important, such as one you have bookmarked, installed as an app or use often. You can ask again later.'
            : ''}
        </p>
        <p className="settings-hint">
          {library.place() !== undefined
            ? 'Your notes are files in the folder above; this is the copy of each the app keeps on this computer beside them.'
            : `${app ? 'What the app keeps is on this computer only, in its own folder.' : 'A browser can still clear what it keeps, for example when you clear its history.'} The copy that lasts is a .shellnote file: open a note and choose Save.`}
        </p>
      </SettingsPart>
    </SettingsPage>
  )
}
