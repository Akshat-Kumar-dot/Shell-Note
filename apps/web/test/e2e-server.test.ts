// The end-to-end tests start their own server, from this checkout, on a port of
// their own: they never test one that is already running, such as a dev server
// left open from before a pull, which serves old code (found in Edge, 10
// October 2026).
import { afterEach, describe, expect, it, vi } from 'vitest'
import config, { E2E_PORT } from '../playwright.config.js'
import dev from '../vite.config.js'

function server() {
  const found = config.webServer
  if (found === undefined || Array.isArray(found)) throw new Error('one web server expected')
  return found
}

describe('the end-to-end server', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('is always started by the tests, never one found running', () => {
    expect(server().reuseExistingServer).toBe(false)
  })

  it('has a port of its own, apart from the dev server, and keeps to it', () => {
    expect(dev.server?.port).toBe(5190)
    expect(E2E_PORT).not.toBe(dev.server?.port)
    expect(server().url).toBe(`http://localhost:${E2E_PORT}`)
    expect(config.use?.baseURL).toBe(server().url)
    // Without --strictPort, Vite would move to the next free port and the tests would wait on the wrong one.
    expect(server().command).toContain(`--port ${E2E_PORT} --strictPort`)
  })

  it('bundles its dependencies apart from a dev server that may be open', async () => {
    expect(dev.cacheDir).toBe('node_modules/.vite')
    vi.stubEnv('SHELLNOTE_E2E', server().env?.SHELLNOTE_E2E ?? '')
    vi.resetModules()
    const { default: e2e } = await import('../vite.config.js')
    expect(e2e.cacheDir).toBe('node_modules/.vite-e2e')
  })
})
