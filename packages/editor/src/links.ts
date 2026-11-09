// Which link addresses a note may hold and show. A note can
// come from a file, a paste or an AI, so every place that turns text into a
// link asks here first: web pages and email only, never javascript: or data:.

/** The address, if a note may link to it; otherwise undefined. */
export function safeHref(href: string): string | undefined {
  const trimmed = href.trim()
  return /^(?:https?:\/\/|mailto:)\S+$/iu.test(trimmed) ? trimmed : undefined
}
