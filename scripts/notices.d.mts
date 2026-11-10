export const RULE: string
export function licenceFiles(dir: string): string[]
export function chosenFiles(files: readonly string[], expression?: string): string[]
export function readTexts(dir: string, files: readonly string[]): string[]
export function mitText(holders: string): string
export function offersMit(expression?: string): boolean
export function webAddress(repository: unknown): string | undefined
export function entry(title: string, address: string | undefined, texts: readonly string[]): string[]
