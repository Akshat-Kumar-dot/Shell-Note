// Appearance: light, dark or the system's look, the app's own colour, and the paper in the dark theme.
import { commands } from '@shellnote/editor'
import { Monitor, Moon, Sun } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { ACCENTS, accentNow, appearanceNow, darkPaperNow, onAppearance, type Accent, type Appearance as Look } from '../theme.js'
import { SettingsPage, SettingsPart } from './Page.js'

const LOOKS: [Look, string, typeof Sun][] = [
  ['system', 'System', Monitor],
  ['light', 'Light', Sun],
  ['dark', 'Dark', Moon],
]
const ACCENT_NAMES: Record<Accent, string> = { graphite: 'Graphite', blue: 'Blue', teal: 'Teal', green: 'Green', amber: 'Amber', rose: 'Rose', red: 'Red' }

export function Appearance() {
  const look = useSyncExternalStore(onAppearance, appearanceNow)
  const accent = useSyncExternalStore(onAppearance, accentNow)
  const darkPaper = useSyncExternalStore(onAppearance, darkPaperNow)
  return (
    <SettingsPage title="Appearance" lead="Light or dark, the app's own colour, and the paper in the dark.">
      <SettingsPart title="Theme">
        <div className="segmented" role="radiogroup" aria-label="Appearance">
          {LOOKS.map(([value, label, Icon]) => (
            <button key={value} type="button" role="radio" aria-checked={look === value} data-command="settings.theme" onClick={() => commands.tap('settings.theme', { look: value })}>
              <Icon size={16} aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </SettingsPart>
      <SettingsPart title="Colour" hint="on the buttons, and what is chosen">
        <div className="accents" role="radiogroup" aria-label="Colour">
          {ACCENTS.map((name) => (
            <button key={name} type="button" role="radio" className="accent-choice" aria-checked={accent === name} aria-label={ACCENT_NAMES[name]} title={ACCENT_NAMES[name]} data-accent={name} data-command="settings.accent" onClick={() => commands.tap('settings.accent', { accent: name })}>
              <span aria-hidden />
            </button>
          ))}
          <span className="accent-name">{ACCENT_NAMES[accent]}</span>
        </div>
      </SettingsPart>
      <SettingsPart title="Paper in dark">
        <div className="segmented" role="radiogroup" aria-label="Paper in dark">
          {(
            [
              [false, 'White'],
              [true, 'Dark'],
            ] as const
          ).map(([dark, name]) => (
            <button key={name} type="button" role="radio" aria-checked={darkPaper === dark} data-command="settings.paper" onClick={() => commands.tap('settings.paper', { on: dark })}>
              {name}
            </button>
          ))}
        </div>
        <p className="settings-hint">In the dark theme, the paper can be dark too, its ink in colours that read on it. Printing is always on white.</p>
      </SettingsPart>
    </SettingsPage>
  )
}
