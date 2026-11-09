export interface Shipped {
  name: string
  version: string
  /** The SPDX expression its package.json names; undefined when it names none. */
  licence: string | undefined
  dir: string
  /** The package that brought it in, or "the workspace". */
  via: string
}
export interface Exception {
  name: string
  version: string
  licence: string
  ship?: boolean
  file?: boolean
  why: string
}
export const ALLOWED: readonly string[]
export const EXCEPTIONS: readonly Exception[]
export function shipped(): Shipped[]
export function licenceText(dir: string): string
export function problems(packages?: readonly Shipped[]): string[]
export function thirdParty(packages?: readonly Shipped[]): string
