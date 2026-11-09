// Packs the companion extension (./extension) into a .vsix, which VS Code installs with `code --install-extension`. A
// .vsix is a zip of the extension, a manifest and a list of content types: written here, so packing it needs no new
// package (`@vscode/vsce` would be one).
//
//   corepack pnpm companion [out.vsix]     (by default shellnote-companion.vsix, beside this file)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateRawSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const out = process.argv[2] ?? join(here, 'shellnote-companion.vsix')
const manifest = JSON.parse(readFileSync(join(here, 'extension/package.json'), 'utf8'))

const parts = new Map([
  [
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension=".json" ContentType="application/json"/><Default Extension=".js" ContentType="application/javascript"/><Default Extension=".md" ContentType="text/markdown"/><Default Extension=".txt" ContentType="text/plain"/><Default Extension=".vsixmanifest" ContentType="text/xml"/></Types>
`,
  ],
  [
    'extension.vsixmanifest',
    `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${manifest.name}" Version="${manifest.version}" Publisher="${manifest.publisher}"/>
    <DisplayName>${manifest.displayName}</DisplayName>
    <Description xml:space="preserve">${manifest.description}</Description>
    <Categories>Other</Categories>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${manifest.engines.vscode}"/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="ui"/>
    </Properties>
    <License>extension/LICENSE.txt</License>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt" Addressable="true"/>
  </Assets>
</PackageManifest>
`,
  ],
  ...readdirSync(join(here, 'extension')).map((name) => [`extension/${name}`, readFileSync(join(here, 'extension', name))]),
])

/** A zip of these files, compressed, each dated 1 January 2026: the same files make the same bytes. */
function zip(files) {
  const [time, date] = [0, ((2026 - 1980) << 9) | (1 << 5) | 1]
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, content] of files) {
    const data = Buffer.from(content)
    const packed = deflateRawSync(data)
    const path = Buffer.from(name)
    const common = Buffer.alloc(26)
    common.writeUInt16LE(20, 0)
    common.writeUInt16LE(0x0800, 2) // The name in UTF-8.
    common.writeUInt16LE(8, 4) // Deflated.
    common.writeUInt16LE(time, 6)
    common.writeUInt16LE(date, 8)
    common.writeUInt32LE(crc32(data), 10)
    common.writeUInt32LE(packed.length, 14)
    common.writeUInt32LE(data.length, 18)
    common.writeUInt16LE(path.length, 22)
    const local = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), common, path, packed])
    const after = Buffer.alloc(14)
    after.writeUInt32LE(offset, 10)
    centrals.push(Buffer.concat([Buffer.from([0x50, 0x4b, 1, 2, 20, 0]), common, after, path]))
    locals.push(local)
    offset += local.length
  }
  const central = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(centrals.length, 8)
  end.writeUInt16LE(centrals.length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, central, end])
}

writeFileSync(out, zip(parts))
console.log(`${out}: ${manifest.publisher}.${manifest.name} ${manifest.version}, ${parts.size} files`)
