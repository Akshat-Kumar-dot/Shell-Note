// Where the page comes under the desktop app's content security policy (vite.config.ts puts this script in the page
// there, before the app's own): Zod, which checks every change to a note, would try once to make its checks into code
// at run time (new Function), which the policy refuses and reports. Told first, it does not try, and uses its plain
// checks (about 0.6 µs more a key typed, measured on 25 October 2026). Zod keeps its settings on this global so that
// every copy of it shares them; should a later Zod stop reading it, the tests under the policy say so.
globalThis.__zod_globalConfig = { ...globalThis.__zod_globalConfig, jitless: true }
