# File format

Version 3. Written and read by `pack`, `unpack`, `toFiles` and `fromFiles` in [packages/core/src/io/container.ts](../packages/core/src/io/container.ts).

## Layout

One document is one zip file, with the extension `.shellnote`.

```
doc.json              the document, without its blocks
pages/<pageId>.json   the blocks on one page
assets/<hash>         image bytes
sync.json             only in a library kept in a synced folder (see Sync)
```

The same layout unzipped is a folder, the **folder form**. The desktop app and the MCP server can use it directly.

Anything else inside a zip is skipped and never read.

## doc.json

```json
{
  "v": 3,
  "id": "d1",
  "title": "Physics lecture 4",
  "rev": 12,
  "pages": ["p1"],
  "page": {
    "p1": {"id":"p1","w":21000,"h":29700,"bg":"ruled","free":["f1","g1","k1"]}
  },
  "asset": {
    "a91f": {"mime":"image/png","w":1600,"h":1200,"bytes":184322}
  },
  "rules": [
    "Headings are blue."
  ]
}
```

| Field | Meaning |
|---|---|
| `v` | Schema version. Every schema change raises it and ships a migration. |
| `id` | The document's id. Ids are unique across the document, its pages and its blocks. |
| `title` | The title. |
| `rev` | Goes up by one with each change. Edits from an AI or MCP name the `rev` they were based on. |
| `pages` | Page order. |
| `page` | Each page: size in units of 0.01 mm (A4 is 21000 × 29700), background, and `free`, its free blocks from back to front. |
| `asset` | Metadata of each image, keyed by content hash. |
| `rules` | The user's notebook rules, one short line each. |
| `pen` | From version 3, and only when the note sets any: the pen switches this note sets for itself, over each person's own defaults (see Ink). |

## pages/&lt;pageId&gt;.json

```json
{
  "block": {
    "f1": {"id":"f1","r":4,"type":"frame","page":"p1","x":2000,"y":2000,"w":17000,"h":9000,"kids":["t1","t2","m1"]},
    "t1": {"id":"t1","r":2,"type":"text","parent":"f1","role":"h2","indent":0,"md":"Newton's laws"},
    "t2": {"id":"t2","r":3,"type":"text","parent":"f1","role":"p","indent":0,"md":"An object at rest stays at rest unless a **force** acts on it."},
    "m1": {"id":"m1","r":4,"type":"math","parent":"f1","tex":"F = ma"},
    "g1": {"id":"g1","r":9,"type":"image","page":"p1","x":11000,"y":12000,"w":8000,"h":6000,"asset":"a91f","alt":"Free-body diagram of a block on a slope"},
    "k1": {"id":"k1","r":12,"type":"ink","page":"p1","x":2500,"y":19000,"w":6000,"h":1500,"strokes":[{"pts":[0,700,128,5800,700,128],"color":"red","width":"m","straight":true}]}
  }
}
```

The file holds every block on the page: the free blocks in stacking order, each frame followed by its children. A free block is on the page it names. A child block is on the page of its frame. Each block is stored in exactly one page file. `r` on a block is the `rev` of the change that last touched it.

The block types and their fields are defined in [packages/core/src/schema/doc.ts](../packages/core/src/schema/doc.ts).

## Writing

- **The same document always gives the same bytes.** Fields are written in schema order, and map entries are one per line. Zip entries carry a fixed timestamp. Files then change only where the document did, which suits sync tools and diffs.
- **Geometry is whole numbers** of 0.01 mm. There are no floats in a file.
- **Text is UTF-8** with no byte-order mark, and holds no broken characters (half of an emoji).
- **Images are stored as they are,** without compression, since PNG and JPEG are compressed already.
- **Every image an image block uses must have its bytes,** or saving fails. An asset no block uses may be kept without bytes, so that undo can bring an image back.

## Reading

1. Read `doc.json`, then the file of each page listed in `pages`.
2. Migrate an older `v`. Refuse a newer one with `too_new`: the app needs updating.
3. Check the whole document: the shape of every field, and the structure. Every block must be listed exactly once, every reference must point at the right kind of thing, and continuation frames must form simple chains.
4. Check each block is stored with its own page, and only once.
5. A byte-order mark that a text editor added is tolerated.

Errors are `ValidationError`s with a hint that says what is wrong, such as "Block gi is stored in pages/w1.json, but it is on page w2."

Limits, from the sizes the zip declares: 100,000 entries, 64 MiB per JSON file, 1 GiB in total. A note holds at most
50,000 blocks: a file with more is refused before its blocks are checked, and `apply` adds none to a note that is full.

## Saving only what changed

In the folder form, a save rewrites only the page files whose text changed: compare the output of `toFiles` with what was written last time. A zip is always written whole. That is fine for version 1; the per-page split pays off in the folder form and keeps each save small there.

## Assets

