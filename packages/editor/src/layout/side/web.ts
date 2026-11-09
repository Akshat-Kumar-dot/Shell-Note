// The side panel's web page, its address: shared and kept in the person's
// browser, so web.open can show a page before the tab is first drawn.
import { Shared } from '../../video/state.js'

const KEY = 'shellnote:side-web'

export const NOT_WEB = 'That is not a web address. Type one like wikipedia.org or https://…'

/** The address as typed, made a web address; none when it is not one, or is this app's own. */
export function webAddress(typed: string): string | undefined {
  const text = typed.trim()
  if (!text) return undefined
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
  if (typeof location !== 'undefined' && url.origin === location.origin) return undefined
  return url.href
}

function readLast(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

/** The page shown in the tab: none until one is asked for. */
export const webPage = new Shared<string | undefined>(webAddress(readLast()))

/** Show a page in the tab (its Show button, web.open), and keep its address for next time. */
export function showWebPage(address: string): void {
  try {
    localStorage.setItem(KEY, address)
  } catch {
    // Storage is off: it lasts until the page closes.
  }
  webPage.set(address)
}
