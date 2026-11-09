import type { Caps } from '@shellnote/core'

/**
 * Billions of parameters, read from a model's name: "qwen2.5-1.5b-instruct"
 * gives 1.5, "google/gemma-4-e4b" gives 4. Undefined when the name does not say.
 */
export function sizeFromName(name: string): number | undefined {
  const match = /(?:^|[-_/:])e?(\d+(?:\.\d+)?)b(?=$|[-_:.])/iu.exec(name)
  return match ? Number(match[1]) : undefined
}

/** The terminal's pages: one for every model, and the small models' own. */
export type TerminalPage = 'overall' | 'small'
/** The person's choice: by the model's size (auto), or one page for every model. */
export type PageSetting = 'auto' | TerminalPage
/**
 * Under this many billions, read from the name, a model gets the small models' page. On the names' own scale: Gemma's
 * "e2b" is 2 and "e4b" 4, so Gemma 4 E4B (97 % of the dev tasks on the page for every model) keeps that page, and
 * Gemma 4 E2B (72 %) and Qwen2.5-1.5B (17 %) get the small one. A name with no size (a hosted model) gets the page for
 * every model.
 */
export const SMALL_PAGE_UNDER = 3

/** Which page a model gets: the person's choice, else by its size. */
export function pageFor(name: string, setting: PageSetting = 'auto'): TerminalPage {
  if (setting !== 'auto') return setting
  const size = sizeFromName(name)
  return size !== undefined && size < SMALL_PAGE_UNDER ? 'small' : 'overall'
}

/**
 * Claude from version 5 on: "anthropic/claude-haiku-5.5", "claude-opus-5-5".
 * Checked on 10 October 2026: these refuse a temperature, and think before
 * they answer.
 */
const CLAUDE_5 = /claude-(?:[a-z]+-)?(?:[5-9]|\d{2,})(?:$|[.\-_:])/iu

/** Thinking models by name: Claude 5 and later, Qwen 3.5, and names that say so. */
const THINKS = /qwen3\.5|thinking|reasoner|(?:^|[-_/])r1(?:$|[-_:])/iu

/**
 * Whether a model takes a temperature. Claude from version 5 on refuses any,
 * so the request leaves it out and the model's own default applies.
 */
export function takesTemperature(name: string): boolean {
  return !CLAUDE_5.test(name)
}

/**
 * A first guess at what a model can do. Under 7B parameters it gets the small
 * operation set; 7B and over, or a size the name does not give (hosted models),
 * the full set. The benchmark result overrides the guess, and the person can
 * override both.
 */
export function guessCaps(name: string, overrides: Partial<Caps> = {}): Caps {
  const size = sizeFromName(name)
  return {
    jsonSchema: true,
    inlineContent: false,
    vision: /(^|[-/_])vl([-/_]|$)|vision/iu.test(name),
    opSet: size !== undefined && size < 7 ? 'small' : 'full',
    thinking: CLAUDE_5.test(name) || THINKS.test(name),
    // Anthropic's structured outputs hold every schema to strict mode, which refuses maxItems and maxLength.
    ...(/claude/iu.test(name) ? { strictSchema: true } : {}),
    ...overrides,
  }
}
