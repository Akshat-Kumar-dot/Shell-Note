// Printing a note, or saving it as a PDF from the print window: every page on its own sheet, at its real size, on
// white paper, whatever the screen shows (the seamless view, dark paper). The pages are drawn apart from the screen,
// all of them, as only the pages near the screen are drawn there; each names its size for the printer (@page), so a
// note of A4 and Letter pages prints each on its own size.
import type { Doc } from '@shellnote/core'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { PageBox, type AssetUrls } from './blocks.js'
import { TitleHead } from './TitleHead.js'

/** A name for a page size in the print window's rules. */
const sizeName = (w: number, h: number): string => `nw-sheet-${w}x${h}`

export interface PrintViewProps {
  doc: Doc
  assets: AssetUrls
  /** The print window has closed, printed or not. */
  onDone: () => void
  /** For a text note: the line under its title, at the top of its first page, printed with it. */
  heading?: string | undefined
}

export function PrintView({ doc, assets, onDone, heading }: PrintViewProps) {
  useEffect(() => {
    let closed = false
    const done = (): void => {
      if (closed) return
      closed = true
      onDone()
    }
    window.addEventListener('afterprint', done)
    // Drawn, and its pictures shown, before the print window takes its picture of the pages. They stay until it
    // closes (afterprint), which every browser the app runs in says.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => window.print())
    })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('afterprint', done)
    }
  }, [onDone])
  const sizes = new Map<string, { w: number; h: number }>()
  for (const id of doc.pages) {
    const page = doc.page[id]!
    sizes.set(sizeName(page.w, page.h), { w: page.w, h: page.h })
  }
  const rules = [...sizes].map(([name, { w, h }]) => `@page ${name} { size: ${w / 100}mm ${h / 100}mm; margin: 0; }`).join('\n')
  return createPortal(
    <div className="nw-print" aria-hidden>
      <style>{rules}</style>
      {doc.pages.map((id, i) => {
        const page = doc.page[id]!
        return (
          <div key={id} className="nw-print-page" style={{ page: sizeName(page.w, page.h) }}>
            <PageBox page={page} doc={doc} assets={assets}>
              {i === 0 && doc.kind === 'text' && heading !== undefined ? <TitleHead doc={doc} line={heading} editable={false} /> : null}
            </PageBox>
          </div>
        )
      })}
    </div>,
    document.body,
  )
}
