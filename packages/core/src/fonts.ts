// The font library bundled with the app: free
// fonts a person can add to the font menu, beside the four font styles. A
// block stores a library font by its id, such as `lora`. Where the font is
// missing, as in an app that does not have it, the text is drawn in the
// style the font resembles (Lora in serif). The AI picks styles only.

/** The four font styles every app has, drawn with fonts already on the computer. */
export const FONT_STYLES = ['sans', 'serif', 'mono', 'hand'] as const
export type FontStyle = (typeof FONT_STYLES)[number]

export interface LibraryFont {
  /** Stored in a block's style. Also the name of its package (@fontsource/<id>). */
  id: string
  /** As people know it, and as CSS names the family. */
  name: string
  /** The style it falls back to where it is missing. */
  like: FontStyle
}

/** All fonts are under the SIL Open Font License 1.1, allowed for font files. */
export const FONT_LIBRARY: readonly LibraryFont[] = [
  { id: 'inter', name: 'Inter', like: 'sans' },
  { id: 'open-sans', name: 'Open Sans', like: 'sans' },
  { id: 'nunito', name: 'Nunito', like: 'sans' },
  { id: 'atkinson-hyperlegible', name: 'Atkinson Hyperlegible', like: 'sans' },
  { id: 'lexend', name: 'Lexend', like: 'sans' },
  { id: 'lora', name: 'Lora', like: 'serif' },
  { id: 'merriweather', name: 'Merriweather', like: 'serif' },
  { id: 'source-serif-4', name: 'Source Serif 4', like: 'serif' },
  { id: 'eb-garamond', name: 'EB Garamond', like: 'serif' },
  { id: 'playfair-display', name: 'Playfair Display', like: 'serif' },
  { id: 'jetbrains-mono', name: 'JetBrains Mono', like: 'mono' },
  { id: 'fira-code', name: 'Fira Code', like: 'mono' },
  { id: 'caveat', name: 'Caveat', like: 'hand' },
  { id: 'patrick-hand', name: 'Patrick Hand', like: 'hand' },
  { id: 'opendyslexic', name: 'OpenDyslexic', like: 'sans' },
]

/** A library font by its id; undefined for a style or a font this app does not have. */
export function libraryFont(id: string | undefined): LibraryFont | undefined {
  return FONT_LIBRARY.find((font) => font.id === id)
}

/** The style a block's font is drawn in where the font itself is missing: the style, the one a library font resembles, or sans. */
export function fontStyleOf(font: string | undefined): FontStyle {
  if ((FONT_STYLES as readonly string[]).includes(font ?? '')) return font as FontStyle
  return libraryFont(font)?.like ?? 'sans'
}
