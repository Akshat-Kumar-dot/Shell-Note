// What both licence checks (licences.mjs, licences-rust.mjs) write into the notices that ship with the app: for each
// package, the licence text it was published with; where its licence is a choice, the one ShellNote takes; and for
// the few published without a licence file, the licence's standard text with the authors they name.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const RULE = '='.repeat(78)

/** A package's licence files: LICENSE, LICENCE.md, LICENSE-MIT, LICENSE_APACHE-2.0, COPYING, UNLICENSE and the like. */
export function licenceFiles(dir) {
  return readdirSync(dir)
    .filter((name) => /^(?:licen[cs]e|unlicense|copying)(?:[-_.][\w.-]*)?$/iu.test(name) && !/\.spdx$/iu.test(name))
    .sort()
}

/**
 * The files whose notices go out with a package. Where its licence is a choice ("MIT OR Apache-2.0", "Unlicense/MIT"),
 * the MIT one when it has one, as ShellNote takes such packages under MIT; otherwise all of them, as "MIT AND
 * BSD-3-Clause" needs both.
 */
export function chosenFiles(files, expression = '') {
  const choice = /\bOR\b|\//u.test(expression) && !/\bAND\b/u.test(expression)
  const mit = files.find((name) => /(?:^|[-_.])mit(?:[-_.]|$)/iu.test(name))
  return choice && mit !== undefined ? [mit] : files
}

/** The texts of those files, line ends made plain. */
export function readTexts(dir, files) {
  return files.map((name) => readFileSync(join(dir, name), 'utf8').replace(/\r\n/gu, '\n').trim())
}

/** The MIT licence's standard text, for a package that names MIT but was published without its licence file. */
export function mitText(holders) {
  return `MIT License

Copyright (c) ${holders}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`
}

/** Whether a licence expression lets ShellNote take the package under MIT. */
export const offersMit = (expression = '') => /(?:^|[\s(/])MIT(?:$|[\s)/])/u.test(expression)

/** A package's repository as a web address: "git+https://github.com/a/b.git", "github:a/b" and "a/b" all give https://github.com/a/b. */
export function webAddress(repository) {
  const url = typeof repository === 'string' ? repository : repository?.url
  if (typeof url !== 'string' || url.trim() === '') return undefined
  const plain = url
    .trim()
    .replace(/^git\+/u, '')
    .replace(/^git:\/\//u, 'https://')
    .replace(/^git@github\.com:/u, 'https://github.com/')
    .replace(/^github:/u, 'https://github.com/')
    .replace(/\.git$/u, '')
  if (/^https?:\/\//u.test(plain)) return plain
  return /^[\w.-]+\/[\w.-]+$/u.test(plain) ? `https://github.com/${plain}` : undefined
}

/** One package's lines: its name, version and licence, where its source is, then its notices. */
export function entry(title, address, texts) {
  return [RULE, title, ...(address ? [address] : []), RULE, '', ...texts.flatMap((text) => [text, ''])]
}
