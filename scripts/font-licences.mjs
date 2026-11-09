// Writes apps/web/public/licences/fonts.txt: the licence of every font the app
// bundles, so each copy of the app carries the fonts' copyright notices and
// the SIL Open Font License, as that licence asks. Run it after changing the
// fonts in packages/editor/package.json: pnpm font-licences
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const editor = join(root, 'packages/editor')
const { dependencies } = JSON.parse(readFileSync(join(editor, 'package.json'), 'utf8'))
const fonts = Object.keys(dependencies)
  .filter((name) => name.startsWith('@fontsource/'))
  .sort()

const parts = ['Fonts bundled with ShellNote', '', 'Each font is used under the SIL Open Font License, Version 1.1, which follows its copyright notice.', '']
for (const name of fonts) {
  const folder = join(editor, 'node_modules', name)
  const { version } = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'))
  const rule = '='.repeat(78)
  parts.push(rule, `${name} ${version}`, rule, '', readFileSync(join(folder, 'LICENSE'), 'utf8').replace(/\r\n/g, '\n').trim(), '')
}

const out = join(root, 'apps/web/public/licences/fonts.txt')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, parts.join('\n'))
console.log(`Wrote the licences of ${fonts.length} fonts to ${out}`)
