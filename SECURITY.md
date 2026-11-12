# Security policy

## Supported versions

ShellNote is in an early testing phase. Security fixes go into the latest code on `main`.

## Reporting a vulnerability

Please do not report security problems in public issues. Report them privately through GitHub instead: open the
repository's **Security** tab and choose **Report a vulnerability**.

Include what you can of:

- the version or commit, and the platform (browser and version, or Windows and the desktop app);
- the steps to reproduce the problem, or a proof of concept;
- what an attacker could do with it.

You will get a reply as soon as possible. Once the problem is confirmed, a fix is prepared, and you are credited in
the release notes unless you prefer not to be.

## Areas of particular interest

- **Opening note files:** a `.shellnote` file is a zip archive, read and checked by `packages/core/src/io/`.
- **AI keys:** an OpenRouter key is kept on the device only and is never written into a note or a log.
- **The desktop app's program panel:** another program's window is held, pictured and given back by
  `apps/desktop/src-tauri/src/apps.rs`. Private browser windows must never be listed, shown or pictured, and no
  command may control another program.
- **Text from other programs and from notes:** it is always treated as data, never as instructions to the AI.
- **The content security policy:** the website and the desktop app take scripts from ShellNote alone, and none made
  at run time. One policy serves both (`apps/desktop/src-tauri/tauri.conf.json`); the website carries it in its page
  (`apps/web/vite.config.ts`), since its host sends no header of the site's own.
- **The library's folder in the desktop app:** the page may read, write and remove notes and the library's own files
  in the folder you chose, and nothing else there, and nothing outside it (`apps/desktop/src-tauri/src/library.rs`).
- **Anything a note file can make the app fetch or open** without a click.
