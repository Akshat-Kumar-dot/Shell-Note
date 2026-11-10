# Contributing to ShellNote

Thanks for your interest in ShellNote. Bug reports, ideas and pull requests are all welcome.

## Before you start

- **Bugs:** search the [issues](https://github.com/Akshat-Kumar-dot/Shell-Note/issues) first, then open one with
  the steps to reproduce it, what you expected and what happened.
- **Larger changes:** open an issue to talk about the idea before writing the code, so your time is not spent on
  something that cannot be merged.
- **Security problems:** do not open a public issue; follow [SECURITY.md](SECURITY.md).

## Setting up

You need [Node.js](https://nodejs.org) 22.12 or later. The pnpm version is pinned in `package.json`, and Corepack
provides it:

```bash
corepack enable
pnpm install
pnpm dev        # http://localhost:5190
```

For the desktop app you also need Windows, the [Rust toolchain](https://rustup.rs) and WebView2 (part of Windows 11).

## Making a change

1. Create a branch from `main`.
2. Keep each commit small and focused, and add tests next to what you change: unit tests in `packages/*/test/` and
   `apps/web/test/`, browser tests in `apps/web/e2e/`.
3. Run the checks before you push:
   ```bash
   pnpm check      # typecheck, lint and unit tests
   pnpm e2e        # browser tests, for anything people see or touch
   ```
4. Open a pull request and fill in the template. The checks run again there and must pass before it is merged.

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains where things live and how a keystroke, a pen stroke or an AI
edit travels through the code.

## Code conventions

- **TypeScript in strict mode, ES modules.** Relative imports end in `.js`, even though the file on disk is `.ts`.
- **Only `apply(doc, ops)` in `packages/core` changes a note.** The editor, the AI and undo all go through it. Never
  change a `Doc` in place: `apply` returns a new one.
- **`packages/core` uses no DOM and no Node-only APIs.** ESLint enforces this. Platform behaviour is passed in by the
  caller.
- **Schemas are defined once, with Zod,** in `packages/core/src/schema/`; TypeScript types come from `z.infer`.
- **Geometry is in whole numbers:** 1 unit = 0.01 mm. No floats in a saved file.
- **Every block has `r`,** the revision of the change that last touched it. `apply` sets it; never set it by hand.
- **Comments explain why,** in plain words, for the next person reading the code.

## Dependencies

Keep them few. A new dependency must be under MIT, Apache-2.0, MPL-2.0 or ISC (font files may also be under the SIL
Open Font License 1.1). `pnpm licences` checks every package the code depends on and rewrites the notices file; a
package under any other licence needs a discussion in an issue first.

## Commit messages

A short subject in the imperative with an area prefix, then a body that says why:

```text
editor: keep the caret when undo changes the frame

Undo replaced the frame's whole text, so the caret jumped to the end.
It now applies the smallest replacement, as typing does.
```

Common prefixes: `core:`, `editor:`, `web:`, `desktop:`, `providers:`, `docs:`, `build:`, `ci:`.

## License

By contributing, you agree that your contributions are licensed under the project's licence, the
[Apache License 2.0](LICENSE), as its section 5 describes.
