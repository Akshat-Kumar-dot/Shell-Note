// Settings' own column, in the library column's place while Settings shows, on the side the library's column keeps:
// its eight sections, each one click away.
import type { SettingsSection } from '@shellnote/core'
import { commands } from '@shellnote/editor'
import { CloudCheck, Info, Palette, PenLine, Settings, SlidersHorizontal, Sparkles, Workflow, type LucideIcon } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { SECTION_WORDS } from '../commands.js'
import { treeAt } from '../shell/state.js'

const SECTIONS: readonly [SettingsSection, LucideIcon][] = [
  ['general', Settings],
  ['appearance', Palette],
  ['customise', SlidersHorizontal],
  ['pen', PenLine],
  ['ai', Sparkles],
  ['assistants', Workflow],
  ['storage', CloudCheck],
  ['about', Info],
]

export function SettingsNav({ section }: { section: SettingsSection }) {
  const at = useSyncExternalStore(treeAt.subscribe, treeAt.snapshot)
  return (
    <nav className="tree set-nav" data-at={at} aria-label="Settings">
      <div className="tree-head">
        <b>Settings</b>
      </div>
      <div className="tree-list">
        <ul className="tree-items">
          {SECTIONS.map(([id, Icon]) => (
            <li key={id}>
              <button type="button" className="tree-row" aria-current={id === section ? 'page' : undefined} data-command="settings.open" onClick={() => commands.tap('settings.open', { section: id })}>
                <Icon size={16} strokeWidth={1.75} aria-hidden />
                <span className="tree-name">{SECTION_WORDS[id]}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  )
}
