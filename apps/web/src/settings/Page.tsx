// A section of Settings, as a page: its name and a line on what it holds, an action of its own at the right if it has
// one, then its parts.
import type { ReactNode } from 'react'

export function SettingsPage({ title, lead, action, children }: { title: string; lead: string; action?: ReactNode; children: ReactNode }) {
  return (
    <>
      <header className="set-top">
        <div>
          <h1>{title}</h1>
          <p>{lead}</p>
        </div>
        {action ? (
          <>
            <span className="sh-grow" />
            {action}
          </>
        ) : null}
      </header>
      {children}
    </>
  )
}

/** A part of a section: its heading (with a word on how it is used, and a way back to how it started, when it has them), then what it holds. */
export function SettingsPart({ title, hint, reset, children }: { title: string; hint?: string; reset?: ReactNode; children: ReactNode }) {
  return (
    <section className="set-part" aria-label={title}>
      <h2>
        {title}
        {hint ? <small>{hint}</small> : null}
        {reset ?? null}
      </h2>
      {children}
    </section>
  )
}
