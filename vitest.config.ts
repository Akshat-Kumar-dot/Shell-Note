import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.{ts,tsx}', 'apps/web/test/**/*.test.{ts,tsx}'],
    // Every file runs at once, one worker each: on a test laptop four tests that take 0.4 to 1.3 s alone passed the
    // default 5 s in a full run (24 October 2026). A real hang still fails, at 20 s.
    testTimeout: 20_000,
    // A test may read a stylesheet's text (?raw), to check it agrees with the code.
    css: { include: [/theme\.css/u] },
  },
})
