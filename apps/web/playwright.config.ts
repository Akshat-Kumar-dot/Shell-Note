import { defineConfig } from '@playwright/test'

const ci = process.env.CI !== undefined

/**
 * The tests start their own server, from this checkout, on a port of their own,
 * and never test one that is already running: a dev server left open from
 * before a pull serves old code (found in testing). When something already
 * answers on this port, the run stops and says so.
 */
export const E2E_PORT = 5191
const url = `http://localhost:${E2E_PORT}`

// Locally the tests use the Microsoft Edge already installed, so no browser is
// downloaded. On CI they use Playwright's own Chromium.
export default defineConfig({
  testDir: './e2e',
  reporter: ci ? 'github' : 'list',
  use: { baseURL: url, ...(ci ? {} : { channel: 'msedge' }) },
  webServer: {
    command: `node node_modules/vite/bin/vite.js --port ${E2E_PORT} --strictPort`,
    url,
    reuseExistingServer: false,
    // Its own bundled dependencies too, so a dev server open beside it changes nothing (vite.config.ts). Inside the
    // desktop app, its pages come under the app's content security policy (SHELLNOTE_CSP=1 asks for it in Edge too;
    // =0 leaves it out in the app, to tell whether the policy is what a failing test meets).
    env: { SHELLNOTE_E2E: '1', ...(process.env.SHELLNOTE_APP && process.env.SHELLNOTE_CSP !== '0' ? { SHELLNOTE_CSP: '1' } : {}) },
    timeout: 60_000,
  },
})
