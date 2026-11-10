//! ShellNote as an installed app: the web app in
//! the system's own web view (WebView2 on Windows), with Rust for what a
//! browser cannot do. Everything a person sees is the web app; this side adds
//! only what needs the system, and makes each window behave as a browser tab
//! does: its title follows the note, a link opens in the person's own browser,
//! one of the app's own pages opened apart (Ctrl+click, a middle click) opens
//! in a window of its own, files dropped from the desktop reach the page,
//! Ctrl and + or - zooms, the window opens where it was last, and closing
//! waits for the note to be kept.

use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::webview::{NewWindowResponse, PageLoadEvent, ScrollBarStyle};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window, WindowEvent};

/// The library kept in a folder the person chooses: its files, and the choice.
mod library;
#[cfg(windows)]
mod speech;
/// Elsewhere the web view's own speech recognition is used: the page asks for Windows' only on Windows (desktop.ts).
#[cfg(not(windows))]
mod speech {
    #[tauri::command]
    pub fn listen() {}
    #[tauri::command]
    pub fn stop_listening() {}
}

#[cfg(windows)]
mod apps;
/// ShellNote's own title bar: the snap window over the page's maximise button (Windows only).
#[cfg(windows)]
mod titlebar;
/// A program's live picture on its panel (stage 3, Windows only for now).
#[cfg(windows)]
mod picture;
/// A program's place as a line is written beside it (stage 4, Windows only for now).
#[cfg(windows)]
mod place;
#[cfg(not(windows))]
mod place {
    #[tauri::command]
    pub fn apps_place_of() -> Option<()> {
        None
    }
    #[tauri::command]
    pub fn apps_go_to() -> bool {
        false
    }
    #[tauri::command]
    pub fn apps_words_of() -> Option<()> {
        None
    }
    #[tauri::command]
    pub fn apps_read_picture() -> Option<()> {
        None
    }
    #[tauri::command]
    pub fn apps_may_keep_picture() -> bool {
        false
    }
}
#[cfg(not(windows))]
mod picture {
    #[tauri::command]
    pub fn apps_picture() -> Result<(), String> {
        Err("only on Windows for now".into())
    }
    #[tauri::command]
    pub fn apps_picture_stop() {}
    #[tauri::command]
    pub fn apps_pictures_running() -> usize {
        0
    }
}
#[cfg(not(windows))]
mod titlebar {
    #[tauri::command]
    pub fn titlebar_snap() {}
}
/// Other programs on a panel are Windows' only for now: elsewhere none is listed, and none can be held.
#[cfg(not(windows))]
mod apps {
    #[tauri::command]
    pub fn apps_list() -> Vec<()> {
        Vec::new()
    }
    #[tauri::command]
    pub fn apps_hold() -> Result<(), String> {
        Err("only on Windows for now".into())
    }
    #[tauri::command]
    pub fn apps_place() -> Result<(), String> {
        Err("only on Windows for now".into())
    }
    #[tauri::command]
    pub fn apps_let_go() -> Result<(), String> {
        Err("only on Windows for now".into())
    }
    #[tauri::command]
    pub fn apps_cover() -> Result<(), String> {
        Err("only on Windows for now".into())
    }    #[tauri::command]
    pub fn apps_icon() -> Result<(), String> {
        Err("only on Windows for now".into())
    }
}

/// The first window; those opened after it are "window-2", "window-3", and so on (never used twice).
const MAIN: &str = "main";
/// How many windows have been opened, the first included.
static OPENED: AtomicUsize = AtomicUsize::new(1);
/// How long a window may stay hidden while its page loads, at most: then it shows, loaded or not.
const SHOW_WAIT: Duration = Duration::from_secs(3);
/// How long a closing window waits for its page to say its note is kept, at most.
const CLOSE_WAIT: Duration = Duration::from_secs(2);
/// The windows asked to close, by label: each page is keeping its note. A second ask (or the wait running out) closes.
static CLOSING: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn closing(label: &str) -> bool {
    CLOSING.lock().map(|labels| labels.iter().any(|l| l == label)).unwrap_or(false)
}

