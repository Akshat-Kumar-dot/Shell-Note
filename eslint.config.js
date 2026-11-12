// @ts-check
import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// packages/core must run unchanged in a browser, in Node and in a webview
//. So it may use neither browser-only globals (the DOM) nor
// Node-only globals. APIs both sides share, such as URL, TextEncoder and
// crypto.getRandomValues, stay allowed.
const shared = new Set([
  ...Object.keys(globals.builtin),
  ...Object.keys(globals['shared-node-browser']),
])
const browserOnly = Object.keys(globals.browser).filter((name) => !shared.has(name))
const nodeOnly = Object.keys(globals.node).filter((name) => !shared.has(name))
// Newer Node versions copy some browser APIs, so the lists above call them
// shared. Core is pure logic: it never stores, fetches or inspects its host.
const io = ['localStorage', 'sessionStorage', 'navigator', 'fetch', 'WebSocket']

const NO_DOM = 'packages/core must not touch the DOM. Pass browser behaviour in from the editor.'
const NO_NODE = 'packages/core must also run in browsers. Pass Node behaviour in from the caller.'
const NO_IO = 'packages/core is pure logic: no storage, network or host access. Pass it in from the caller.'
const NO_HOST = 'packages/library runs in a browser and in Node alike. Pass files and anything of the host in from the caller.'

export default defineConfig(
  globalIgnores(['**/dist/', '**/dist-check/', '**/dist-desktop/', '**/src-tauri/target/', '**/src-tauri/gen/', '**/coverage/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // Scripts, such as the benchmark spikes, run in Node.
    files: ['**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    // The VS Code companion runs in VS Code's Node, which loads it with require.
    files: ['apps/vscode-companion/extension/*.js'],
    languageOptions: { globals: globals.node, sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // The desktop app's checks run in Node and hand functions to the app's page, which run there (page.evaluate).
    files: ['apps/desktop/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // The editor and the app run in the browser.
    files: ['packages/editor/src/**/*.{ts,tsx}', 'apps/web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    // The app's configs and end-to-end tests run in Node.
    files: ['apps/web/*.ts', 'apps/web/e2e/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // The library runs in the app's page and in Node: it reaches files only through the Files it is given.
    files: ['packages/library/src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...browserOnly.map((name) => ({ name, message: NO_HOST })),
        ...nodeOnly.map((name) => ({ name, message: NO_HOST })),
        ...io.map((name) => ({ name, message: NO_HOST })),
      ],
      'no-restricted-imports': ['error', { patterns: [{ group: ['node:*', 'react', 'react/*', '@tauri-apps/*'], message: NO_HOST }] }],
    },
  },
  {
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...browserOnly.map((name) => ({ name, message: NO_DOM })),
        ...nodeOnly.map((name) => ({ name, message: NO_NODE })),
        ...io.map((name) => ({ name, message: NO_IO })),
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: ['react', 'react-dom', 'mermaid', 'mathlive', 'dompurify', 'jsdom', 'lexical'].map(
            (name) => ({ name, message: NO_DOM }),
          ),
          patterns: [
            { group: ['react/*', 'react-dom/*', '@tiptap/*', '@blocknote/*', '@lexical/*'], message: NO_DOM },
            { group: ['node:*'], message: NO_NODE },
          ],
        },
      ],
    },
  },
)
