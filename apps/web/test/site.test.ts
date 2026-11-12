// The check the website's workflow runs on the built page before publishing it (scripts/check-site.mjs): the page
// must carry its content security policy first, take scripts from the site alone, and hold no script of its own.
import { describe, expect, it } from 'vitest'
import { problemsOf } from '../../../scripts/check-site.mjs'
import { websitePolicy } from '../vite.config.js'

const page = (head: string, body = '<div id="root"></div>'): string => `<!doctype html><html lang="en"><head>${head}</head><body>${body}</body></html>`
const policy = (content = websitePolicy()): string => `<meta http-equiv="Content-Security-Policy" content="${content}">`
const app = '<script type="module" crossorigin src="/assets/index-abc.js"></script><link rel="stylesheet" crossorigin href="/assets/index-abc.css">'

describe('the built website, before it is published', () => {
  it('passes as the build makes it: the policy first, then the app', () => {
    expect(problemsOf(page(`${policy()}<script defer src="/no-compiled-checks.js"></script><meta charset="utf-8" /><title>ShellNote</title>${app}`))).toEqual([])
    // The build writes each quote in the tag as &#39;, which a browser reads back as the quote.
    expect(problemsOf(page(`${policy(websitePolicy().replaceAll("'", '&#39;'))}${app}`))).toEqual([])
    // A meta tag before it changes nothing: only what could load or run counts.
    expect(problemsOf(page(`<meta charset="utf-8" />${policy()}${app}`))).toEqual([])
  })

  it('refuses a page with no policy, or one that comes after a script or a stylesheet', () => {
    expect(problemsOf(page(app))).toEqual(['the page has no content security policy'])
    expect(problemsOf(page(`${app}${policy()}`))[0]).toMatch(/^the policy comes after <script/u)
    expect(problemsOf(page(`<link rel="stylesheet" href="/a.css">${policy()}${app}`))[0]).toMatch(/^the policy comes after <link/u)
  })

  it('refuses a policy that lets scripts in from elsewhere, or code made at run time', () => {
    const wider = websitePolicy().replace("script-src 'self'", "script-src 'self' https://www.youtube.com")
    expect(problemsOf(page(`${policy(wider)}${app}`))).toEqual(["script-src is 'self' https://www.youtube.com: it must be 'self' alone"])
    const made = websitePolicy().replace("script-src 'self'", "script-src 'self' 'unsafe-eval'")
    expect(problemsOf(page(`${policy(made)}${app}`))).toContain('the policy allows code made at run time')
    expect(problemsOf(page(`${policy("default-src 'self'")}${app}`)).length).toBeGreaterThan(0)
  })

  it('refuses a script written into the page, one from another site, a handler in a tag, a base address', () => {
    expect(problemsOf(page(`${policy()}${app}<script>window.x = 1</script>`))[0]).toMatch(/^a script is written into the page/u)
    expect(problemsOf(page(`${policy()}${app}<script src="https://example.com/a.js"></script>`))).toEqual(['a script comes from another site: https://example.com/a.js'])
    expect(problemsOf(page(`${policy()}${app}<script src="//example.com/a.js"></script>`))).toEqual(['a script comes from another site: //example.com/a.js'])
    expect(problemsOf(page(`${policy()}${app}`, '<div id="root" onclick="x()"></div>'))).toEqual(['a tag of the page has a handler written into it'])
    expect(problemsOf(page(`${policy()}<base href="https://example.com/">${app}`))).toContain('the page sets a base address')
  })
})
