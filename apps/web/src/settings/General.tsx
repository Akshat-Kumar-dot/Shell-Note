// General: the keys, everywhere in ShellNote, from the app's one list of them (the editor's keys.ts), which the
// buttons' hints read too.
import { KEYS } from '@shellnote/editor'
import { SettingsPage, SettingsPart } from './Page.js'

/** Keys to press, as "Ctrl+Shift+P" writes them: a cap for each key, and "or" between two ways. */
function Keys({ keys }: { keys: string }) {
  return (
    <>
      {keys.split(' or ').map((way, i) => (
        <span key={way} className="set-way">
          {i > 0 ? <span className="set-or">or</span> : null}
          {way.split('+').map((key, j) => (
            <kbd key={`${key}-${j}`}>{key}</kbd>
          ))}
        </span>
      ))}
    </>
  )
}

export function General() {
  return (
    <SettingsPage title="General" lead="The keys, everywhere in ShellNote. On a Mac, ⌘ stands for Ctrl.">
      {KEYS.map((group) => (
        <SettingsPart key={group.name} title={group.name}>
          <dl className="set-keys">
            {group.keys.map((line) => (
              <div key={`${line.keys} ${line.does}`}>
                <dt>
                  <Keys keys={line.keys} />
                </dt>
                <dd>{line.does}</dd>
              </div>
            ))}
          </dl>
        </SettingsPart>
      ))}
    </SettingsPage>
  )
}