/// Where the app is running, as Rust names it: the system ("windows",
/// "android", "linux", "macos") and the processor ("x86_64", "aarch64"). For
/// where each note was made: ink written in the app can be read by
/// the system's own reader.
#[derive(serde::Serialize)]
struct Where {
    os: &'static str,
    arch: &'static str,
}

#[tauri::command]
fn where_running() -> Where {
    Where {
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
    }
}

/// The page has kept its note after a close was asked for: its window goes now.
#[tauri::command]
fn ready_to_close(window: WebviewWindow) {
    let _ = window.destroy();
}

/// What a link may open outside the app: web pages and email, as a note may hold (the editor's links.ts).
fn may_open(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "mailto")
}

/// One of the app's own pages: one from the same place as the page it was opened from (as a browser opens the same
/// site's page in a tab of its own), or one of its built pages (http://tauri.localhost on Windows and Android,
/// tauri://localhost on macOS and Linux). Never sent to the person's browser, which cannot open them.
fn own_page(opener: Option<&Url>, url: &Url) -> bool {
    let built = url.scheme() == "tauri" || (matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost"));
    // An opaque origin (a custom scheme's) never equals another: those are the built pages, above.
    built || opener.is_some_and(|opener| opener.origin().is_tuple() && opener.origin() == url.origin())
}

/// A link that asks for a window of its own, as links in notes do, opens in the
/// person's own browser, as in any desktop app. Inside the app it would open a
/// bare window with no way back (found 18 October 2026). The address is passed
/// to the system as one argument, never through a shell.
fn open_outside(url: &Url) {
    if !may_open(url) {
        return;
    }
    // For the tests: the address written down, and no browser opened.
    if let Ok(log) = std::env::var("SHELLNOTE_OPENED_LOG") {
        let _ = std::fs::write(log, url.as_str());
        return;
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        /// No console window flashing up for the helper.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", url.as_str()])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(url.as_str()).spawn();
    }
    #[cfg(all(unix, not(target_os = "macos"), not(target_os = "android"), not(target_os = "ios")))]
    {
        let _ = std::process::Command::new("xdg-open").arg(url.as_str()).spawn();
    }
}

/// Whether the browser tests run this copy: they set each window's size (SHELLNOTE_WINDOW_SIZE).
fn testing() -> bool {
    std::env::var_os("SHELLNOTE_WINDOW_SIZE").is_some()
}

/// For the browser tests only: the window made the size a test asks for midway, as Playwright resizes Edge's.
#[tauri::command]
fn size_for_tests(window: WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    if !testing() {
        return Err("only for the browser tests".into());
    }
    #[cfg(desktop)]
    return window.set_size(tauri::LogicalSize::new(width, height)).map_err(|error| error.to_string());
    #[cfg(not(desktop))]
    return Err(format!("no window to size here ({width} by {height}, {})", window.label()));
}

/// A window's first size, 1280 by 860; the browser tests ask for the size each of them needs
/// (SHELLNOTE_WINDOW_SIZE, "1280x1200"), as Edge's window is made at that size.
#[cfg(desktop)]
fn window_size() -> (f64, f64) {
    std::env::var("SHELLNOTE_WINDOW_SIZE")
        .ok()
        .and_then(|size| {
            let (w, h) = size.split_once('x')?;
            Some((w.trim().parse().ok()?, h.trim().parse().ok()?))
        })
        .unwrap_or((1280.0, 860.0))
}

/// Where a window was, in the screen's own pixels, and whether it was maximized: the next start opens there, as a
/// browser's window does. Kept as one line of text, "x,y,width,height,maximized" or "…,normal".
struct Place {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
}

impl Place {
    fn read(text: &str) -> Option<Place> {
        let mut parts = text.trim().split(',').map(str::trim);
        let mut next = || parts.next();
        Some(Place { x: next()?.parse().ok()?, y: next()?.parse().ok()?, width: next()?.parse().ok()?, height: next()?.parse().ok()?, maximized: next()? == "maximized" })
    }

    fn line(&self) -> String {
        format!("{},{},{},{},{}", self.x, self.y, self.width, self.height, if self.maximized { "maximized" } else { "normal" })
    }
}

/// The file the window's place is kept in: beside the web view's own data, so a copy of the app the checks open, with
/// a data folder of its own (WEBVIEW2_USER_DATA_FOLDER), never moves the person's window. None while the browser tests
/// set each window's size (SHELLNOTE_WINDOW_SIZE).
fn place_file(app: &AppHandle) -> Option<PathBuf> {
    if testing() {
        return None;
    }
    let folder = std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").map(PathBuf::from).or_else(|| app.path().app_local_data_dir().ok())?;
    Some(folder.join("window-place.txt"))
}

/// Open the window where it was last, before it is shown; only onto a screen still there (one unplugged since would
/// leave the window out of sight), and never smaller than its least size.
#[cfg(desktop)]
fn restore_place(window: &WebviewWindow) {
    let Some(place) = place_file(window.app_handle()).and_then(|file| std::fs::read_to_string(file).ok()).and_then(|text| Place::read(&text)) else {
        return;
    };
    let (x, y) = (place.x.saturating_add((place.width / 2) as i32), place.y.saturating_add((place.height / 2) as i32));
    let on_screen = window.available_monitors().unwrap_or_default().iter().any(|monitor| {
        let (at, size) = (monitor.position(), monitor.size());
        x >= at.x && y >= at.y && x < at.x.saturating_add(size.width as i32) && y < at.y.saturating_add(size.height as i32)
    });
    if !on_screen || place.width < 240 || place.height < 180 {
        return;
    }
    let _ = window.set_size(PhysicalSize::new(place.width, place.height));
    let _ = window.set_position(PhysicalPosition::new(place.x, place.y));
    if place.maximized {
        let _ = window.maximize();
    }
}

/// Keep where a closing window is. Maximized or full screen, it keeps the place it had before, and opens maximized.
fn keep_place(window: &Window) {
    let Some(file) = place_file(window.app_handle()) else { return };
    if window.is_minimized().unwrap_or(true) {
        return;
    }
    let filled = window.is_maximized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false);
    let before = std::fs::read_to_string(&file).ok().and_then(|text| Place::read(&text));
    let place = match (filled, before) {
        (true, Some(before)) => Place { maximized: true, ..before },
        _ => {
            let (Ok(at), Ok(size)) = (window.outer_position(), window.inner_size()) else { return };
            Place { x: at.x, y: at.y, width: size.width, height: size.height, maximized: filled }
        }
    };
    if let Some(folder) = file.parent() {
        let _ = std::fs::create_dir_all(folder);
    }
    let _ = std::fs::write(file, place.line());
}

