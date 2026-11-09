// The font library: every font bundled with the app, each shown in itself, to
// add to the font menu or take off it. Fonts in the menu sit beside the four
// font styles; the choice is kept in this browser (fonts.ts).
import { FONT_LIBRARY, type FontStyle } from '@shellnote/core'
import { useEffect, type MouseEvent } from 'react'
import { fontFamily } from './fonts.js'
import { placeMenu } from './popover.js'

/** A press on a button must not move the focus out of the text. */
const keepFocus = (event: MouseEvent): void => event.preventDefault()

const LIKE: Record<FontStyle, string> = { sans: 'Sans', serif: 'Serif', mono: 'Mono', hand: 'Handwriting' }

export interface FontLibraryProps {
  /** The library fonts in the font menu now. */
  chosen: readonly string[]
  onChange: (chosen: string[]) => void
  onClose: () => void
}

export function FontLibrary({ chosen, onChange, onClose }: FontLibraryProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div ref={placeMenu} className="nw-font-library" role="dialog" aria-label="Font library">
      <div className="nw-font-library-head">
        <span>Add fonts to the font menu</span>
        <button type="button" aria-label="Close the font library" onMouseDown={keepFocus} onClick={onClose}>
          ×
        </button>
      </div>
      <ul>
        {FONT_LIBRARY.map((font) => {
          const added = chosen.includes(font.id)
          return (
            <li key={font.id}>
              <span className="nw-font-sample" style={{ fontFamily: fontFamily(font.id) }}>
                {font.name}
              </span>
              <span className="nw-font-like">{LIKE[font.like]}</span>
              <button
                type="button"
                aria-pressed={added}
                aria-label={`${font.name} in the font menu`}
                onMouseDown={keepFocus}
                onClick={() => onChange(added ? chosen.filter((id) => id !== font.id) : [...chosen, font.id])}
              >
                {added ? 'Added' : 'Add'}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
