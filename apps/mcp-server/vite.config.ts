// The server as one file to run with Node: dist/shellnote-mcp.mjs. Everything
// it needs is inside it, so nothing is fetched or looked for when an AI app
// starts it.
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rollupOptions: { output: { entryFileNames: 'shellnote-mcp.mjs', inlineDynamicImports: true } },
  },
  ssr: { noExternal: true },
})