/// The web view's switches: Tauri's own (no "mini menu" over selected words, no SmartScreen), and Windows'
/// handwriting into text fields off, Edge's (msAbydos) and Chromium's (StylusHandwritingWin). With it on, the pen near
/// the note's words was taken by Windows: its own grey ink, drawn past the page, the pen's dot gone and the mouse's
/// arrow shown, a caret put in the words, and after a pause what it read typed there and its ink gone; and it
/// holds the pen's events back while it decides. The checks add theirs
/// (SHELLNOTE_BROWSER_ARGS: a developer port and the like), never a second --disable-features. WebView2's own
/// variable for this would replace these switches, not add to them.
#[cfg(windows)]
fn browser_args() -> String {
    let mut args = String::from("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,msAbydos,StylusHandwritingWin");
    if let Ok(more) = std::env::var("SHELLNOTE_BROWSER_ARGS") {
        args.push(' ');
        args.push_str(more.trim());
    }
    args
}

/// Show a window, unless it is closing (closed within SHOW_WAIT of opening, it stays hidden).
fn show(window: &WebviewWindow) {
    if !closing(window.label()) {
        let _ = window.show();
    }
}

/// A window of the app on one of its pages, made here rather than in tauri.conf.json, for what only code can set.
fn app_window(app: &AppHandle, label: &str, page: WebviewUrl) -> tauri::Result<WebviewWindow> {
    let builder = WebviewWindowBuilder::new(app, label, page)
        .title("ShellNote")
        // Shown once its page has loaded, drawn, not as a blank white window first (SHOW_WAIT at most).
        .visible(false)
        .on_page_load(|window, payload| {
            // A new page starting (a reload: F5, Ctrl+R, the stroke recorder, a sample note) knows nothing of the
            // programs the old one held: they let go, as when ShellNote closes, or they stay over ShellNote with
            // nothing to let them go (25 October 2026). A change of the page's # route loads no page: they stay.
            #[cfg(windows)]
            if payload.event() == PageLoadEvent::Started {
                apps::host_closing(window.label());
                picture::host_closing(window.label());
            }
            if payload.event() == PageLoadEvent::Finished {
                show(&window);
            }
        })
        // Files dropped from the desktop go to the page, as in the browser (pictures onto a note); Tauri's own
        // handler would take them, and the page would see nothing.
        .disable_drag_drop_handler()
        // The window's title is the page's: the note's name, as the browser's tab shows it.
        .on_document_title_changed(|window, title| {
            let _ = window.set_title(if title.trim().is_empty() { "ShellNote" } else { &title });
        })
        // Scroll bars as Edge's, over the page: WebView2's own take 15 points from it, so the page sat 7.6 points
        // left of where Edge puts it, and jumped sideways when a note grew long enough to scroll (18 October 2026).
        // The same for every window, as WebView2 requires of windows sharing a data folder.
        .scroll_bar_style(ScrollBarStyle::FluentOverlay)
        // Ctrl and + or -, Ctrl+0 and Ctrl with the wheel zoom the page, as in a browser (Tauri turns them off unless
        // asked). Over a note, Ctrl with the wheel stays the note's own zoom: the page takes it first, as in Edge.
        .zoom_hotkeys_enabled(true);
    // The same for every window, as WebView2 requires of windows sharing a data folder.
    #[cfg(windows)]
    let builder = builder.additional_browser_args(&browser_args());
    // No Windows title bar: the page's app bar is the window's top row, with its own minimise, maximise and close
    // (titlebar.rs). The shadow stays, so Windows keeps the border, the round corners and the resize edges.
    #[cfg(windows)]
    let builder = builder.decorations(false);
    #[cfg(desktop)]
    let builder = {
        let (width, height) = window_size();
        let builder = builder.inner_size(width, height).min_inner_size(480.0, 360.0);
        // For the browser tests, a window as tall as a test asks, taller than the screen if need be, as Edge's is made
        // (Windows keeps a window within the screen unless its largest size says otherwise).
        let builder = if testing() { builder.max_inner_size(8192.0, 8192.0) } else { builder };
        let app = app.clone();
        let label = label.to_string();
        builder.on_new_window(move |url, _features| {
            let opener = app.get_webview_window(&label).and_then(|window| window.url().ok());
            if own_page(opener.as_ref(), &url) {
                // The app's own page opened apart, as a browser opens a new tab: a window of its own, the library
                // shared (one store, as tabs share theirs; a note open in two is read-only in the second).
                let opened = format!("window-{}", OPENED.fetch_add(1, Ordering::SeqCst) + 1);
                let _ = app_window(&app, &opened, WebviewUrl::External(url));
            } else {
                open_outside(&url);
            }
            NewWindowResponse::Deny
        })
    };
    let window = builder.build()?;
    #[cfg(windows)]
    whole_screen_when_full(&window);
    #[cfg(desktop)]
    if label == MAIN {
        restore_place(&window);
    }
    let late = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(SHOW_WAIT);
        show(&late);
    });
    Ok(window)
}

