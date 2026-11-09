// The program panel (stage 2 of other programs inside ShellNote, 25 October 2026; the at 11:37, "GO STAGE 2"):
// another program's own, whole window kept on a panel of the workspace, as the video is. It is the real program,
// running on its own: the person clicks, types and scrolls in it as always; ShellNote only keeps it on the panel's
// box, framed by the panel's bar above and the panel's border colour round it.
//
// Its window is above the page, so anything of ShellNote opening over the panel (a menu, a dialog, the side panel, a
// floating bar) would be hidden behind it: while something is, the window is hidden and the panel shows a stand-in
// with its title, then it comes back (the research, section 3.2). Dragged off by its own title bar, the program is let
// go and the panel offers to put it back.
import { AppWindow, ArrowDownToLine, Eye, List, RefreshCw, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { usePanel } from '../layout/DockArea.js'
import { PanelBar } from '../layout/PanelBar.js'
import { workspace } from '../layout/state.js'
import { watchCovered } from '../video/stepAside.js'
import { leftOutWords, offered, PROGRAM_ICON, type ProgramArea, type ProgramHost, type ProgramWindow } from './host.js'
import { keepFrames } from './moment.js'
import { ProgramPicture } from './ProgramPicture.js'
import { programElsewhere, programHeld, programShown, type Held } from './state.js'

/** The panel body's box in the screen's pixels from the page's top left (apps.rs's `Area`). */
function areaOf(element: HTMLElement): ProgramArea {
  const box = element.getBoundingClientRect()
  const scale = window.devicePixelRatio
  return { x: Math.round(box.left * scale), y: Math.round(box.top * scale), width: Math.round(box.width * scale), height: Math.round(box.height * scale) }
}

const same = (a: ProgramArea | undefined, b: ProgramArea): boolean => a !== undefined && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

/** The panel's border colour as 0xRRGGBB, for the frame Windows draws round the program. */
function borderOf(element: HTMLElement): number {
  const [r = 0, g = 0, b = 0] = (getComputedStyle(element).borderLeftColor.match(/\d+/gu) ?? []).map(Number)
  return (r << 16) | (g << 8) | b
}

const failed = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** How often the list of windows is read again while it shows: a few milliseconds of the system's each time. */
const LIST_EVERY = 2000

/** Each window's icon as a picture, made once: the list is read again every 2 s. By window and program, as Windows may
 * give a closed window's number to another. */
const icons = new Map<string, Promise<string | undefined>>()

function iconOf(host: ProgramHost, item: ProgramWindow): Promise<string | undefined> {
  const key = `${item.id} ${item.program}`
  let made = icons.get(key)
  if (!made) {
    made = (host.icon?.(item.id) ?? Promise.resolve(undefined)).then((rgba) => (rgba ? pictureOf(rgba) : undefined), () => undefined)
    icons.set(key, made)
  }
  return made
}

function pictureOf(rgba: Uint8Array): string {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = PROGRAM_ICON
  canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(rgba), PROGRAM_ICON, PROGRAM_ICON), 0, 0)
  return canvas.toDataURL()
}

/** The program's own icon beside its window in the list, or a plain window mark. */
function ProgramIcon({ host, item }: { host: ProgramHost; item: ProgramWindow }) {
  const [picture, setPicture] = useState<string>()
  useEffect(() => {
    let live = true
    void iconOf(host, item).then((made) => live && setPicture(made))
    return () => {
      live = false
    }
  }, [host, item])
  return picture ? <img className="nw-program-icon" src={picture} alt="" draggable={false} /> : <AppWindow className="nw-program-icon" size={20} aria-hidden />
}

/** The mark on the panel while lines keep moments (the research's rule, 3.9): the person always knows. */
const KEEPING = 'Each line you write now keeps this program’s place and words, and a small picture when its view changed. All of it stays in this note, on this computer. × beside a line takes them off.'

/** Whether ShellNote can be seen: nothing is pictured while it is minimised (the research's rule, 3.9). */
function useSeen(): boolean {
  return useSyncExternalStore(
    (change) => {
      document.addEventListener('visibilitychange', change)
      return () => document.removeEventListener('visibilitychange', change)
    },
    () => document.visibilityState === 'visible',
  )
}

