// A program's live picture on its panel (stage 3 of other programs inside ShellNote, without
// cropping, xq1, 2 November 2026): a canvas drawn from the frames the host sends for one window, fitted to the panel,
// view only. The last frame stays drawn when no more come (a window hidden while something of ShellNote covers it).
import { useEffect, useRef } from 'react'
import type { ProgramHost } from './host.js'

export function ProgramPicture({ host, id, title, onEnd }: { host: ProgramHost; id: number; title: string; onEnd?: (why: 'closed' | string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const ended = useRef(onEnd)
  ended.current = onEnd
  useEffect(
    () =>
      host.onFrame?.((frame) => {
        if (frame.id !== id) return
        if ('rgba' in frame) {
          const element = canvas.current
          const context = element?.getContext('2d')
          if (!element || !context) return
          if (element.width !== frame.width) element.width = frame.width
          if (element.height !== frame.height) element.height = frame.height
          context.putImageData(new ImageData(frame.rgba, frame.width, frame.height), 0, 0)
          element.dataset.drawn = ''
        } else ended.current?.('closed' in frame ? 'closed' : frame.problem)
      }),
    [host, id],
  )
  return <canvas ref={canvas} className="nw-program-picture" role="img" aria-label={`The picture of ${title}`} />
}
