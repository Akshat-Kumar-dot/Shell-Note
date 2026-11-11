// Phase 0 exit check: a lint rule proves core imports nothing from the DOM.
// `pnpm lint` runs the rule over the real source; these tests prove the rule
// actually fires, by linting small probe files placed (virtually) in core.
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const eslint = new ESLint({ cwd: root })

async function rulesHit(code: string, file = 'packages/core/src/probe.ts'): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: root + file })
  return (result?.messages ?? []).map((m) => m.ruleId ?? m.message)
}

describe('the no-DOM rule for packages/core', () => {
  it('rejects DOM globals', async () => {
    expect(await rulesHit('export const t = document.title\n')).toContain('no-restricted-globals')
    expect(await rulesHit('export const w = window.innerWidth\n')).toContain('no-restricted-globals')
    expect(await rulesHit('export const s = localStorage.length\n')).toContain('no-restricted-globals')
    // ESLint itself, three times: about 3 s alone, and 16 s and more while a hundred other test files run beside it
    // on a busy laptop (11 November 2026), past the 15 s it had. A real hang still fails.
  }, 60_000)

  it('rejects storage and network access, even where Node has it too', async () => {
    expect(await rulesHit('export const f = fetch("https://example.com")\n')).toContain('no-restricted-globals')
    expect(await rulesHit('export const n = navigator.language\n')).toContain('no-restricted-globals')
  })

  it('rejects Node-only globals', async () => {
    expect(await rulesHit('export const e = process.env\n')).toContain('no-restricted-globals')
    expect(await rulesHit('export const b = Buffer.from("x")\n')).toContain('no-restricted-globals')
  })

  it('rejects UI libraries and Node modules', async () => {
    expect(await rulesHit("export { default } from 'react'\n")).toContain('no-restricted-imports')
    expect(await rulesHit("import 'mermaid'\n")).toContain('no-restricted-imports')
    expect(await rulesHit("export { readFile } from 'node:fs'\n")).toContain('no-restricted-imports')
  })

  it('allows APIs that browsers and Node share', async () => {
    const code = [
      'export const a = crypto.getRandomValues(new Uint8Array(4))',
      'export const b = new TextEncoder().encode("x")',
      'export const c = new URL("https://example.com")',
      '',
    ].join('\n')
    expect(await rulesHit(code)).toEqual([])
  })

  it('applies only to packages/core', async () => {
    expect(await rulesHit('export const t = document.title\n', 'apps/web/src/probe.ts')).toEqual([])
  })
})
