// The side panel's web page: a page beside the note. Many sites refuse to be
// shown inside another page (Google, YouTube's own pages, most banks and news sites); for those, a tab of their own.
// Sandboxed: the page cannot take the app over, nor open this app's own address inside itself. Full browsing comes
// with the desktop app (phase 10).
import { ExternalLink } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { commands } from '../../commands/index.js'
import { NOT_WEB, webAddress, webPage } from './web.js'

export { webAddress } from './web.js'

export function WebTab() {
  const shown = useSyncExternalStore(webPage.subscribe, webPage.snapshot)
  const [typed, setTyped] = useState(shown ?? '')
  // A page shown from elsewhere (web.open) shows its address in the box too.
  useEffect(() => setTyped(shown ?? ''), [shown])
  const [problem, setProblem] = useState<string>()
  /** Show what is typed (web.open). */
  const go = (): void => {
    if (!webAddress(typed)) {
      setProblem(NOT_WEB)
      return
    }
    setProblem(undefined)
    commands.tap('web.open', { link: typed })
  }
  return (
    <div className="nw-web">
      <form
        className="nw-video-link"
        onSubmit={(event) => {
          event.preventDefault()
          go()
        }}
      >
        <input aria-label="Web address" data-command="web.open" placeholder="A web address" value={typed} onChange={(event) => setTyped(event.target.value)} />
        <button type="submit" className="nw-video-add" data-command="web.open">
          Show
        </button>
      </form>
      {problem ? (
        <p className="nw-video-problem" role="alert">
          {problem}
        </p>
      ) : null}
      {shown ? (
        <>
          <p className="nw-video-note">
            Blank? The site does not let other pages show it.{' '}
            <a href={shown} target="_blank" rel="noopener noreferrer">
              Open it in a new tab <ExternalLink size={12} aria-hidden />
            </a>
          </p>
          <iframe className="nw-web-page" title="Web page" src={shown} sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" />
        </>
      ) : null}
    </div>
  )
}
