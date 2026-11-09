// Where the editor runs: a browser tab, or the desktop app (Tauri 2, the of 18
// October 2026). The same code runs in both; the few places the system's web
// view behaves otherwise ask here.

/** Whether this page runs inside the desktop app's window: Tauri gives every page it opens this global. */
export const inDesktopApp = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/** Whether this is the desktop app on Windows, where Windows' own recognizer hears what is said (the app's desktop.ts). */
export const inWindowsApp = (): boolean => inDesktopApp() && /\bWindows\b/u.test(navigator.userAgent)

/** What a page of the app is called, in what it says to a person: a browser's tab, or a window of the app. */
export const tabWord = (): 'tab' | 'window' => (inDesktopApp() ? 'window' : 'tab')
