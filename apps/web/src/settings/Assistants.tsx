// Assistants: other AI apps on this computer reaching the notes through ShellNote's MCP server (docs/mcp.md). The
// person's switch, which the server reads before every request; how to connect an app, with this library's folder
// filled in; and the latest edits assistants made, each also in its note's AI log, with Undo.
import { commands, inDesktopApp } from '@shellnote/editor'
import { hidden } from '@shellnote/library/tree'
import { Copy, ShieldCheck, ShieldOff } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { recentAssistantEdits, type AssistantEdit } from '../ai/assistants.js'
import { assistantsChanged } from '../commands.js'
import { library } from '../library/chosen.js'
import { SettingsPage, SettingsPart } from './Page.js'

const GUIDE = 'https://github.com/Akshat-Kumar-dot/Shell-Note/blob/main/docs/mcp.md'

/** What came of an edit, in words. */
const RESULT: Readonly<Record<string, string>> = { applied: 'changed', unchanged: 'nothing to change', declined: 'refused', failed: 'failed', stopped: 'stopped', answered: 'answered' }

/** When, as a person says it. */
const when = (at: number): string => new Date(at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

export function Assistants() {
  const folder = library.place()
  // A library kept in a folder, in the desktop app: the one the server works on.
  const usable = inDesktopApp() && folder !== undefined
  const round = useSyncExternalStore(assistantsChanged.subscribe, assistantsChanged.snapshot)
  const [on, setOn] = useState<boolean>()
  const [edits, setEdits] = useState<AssistantEdit[]>()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!usable) return
    let live = true
    void library.assistants().then(
      (allowed) => live && setOn(allowed),
      () => live && setOn(false),
    )
    return () => {
      live = false
    }
  }, [usable, round])

  useEffect(() => {
    if (!usable) return
    let live = true
    void library
      .list()
      .then((all) =>
        recentAssistantEdits(
          all.notes
            .filter((note) => !hidden(all, note))
            .sort((a, b) => b.edited - a.edited)
            .slice(0, 40),
        ),
      )
      .then(
        (found) => live && setEdits(found),
        () => live && setEdits([]),
      )
    return () => {
      live = false
    }
  }, [usable, round])

  const line = `node "<the server's file>\\shellnote-mcp.mjs" --library "${folder ?? '<your library folder>'}"`
  const copy = (): void => {
    void navigator.clipboard?.writeText(line).then(() => setCopied(true))
  }

  return (
    <SettingsPage title="Assistants" lead="Other AI apps on this computer can read and change your notes through ShellNote's MCP server, if you let them. Each change shows in its note's AI log, with Undo.">
      <SettingsPart title="Let assistants reach my notes">
        {usable ? (
          <>
            <div className="segmented" role="radiogroup" aria-label="Assistants">
              {(
                [
                  [true, 'On'],
                  [false, 'Off'],
                ] as const
              ).map(([allow, name]) => (
                <button key={name} type="button" role="radio" aria-checked={on === allow} disabled={on === undefined} data-command="settings.assistants" onClick={() => commands.tap('settings.assistants', { on: allow })}>
                  {name}
                </button>
              ))}
            </div>
            <p className="settings-line">
              {on === false ? <ShieldOff size={16} aria-hidden className="warn" /> : <ShieldCheck size={16} aria-hidden className="ok" />}
              <span>{on === undefined ? 'Checking…' : on ? 'On: an assistant you connect can read your notes and change their blocks. It cannot reach any other file, or the internet.' : 'Off: the server reads and changes nothing, and tells the AI app that you switched assistants off.'}</span>
            </p>
          </>
        ) : (
          <p className="settings-hint">Assistants work in the desktop app, with your notes kept in a folder: choose one in Sync and storage. The server works on that folder, and nothing else.</p>
        )}
      </SettingsPart>

      <SettingsPart title="Connect an AI app">
        <ol className="set-steps">
          <li>
            Get the server: in ShellNote's source code, <code>corepack pnpm install</code>, then <code>corepack pnpm mcp:build</code>.
          </li>
          <li>
            In your AI app's settings for MCP servers, add one called <code>shellnote</code> that runs:
            <span className="set-code">
              <code>{line}</code>
              <button type="button" className="sh-b" aria-label="Copy the line" title={copied ? 'Copied' : 'Copy the line'} onClick={copy}>
                <Copy size={15} aria-hidden />
              </button>
            </span>
          </li>
        </ol>
        <p className="settings-hint">
          The folder must be written as it is here. Every step, and what an assistant can and cannot do, is in{' '}
          <a href={GUIDE} target="_blank" rel="noreferrer">
            the guide to the MCP server
          </a>
          .
        </p>
      </SettingsPart>

      {usable ? (
        <SettingsPart title="What assistants changed" hint="the latest, newest first">
          {edits === undefined ? (
            <p className="set-quiet">Reading the notes' logs…</p>
          ) : edits.length === 0 ? (
            <p className="set-quiet">No assistant has changed a note yet.</p>
          ) : (
            <ul className="set-edits">
              {edits.map((edit) => (
                <li key={`${edit.note}:${edit.at}:${edit.asked}`}>
                  <a href={`#/note/${edit.note}`}>{edit.title}</a>
                  <span className="set-edit-what">{edit.asked || 'an edit'}</span>
                  <span className="set-edit-by">
                    {edit.by} · {when(edit.at)} · {RESULT[edit.result] ?? edit.result}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SettingsPart>
      ) : null}
    </SettingsPage>
  )
}
