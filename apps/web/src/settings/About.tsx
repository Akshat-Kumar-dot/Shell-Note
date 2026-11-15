// About: which ShellNote this is, its licence, its source code, and the other projects it is built with.
import { inDesktopApp } from '@shellnote/editor'
import { SettingsPage, SettingsPart } from './Page.js'

const SOURCE = 'https://github.com/Akshat-Kumar-dot/Shell-Note'
const VERSION = typeof __SHELLNOTE_VERSION__ === 'string' && __SHELLNOTE_VERSION__ !== '' ? __SHELLNOTE_VERSION__ : undefined

export function About() {
  return (
    <SettingsPage title="About" lead="ShellNote: notes that hold typing and handwriting together, kept as files that are yours.">
      <SettingsPart title="This ShellNote">
        <dl className="set-facts">
          <div>
            <dt>Version</dt>
            <dd>{VERSION ?? 'Not known'}</dd>
          </div>
          <div>
            <dt>Running</dt>
            <dd>{inDesktopApp() ? 'The desktop app' : 'In the browser'}</dd>
          </div>
          <div>
            <dt>Licence</dt>
            <dd>Apache License 2.0</dd>
          </div>
        </dl>
      </SettingsPart>
      <SettingsPart title="More">
        <ul className="set-links">
          <li>
            <a href={SOURCE} target="_blank" rel="noreferrer">
              The source code, on GitHub
            </a>
          </li>
          <li>
            <a href={`${import.meta.env.BASE_URL}licences/third-party.txt`} target="_blank" rel="noreferrer">
              The other projects ShellNote is built with, and their licences
            </a>
          </li>
          <li>
            <a href={`${import.meta.env.BASE_URL}licences/fonts.txt`} target="_blank" rel="noreferrer">
              The fonts, and their licences
            </a>
          </li>
        </ul>
      </SettingsPart>
    </SettingsPage>
  )
}