An asset is keyed by the **SHA-256** hash of its bytes, written as 64 lowercase hex digits. `hashBytes` in [packages/core/src/io/hash.ts](../packages/core/src/io/hash.ts) computes it. Because the key comes from the bytes, the same picture added twice is stored once, and a key that does not match its bytes shows the file was damaged.

An image block can carry two kinds of words:

| Field | What it is | Shown |
|---|---|---|
| `alt` | A plain description of the picture, for screen readers and the AI. | No |
| `caption` | Inline Markdown, with the same marks as a text block, such as `**bold**`. | Under the picture |

An empty caption is removed rather than stored as `""`.

## Versions

| Version | Since | Change |
|---|---|---|
| 1 | 9 October 2026 | The first. |
| 3 | 13 October 2026 | The pen: a stroke may have a pen kind, a colour code, the widths `xs` and `xl`, tilt and a snapped shape; a note may hold its own pen switches, `pen`. Nothing in version 2 changes meaning. |
| 2 | 10 October 2026 | Words may be underlined, `[words]{.underline}`; written small below or above the line, `H[2]{.sub}O`, `x[2]{.sup}`; or given a size or font of their own, `[words]{size=l}`, `[words]{font=lora}` (Pandoc's span form). A table may hold its column widths, its width and its look (`cols`, `width`, `look`). |

Opening a file of an older version moves it to the current one in memory (`migrate` in [packages/core/src/schema/migrate.ts](../packages/core/src/schema/migrate.ts)); it is saved in the current version. From 1 to 2, text that only looked like one of the new spans, which version 1 read as plain text, is written again with its brackets escaped, so it still reads as text; all other text keeps its exact form. An app refuses a file of a newer version than its own, saying to update the app.

## Words on a block

A text block's `md`, a caption, and a table's cell hold one line of inline Markdown: `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, `==highlight==`, `[a link](https://example.com)`, `$x^2$`, coloured words `[words]{color=red}`, and from version 2 the spans above. A size on words is `s`, `m`, `l` or `xl`; a font is a font style (`sans`, `serif`, `mono`, `hand`) or a library font's id. People set these; the AI sets size and font on whole blocks. No HTML.

## Colours

A colour, on a block (`style.color`) or on words (`[words]{color=red}`), is one of the eight named colours (`ink`, `gray`, `red`, `orange`, `yellow`, `green`, `blue`, `purple`) or a colour a person picked, written as a code: `#` and six lowercase hex digits, such as `#e0563a`. The app draws a named colour from its theme, so it can follow dark mode, and a code as it is. The AI picks named colours only.

## Tables

A table block sits in a frame and holds its cells row by row:

```json
{"id":"tb","r":14,"type":"table","parent":"f1","rows":[["Name","Age"],["**Ann**","31"]],"head":true,"caption":"Ages"}
```

| Field | Meaning |
|---|---|
| `rows` | The cells, row by row. Every row has the same number of cells. Each cell is inline Markdown, like a text block's `md`, on one line. |
| `head` | Present and `true` when the first row is a header. |
| `alt`, `caption` | As on a picture. |
| `cols` | From version 2. Each column's share of the table's width, in thousandths: whole numbers, one for each column, adding up to 1000, such as `[500, 300, 200]`. Missing: equal columns. |
| `width` | From version 2. The table's width as a share of its frame's, in thousandths, from 200 to 1000. Missing: the frame's whole width. |
| `look` | From version 2. `lines` (lines between rows only), `banded` (every other row shaded) or `header` (the first row filled). Missing: a grid. |

People size a table and choose its look; the AI does not. A table's width is `width`, not `w`, which on a block placed on a page is a size in 0.01 mm.

The Markdown export writes a table as a pipe table, the same form a model writes one in; widths and looks have no Markdown form and are left out.

## Ink

An ink block is placed on a page and holds pen strokes, in drawing order. Its `x`, `y`, `w` and `h` are the box around them; the strokes' points are relative to its top-left corner.

```json
{"pts":[0,700,128, 5800,700,131],"color":"#e0563a","width":"m","tool":"pencil","tilt":[30,32],"straight":true,"shape":{"kind":"line","key":[0,700,5800,700]}}
```

| Field | Meaning |
|---|---|
| `pts` | x, y and pressure, repeated: x and y in 0.01 mm from the block's corner, pressure from 0 to 255. The pressure is the width at that point: 128 draws the stroke at its width, 255 at twice it, 64 at half, never thinner than a quarter. The app records it relative to how hard the person usually presses, so a note looks the same on every device; a mouse and a finger record 128. |
| `color` | A named colour or, from version 3, a colour code, as on text. |
| `width` | `xs`, `s`, `m`, `l` or `xl` (`xs` and `xl` from version 3); the pen kind turns it into a size. |
| `tool` | From version 3. `pencil`, `fountain`, `marker` or `highlighter`. Missing: the plain pen. A highlighter is drawn see-through, under ink. |
| `tilt` | From version 3, pencil only: how far the pen leant at each point, 0 (upright) to 90 degrees, one value per point. |
| `straight` | The stroke was straightened. |
| `shape` | From version 3. A stroke snapped to a shape keeps what it is (`kind`: line, arrow, arc, curve, triangle, rect, square, rhombus, polygon, star, ellipse, circle, heart, cloud or bubble; or a symbol neatened as the pen lifted: paren, bracket, brace, comma or at) and its key points (`key`, whole numbers in the stroke's units), so it can be changed as that shape. A symbol's key is its box, `x, y, w, h`, and for paren, bracket and brace a fifth number: 0 when it opens, as `(`, 1 when it closes. Its `pts` still hold the shape drawn out, so any app can show it. |

An ink block's `text`, when there, is what the handwriting says: what the AI and search read in place of the strokes.

The pen switches (`pen` on the document, from version 3) are `penOnly` (`auto`, `always`, `off`), `lines` (`off`, `hold`, `auto`), `shapes` (`off`, `hold`), `smoothing` (0 to 3), `neaten` (`off`; `demand`, only with the Tidy button; `word`, each word as the next one starts, added on 17 October 2026 before version 3 left this branch; `line`, each line levelled as well), `anchor` (the line a finished line's words are put on: `first`, its first word's; `most`, the one most of its words sit on; `last`, its last word's) and `wordGap` (the gap they are spaced to: `usual`, the line's usual gap; `first`, its first gap; `tighter`; `wider`; `written`, as written), both added on 17 October 2026 before version 3 left this branch, `toText` (`off`, `demand`, `live`), `scratch` and `circleLasso` (`true` or `false`), `symbols` (the symbols neatened as the pen lifts, any of `paren`, `bracket`, `brace`, `comma`, `at`; an empty list for none) and `pressure` (`off`, an even width, added on 16 October 2026 before version 3 left this branch; `soft`, `normal`, `firm`). A note holds only those it sets; the rest are each person's own, kept in their app.

**Videos beside a note** (version 3):

- `media` on the document: the note's videos, each `{ "id", "kind": "youtube", "video": "<11-character YouTube id>", "title"? }` (played in YouTube's own player, never stored) or `{ "id", "kind": "file", "asset": "<hash>", "name"?, "crop"? }` (a video file of the person's own, its bytes kept in `assets/<hash>` like a picture's; `crop` in thousandths of its width and height: `x`, `y`, `w`, `h`).
- `transcript` on a video, either kind (added the same day): its lines in time order, each `{ "t": <tenths of a second>, "text" }`, pasted by the person (from YouTube's own "Show transcript", or a subtitle file).
- `clips` on the document: parts of those videos marked in the note, each `{ "id", "media", "from", "to", "page", "x", "y", "note"? }`, `from` and `to` in tenths of a second, `x` and `y` in the page's units.
- `vt` on a stroke: `{ "m": "<media id>", "t": <tenths of a second>, "e"?: <tenths of a second> }`, which video the stroke was written beside, where it was as the pen went down, and, when later, where it was as the pen lifted (`e`, added the same day).

Their ids are new to the document, like a block's. A file video's asset must be in the note; a clip's video and page must be too.

## Sync

A library kept in a folder that a cloud service copies between devices adds one small file to each note, `sync.json`. It lets a device tell "the other device saw all I wrote, and wrote more" from "we both wrote apart", with no server. A file without it opens as any note does, and a reader that does not know it skips it.

```json
{"v":1,"by":"k3J9x2Qa","at":1794300000000,"id":"5f2c9a0e41b7d3886a10c2e4f7b95d03","seen":{"Zp01mN7c":8,"k3J9x2Qa":12},"base":{"seen":{"Zp01mN7c":8},"rev":9}}
```

| Field | Meaning |
|---|---|
| `by` | The device that wrote this version: a random id it made for this library. It names nothing else. |
| `at` | When that device last changed the note, in milliseconds since 1970. |
| `id` | A fingerprint of the note's content, without `rev` and each block's `r`: two versions that hold the same have the same one. |
| `seen` | The latest change of each device this version includes: the device's own `rev` of the note when it wrote that change. |
| `base` | The last version this device took from another device or merged: what that one had seen, and this device's `rev` just after. Blocks whose `r` is above it are this device's own changes since. |
| `put` | When the note was last put where it is: moved, deleted or brought back. Of two files of one note in two places, the one put later says where the note belongs. |

Given two versions: when one has seen everything the other has, it is the newer and is taken as it is. When each has changes the other has not seen, they are merged block by block (`merge` in [packages/core/src/sync/merge.ts](../packages/core/src/sync/merge.ts)): a block changed on one device is taken from it, an edit stands against a removal, text changed in different words is merged, and a paragraph whose same words both changed is kept twice, one after the other. A file saved with Save, to share or keep, has no `sync.json`.

## Not stored in the file

- **The edit log** is kept on the device beside the document, never inside it, so sharing a note does not share its prompt history.
- **Undo history** lives in memory only.
