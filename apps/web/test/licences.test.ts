// The licence check: every package the code depends on is under MIT,
// Apache-2.0, MPL-2.0 or ISC, or is one of the project's exceptions, and every
// shipped package's licence notice ships with the app.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { problems, shipped, thirdParty, type Shipped } from '../../../scripts/licences.mjs'
import { chosenFiles, entry, mitText, offersMit, webAddress } from '../../../scripts/notices.mjs'

const packages = shipped()

describe('licences', () => {
  it('allows every package the code depends on, all the way down', () => {
    expect(packages.length).toBeGreaterThan(100)
    expect(problems(packages)).toEqual([])
  })

  it("ships every package's licence notice, and the file is current (corepack pnpm licences)", () => {
    const file = readFileSync(new URL('../public/licences/third-party.txt', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    expect(file).toBe(thirdParty(packages))
    const others = packages.filter((p) => !p.own && !p.name.startsWith('@fontsource/'))
    expect(others.length).toBeGreaterThan(100)
    for (const pkg of others) expect(file).toContain(`\n${pkg.name} ${pkg.version} (`)
    // ShellNote's own packages are under its own licence, and the fonts' notices are in fonts.txt.
    expect(packages.filter((p) => p.own).map((p) => p.name)).toContain('@shellnote/core')
    expect(file).not.toContain('\n@shellnote/')
    expect(file).not.toContain('\n@fontsource/')
  })

  it('takes a package offered under a choice of licences under MIT, and keeps every file of one under several at once', () => {
    expect(chosenFiles(['LICENSE-APACHE', 'LICENSE-MIT'], 'MIT OR Apache-2.0')).toEqual(['LICENSE-MIT'])
    expect(chosenFiles(['COPYING', 'LICENSE-MIT', 'UNLICENSE'], 'Unlicense/MIT')).toEqual(['LICENSE-MIT'])
    expect(chosenFiles(['LICENSE-APACHE-2.0', 'LICENSE-MIT'], 'Apache-2.0 OR MIT')).toEqual(['LICENSE-MIT'])
    expect(chosenFiles(['LICENSE-BSD', 'LICENSE-MIT'], 'BSD-3-Clause AND MIT')).toEqual(['LICENSE-BSD', 'LICENSE-MIT'])
    expect(chosenFiles(['LICENSE'], 'MIT OR Apache-2.0')).toEqual(['LICENSE'])
    expect([offersMit('MIT'), offersMit('(Apache-2.0 OR MIT)'), offersMit('MIT/Apache-2.0'), offersMit('MIT-0'), offersMit('Apache-2.0')]).toEqual([true, true, true, false, false])
  })

  it("gives MIT's standard text, with the authors named, to a package published without its licence file", () => {
    const text = mitText('Wilson Page')
    expect(text.split('\n').slice(0, 3)).toEqual(['MIT License', '', 'Copyright (c) Wilson Page'])
    expect(text).toContain('The above copyright notice and this permission notice shall be included in all')
  })

  it("writes where each package's source is, as a web address", () => {
    expect(webAddress({ type: 'git', url: 'git+https://github.com/tauri-apps/tauri.git' })).toBe('https://github.com/tauri-apps/tauri')
    expect(webAddress('github:wilsonpage/fastdom')).toBe('https://github.com/wilsonpage/fastdom')
    expect(webAddress('wilsonpage/fastdom')).toBe('https://github.com/wilsonpage/fastdom')
    expect(webAddress('git://github.com/a/b.git')).toBe('https://github.com/a/b')
    expect(webAddress(undefined)).toBeUndefined()
    expect(entry('rw 1.3.3 (BSD-3-Clause)', undefined, ['text'])).toEqual(['='.repeat(78), 'rw 1.3.3 (BSD-3-Clause)', '='.repeat(78), '', 'text', ''])
  })

  it('stops a package under another licence', () => {
    const odd: Shipped = { name: 'left-pad', version: '1.3.0', licence: 'WTFPL', dir: '', via: 'some-package@1.0.0' }
    expect(problems([...packages, odd])).toEqual(['left-pad@1.3.0 is under WTFPL (brought in by some-package@1.0.0). Ask the maintainer before adding it.'])
  })

  it('stops a new major version of an excepted package, and a package that names no licence', () => {
    const newer: Shipped = { name: 'd3-ease', version: '4.0.0', licence: 'BSD-3-Clause', dir: '', via: 'd3@8.0.0' }
    const unnamed: Shipped = { name: 'mystery', version: '1.0.0', licence: undefined, dir: '', via: 'the workspace' }
    expect(problems([...packages, newer, unnamed])).toEqual([
      'd3-ease@4.0.0 is under BSD-3-Clause (brought in by d3@8.0.0). Ask the maintainer before adding it.',
      'mystery@1.0.0 is under no named licence (brought in by the workspace). Ask the maintainer before adding it.',
    ])
  })

  it('reads an SPDX choice: either licence allowed is enough', () => {
    const dual: Shipped = { name: 'dual', version: '1.0.0', licence: '(GPL-3.0 OR MIT)', dir: '', via: 'the workspace' }
    const both: Shipped = { name: 'both', version: '1.0.0', licence: 'MIT AND GPL-3.0', dir: '', via: 'the workspace' }
    expect(problems([...packages, dual, both])).toEqual(['both@1.0.0 is under MIT AND GPL-3.0 (brought in by the workspace). Ask the maintainer before adding it.'])
  })

  it('asks for an exception to be removed when nothing needs it', () => {
    const withoutRw = packages.filter((p) => p.name !== 'rw')
    expect(problems(withoutRw)).toEqual(['The exception for rw 1.x is no longer needed: remove it.'])
  })
})