/// Full screen from a maximised window. When the page asks for full screen (the app's own button, F11, a video's own),
/// Tauri makes the window full screen; but a window without Windows' frame that is maximised keeps its page within the
/// screen less the taskbar, so the page stopped short and left a black band at the bottom. So a maximised window is
/// restored first, at once, before Tauri's full screen comes in, and maximised again once full screen is left.
#[cfg(windows)]
fn whole_screen_when_full(window: &WebviewWindow) {
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;
    use webview2_com::ContainsFullScreenElementChangedEventHandler;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{IsZoomed, ShowWindow, SW_RESTORE};

    let was_maximised = Arc::new(AtomicBool::new(false));
    let target = window.clone();
    let _ = window.with_webview(move |webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else { return };
        let handler = ContainsFullScreenElementChangedEventHandler::create(Box::new(move |sender, _| {
            let mut full = windows::core::BOOL::default();
            sender.ok_or_else(windows::core::Error::empty)?.ContainsFullScreenElement(&mut full)?;
            let Ok(raw) = target.hwnd() else { return Ok(()) };
            let hwnd = HWND(raw.0 as *mut std::ffi::c_void);
            if full.as_bool() {
                // Restored now, on this thread, before Tauri's own full screen (sent to the event loop) is carried out.
                if IsZoomed(hwnd).as_bool() {
                    was_maximised.store(true, Ordering::SeqCst);
                    let _ = ShowWindow(hwnd, SW_RESTORE);
                }
            } else if was_maximised.swap(false, Ordering::SeqCst) {
                // Maximised again once the window has left full screen, which Tauri does after this returns.
                let window = target.clone();
                std::thread::spawn(move || {
                    for _ in 0..40 {
                        if !window.is_fullscreen().unwrap_or(true) {
                            let _ = window.maximize();
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(50));
                    }
                });
            }
            Ok(())
        }));
        let mut token = Default::default();
        let _ = core.add_ContainsFullScreenElementChanged(&handler, &mut token);
    });
}

