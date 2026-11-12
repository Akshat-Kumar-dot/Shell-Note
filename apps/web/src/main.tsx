import '@shellnote/editor/theme.css'
import '@shellnote/editor/fonts.css'
import './app.css'
import { inWindowsApp } from '@shellnote/editor'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App, library } from './App.js'
import { defineAppCommands } from './commands.js'
import { FRAMED, inAFrame } from './framed.js'
import { keepChoices } from './library/choices.js'
import { TerminalHost } from './TerminalHost.js'
import { applyAppearance, savedAppearance } from './theme.js'
import { WindowControls } from './WindowControls.js'

// The app's commands have their code before anything is on screen (app control).
defineAppCommands(library)
// The shapes the agent's recipes and shape rules choose, kept on this device (note control, step 5;).
keepChoices()

// The app's own title bar's room kept in every top bar from the first paint, so the app bar measures itself with it.
if (inWindowsApp()) document.documentElement.dataset.ownTitlebar = ''

// Light or dark before the first paint, so the app does not flash the other look.
applyAppearance(savedAppearance(), false)

const root = document.getElementById('root')!
// Inside another page's frame nothing of the app is drawn (framed.ts): there is nothing there to click.
if (inAFrame()) root.textContent = FRAMED
else {
  createRoot(root).render(
    <StrictMode>
      <div className="app-area">
        <App />
      </div>
      <TerminalHost />
      {/* The desktop app on Windows has no Windows title bar: its own minimise, maximise and close, on every screen. */}
      {inWindowsApp() ? <WindowControls /> : null}
    </StrictMode>,
  )
}
