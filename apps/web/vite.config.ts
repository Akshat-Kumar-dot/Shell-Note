import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'

/**
 * The desktop app's content security policy (apps/desktop/src-tauri/tauri.conf.json), as one header. With
 * SHELLNOTE_CSP=1 (the desktop build, and the browser tests inside the app) the server sends it with every page, so
 * every test checks the page under the policy the app ships with.
 */
function desktopPolicy(): string {
  const conf = JSON.parse(readFileSync(new URL('../desktop/src-tauri/tauri.conf.json', import.meta.url), 'utf8')) as { app: { security: { csp: Record<string, string> } } }
  return Object.entries(conf.app.security.csp)
    .map(([directive, sources]) => `${directive} ${sources}`)
    .join('; ')
}

const underPolicy = process.env.SHELLNOTE_CSP === '1'

/** Under the policy, the page first tells Zod not to make code at run time (public/no-compiled-checks.js says why). */
const noCompiledChecks: Plugin = {
  name: 'shellnote:no-compiled-checks',
  transformIndexHtml: () => [{ tag: 'script', attrs: { defer: true, src: '/no-compiled-checks.js' }, injectTo: 'head-prepend' }],
}

export default defineConfig({
  plugins: [react(), ...(underPolicy ? [noCompiledChecks] : [])],
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
