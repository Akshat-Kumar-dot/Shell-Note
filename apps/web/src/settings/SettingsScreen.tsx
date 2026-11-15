// Settings, as a tab: the section its column chose, as a page of its own. Every change shows at once, and nothing
// here can lose a note.
import type { SettingsSection } from '@shellnote/core'
import { PenSettingsPart } from '@shellnote/editor'
import type { ReactNode } from 'react'
import { AiSettingsPart } from '../ai/AiSettings.js'
import { About } from './About.js'
import { Appearance } from './Appearance.js'
import { Assistants } from './Assistants.js'
import { Customise } from './Customise.js'
import { General } from './General.js'
import { SettingsPage } from './Page.js'
import { Storage } from './Storage.js'

export function SettingsScreen({ section }: { section: SettingsSection }) {
  return (
    <div className="set" data-section={section}>
      <div className="set-in">{body(section)}</div>
    </div>
  )
}

function body(section: SettingsSection): ReactNode {
  switch (section) {
    case 'general':
      return <General />
    case 'appearance':
      return <Appearance />
    case 'customise':
      return <Customise />
    case 'pen':
      return (
        <SettingsPage title="Pen" lead="Your own pen settings, for every note. A note can keep its own as well: in the note, the pen's menu, Pen settings…, This note.">
          <PenSettingsPart />
        </SettingsPage>
      )
    case 'ai':
      return (
        <SettingsPage title="AI" lead="The model the AI uses, and where it runs: on this computer, or through OpenRouter.">
          <AiSettingsPart />
        </SettingsPage>
      )
    case 'assistants':
      return <Assistants />
    case 'storage':
      return <Storage />
    case 'about':
      return <About />
  }
}