/// Whether this program was started as the watcher of a ShellNote holding other programs (apps.rs): its work is
/// then done, and it ends without opening the app.
#[cfg(windows)]
pub fn run_as_watcher() -> bool {
    apps::watcher(&std::env::args().collect::<Vec<_>>())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            where_running,
            ready_to_close,
            size_for_tests,
            speech::listen,
            speech::stop_listening,
            apps::apps_list,
            apps::apps_hold,
            apps::apps_place,
            apps::apps_let_go,
            apps::apps_cover,
            apps::apps_icon,
            picture::apps_picture,
            picture::apps_picture_stop,
            picture::apps_pictures_running,
            place::apps_place_of,
            place::apps_go_to,
            place::apps_words_of,
            place::apps_read_picture,
            place::apps_may_keep_picture,
            titlebar::titlebar_snap,
            library::library_folder,
            library::library_choose,
            library::library_forget,
            library::library_list,
            library::library_info,
            library::library_read,
            library::library_write,
            library::library_move,
            library::library_remove,
            library::library_make_folder
        ])
        .setup(|app| {
            // Programs a ShellNote that ended without letting them go left held (a crash, End task): given back.
            #[cfg(windows)]
            apps::recover(app.handle());
            app_window(app.handle(), MAIN, WebviewUrl::App("index.html".into()))?;
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Closing: the window goes from the screen at once, its page keeps its note (it is told, and says when
            // done: ready_to_close), then it closes; a page that never answers is closed after CLOSE_WAIT.
            WindowEvent::CloseRequested { api, .. } => {
                let label = window.label().to_string();
                {
                    let Ok(mut labels) = CLOSING.lock() else { return };
                    if labels.contains(&label) {
                        return;
                    }
                    labels.push(label.clone());
                }
                api.prevent_close();
                // Other programs on its panels let go before it hides, so they stay shown and open.
                #[cfg(windows)]
                apps::host_closing(&label);
                picture::host_closing(&label);
                keep_place(window);
                let _ = window.hide();
                if let Some(webview) = window.app_handle().get_webview_window(&label) {
                    let _ = webview.eval("window.dispatchEvent(new Event('shellnote:closing'))");
                    std::thread::spawn(move || {
                        std::thread::sleep(CLOSE_WAIT);
                        let _ = webview.destroy();
                    });
                }
            }
            WindowEvent::Destroyed => {
                if let Ok(mut labels) = CLOSING.lock() {
                    labels.retain(|l| l != window.label());
                }
                #[cfg(windows)]
                apps::host_closing(window.label());
                picture::host_closing(window.label());
            }
            // Other programs on its panels follow it, from here (no trip through the page), and stay above it.
            #[cfg(windows)]
            WindowEvent::Moved(_) | WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
                if let Some(webview) = window.app_handle().get_webview_window(window.label()) {
                    apps::host_moved(&webview);
                }
            }
            #[cfg(windows)]
            WindowEvent::Focused(true) => {
                if let Some(webview) = window.app_handle().get_webview_window(window.label()) {
                    apps::host_in_front(&webview);
                }
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("shellnote could not start");
}