export function ProgramPanel({ host }: { host: ProgramHost }) {
  const panel = usePanel()
  const held = useSyncExternalStore(programHeld.subscribe, programHeld.snapshot)
  const body = useRef<HTMLDivElement>(null)
  const [windows, setWindows] = useState<ProgramWindow[]>()
  const [problem, setProblem] = useState<string>()
  const hidden = panel?.hidden ?? false
  const on = held?.state === 'held' || held?.state === 'covered'
  const seen = useSeen()
  const pictures = host.picture !== undefined
  // A program shown by its picture, left where it is: view only, until brought here or let be.
  const elsewhere = useSyncExternalStore(programElsewhere.subscribe, programElsewhere.snapshot)

  // Each window's last picture, for reading what it shows as a line is written (stage 4).
  useEffect(() => keepFrames(host), [host])

  const refresh = useCallback((): void => {
    setProblem(undefined)
    host.list().then((found) => setWindows(found.filter(offered)), (error: unknown) => setProblem(failed(error)))
  }, [host])
  useEffect(() => {
    if (!on) refresh()
  }, [on, refresh])

  // The list kept up to date while it shows (a program opened after the panel did not appear until the page was
  // reloaded, which is easy to miss): read again every 2 s, and at once when ShellNote comes back in front from
  // another program. Quiet: a problem shown stays, and an unchanged list draws nothing.
  useEffect(() => {
    if (on || hidden || elsewhere) return
    const again = (): void => {
      host.list().then(
        (found) => {
          const now = found.filter(offered)
          setWindows((was) => (JSON.stringify(was) === JSON.stringify(now) ? was : now))
        },
        () => undefined,
      )
    }
    const timer = setInterval(again, LIST_EVERY)
    window.addEventListener('focus', again)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', again)
    }
  }, [on, hidden, elsewhere, host])

  const choose = (chosen: ProgramWindow): void => {
    const element = body.current
    if (!element) return
    setProblem(undefined)
    host.hold(chosen.id, areaOf(element), borderOf(element)).then(
      () => programHeld.set({ id: chosen.id, title: chosen.title, program: chosen.program, state: 'held' }),
      (error: unknown) => setProblem(failed(error)),
    )
  }

  /** Put back a program dragged off: held again on the panel's box. */
  const putBack = (): void => {
    const element = body.current
    if (!held || !element) return
    host.hold(held.id, areaOf(element), borderOf(element), true).then(
      () => programHeld.set({ ...held, state: 'held' }),
      (error: unknown) => setProblem(failed(error)),
    )
  }

  // What the system tells: the program closed, the person dragged it off (let go), its title changed.
  useEffect(
    () =>
      host.onTold((told) => {
        const now = programHeld.value
        if (!now || now.id !== told.id) return
        if (told.kind === 'closed') programHeld.set({ ...now, state: 'closed' })
        else if (told.kind === 'title') programHeld.set({ ...now, title: told.title })
        else if (now.state === 'held') {
          programHeld.set({ ...now, state: 'moved-off' })
          // Dragged off by the person: it stays where they drop it, not given back its old place.
          void host.letGo(now.id, false).catch(() => undefined)
        }
      }),
    [host],
  )

  // Follow the panel: its box sent when it changes by a pixel or more, at most once a frame (dragged, resized, the
  // workspace laid out again, the page zoomed). ShellNote's own window moving is followed from the Rust side.
  const id = on ? held.id : undefined
  useEffect(() => {
    const element = body.current
    if (id === undefined || !element) return
    let sent = areaOf(element)
    let frame = 0
    const check = (): void => {
      frame = 0
      const area = areaOf(element)
      if (same(sent, area) || area.width <= 0 || area.height <= 0) return
      sent = area
      void host.place(id, area).catch(() => undefined)
      if (seen) void host.picture?.(id, area.width, area.height, false).catch(() => undefined)
    }
    const later = (): void => {
      frame ||= requestAnimationFrame(check)
    }
    const watcher = new ResizeObserver(later)
    watcher.observe(element)
    window.addEventListener('resize', later)
    const unlisten = workspace.subscribe(later)
    return () => {
      watcher.disconnect()
      window.removeEventListener('resize', later)
      unlisten()
      cancelAnimationFrame(frame)
    }
  }, [id, host, seen])

  // The held window's picture, two frames a second while it is seen on the panel: its last picture stands where it was
  // while something of ShellNote covers it and the window itself is hidden (stage 3). None while ShellNote is
  // minimised, or the panel is out of sight.
  useEffect(() => {
    const element = body.current
    if (id === undefined || !element || !seen || hidden || !host.picture) return
    const area = areaOf(element)
    void host.picture(id, area.width, area.height, false).catch(() => undefined)
    return () => void host.stopPicture?.(id).catch(() => undefined)
  }, [id, host, seen, hidden])

  // A program elsewhere, by its live picture: up to 30 frames a second, at the panel's size as it changes.
  const shown = elsewhere?.id
  useEffect(() => {
    const element = body.current
    if (shown === undefined || !element || !seen || hidden || !host.picture) return
    let sent = areaOf(element)
    host.picture(shown, sent.width, sent.height, true).catch((error: unknown) => {
      programElsewhere.set(undefined)
      setProblem(failed(error))
    })
    let frame = 0
    const watcher = new ResizeObserver(() => {
      frame ||= requestAnimationFrame(() => {
        frame = 0
        const area = areaOf(element)
        if (area.width <= 0 || area.height <= 0 || same(sent, area)) return
        sent = area
        void host.picture?.(shown, area.width, area.height, true).catch(() => undefined)
      })
    })
    watcher.observe(element)
    return () => {
      watcher.disconnect()
      cancelAnimationFrame(frame)
      void host.stopPicture?.(shown).catch(() => undefined)
    }
  }, [shown, host, seen, hidden])
  const pictureEnded = useCallback(
    (why: string): void => {
      if (elsewhere) setProblem(why === 'closed' ? `${elsewhere.title} closed.` : why)
      programElsewhere.set(undefined)
    },
    [elsewhere],
  )
  /** Bring it here: the program itself on the panel, to work in, as when chosen from the list. */
  const bring = (): void => {
    const item = elsewhere
    if (!item) return
    programElsewhere.set(undefined)
    choose(item)
  }

  // Covered: hidden while something of ShellNote is over the panel, or another panel is in full view.
  const [over, setOver] = useState(false)
  useEffect(() => (id === undefined ? undefined : watchCovered(() => body.current, '.nw-program', setOver)), [id])
  const covered = over || hidden
  useEffect(() => {
    const now = programHeld.value
    if (id === undefined || !now || now.id !== id) return
    const state: Held['state'] = covered ? 'covered' : 'held'
    if (now.state === state) return
    programHeld.set({ ...now, state })
    void host.cover(id, covered).catch(() => undefined)
  }, [covered, id, host])

  // The panel closed, however: the program let go, back to its own place, size and state from before the panel, its
  // taskbar button back.
  useEffect(
    () => () => {
      const now = programHeld.value
      if (now && (now.state === 'held' || now.state === 'covered')) void host.letGo(now.id).catch(() => undefined)
      programHeld.set(undefined)
      programElsewhere.set(undefined)
    },
    [host],
  )

  const close = (): void => programShown.set(false)
  const letGo = (): void => {
    if (held && on) void host.letGo(held.id).catch(() => undefined)
    programHeld.set(undefined)
  }

  return (
    <section className="nw-program" aria-label="Program">
      <PanelBar title="Program" onClose={close}>
        {on || elsewhere ? <span className="nw-program-keeping" title={KEEPING} aria-label={KEEPING} role="img" /> : null}
        {held && on ? (
          <span className="nw-program-name" title={held.title}>
            {held.title}
          </span>
        ) : elsewhere ? (
          <span className="nw-program-name" title={elsewhere.title}>
            {elsewhere.title}
          </span>
        ) : null}
        {elsewhere && !on ? (
          <>
            <button type="button" className="nw-ibtn" aria-label="Bring it here" title="Bring it here: the program itself on the panel, to work in" onClick={bring}>
              <ArrowDownToLine size={15} aria-hidden />
            </button>
            <button type="button" className="nw-ibtn" aria-label="Back to the list" title="Back to the list of windows" onClick={() => programElsewhere.set(undefined)}>
              <List size={15} aria-hidden />
            </button>
          </>
        ) : held && on ? (
          <button type="button" className="nw-ibtn" aria-label="Let the program go" title="Let it go: back to its own window, as it was before the panel" onClick={letGo}>
            <Undo2 size={15} aria-hidden />
          </button>
        ) : (
          <button type="button" className="nw-ibtn" aria-label="List the windows again" title="List the windows again" onClick={refresh}>
            <RefreshCw size={15} aria-hidden />
          </button>
        )}
      </PanelBar>
      <div className="nw-program-body" ref={body} data-state={held?.state}>
        {on ? (
          <>
            {held.state === 'covered' ? <p className="nw-program-standin">{held.title}</p> : null}
            {pictures ? <ProgramPicture host={host} id={held.id} title={held.title} /> : null}
          </>
        ) : elsewhere ? (
          <ProgramPicture host={host} id={elsewhere.id} title={elsewhere.title} onEnd={pictureEnded} />
        ) : (
          <div className="nw-program-choose">
            {held?.state === 'closed' ? <p className="nw-program-note">{held.title} closed.</p> : null}
            {held?.state === 'moved-off' ? (
              <p className="nw-program-note">
                {held.title} was moved off the panel.{' '}
                <button type="button" className="nw-program-back" onClick={putBack}>
                  Put back
                </button>
              </p>
            ) : null}
            {problem ? (
              <p className="nw-program-note" role="alert">
                {problem}
              </p>
            ) : null}
            <p className="nw-program-hint">Choose a window to show here. It stays the program itself, used as always.</p>
            <ul className="nw-program-list" aria-label="Open windows">
              {(windows ?? []).map((item) => {
                const why = leftOutWords(item.left_out)
                return (
                  <li key={item.id}>
                    <button type="button" disabled={why !== undefined} title={why ?? `Show ${item.title} here`} onClick={() => choose(item)}>
                      <ProgramIcon host={host} item={item} />
                      <span className="nw-program-title">{item.title}</span>
                      <span className="nw-program-file">{why ?? item.program}</span>
                    </button>
                    {pictures && why === undefined ? (
                      <button
                        type="button"
                        className="nw-program-see"
                        aria-label={`Show the picture of ${item.title}`}
                        title="Show its picture here, live and view only: the program stays where it is"
                        onClick={() => {
                          setProblem(undefined)
                          programElsewhere.set(item)
                        }}
                      >
                        <Eye size={16} aria-hidden />
                      </button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
            {windows && windows.length === 0 ? <p className="nw-program-note">No other windows are open.</p> : null}
          </div>
        )}
      </div>
    </section>
  )
}
