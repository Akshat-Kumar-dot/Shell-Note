// The desktop app's Rust licence check, beside the npm one (licences.mjs).
// Every Rust package the app ships, on each Windows processor it is built for,
// must be under MIT, Apache-2.0, MPL-2.0 or ISC, or be one of the project's
// exceptions: the 24 packages Tauri brings under Unicode-3.0, BSD-3-Clause and
// Zlib (allowed on 18 October 2026). A new package under any other licence
// makes the check fail, so nothing slips in unseen.
//
// Only what ships counts: packages reached from the app through normal
// dependencies. A build script's or a macro's own dependencies run only while
// building, on the developer's machine.
//
// It writes apps/desktop/licences/third-party-rust.txt: the licence texts of
// the excepted packages, which the desktop build copies into the app.
//
// Run: corepack pnpm licences:rust (the desktop build runs it first).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = join(root, 'apps/desktop/src-tauri/Cargo.toml')
// Where rustup puts cargo, for a shell opened before Rust was installed.
const rustup = join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.cargo', 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo')
const cargo = existsSync(rustup) ? rustup : 'cargo'
const out = join(root, 'apps/desktop/licences/third-party-rust.txt')

/** The systems and processors the app is built for so far. Linux, the Mac and Android join as their apps come. */
export const TARGETS = ['x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc']

export const ALLOWED = ['MIT', 'Apache-2.0', 'MPL-2.0', 'ISC']

// The 17 of the first count, and zerovec-derive, a build-time helper of zerovec the person allowed the same
// day.
const ICU4X = ['icu_collections', 'icu_locale_core', 'icu_normalizer', 'icu_normalizer_data', 'icu_properties', 'icu_properties_data', 'icu_provider', 'litemap', 'potential_utf', 'tinystr', 'writeable', 'yoke', 'yoke-derive', 'zerofrom', 'zerofrom-derive', 'zerotrie', 'zerovec', 'zerovec-derive']

/** The person's exceptions: for the packages Tauri brings, by name and licence. */
export const EXCEPTIONS = [
  ...ICU4X.map((name) => ({ name, licence: 'Unicode-3.0', why: "the Unicode Consortium's ICU4X, used by url (through idna) for web addresses in any language" })),
  ...['alloc-no-stdlib', 'alloc-stdlib', 'brotli'].map((name) => ({ name, licence: 'BSD-3-Clause', why: "Brotli, which Tauri uses to pack the app's own files inside the program" })),
  { name: 'foldhash', licence: 'Zlib', why: 'a fast hash' },
  { name: 'zlib-rs', licence: 'Zlib', why: "zlib compression (flate2), for pictures such as the app's icons" },
]

/** Whether a licence expression is allowed: one OR branch made only of allowed ids. Old crates write "MIT/Apache-2.0". */
export function allowed(expression) {
  if (!expression) return false
  return expression
    .replace(/\//gu, ' OR ')
    .replace(/[()]/gu, ' ')
    .split(/\s+OR\s+/u)
    .some((branch) => {
      const ids = branch.split(/\s+AND\s+|\s+WITH\s+\S+/u).map((id) => id.trim()).filter(Boolean)
      return ids.length > 0 && ids.every((id) => ALLOWED.includes(id))
    })
}

/** The packages the app ships, for each target, merged: { name, version, licence, dir }. */
export function shipped() {
  const found = new Map()
  for (const target of TARGETS) {
    const args = ['metadata', '--format-version', '1', '--filter-platform', target, '--manifest-path', manifest]
    if (existsSync(join(dirname(manifest), 'Cargo.lock'))) args.push('--locked')
    const meta = JSON.parse(execFileSync(cargo, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }))
    const packages = new Map(meta.packages.map((p) => [p.id, p]))
    const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]))
    const seen = new Set()
    const stack = [meta.resolve.root]
    while (stack.length > 0) {
      for (const dep of nodes.get(stack.pop()).deps) {
        if (dep.dep_kinds.some((kind) => kind.kind === null) && !seen.has(dep.pkg)) {
          seen.add(dep.pkg)
          stack.push(dep.pkg)
        }
      }
    }
    for (const id of seen) {
      const p = packages.get(id)
      found.set(`${p.name}@${p.version}`, { name: p.name, version: p.version, licence: p.license ?? undefined, dir: dirname(p.manifest_path), licenceFile: p.license_file ?? undefined })
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version, 'en', { numeric: true }))
}

const excepted = (pkg) => EXCEPTIONS.find((e) => e.name === pkg.name && (pkg.licence ?? '').includes(e.licence))

/** What is wrong: shipped packages neither allowed nor excepted, and exceptions nothing needs any more. */
export function problems(packages = shipped()) {
  const out = []
  for (const pkg of packages) {
    if (allowed(pkg.licence) || excepted(pkg)) continue
    out.push(`${pkg.name} ${pkg.version} is under ${pkg.licence ?? 'no named licence'}. Ask the maintainer before shipping it.`)
  }
  for (const exception of EXCEPTIONS) {
    if (!packages.some((pkg) => pkg.name === exception.name)) out.push(`The exception for ${exception.name} is no longer needed: remove it.`)
  }
  return out
}

/**
 * Notices kept here for packages published without their licence file, taken
 * from their own repository: alloc-stdlib 0.3 names BSD-3-Clause but ships no
 * text; its repository's LICENSE (dropbox/rust-alloc-no-stdlib) is the one
 * alloc-no-stdlib ships, word for word (checked 18 October 2026).
 */
const notices = join(root, 'apps/desktop/licences/notices')

/** The licence files in a package's folder: LICENSE, LICENSE-MIT, COPYING and the like, or the one its manifest names. */
function licenceTexts(pkg) {
  if (pkg.licenceFile) return [readFileSync(join(pkg.dir, pkg.licenceFile), 'utf8')]
  const files = readdirSync(pkg.dir).filter((name) => /^(?:licen[cs]e|copying|unicode)(?:[-_.][\w.-]*)?$/iu.test(name)).sort()
  if (files.length > 0) return files.map((file) => readFileSync(join(pkg.dir, file), 'utf8'))
  const kept = join(notices, `${pkg.name}.txt`)
  if (existsSync(kept)) return [readFileSync(kept, 'utf8')]
  throw new Error(`No licence file in ${pkg.dir}, and none kept in ${notices}`)
}

/** apps/desktop/licences/third-party-rust.txt: the licence texts of the excepted packages the app ships. */
export function thirdParty(packages = shipped()) {
  const rule = '='.repeat(78)
  const parts = [
    'Rust code built into the ShellNote app under licences other than MIT, Apache-2.0, MPL-2.0 and ISC',
    '',
    "These packages come with Tauri; their licences are allowed by the project's licence policy. Each package's licence text follows its name.",
    '',
  ]
  for (const pkg of packages.filter(excepted)) {
    parts.push(rule, `${pkg.name} ${pkg.version} (${pkg.licence})`, rule, '')
    for (const text of licenceTexts(pkg)) parts.push(text.replace(/\r\n/gu, '\n').trim(), '')
  }
  return parts.join('\n')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const packages = shipped()
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, thirdParty(packages))
  const found = problems(packages)
  if (found.length > 0) {
    console.error(`${found.length} Rust licence problem${found.length === 1 ? '' : 's'}:\n${found.map((p) => `- ${p}`).join('\n')}`)
    process.exitCode = 1
  } else {
    console.log(`${packages.length} Rust packages shipped (${TARGETS.join(', ')}), every licence allowed. Wrote ${out}`)
  }
}
