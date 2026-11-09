// The terminal on every screen, its model
// the one the AI settings name, as the AI box's is.
import { commands, Terminal } from '@shellnote/editor'
import { pageFor } from '@shellnote/providers'
import { loadSettings, missing, modelFrom, savedKey } from './ai/settings.js'

// Thinking as the settings say: as the model is set, low, or off where LM Studio can switch it. Off is two and a half
// times faster on Gemma 4 and right less often (the agent test: E4B 56 of 65 tasks against 64), so the model's own
// way stays until one is chosen.
const model = () => {
  const chosen = loadSettings()
  const key = savedKey()
  return modelFrom(chosen, key, chosen.thinking ? { thinking: chosen.thinking } : {}) ?? missing(chosen, key)!
}

// No embedding model: in the agent test LM Studio's nomic was asked about 18
// requests and changed none; the verb meaning table, the inputs and the model's own fixes decide, and what they leave
// unclear is offered, never guessed.

declare global {
  interface Window {
    /** For the agent test (app control's step 6): the app's state line, as the agent reads it, on every screen. Development builds only. */
    __shellnoteState?: () => string
  }
}
if (import.meta.env.DEV) window.__shellnoteState = () => commands.state()

export function TerminalHost() {
  // The page by the model's size, or as chosen in Settings.
  return <Terminal model={model} page={() => pageFor(loadSettings().model, loadSettings().page ?? 'auto')} />
}
