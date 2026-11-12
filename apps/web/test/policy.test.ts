// The content security policy of the app's pages: one policy, kept in the desktop app's configuration, sent as a
// header by the app and carried by the website's own page in a meta tag (its host sends no header of the site's).
// These check what the policy must always say, whatever else changes: scripts from the app alone, none made at run
// time, no plug-ins, no base address, no form sent anywhere.
import { describe, expect, it } from 'vitest'
import { desktopPolicy, forWebsite, websitePolicy } from '../vite.config.js'

const directives = (policy: string): Map<string, string[]> => new Map(policy.split(';').map((part) => part.trim().split(/\s+/u)).map(([name, ...sources]) => [name!, sources]))

describe('the content security policy', () => {
  for (const [where, text] of [
    ['the desktop app', desktopPolicy()],
    ['the website', websitePolicy()],
  ] as const) {
    const policy = directives(text)

    it(`${where}: scripts come from the app itself and nowhere else, and none is made at run time`, () => {
      expect(policy.get('script-src')).toEqual(["'self'"])
      expect(policy.get('default-src')).toEqual(["'self'"])
      // No script-src-elem or script-src-attr of its own to widen it again.
      expect([...policy.keys()].filter((name) => name.startsWith('script-src'))).toEqual(['script-src'])
    })

    it(`${where}: no plug-ins, no base address, no form sent anywhere, fonts and media from the app`, () => {
      expect(policy.get('object-src')).toEqual(["'none'"])
      expect(policy.get('base-uri')).toEqual(["'none'"])
      expect(policy.get('form-action')).toEqual(["'none'"])
      expect(policy.get('font-src')).toEqual(["'self'"])
      expect(policy.get('media-src')).toEqual(["'self'", 'blob:'])
    })

    it(`${where}: nothing unsafe but styles written into a tag, which run no code`, () => {
      const unsafe = [...policy].flatMap(([name, sources]) => sources.filter((source) => source.startsWith("'unsafe-") || source === '*' || source === "'wasm-unsafe-eval'").map((source) => `${name} ${source}`))
      expect(unsafe).toEqual(["style-src 'unsafe-inline'"])
    })
  }

  it('the desktop app: no other page may frame it, and its page reaches Rust', () => {
    const policy = directives(desktopPolicy())
    expect(policy.get('frame-ancestors')).toEqual(["'none'"])
    expect(policy.get('connect-src')).toEqual(expect.arrayContaining(['ipc:', 'http://ipc.localhost']))
  })

  it('the website: what a meta tag cannot say is left out, and there is no channel to Rust', () => {
    const policy = directives(websitePolicy())
    // A browser passes over the whole of frame-ancestors, report-uri and sandbox in a meta tag, and warns of each.
    for (const header of ['frame-ancestors', 'report-uri', 'report-to', 'sandbox']) expect(policy.has(header), header).toBe(false)
    expect(policy.get('connect-src')).not.toEqual(expect.arrayContaining(['ipc:']))
    expect(policy.get('connect-src')).not.toEqual(expect.arrayContaining(['http://ipc.localhost']))
    // No quote could end the tag's attribute early.
    expect(websitePolicy()).not.toMatch(/["<>]/u)
  })

  it('the website as built carries it in its page, before anything else, and only as built', () => {
    expect(forWebsite.apply).toBe('build')
    const tags = (forWebsite.transformIndexHtml as () => { tag: string; attrs: Record<string, string | boolean>; injectTo: string }[])()
    expect(tags[0]).toEqual({ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: websitePolicy() }, injectTo: 'head-prepend' })
    // Then Zod is told not to make code at run time, which the policy refuses (public/no-compiled-checks.js).
    expect(tags[1]).toMatchObject({ tag: 'script', attrs: { src: '/no-compiled-checks.js' }, injectTo: 'head-prepend' })
  })
})
