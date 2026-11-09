// The licence check. Every package the code depends on, all the way down, must
// be under a licence the person allowed: MIT, Apache-2.0, MPL-2.0 or ISC.
// Anything else needs the person's word, one package at a time, and is listed
// in EXCEPTIONS with the version that was checked. A new package, or a new
// major version, under any other licence makes the check fail, so nothing slips
// in unseen.
//
// Only what can ship is checked: each workspace package's dependencies, never
// its devDependencies. Build and test tools (TypeScript, Vitest, ESLint,
// Playwright…) stay on the developer's machine.
//
// It also writes apps/web/public/licences/third-party.txt: the licence texts of
// the excepted packages, so each copy of the app carries their notices, as the
// font licences do in fonts.txt.
//
// Run: corepack pnpm licences. A test fails when the check fails or the file is stale.
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = join(root, 'apps/web/public/licences/third-party.txt')

/** Allowed for any package. */
export const ALLOWED = ['MIT', 'Apache-2.0', 'MPL-2.0', 'ISC']

/**
 * The person's exceptions, each for one package at the version that was checked
 * (`version` is a prefix: "2." means any 2.x). `ship`: its licence text goes
 * into third-party.txt. `file`: its package.json names no licence, so its
 * licence file is read instead.
 */
export const EXCEPTIONS = [
 { name: '@fontsource/*', version: '5.', licence: 'OFL-1.1', why: 'font files only; their licences ship in fonts.txt' },
  { name: 'd3-sankey', version: '0.12.', licence: 'BSD-3-Clause', ship: true, why: 'Mermaid uses it' },
  { name: 'd3-array', version: '2.', licence: 'BSD-3-Clause', ship: true, why: 'an older version only d3-sankey uses' },
  { name: 'd3-shape', version: '1.', licence: 'BSD-3-Clause', ship: true, why: 'an older version only d3-sankey uses' },
  { name: 'd3-path', version: '1.', licence: 'BSD-3-Clause', ship: true, why: 'an older version only d3-sankey uses' },
  { name: 'd3-ease', version: '3.', licence: 'BSD-3-Clause', ship: true, why: "part of D3 itself: its transitions use it" },
  { name: 'rw', version: '1.', licence: 'BSD-3-Clause', ship: true, why: "only d3-dsv's command-line tools use it" },
  { name: 'robust-predicates', version: '3.', licence: 'Unlicense', ship: true, why: "delaunator uses it, which D3 uses" },
  { name: 'khroma', version: '2.', licence: 'MIT', file: true, why: "Mermaid uses it; its package.json names no licence, and its licence file is MIT" },
]

const readJson = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))

/** Where `name` resolves from `from`, as Node finds it: the nearest node_modules on the way up. */
function find(from, name) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate)
    if (dirname(dir) === dir) return undefined
  }
}

/** A package.json's licence, as an SPDX expression; undefined when it names none. */
function licenceOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license
  if (pkg.license?.type) return pkg.license.type
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(' OR ')
  return undefined
}

/** Every package the workspace's code depends on, all the way down, once each, sorted. */
export function shipped() {
  const found = new Map()
  const visit = (dir, via) => {
    const real = realpathSync(dir)
    if (found.has(real)) return
    const pkg = readJson(real)
    found.set(real, { name: pkg.name, version: pkg.version, licence: licenceOf(pkg), dir: real, via })
    // Optional dependencies count when they are installed; peer dependencies are another package's own.
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
      const at = find(real, name)
      if (at !== undefined) visit(at, `${pkg.name}@${pkg.version}`)
    }
  }
  for (const group of ['packages', 'apps']) {
    for (const name of readdirSync(join(root, group)).sort()) {
      const dir = join(root, group, name)
      if (existsSync(join(dir, 'package.json'))) visit(dir, 'the workspace')
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version, 'en', { numeric: true }))
}

/** Whether an SPDX expression is allowed: "MIT", "(MPL-2.0 OR Apache-2.0)", "MIT OR Apache-2.0". */
function allowed(expression) {
  const clean = expression.replace(/[()]/g, '').trim()
  if (/ OR /iu.test(clean)) return clean.split(/ OR /iu).some(allowed)
  if (/ AND /iu.test(clean)) return clean.split(/ AND /iu).every(allowed)
  return ALLOWED.includes(clean)
}

/** The text of a package's licence file. */
export function licenceText(dir) {
  const file = readdirSync(dir).find((name) => /^(?:licen[cs]e|unlicense|copying)(?:\.(?:md|txt))?$/iu.test(name))
  if (file === undefined) throw new Error(`No licence file in ${dir}`)
  return readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n').trim()
}

function matches(exception, pkg) {
  const name = exception.name.endsWith('/*') ? pkg.name.startsWith(exception.name.slice(0, -1)) : pkg.name === exception.name
  if (!name || !pkg.version.startsWith(exception.version)) return false
  if (exception.file) return pkg.licence === undefined && pkg.dir !== '' && /\bMIT License\b/iu.test(licenceText(pkg.dir))
  return pkg.licence === exception.licence
}

/**
 * What is wrong: packages under a licence that is neither allowed nor excepted,
 * and exceptions nothing needs any more. Empty when all is well.
 */
export function problems(packages = shipped()) {
  const out = []
  for (const pkg of packages) {
    if (pkg.licence !== undefined && allowed(pkg.licence)) continue
    if (EXCEPTIONS.some((exception) => matches(exception, pkg))) continue
    out.push(`${pkg.name}@${pkg.version} is under ${pkg.licence ?? 'no named licence'} (brought in by ${pkg.via}). Ask the maintainer before adding it.`)
  }
  for (const exception of EXCEPTIONS) {
    if (!packages.some((pkg) => matches(exception, pkg))) out.push(`The exception for ${exception.name} ${exception.version}x is no longer needed: remove it.`)
  }
  return out
}

/** apps/web/public/licences/third-party.txt: the licence texts of the excepted packages that ship. */
export function thirdParty(packages = shipped()) {
  const rule = '='.repeat(78)
  const parts = [
    'Code bundled with ShellNote under licences other than MIT, Apache-2.0, MPL-2.0 and ISC',
    '',
    "These packages come with Mermaid, for the diagrams; each was checked one at a time against the project's licence policy. Each package's licence text follows its name.",
    '',
  ]
  for (const pkg of packages.filter((p) => EXCEPTIONS.some((exception) => exception.ship && matches(exception, p)))) {
    parts.push(rule, `${pkg.name} ${pkg.version} (${pkg.licence})`, rule, '', licenceText(pkg.dir), '')
  }
  return parts.join('\n')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const packages = shipped()
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, thirdParty(packages))
  const found = problems(packages)
  if (found.length > 0) {
    console.error(`${found.length} licence problem${found.length === 1 ? '' : 's'}:\n${found.map((p) => `- ${p}`).join('\n')}`)
    process.exitCode = 1
  } else {
    console.log(`${packages.length} packages, every licence allowed. Wrote ${out}`)
  }
}
