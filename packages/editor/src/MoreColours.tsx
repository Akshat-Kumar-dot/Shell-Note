// More colours, as in Word's Custom tab: a colour field (saturation across,
// brightness up and down), a hue slider, boxes for red, green and blue, and a
// box for the code. Nothing changes on the page until OK, so the colour is
// one undo step; New and Current show the two side by side.
import { X } from 'lucide-react'
import { useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { colourOf } from './colours.js'
import { codeOf, hsvOf, rgbOf, rgbOfHsv, rounded, withPart, type Hsv, type Rgb } from './palette.js'

export interface MoreColoursProps {
  /** The colour code to start from: the one in use. */
  start: string
  onUse: (code: string) => void
  onCancel: () => void
  /** Close the whole colour panel. */
  onClose: () => void
}

type Part = 'r' | 'g' | 'b'
const PARTS: [Part, string][] = [
  ['r', 'Red'],
  ['g', 'Green'],
  ['b', 'Blue'],
]

/** How far an arrow key moves the colour field's marker: 1%, or 10% with Shift. */
const STEP = 0.01

export function MoreColours({ start, onUse, onCancel, onClose }: MoreColoursProps) {
  const [hsv, setHsv] = useState<Hsv>(() => hsvOf(rgbOf(start)))
  // What is being typed in a box, shown as typed until it is a colour or the box is left.
  const [typing, setTyping] = useState<{ box: Part | 'hex'; text: string } | undefined>()
  const rgb = rounded(rgbOfHsv(hsv))
  const code = codeOf(rgb)

  /** A colour typed as red, green and blue: a grey keeps the hue the slider shows, and black the saturation too. */
  const takeRgb = (next: Rgb): void => {
    const now = hsvOf(next)
    setHsv((before) => ({ h: now.s === 0 ? before.h : now.h, s: now.v === 0 ? before.s : now.s, v: now.v }))
  }

  const fieldAt = (event: PointerEvent<HTMLDivElement>): void => {
    const box = event.currentTarget.getBoundingClientRect()
    const s = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
    const v = Math.min(1, Math.max(0, 1 - (event.clientY - box.top) / box.height))
    setHsv((before) => ({ ...before, s, v }))
  }
  const fieldKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? STEP * 10 : STEP
    const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
    const by = move[event.key]
    if (!by) return
    event.preventDefault()
    setHsv((before) => ({ ...before, s: Math.min(1, Math.max(0, before.s + by[0])), v: Math.min(1, Math.max(0, before.v + by[1])) }))
  }

  return (
    <div className="nw-more-colours" role="dialog" aria-label="More colours">
      <div className="nw-panel-head">
        <span>More colours</span>
        <button type="button" className="nw-ibtn" aria-label="Close colours" title="Close (Esc)" onClick={onClose}>
          <X size={16} aria-hidden />
        </button>
      </div>
      <div
        className="nw-colour-field"
        role="group"
        aria-label="Colour field: saturation across, brightness up and down"
        tabIndex={0}
        style={{ '--hue': `hsl(${hsv.h} 100% 50%)` } as CSSProperties}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          fieldAt(event)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) fieldAt(event)
        }}
        onKeyDown={fieldKey}
      >
        <span className="nw-field-marker" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: code }} aria-hidden />
      </div>
      <input
        className="nw-hue"
        type="range"
        aria-label="Hue"
        min={0}
        max={359}
        step={1}
        value={Math.round(hsv.h) % 360}
        onChange={(event) => setHsv((before) => ({ ...before, h: Number(event.target.value) }))}
      />
      <div className="nw-colour-boxes">
        {PARTS.map(([part, label], i) => (
          <label key={part}>
            <span>{label}</span>
            <input
              type="number"
              min={0}
              max={255}
              aria-label={label}
              value={typing?.box === part ? typing.text : rgb[i]}
              onChange={(event) => {
                const text = event.target.value
                setTyping({ box: part, text })
                const n = Number(text)
                if (text.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= 255) takeRgb(withPart(rgb, i, n))
              }}
              onBlur={() => setTyping(undefined)}
            />
          </label>
        ))}
      </div>
      <div className="nw-colour-hex">
        <label>
          <span>Hex</span>
          <input
            type="text"
            aria-label="Hex"
            spellCheck={false}
            value={typing?.box === 'hex' ? typing.text : code}
            aria-invalid={typing?.box === 'hex' && !colourOf(typing.text)?.startsWith('#')}
            onChange={(event) => {
              const text = event.target.value
              setTyping({ box: 'hex', text })
              const typed = colourOf(text)
              if (typed?.startsWith('#')) takeRgb(rgbOf(typed))
            }}
            onBlur={() => setTyping(undefined)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onUse(code)
            }}
          />
        </label>
        <span className="nw-colour-compare" aria-hidden>
          <span>
            <span style={{ background: code }} />
            New
          </span>
          <span>
            <span style={{ background: start }} />
            Current
          </span>
        </span>
      </div>
      <div className="nw-dialog-buttons">
        <button type="button" className="nw-chip" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="nw-chip nw-chip-primary" onClick={() => onUse(code)}>
          OK
        </button>
      </div>
    </div>
  )
}
