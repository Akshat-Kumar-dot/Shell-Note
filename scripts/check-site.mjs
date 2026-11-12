// The website as built, checked before it is published: its page carries the content security policy in a meta tag
// (its host sends no header of the site's own), before any script or stylesheet; the policy takes scripts from the
// site alone; and the page has no script written into it and none from another site.
//
//   node scripts/check-site.mjs apps/web/dist
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** What is wrong with a built page, as sentences; none when it is as it should be. */
export function problemsOf(html) {
  const problems = []
  const head = /<head[^>]*>([\s\S]*?)<\/head>/iu.exec(html)?.[1] ?? ''
  const tags = [...head.matchAll(/<(meta|script|link|style|base)\b[^>]*>/giu)].map((match) => match[0])
  const policyAt = tags.findIndex((tag) => /http-equiv\s*=\s*["']?content-security-policy/iu.test(tag))
  if (policyAt === -1) return ['the page has no content security policy']
  const before = tags.slice(0, policyAt).filter((tag) => !/^<meta\b/iu.test(tag))
  if (before.length > 0) problems.push(`the policy comes after ${before[0]}: it holds only for what follows it`)
  // As a browser reads the tag: the build writes a quote inside it as &#39;.
  const policy = (/content\s*=\s*"([^"]*)"/iu.exec(tags[policyAt])?.[1] ?? '').replace(/&#39;|&#x27;|&apos;/giu, "'").replace(/&quot;/giu, '"').replace(/&amp;/giu, '&')
  const directive = (name) => policy.split(';').map((part) => part.trim().split(/\s+/u)).find((part) => part[0] === name)?.slice(1)
  const scripts = directive('script-src')
  if (!scripts || scripts.join(' ') !== "'self'") problems.push(`script-src is ${scripts ? scripts.join(' ') : 'missing'}: it must be 'self' alone`)
  if ((directive('default-src') ?? []).join(' ') !== "'self'") problems.push("default-src must be 'self'")
  if ((directive('object-src') ?? []).join(' ') !== "'none'") problems.push("object-src must be 'none'")
  if ((directive('base-uri') ?? []).join(' ') !== "'none'") problems.push("base-uri must be 'none'")
  if (/'unsafe-eval'|'unsafe-hashes'|'wasm-unsafe-eval'/u.test(policy)) problems.push('the policy allows code made at run time')
  if (/<base\b/iu.test(html)) problems.push('the page sets a base address')
  for (const [whole, attributes, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)) {
    const src = /\bsrc\s*=\s*["']([^"']*)["']/iu.exec(attributes)?.[1]
    if (src === undefined || body.trim() !== '') problems.push(`a script is written into the page: ${whole.slice(0, 80)}`)
    else if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//iu.test(src)) problems.push(`a script comes from another site: ${src}`)
  }
  if (/\son[a-z]+\s*=/iu.test(html.replace(/content\s*=\s*"[^"]*"/giu, ''))) problems.push('a tag of the page has a handler written into it')
  return problems
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const folder = process.argv[2]
  if (!folder) {
    console.error('Use: node scripts/check-site.mjs <the built site folder>')
    process.exit(1)
  }
  const problems = problemsOf(readFileSync(join(folder, 'index.html'), 'utf8'))
  if (problems.length > 0) {
    console.error(`The built page is not safe to publish:\n${problems.map((problem) => `- ${problem}`).join('\n')}`)
    process.exit(1)
  }
  console.log('The built page carries its content security policy, before anything else, and takes scripts from the site alone.')
}
