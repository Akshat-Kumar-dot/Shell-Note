import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'

/** The app's content security policy, as the desktop app's configuration keeps it: one policy for the app and the website. */
function policy(): Record<string, string> {
  const conf = JSON.parse(readFileSync(new URL('../desktop/src-tauri/tauri.conf.json', import.meta.url), 'utf8')) as { app: { security: { csp: Record<string, string> } } }
  return conf.app.security.csp
}

const asText = (directives: Record<string, string>): string =>
  Object.entries(directives)
    .map(([directive, sources]) => `${directive} ${sources}`)
    .join('; ')

/**
 * The desktop app's content security policy (apps/desktop/src-tauri/tauri.conf.json), as one header. With
 * SHELLNOTE_CSP=1 (the desktop build, and the browser tests inside the app) the server sends it with every page, so
 * every test checks the page under the policy the app ships with.
 */
export function desktopPolicy(): string {
  return asText(policy())
}

/**
 * The website's policy: the app's, in the page itself. The site's host (GitHub Pages) sends no header of the site's
 * own, so the built page carries the policy in a meta tag, before anything else in it. Two things differ from the
 * app's: a meta tag cannot say who may frame the page (`frame-ancestors` is a header's alone; main.tsx refuses to
 * start in another site's frame), and the website has no channel to Rust (`ipc:`).
 */
export function websitePolicy(): string {
  const directives = Object.fromEntries(Object.entries(policy()).filter(([directive]) => directive !== 'frame-ancestors'))
  const connect = (directives['connect-src'] ?? '')
    .split(/\s+/u)
    .filter((source) => source !== 'ipc:' && source !== 'http://ipc.localhost')
    .join(' ')
  return asText({ ...directives, 'connect-src': connect })
}

const underPolicy = process.env.SHELLNOTE_CSP === '1'

/** Under a policy, the page first tells Zod not to make code at run time (public/no-compiled-checks.js says why). */
const noCompiledChecks = { tag: 'script', attrs: { defer: true, src: '/no-compiled-checks.js' }, injectTo: 'head-prepend' } as const

/** The desktop app and the tests under its policy: the policy comes as a header (Tauri's, or the test server's). */
const forDesktop: Plugin = {
  name: 'shellnote:no-compiled-checks',
  transformIndexHtml: () => [noCompiledChecks],
}

/**
 * The website as built (`pnpm build`): the policy as the page's first tag. Not while developing: the dev server
 * writes a script of its own into the page to reload it as code changes, which the policy would refuse.
 */
export const forWebsite: Plugin = {
  name: 'shellnote:website-policy',
  apply: 'build',
  // Tags asked for the same place go in as listed: the policy first, so it holds for everything after it.
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: websitePolicy() }, injectTo: 'head-prepend' }, noCompiledChecks],
}

export default defineConfig({
  plugins: [react(), underPolicy ? forDesktop : forWebsite],
  // The end-to-end tests run their own server, and may run while a dev server
  // is open: each bundles its dependencies into its own folder, so neither
  // replaces the other's files mid-run.
  cacheDir: process.env.SHELLNOTE_E2E ? 'node_modules/.vite-e2e' : 'node_modules/.vite',
  server: {
    port: 5190,
    strictPort: true,
    // Prepared as the server starts, so the first page to open does not wait.
    warmup: { clientFiles: ['./src/main.tsx'] },
    // Under the policy, no live reload: its script is written into the page, which the policy refuses, as the
    // built app has none.
    ...(underPolicy ? { hmr: false, headers: { 'Content-Security-Policy': desktopPolicy() } } : {}),
  },
  // `pnpm app`: the built app, at the same address as `pnpm dev`, since the
  // browser keeps the library and the settings per address.
  preview: { port: 5190, strictPort: true },
  // Bundled once, up front. Found one by one as the first page loads, each new
  // one would make the server reload every open page, as on a fresh checkout.
  optimizeDeps: {
    include: [
      'react',
      'react/jsx-runtime',
      'react-dom',
      'react-dom/client',
      '@shellnote/core > zod',
      '@shellnote/core > fflate',
      '@shellnote/editor > @tiptap/core',
      '@shellnote/editor > @tiptap/extension-bold',
      '@shellnote/editor > @tiptap/extension-code',
      '@shellnote/editor > @tiptap/extension-highlight',
      '@shellnote/editor > @tiptap/extension-italic',
      '@shellnote/editor > @tiptap/extension-strike',
      '@shellnote/editor > @tiptap/pm/dropcursor',
      '@shellnote/editor > @tiptap/pm/gapcursor',
      '@shellnote/editor > @tiptap/pm/model',
      '@shellnote/editor > @tiptap/pm/state',
      '@shellnote/editor > @tiptap/pm/tables',
      '@shellnote/editor > @tiptap/pm/view',
      // Loaded only when the first diagram is drawn, but bundled up front all the same.
      '@shellnote/editor > mermaid',
    ],
  },
})
