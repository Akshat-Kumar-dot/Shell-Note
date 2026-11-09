// A note's thumbnail: a small picture of its first page, drawn straight from
// the note's own blocks on a canvas, with no screenshot library. It is only a
// picture, 240 pixels wide, never a second copy of the note. Text is drawn line
// by line at the page's own sizes, with its marks (textLayout.ts), pictures
// from their bytes, tables as grids, handwriting as its strokes, and a diagram
// as a box: enough to know a page at a glance.
import { toRuns, type Block, type Doc, type TextBlock } from '@shellnote/core'
import { fontStyle, layoutRuns, LINE, SIZE_FACTOR, tableColumns, type Line, type Look } from './textLayout.js'

/** The thumbnail's width in pixels; its height follows the page's shape. */
export const THUMB_WIDTH = 240

/** Document units (0.01 mm) in one typographic point. */
const POINT = 35.28
/** Headings, as theme.css draws them: 11 pt text scaled up. */
const ROLES: Partial<Record<TextBlock['role'], number>> = { h1: 1.9, h2: 1.5, h3: 1.25 }

/** Draw page 1 of a note as a small picture. Resolves to undefined when the browser cannot draw one. */
export async function drawThumbnail(doc: Doc, blob: (hash: string) => Blob | undefined): Promise<Blob | undefined> {
  const page = doc.page[doc.pages[0] ?? '']
  if (!page) return undefined
  const scale = THUMB_WIDTH / page.w
  const canvas = document.createElement('canvas')
  canvas.width = THUMB_WIDTH
  canvas.height = Math.round(page.h * scale)
  const g = canvas.getContext('2d')
  if (!g) return undefined
  const css = getComputedStyle(document.documentElement)
  const token = (name: string, fallback: string): string => css.getPropertyValue(`--nw-${name}`).trim() || fallback
  const colour = (value: string | undefined): string => (value === undefined ? token('ink', '#1d1d22') : value.startsWith('#') ? value : token(value, '#1d1d22'))
  const px = (units: number): number => units * scale

  // The paper, always white, and its lines, squares or dots.
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.fillStyle = g.strokeStyle = token('rule', '#c9d7e8')
  g.lineWidth = 0.5
  if (page.bg === 'ruled') for (let y = 800; y < page.h; y += 800) g.fillRect(0, px(y), canvas.width, 0.6)
  if (page.bg === 'grid') {
    for (let y = 500; y < page.h; y += 500) g.fillRect(0, px(y), canvas.width, 0.4)
    for (let x = 500; x < page.w; x += 500) g.fillRect(px(x), 0, 0.4, canvas.height)
  }
  if (page.bg === 'dots') for (let y = 500; y < page.h; y += 500) for (let x = 500; x < page.w; x += 500) g.fillRect(px(x) - 0.4, px(y) - 0.4, 0.8, 0.8)

  const family = (font: string | undefined): string => token(fontStyle(font), 'system-ui, sans-serif')
  const fontOf = (look: Look): string => `${look.italic ? 'italic ' : ''}${look.bold ? 700 : 400} ${look.size}px ${family(look.font)}`
  const measure = (text: string, look: Look): number => {
    g.font = fontOf(look)
    return g.measureText(text).width
  }
  const normal = px(11 * POINT)
  /** Lines of words drawn at a top-left corner, each line placed by `left`, with every piece's own look. */
  const drawLines = (laid: readonly Line[], top: number, left: (line: Line) => number): void => {
    g.textBaseline = 'top'
    let y = top
    for (const line of laid) {
      const x0 = left(line)
      for (const piece of line.pieces) {
        const x = x0 + piece.x
        const py = y + piece.shift
        if (piece.highlight) {
          g.fillStyle = token('highlight', '#fff3a3')
          g.fillRect(x, py, piece.width, piece.size * 1.15)
        }
        g.font = fontOf(piece)
        g.fillStyle = colour(piece.color)
        g.fillText(piece.text, x, py)
        const thick = Math.max(0.4, piece.size / 14)
        if (piece.underline) g.fillRect(x, py + piece.size * 1.02, piece.width, thick)
        if (piece.strike) g.fillRect(x, py + piece.size * 0.55, piece.width, thick)
      }
      y += line.height
    }
  }
  const picture = async (hash: string, x: number, y: number, w: number, h: number): Promise<void> => {
    const bytes = blob(hash)
    if (bytes) {
      try {
        const bitmap = await createImageBitmap(bytes)
        g.drawImage(bitmap, x, y, w, h)
        bitmap.close()
        return
      } catch {
        // Not a picture the browser can read: a grey box, as on the page.
      }
    }
    g.fillStyle = '#e3e6ea'
    g.fillRect(x, y, w, h)
  }
  const box = (x: number, y: number, w: number, h: number, label: string): void => {
    g.strokeStyle = '#b9c0ca'
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
    g.fillStyle = '#8a9099'
    g.font = `${Math.max(4, Math.min(9, h / 4))}px ${family('sans')}`
    g.fillText(label, x + 3, y + Math.min(h - 3, 10))
  }

  /** One block in a frame, drawn at the top-left corner given; returns its height in pixels. */
  const child = async (block: Block, x: number, y: number, w: number): Promise<number> => {
    switch (block.type) {
      case 'text': {
        const size = normal * SIZE_FACTOR[block.style?.size ?? 'm'] * (ROLES[block.role] ?? 1)
        const indent = px(block.indent * 600) + (block.role === 'li' || block.role === 'oli' || block.role === 'todo' ? size * 1.2 : 0)
        const look: Look = { size, font: fontStyle(block.style?.font), bold: ROLES[block.role] !== undefined, italic: block.role === 'quote', color: block.style?.color }
        const quote = block.role === 'quote' ? size : 0
        const laid = layoutRuns(toRuns(block.md), look, normal, Math.max(10, w - indent - quote), measure)
        const height = laid.reduce((sum, line) => sum + line.height, 0) || size * LINE
        g.fillStyle = colour(block.style?.color)
        g.textBaseline = 'top'
        if (block.role === 'li') {
          g.font = fontOf(look)
          g.fillText('•', x + px(block.indent * 600), y)
        }
        if (block.role === 'todo') g.strokeRect(x + px(block.indent * 600) + 0.5, y + size * 0.15, size * 0.8, size * 0.8)
        if (block.role === 'quote') g.fillRect(x, y, 1, height)
        const align = block.style?.align ?? 'left'
        drawLines(laid, y, (line) => (align === 'center' ? x + (w - line.width) / 2 : align === 'right' ? x + w - line.width : x + indent + quote))
        return height + size * 0.35
      }
      case 'math': {
        const size = px(11 * POINT) * 1.1
        g.font = `italic ${size}px ${family('serif')}`
        g.fillStyle = colour(undefined)
        g.textBaseline = 'top'
        g.fillText(block.tex, x + size, y, Math.max(10, w - size))
        return size * 1.8
      }
      case 'image': {
        const asset = doc.asset[block.asset]
        const natural = asset?.w ? px((asset.w * 2540) / 96) : w
        const width = Math.min(w, natural)
        const height = asset?.w && asset.h ? (width * asset.h) / asset.w : width * 0.6
        await picture(block.asset, x, y, width, height)
        return height + px(300)
      }
      case 'table': {
        const size = px(11 * POINT) * 0.9
        const rowHeight = size * 1.7
        // Its own width and column widths, and its look, as the page draws them (theme.css).
        const { width: across, edges } = tableColumns(block, w)
        const looks = block.look
        const plain: Look = { size, font: 'sans', bold: false, italic: false, color: undefined }
        g.textBaseline = 'top'
        block.rows.forEach((row, r) => {
          const top = y + r * rowHeight
          const header = r === 0 && looks === 'header'
          const fill = header ? '#1f4e8c' : looks === 'banded' && r % 2 === 1 ? '#eef2f7' : r === 0 && block.head === true && looks !== 'lines' ? '#f1f4f8' : undefined
          if (fill) {
            g.fillStyle = fill
            g.fillRect(x, top, across, rowHeight)
          }
          row.forEach((md, c) => {
            const left = x + edges[c]!
            const cell = edges[c + 1]! - edges[c]!
            if (looks === undefined || looks === 'banded') {
              g.strokeStyle = looks === 'banded' ? '#dde2e8' : '#b9c0ca'
              g.strokeRect(left + 0.5, top + 0.5, cell, rowHeight)
            }
            // One line of a cell's words, with their marks, cut at the cell's edge.
            const first = layoutRuns(toRuns(md), { ...plain, bold: header || (r === 0 && block.head === true), color: header ? '#ffffff' : undefined }, normal, cell - size * 0.8, measure)[0]
            if (!first) return
            g.save()
            g.beginPath()
            g.rect(left, top, cell, rowHeight)
            g.clip()
            drawLines([first], top + size * 0.35, () => left + size * 0.4)
            g.restore()
          })
          // Lines between rows only, for these looks; heavier at the top and bottom of the lines look.
          if (looks === 'lines' || looks === 'header') {
            const rule = (at: number, heavy: boolean): void => {
              g.fillStyle = heavy ? '#1d1d22' : '#c9d0d9'
              g.fillRect(x, at, across, heavy ? 1.2 : 0.7)
            }
            if (r === 0 && looks === 'lines') rule(top, true)
            rule(top + rowHeight, looks === 'lines' && r === block.rows.length - 1)
          }
        })
        return block.rows.length * rowHeight + px(300)
      }
      case 'diagram': {
        const height = px(3000)
        box(x, y, w, height, 'Diagram')
        return height + px(300)
      }
      default:
        return 0
    }
  }

  for (const id of page.free) {
    const block = doc.block[id]
    if (!block || !('page' in block)) continue
    const x = px(block.x)
    const y = px(block.y)
    const w = px(block.w)
    const h = px(block.h)
    if (block.type === 'frame') {
      let at = y
      for (const kid of block.kids) {
        const inner = doc.block[kid]
        if (!inner || at > canvas.height) break
        at += await child(inner, x, at, w)
      }
    } else if (block.type === 'image') {
      await picture(block.asset, x, y, w, h)
    } else if (block.type === 'math') {
      await child(block, x, y + h / 4, w)
    } else if (block.type === 'diagram') {
      box(x, y, w, h, 'Diagram')
    } else if (block.type === 'ink') {
      for (const stroke of block.strokes) {
        g.strokeStyle = colour(stroke.color)
        g.lineWidth = stroke.width === 'l' ? 1.4 : stroke.width === 'm' ? 1 : 0.7
        g.beginPath()
        for (let i = 0; i + 1 < stroke.pts.length; i += 3) {
          const sx = x + px(stroke.pts[i]!)
          const sy = y + px(stroke.pts[i + 1]!)
          if (i === 0) g.moveTo(sx, sy)
          else g.lineTo(sx, sy)
        }
        g.stroke()
      }
    }
  }
  return new Promise((resolve) => canvas.toBlob((made) => resolve(made ?? undefined), 'image/webp', 0.82))
}
