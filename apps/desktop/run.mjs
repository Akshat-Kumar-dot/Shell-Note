// The desktop app's commands (Tauri 2), run with Node so they need nothing on
// the PATH but Node itself: Rust's cargo is added from where rustup puts it
// when a shell opened before Rust was installed does not have it.
//
//   node run.mjs dev        the app in a window, reloading as code changes (the web app on port 5194)
//   node run.mjs build      the Rust licence check, then the app built for release
//   node run.mjs smoke      opens the built app and checks it works (smoke.mjs)
//   node run.mjs e2e [args] the browser tests inside the built app (apps/web/e2e/fixtures.ts); args go to Playwright
//   node run.mjs web-dev    Tauri's beforeDevCommand: the web app's dev server on port 5194
//   node run.mjs web-build  Tauri's beforeBuildCommand: the web app built into apps/web/dist-desktop
//
// Port 5194 is the desktop app's own: 5190 is the web app, 5191 the browser tests, 5192 and 5193 the checks.
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = join(here, '../..')
const web = join(root, 'apps/web')
export const DEV_PORT = 5194
/** The web app as the desktop app ships it: apart from apps/web/dist, which `pnpm app` serves. */
export const OUT = join(web, 'dist-desktop')
/**
 * Where the built app goes: src-tauri/target (the copy you run), or, with SHELLNOTE_TARGET=check,
 * src-tauri/target/check, so the checks can build and run while your own copy is open (a running program
 * cannot be replaced on Windows).
 */
const targetDir = process.env.SHELLNOTE_TARGET ? join(here, 'src-tauri/target', process.env.SHELLNOTE_TARGET) : join(here, 'src-tauri/target')
const exe = join(targetDir, 'release/shellnote.exe')

/** The environment with cargo on the PATH, the build's own folder, and where the built app is. */
function withCargo() {
  const env = { ...process.env, CARGO_TARGET_DIR: targetDir, SHELLNOTE_EXE: exe }
  const cargoBin = join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.cargo', 'bin')
  const path = env.Path ?? env.PATH ?? ''
  if (existsSync(cargoBin) && !path.split(delimiter).includes(cargoBin)) {
    const key = 'Path' in env ? 'Path' : 'PATH'
    env[key] = `${cargoBin}${delimiter}${path}`
  }
  return env
}

/** Run Node on a script, here, and stop with its exit code if it fails. */
function node(script, args, env = process.env) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: here, stdio: 'inherit', env })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const tauri = (args) => node(createRequire(join(here, 'package.json')).resolve('@tauri-apps/cli/tauri.js'), args, withCargo())

const command = process.argv[2]
if (command === 'dev') {
  tauri(['dev'])
} else if (command === 'build') {
  node(join(root, 'scripts/licences-rust.mjs'), [], withCargo())
  tauri(['build', ...process.argv.slice(3)])
} else if (command === 'apps') {
  node(join(here, 'apps-check.mjs'), process.argv.slice(3), withCargo())
} else if (command === 'smoke') {
  node(join(here, 'smoke.mjs'), process.argv.slice(3), withCargo())
} else if (command === 'e2e') {
  // The browser tests, inside the app as built: each test opens a fresh copy (apps/web/e2e/fixtures.ts).
  if (!existsSync(exe)) {
    console.error(`No built app at ${exe}. Build it first: corepack pnpm desktop:build`)
    process.exit(1)
  }
  const cli = createRequire(join(root, 'package.json')).resolve('@playwright/test/cli')
  const result = spawnSync(process.execPath, [cli, 'test', '-c', join(web, 'playwright.config.ts'), ...process.argv.slice(3)], { cwd: root, stdio: 'inherit', env: { ...process.env, SHELLNOTE_APP: exe } })
  process.exit(result.status ?? 1)
} else if (command === 'web-dev') {
  const { createServer } = await import('vite')
  // Its own cache, so it never shares one with a dev server you run.
  const server = await createServer({ root: web, cacheDir: join(web, 'node_modules/.vite-desktop'), server: { port: DEV_PORT, strictPort: true } })
  await server.listen()
  server.printUrls()
} else if (command === 'web-build') {
  const { build } = await import('vite')
  // The app's pages come under its content security policy (tauri.conf.json): built for it (vite.config.ts).
  process.env.SHELLNOTE_CSP = '1'
  await build({ root: web, build: { outDir: OUT, emptyOutDir: true } })
  // The Rust packages' licence notices go with the app (scripts/licences-rust.mjs writes them).
  mkdirSync(join(OUT, 'licences'), { recursive: true })
  cpSync(join(here, 'licences/third-party-rust.txt'), join(OUT, 'licences/third-party-rust.txt'))
} else {
  console.error('Use: node run.mjs dev | build | smoke | apps | e2e | web-dev | web-build (SHELLNOTE_TARGET=check: a build of its own)')
  process.exit(1)
}
