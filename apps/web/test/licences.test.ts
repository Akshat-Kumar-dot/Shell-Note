// The licence check: every package the code depends on is under MIT,
// Apache-2.0, MPL-2.0 or ISC, or is one of the project's exceptions, and the
// excepted packages' licence texts ship with the app.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { problems, shipped, thirdParty, type Shipped } from '../../../scripts/licences.mjs'

const packages = shipped()

describe('licences', () => {
  it('allows every package the code depends on, all the way down', () => {
    expect(packages.length).toBeGreaterThan(100)
    expect(problems(packages)).toEqual([])
  })

  it('ships the excepted packages\' licence texts, and the file is current (corepack pnpm licences)', () => {
    const file = readFileSync(new URL('../public/licences/third-party.txt', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    expect(file).toBe(thirdParty(packages))
    for (const name of ['d3-sankey', 'd3-array', 'd3-shape', 'd3-path', 'd3-ease', 'rw', 'robust-predicates']) expect(file).toContain(`\n${name} `)
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
