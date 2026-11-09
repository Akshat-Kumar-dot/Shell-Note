export interface Rulebook {
  version: string
  topics: Record<string, string>
}
export function rulebook(): Rulebook
export function render(book: Rulebook): string
