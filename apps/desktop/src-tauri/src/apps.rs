//! Other programs inside ShellNote, on Windows. A program's own, whole window is kept on a panel of the page: the
//! page's window is made its owner (so it stays above ShellNote, and hides and shows with it), and it is placed on the
//! panel's box with the invisible borders Windows keeps round a window added back (the spike: 0 px off). It is the real
//! program, running on its own: nothing of it runs inside ShellNote, and the person uses it as always.
//!
//! What this side does, with no trip through the page where none is needed:
//! - lists the windows a person could put on a panel, saying which are left out and why (one run as administrator
//!   cannot be moved by an ordinary app, and ShellNote never asks to run as one);
//! - holds a window on a box of the page (in the screen's pixels from the page's top left), and places it again as ShellNote's window
//! moves, resizes or changes screens (from its window events), and raises it when ShellNote comes in front !
//(PowerPoint alone dropped behind its owner in the spike);
//! - follows the program's own moves, title changes and closing (`SetWinEventHook`, filtered to that program), and
//!   tells the page (the event "apps");
//! - gives ShellNote's frame round it: square corners and the panel's border colour (allowed, the spike found);
//! - lets it go: hidden, its owner removed, shown again where it is, its corners and border as before;
//! - keeps a record of what it holds, and a small watcher that gives each back at once should ShellNote end without
//!   letting go (a crash, End task), as ShellNote's next start would.
//!
//! **The threads.** A command without `async` runs on ShellNote's main thread, as Tauri runs such commands. That
//! matters here: a hook belongs to the thread that sets it and its events come through that thread's message loop, so
//! `heard` runs on the main thread too, possibly in the middle of a command there (placing a window sends it messages).
//!
//! **The locks.** Where both are taken, `HELD` comes before `ORIGINAL`. `heard` only ever tries for `HELD`, and never
//! waits: the command it interrupts may hold it on the same thread. `save_record` takes both, so it is called with
//! neither held.
//!
//! **Not handled here:** a program dragged off by its title bar is told to the page and left where the person put
//! it; and owning a window takes its button off the taskbar, as Windows does: nothing here adds it back or hides it
//! more.

use std::ffi::c_void;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use windows::core::PWSTR;
use windows::Wdk::System::Threading::{NtQueryInformationProcess, ProcessCommandLineInformation};
use windows::Win32::Foundation::{CloseHandle, FILETIME, HANDLE, HWND, LPARAM, POINT, RECT, UNICODE_STRING, WPARAM};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS, DWMWA_WINDOW_CORNER_PREFERENCE};
use windows::Win32::Graphics::Gdi::{CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GdiFlush, GetDC, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS};
use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
use windows::Win32::System::Threading::{
    GetCurrentProcess, GetCurrentProcessId, GetProcessTimes, OpenProcess, OpenProcessToken, QueryFullProcessImageNameW, WaitForSingleObject, INFINITE, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
};
use windows::core::BSTR;
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
use windows::Win32::System::Variant::VARIANT;
use windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation, SetWinEventHook, TreeScope_Descendants, UnhookWinEvent, HWINEVENTHOOK, UIA_NamePropertyId};
use windows::Win32::UI::HiDpi::{SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
use windows::Win32::UI::WindowsAndMessaging::{
    DrawIconEx, EnumWindows, GetAncestor, GetClassLongPtrW, GetClassNameW, GetWindow, GetWindowLongPtrW, GetWindowPlacement, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, IsZoomed, SendMessageTimeoutW, SetForegroundWindow, SetWindowLongPtrW, SetWindowPlacement, SetWindowPos, ShowWindow,
    ShowWindowAsync, GWLP_HWNDPARENT, GWL_EXSTYLE, GW_OWNER, HWND_TOP, SET_WINDOW_POS_FLAGS, SHOW_WINDOW_CMD, GA_ROOT, SMTO_ABORTIFHUNG, SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_NOZORDER, SW_HIDE, SW_RESTORE,
    SW_SHOWMAXIMIZED, SW_SHOWMINIMIZED, SW_SHOWMINNOACTIVE, SW_SHOWNA, SW_SHOWNOACTIVATE, WINDOWPLACEMENT, WINDOWPLACEMENT_FLAGS, WM_NULL, WS_EX_TOOLWINDOW, DI_NORMAL, GCLP_HICON, GCLP_HICONSM, HICON,
    ICON_BIG, ICON_SMALL2, WM_GETICON,
};

/// Windows' events this side listens to, for a held program only: its closing, moves and title (EVENT_OBJECT_DESTROY
/// to EVENT_OBJECT_NAMECHANGE; the others in between are passed over).
const EVENT_OBJECT_DESTROY: u32 = 0x8001;
const EVENT_OBJECT_LOCATIONCHANGE: u32 = 0x800B;
const EVENT_OBJECT_NAMECHANGE: u32 = 0x800C;
/// The events come through ShellNote's own message loop, not loaded into the program, and never for ShellNote's own.
const WINEVENT_OUTOFCONTEXT: u32 = 0x0;
const WINEVENT_SKIPOWNPROCESS: u32 = 0x2;
/// The event is about the window itself, not a part of it.
const OBJID_WINDOW: i32 = 0;
const CHILDID_SELF: i32 = 0;
/// Corners as Windows draws them, and square ones; the border as Windows colours it.
const DWMWCP_DEFAULT: u32 = 0;
const DWMWCP_DONOTROUND: u32 = 1;
const DWMWA_COLOR_DEFAULT: u32 = 0xFFFF_FFFF;
/// How far a program may be from where it was placed before it counts as moved by the person (rounding at odd scales).
const SLACK: i32 = 2;

/// A window the person could put on a panel.
#[derive(serde::Serialize)]
pub struct AppWindow {
    /// The window's handle, as a number: what the other commands take.
    id: i64,
    title: String,
    /// The program's file, "POWERPNT.EXE".
    program: String,
    /// Why it cannot be put on a panel, or none: "administrator" (run as one: an ordinary app cannot move it, and
    /// ShellNote never asks to run as one), "unknown" (Windows would not say who runs it), "held" (already on one).
    left_out: Option<&'static str>,
}

/// A box of the page, in the screen's pixels from the page's top left: the panel element's box times the page's
/// `devicePixelRatio`. Not CSS pixels times the window's scale: the page's zoom (Ctrl and +) changes the first and not
/// the second.
#[derive(serde::Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct Area {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// What the page is told about a held program (the event "apps", by `kind`).
#[derive(Clone, serde::Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum Told {
    /// The person moved or sized it, or minimised it, not shellnote: where it is now, in the screen's pixels (pick
    /// xd decides what follows; for now nothing).
    Moved { id: i64, x: i32, y: i32, width: i32, height: i32, minimised: bool },
    /// Its title changed: often its place (the file, the page, the slide's deck), for each line's place.
    Title { id: i64, title: String },
    /// It closed: the panel is empty now.
    Closed { id: i64 },
}

/// One program held on a panel.
struct Held {
    target: isize,
    /// The label of ShellNote's window that holds it.
    host: String,
    area: Area,
    /// Where it was last placed (what is seen of it, in the screen's pixels), to tell ShellNote's own moves from the
    /// person's.
    placed: RECT,
    hook: isize,
    /// Hidden while something of the page covers its panel.
    covered: bool,
}

static HELD: Mutex<Vec<Held>> = Mutex::new(Vec::new());
static APP: OnceLock<AppHandle> = OnceLock::new();
/// Each program's own place, size and state (normal, maximised, minimised) from before it was put on a panel, given
/// back when it leaves the panel or ShellNote closes. Kept through a drag off and "Put back", so the first place is the
/// one given back.
static ORIGINAL: Mutex<Vec<(isize, WINDOWPLACEMENT)>> = Mutex::new(Vec::new());

/// A window's place, size and state, as Windows keeps them.
fn placement_of(window: HWND) -> Option<WINDOWPLACEMENT> {
    let mut placement = WINDOWPLACEMENT { length: std::mem::size_of::<WINDOWPLACEMENT>() as u32, ..Default::default() };
    unsafe { GetWindowPlacement(window, &mut placement) }.ok().map(|_| placement)
}

/// Its state given back without taking the person's focus: shown as it was, never brought in front unasked.
fn gentle(show: u32) -> u32 {
    let cmd = |c: SHOW_WINDOW_CMD| c.0 as u32;
    if show == cmd(SW_SHOWMINIMIZED) {
        cmd(SW_SHOWMINNOACTIVE)
    } else if show == cmd(SW_SHOWMAXIMIZED) {
        // Windows has no command for maximised without activating: this one state may take the focus.
        cmd(SW_SHOWMAXIMIZED)
    } else {
        cmd(SW_SHOWNOACTIVATE)
    }
}

/// Whether a window answers at once (in 150 ms). One that does not is never waited for: covering a program that had
/// stopped answering held ShellNote 3.7 s (25 October 2026).
fn answering(window: HWND) -> bool {
    unsafe { SendMessageTimeoutW(window, WM_NULL, WPARAM(0), LPARAM(0), SMTO_ABORTIFHUNG, 150, None) }.0 != 0
}

/// Where the record of the programs held is kept: beside this copy's own data (the check copies have their own), so a
/// ShellNote that ends without letting them go (a crash, End task) can give them back when it starts again.
fn record_path() -> Option<std::path::PathBuf> {
    let dir = match std::env::var_os("WEBVIEW2_USER_DATA_FOLDER") {
        Some(dir) => std::path::PathBuf::from(dir),
        None => APP.get()?.path().app_local_data_dir().ok()?,
    };
    let _ = std::fs::create_dir_all(&dir);
    Some(dir.join("programs-held.txt"))
}

/// The record written again: a line a program held, its window, its program, whether covered, where ShellNote put it,
/// and its own place from before. Removed when none is held. Never call it while holding `HELD`.
fn save_record() {
    let Some(path) = record_path() else { return };
    let lines: Vec<String> = {
        let (Ok(held), Ok(original)) = (HELD.lock(), ORIGINAL.lock()) else { return };
        held.iter()
            .filter_map(|h| {
                let p = original.iter().find(|(t, _)| *t == h.target)?.1;
                let pid = process_of(hwnd(h.target));
                let program = program_of(pid).map(|(file, _)| file).unwrap_or_default();
                let (n, placed) = (p.rcNormalPosition, h.placed);
                Some(format!(
                    "{} {} {} {} {} {} {} {} {} {} {} {} {} {} {} {} {} {}",
                    h.target, pid, h.covered as u8, placed.left, placed.top, placed.right, placed.bottom, p.showCmd, p.flags.0, n.left, n.top, n.right, n.bottom, p.ptMinPosition.x, p.ptMinPosition.y, p.ptMaxPosition.x, p.ptMaxPosition.y, program
                ))
            })
            .collect()
    };
    if lines.is_empty() {
        let _ = std::fs::remove_file(&path);
    } else {
        let _ = std::fs::write(&path, lines.join("\n") + "\n");
    }
}

/// At ShellNote's start: the programs a ShellNote that ended without letting them go left held, given back (should
/// its watcher not have done it already).
pub fn recover(app: &AppHandle) {
    let _ = APP.set(app.clone());
    // Never while ShellNote runs as administrator: the record is a file any program of the person's can write, and
    // an administrator's ShellNote would place the windows it names with rights an ordinary program has not.
    if switched_off().is_some() {
        return;
    }
    if let Some(path) = record_path() {
        give_back(&path);
    }
}

/// The programs a record still holds, after a ShellNote that ended without letting them go (a crash, End task), each
/// given back: its frame as before, and, if it is still hidden or still where ShellNote put it, its own place and
/// state from before the panel (25 October 2026: one hidden under a menu at that moment stayed hidden). A window is
/// taken for the same only with the same program file in the same process. The record is removed.
fn give_back(path: &Path) {
    let Ok(text) = std::fs::read_to_string(path) else { return };
    let _ = std::fs::remove_file(path);
    for line in text.lines() {
        // The program's file comes last and may hold spaces ("Code - Insiders.exe"): the 18th part keeps the rest.
        let parts: Vec<&str> = line.splitn(18, ' ').collect();
        let numbers: Vec<i64> = parts.iter().take(17).filter_map(|part| part.parse().ok()).collect();
        let [id, pid, covered, pl, pt, pr, pb, show, flags, nl, nt, nr, nb, minx, miny, maxx, maxy] = numbers[..] else { continue };
        let program = parts.get(17).copied().unwrap_or_default();
        let window = hwnd(id as isize);
        // The same window still: the same program file in the same process, and not one run as administrator (none
        // is ever held, so a record naming one was not written by ShellNote).
        let same = unsafe { IsWindow(Some(window)) }.as_bool() && process_of(window) == pid as u32 && program_of(pid as u32).is_some_and(|(file, elevated)| file == program && !elevated);
        if !same {
            continue;
        }
        unsafe { SetWindowLongPtrW(window, GWLP_HWNDPARENT, 0) };
        frame(window, None);
        let placed = RECT { left: pl as i32, top: pt as i32, right: pr as i32, bottom: pb as i32 };
        let now = seen(window);
        let untouched = (now.left - placed.left).abs().max((now.top - placed.top).abs()).max((now.right - placed.right).abs()).max((now.bottom - placed.bottom).abs()) <= SLACK;
        let hidden = covered != 0 || !unsafe { IsWindowVisible(window) }.as_bool();
        // Shown, and not where ShellNote put it: the person moved it since. Its owner and frame are back; it stays.
        if !hidden && !untouched {
            continue;
        }
        let placement = WINDOWPLACEMENT {
            length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
            flags: WINDOWPLACEMENT_FLAGS(flags as u32),
            showCmd: gentle(show as u32),
            ptMinPosition: POINT { x: minx as i32, y: miny as i32 },
            ptMaxPosition: POINT { x: maxx as i32, y: maxy as i32 },
            rcNormalPosition: RECT { left: nl as i32, top: nt as i32, right: nr as i32, bottom: nb as i32 },
        };
        // One that does not answer is only asked to show itself: setting its placement could wait on it.
        if answering(window) {
            let _ = unsafe { SetWindowPlacement(window, &placement) };
        } else {
            let _ = unsafe { ShowWindowAsync(window, SW_SHOWNA) };
        }
    }
}

/// How this program is started as the watcher: `--watch` waits for a ShellNote to end,
/// then gives back what its record still holds, at once, so one covered by a menu at that moment is not left hidden
/// until ShellNote starts again. It is started through a copy that ends at once (`--watch-start`): no child of
/// ShellNote', so ending ShellNote with all it started (`taskkill /T`, End task) leaves it.
const WATCH: &str = "--watch";
const WATCH_START: &str = "--watch-start";

/// Run as the watcher, when started as one (main.rs, before anything of the app): true then, and the program ends.
pub fn watcher(args: &[String]) -> bool {
    match args.get(1).map(String::as_str) {
        Some(WATCH_START) => {
            let _ = start_self(WATCH, &args[2..]);
            true
        }
        Some(WATCH) => {
            if let [pid, made, path] = &args[2..] {
                watch(pid.parse().unwrap_or(0), made.parse().unwrap_or(0), Path::new(path));
            }
            true
        }
        _ => false,
    }
}

/// This program started again with these words: no window, and out of any job ShellNote runs in, when allowed.
fn start_self(first: &str, rest: &[String]) -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
    let exe = std::env::current_exe()?;
    let start = |flags: u32| Command::new(&exe).arg(first).args(rest).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).creation_flags(flags).spawn();
    // A job may forbid leaving it, and then Windows refuses the start: tried again without.
    start(CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB).or_else(|_| start(CREATE_NO_WINDOW)).map(|_| ())
}

/// When a process was made, in Windows' ticks: with its number, it tells ShellNote from a later process given the
/// same number.
fn made_at(process: HANDLE) -> u64 {
    let (mut made, mut ended, mut kernel, mut user) = (FILETIME::default(), FILETIME::default(), FILETIME::default(), FILETIME::default());
    match unsafe { GetProcessTimes(process, &mut made, &mut ended, &mut kernel, &mut user) } {
        Ok(()) => ((made.dwHighDateTime as u64) << 32) | made.dwLowDateTime as u64,
        Err(_) => 0,
    }
}

/// The watcher started, once, as the first program is held.
fn start_watcher() {
    static STARTED: OnceLock<()> = OnceLock::new();
    STARTED.get_or_init(|| {
        let Some(path) = record_path() else { return };
        let made = made_at(unsafe { GetCurrentProcess() });
        let _ = start_self(WATCH_START, &[std::process::id().to_string(), made.to_string(), path.to_string_lossy().into_owned()]);
    });
}

/// The watcher's work: wait for ShellNote (the process `pid`, made at `made`) to end, then give back what its record
/// still holds. A ShellNote that let its programs go left no record, and nothing is done.
fn watch(pid: u32, made: u64, path: &Path) {
    // The screen's own pixels, as ShellNote has them (Tauri asks for them as it starts): without, at 125 % scaling
    // Windows took the record's places for its smaller ones and put each program 1.25 times further out (175 px off,
    // 25 October 2026).
    let _ = unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    // Not opened: no such process now, so there is nothing to wait for.
    if let Ok(process) = unsafe { OpenProcess(PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, false, pid) } {
        // A later process with ShellNote's number: ShellNote has ended already.
        if made_at(process) == made {
            let _ = unsafe { WaitForSingleObject(process, INFINITE) };
        }
        let _ = unsafe { CloseHandle(process) };
    }
    give_back(path);
}

/// Private browser windows are never listed, held nor pictured. Edge's InPrivate and Firefox's private windows say so
/// in their titles; Chrome's Incognito and
/// Brave's private windows only by a mark in their own toolbar, read once a window, through UI Automation, on a thread
/// of its own (Chromium's accessibility costs it some processor while on). No other program is read so: never VS Code.
#[derive(Clone, Copy, PartialEq)]
enum Private {
    Yes,
    No,
    /// Its toolbar being read: shown, not to be chosen yet.
    NotYetRead,
}

const PRIVATE: &str = "A private browser window is never put on a panel";

/// Each Chromium window's toolbar read: none while it is being read.
static TOOLBARS: Mutex<Vec<(isize, Option<bool>)>> = Mutex::new(Vec::new());

/// A private window's mark in Chrome's toolbar, in English and in Chrome's twenty-two most used other languages, as
/// Chromium's own translation files have it (the message "Incognito" of `generated_resources_*.xtb`, read 13
/// November 2026): Arabic, Bengali, German, Spanish, French, Hindi, Indonesian, Italian, Japanese, Korean, Dutch,
/// Polish, Portuguese of Brazil and of Portugal, Russian, Thai, Turkish, Ukrainian, Vietnamese, Chinese in both
/// scripts. A Chrome in a language not here shows another word, and its private window is not known for one.
const CHROME_PRIVATE: &[&str] = &[
    "Incognito", "التصفح المتخفي", "ছদ্মবেশী", "Inkognito", "Incógnito", "Navigation privée", "गुप्त", "Samaran", "シークレット モード", "시크릿 모드", "Modo anônimo", "Navegação anónima", "Инкогнито",
    "โหมดไม่ระบุตัวตน", "Gizli mod", "Анонімний перегляд", "Ẩn danh", "无痕模式", "無痕模式",
];

/// Brave's own word for it, in the same languages (the message "Private" of Brave's `generated_resources_*.xtb`).
/// Where Brave has no word of its own it shows Chrome's, so a Brave window is looked through for both.
const BRAVE_PRIVATE: &[&str] = &["Private", "خاص", "Privat", "Privado", "प्राइवेट", "Pribadi", "Privato", "プライベート", "Privé", "Prywatna", "Приватное", "ส่วนตัว", "Kişisel", "Приватно", "Riêng tư", "无痕"];

/// What Firefox adds to its name in the title of a private window, in the same languages (the message
/// `browser-main-private-window-title` of Firefox's translations, without the browser's name, which differs between
/// Firefox and the browsers made from it).
const FIREFOX_PRIVATE: &[&str] = &[
    "Private Browsing", "التصفح الخاص", "ব্যক্তিগত ব্রাউজিং", "Privater Modus", "Navegación privada", "Navigation privée de ", "Meramban Privat ", "Navigazione anonima", "プライベートブラウジング", "사생활 보호 모드",
    "-privénavigatie", "tryb prywatny", "navegação privativa", "Navegação privada do ", "Приватный просмотр ", "การเรียกดูแบบส่วนตัวใน ", "Gizli Gezinti", "Приватний перегляд ", "duyệt web riêng tư", "隐私浏览", "隱私瀏覽模式",
];

/// Firefox, and the browsers made from it, which word their titles as Firefox does.
fn is_firefox_like(program: &str) -> bool {
    matches!(program.to_ascii_lowercase().as_str(), "firefox.exe" | "librewolf.exe" | "waterfox.exe" | "floorp.exe" | "zen.exe" | "mullvadbrowser.exe")
}

/// Whether a window's title says it is private: Edge's "InPrivate", the same in every language; Firefox's "Private
/// Browsing", in English at the end of any window's title as before, and in Firefox's other languages in the
/// titles of Firefox and its kin.
fn private_by_title(program: &str, title: &str) -> bool {
    title.contains("InPrivate") || title.ends_with("Private Browsing") || (is_firefox_like(program) && FIREFOX_PRIVATE.iter().any(|words| title.contains(words)))
}

/// The marks a Chromium browser's toolbar shows in a private window, by its program; none for another program.
fn private_marks(program: &str) -> Option<Vec<&'static str>> {
    match program.to_ascii_lowercase().as_str() {
        "chrome.exe" | "chromium.exe" => Some(CHROME_PRIVATE.to_vec()),
        "brave.exe" => Some(BRAVE_PRIVATE.iter().chain(CHROME_PRIVATE).copied().collect()),
        _ => None,
    }
}

fn private(window: HWND, program: &str, title: &str) -> Private {
    if private_by_title(program, title) {
        return Private::Yes;
    }
    let Some(marks) = private_marks(program) else { return Private::No };
    let id = window.0 as isize;
    // The first ask of a window answers "not yet read" and starts the read: `apps_list` shows it as "checking" and
    // `apps_hold` refuses it, until a later ask finds the answer here.
    let Ok(mut read) = TOOLBARS.lock() else { return Private::NotYetRead };
    match read.iter().find(|(one, _)| *one == id) {
        Some((_, Some(true))) => Private::Yes,
        Some((_, Some(false))) => Private::No,
        Some((_, None)) => Private::NotYetRead,
        None => {
            read.push((id, None));
            std::thread::spawn(move || {
                // Not read (an error): taken as private, never shown.
                let private = toolbar_holds(id, &marks).unwrap_or(true);
                if let Ok(mut read) = TOOLBARS.lock() {
                    if let Some(one) = read.iter_mut().find(|(one, _)| *one == id) {
                        one.1 = Some(private);
                    }
                }
            });
            Private::NotYetRead
        }
    }
}

/// Whether the window's own toolbar holds a part named as one of `marks` ("Incognito", or the word for it in
/// another language), as its people see it. One look through the window for all the names at once.
fn toolbar_holds(id: isize, marks: &[&str]) -> windows::core::Result<bool> {
    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
        let automation: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)?;
        let element = automation.ElementFromHandle(hwnd(id))?;
        let name_is = |mark: &str| automation.CreatePropertyCondition(UIA_NamePropertyId, &VARIANT::from(BSTR::from(mark)));
        let mut named = name_is(marks.first().copied().unwrap_or_default())?;
        for mark in marks.iter().skip(1) {
            named = automation.CreateOrCondition(&named, &name_is(mark)?)?;
        }
        // Ok means found: the windows crate turns an answer of "nothing found" into an error. So a failure of this one
        // call reads as "not there" too, unlike a failure on the lines above, which `private` takes as private.
        Ok(element.FindFirst(TreeScope_Descendants, &named).is_ok())
    }
}

/// Whether the window `id` may be pictured (stage 3, picture.rs): one held on a panel (owned by ShellNote, so the list
/// leaves it out), or one the list offers; never another, and nothing while ShellNote runs as administrator.
pub(crate) fn may_picture(id: i64) -> Result<HWND, String> {
    if let Some(why) = switched_off() {
        return Err(why.into());
    }
    if HELD.lock().is_ok_and(|held| held.iter().any(|one| one.target == id as isize)) {
        return Ok(hwnd(id as isize));
    }
    match apps_list()?.iter().find(|window| window.id == id) {
        Some(window) if window.left_out.is_none() || window.left_out == Some("held") => Ok(hwnd(id as isize)),
        Some(_) => Err("That window cannot be pictured".into()),
        None => Err("That window is not one ShellNote offers".into()),
    }
}

/// How big a program's icon is sent to the page: 32 by 32, as the taskbar's at 125 %.
const ICON: i32 = 32;

/// A window's icon, as the taskbar shows it, for the panel's list: 32 by 32 pixels, RGBA, row by row; none (no bytes)
/// when the program has none.
#[tauri::command]
pub fn apps_icon(id: i64) -> Result<tauri::ipc::Response, String> {
    if let Some(why) = switched_off() {
        return Err(why.into());
    }
    let window = hwnd(id as isize);
    if !unsafe { IsWindow(Some(window)) }.as_bool() {
        return Err("That window has closed".into());
    }
    // Only of a window the list offers, or one held: the page names a window by a number, and any number could be sent.
    let held = HELD.lock().is_ok_and(|held| held.iter().any(|one| one.target == id as isize));
    if !held && !offered(window) {
        return Err(NOT_OFFERED.into());
    }
    Ok(tauri::ipc::Response::new(icon_of(window).map(|icon| pixels(icon, ICON)).unwrap_or_default()))
}

/// The window's own icon, or its kind's: never waiting on a program that does not answer (100 ms).
fn icon_of(window: HWND) -> Option<HICON> {
    for kind in [ICON_BIG, ICON_SMALL2] {
        let mut answer = 0usize;
        let asked = unsafe { SendMessageTimeoutW(window, WM_GETICON, WPARAM(kind as usize), LPARAM(0), SMTO_ABORTIFHUNG, 100, Some(&mut answer)) };
        if asked.0 != 0 && answer != 0 {
            return Some(HICON(answer as *mut c_void));
        }
    }
    [GCLP_HICON, GCLP_HICONSM].into_iter().map(|index| unsafe { GetClassLongPtrW(window, index) }).find(|&handle| handle != 0).map(|handle| HICON(handle as *mut c_void))
}

/// The icon drawn once on black and once on white: where the two differ, the icon lets the background through, so its
/// own transparency is read back, for an old icon with a mask as for a new one with an alpha channel.
fn pixels(icon: HICON, size: i32) -> Vec<u8> {
    // A colour c at alpha a (0 to 1) comes out as b = a * c on black and w = a * c + (1 - a) * 255 on white. So
    // w - b = (1 - a) * 255 gives the alpha, and c = b / a the colour.
    let (Some(black), Some(white)) = (drawn(icon, size, 0), drawn(icon, size, 255)) else { return Vec::new() };
    let mut rgba = Vec::with_capacity(black.len());
    for (b, w) in black.chunks_exact(4).zip(white.chunks_exact(4)) {
        // Blue, green, red: how much of the white comes through.
        let through = (0..3).map(|c| w[c] as i32 - b[c] as i32).max().unwrap_or(0).clamp(0, 255);
        let alpha = 255 - through;
        // On black the colour was laid at its alpha: back to its own.
        let colour = |c: usize| if alpha == 0 { 0 } else { ((b[c] as i32 * 255 + alpha / 2) / alpha).min(255) as u8 };
        rgba.extend_from_slice(&[colour(2), colour(1), colour(0), alpha as u8]);
    }
    rgba
}

/// The icon drawn at `size` on a ground of one shade, as Windows' blue, green, red and a fourth byte, row by row.
fn drawn(icon: HICON, size: i32, ground: u8) -> Option<Vec<u8>> {
    unsafe {
        let screen = GetDC(None);
        let dc = CreateCompatibleDC(Some(screen));
        // A negative height: rows from the top, as the page takes them.
        let info = BITMAPINFO { bmiHeader: BITMAPINFOHEADER { biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32, biWidth: size, biHeight: -size, biPlanes: 1, biBitCount: 32, biCompression: BI_RGB.0, ..Default::default() }, ..Default::default() };
        let mut bits: *mut c_void = std::ptr::null_mut();
        let out = CreateDIBSection(Some(dc), &info, DIB_RGB_COLORS, &mut bits, None, 0).ok().filter(|_| !bits.is_null()).and_then(|bitmap| {
            let memory = std::slice::from_raw_parts_mut(bits as *mut u8, (size * size * 4) as usize);
            memory.fill(ground);
            let before = SelectObject(dc, bitmap.into());
            let drew = DrawIconEx(dc, 0, 0, icon, size, size, 0, None, DI_NORMAL).is_ok();
            // Windows may hold drawing back in a batch: flushed before the bytes are read.
            let _ = GdiFlush();
            let copy = drew.then(|| memory.to_vec());
            // Out of the drawing surface first: a bitmap still selected into one cannot be deleted.
            SelectObject(dc, before);
            let _ = DeleteObject(bitmap.into());
            copy
        });
        let _ = DeleteDC(dc);
        ReleaseDC(None, screen);
        out
    }
}

/// A window brought in front, restored if minimised (the person's tap on a line's mark, ShellNote being in front).
pub(crate) fn bring_forward(id: isize) {
    let window = hwnd(id);
    unsafe {
        if IsIconic(window).as_bool() {
            let _ = ShowWindowAsync(window, SW_RESTORE);
        }
        let _ = SetForegroundWindow(window);
    }
}

/// A process's whole command line, as it was started; none when Windows will not say.
fn command_line_of(pid: u32) -> Option<String> {
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut size = 0u32;
        // Windows' lower-level call: the ordinary ones give no other process's command line. Asked twice: with no room,
        // for the size; then for the answer, a UNICODE_STRING (a length and a pointer) with the words after it.
        let _ = NtQueryInformationProcess(process, ProcessCommandLineInformation, std::ptr::null_mut(), 0, &mut size);
        // Eight bytes at a time: the answer starts with a pointer.
        let mut buffer = vec![0u64; (size as usize).div_ceil(8)];
        let status = NtQueryInformationProcess(process, ProcessCommandLineInformation, buffer.as_mut_ptr().cast(), size, &mut size);
        let _ = CloseHandle(process);
        if status.0 < 0 || buffer.is_empty() {
            return None;
        }
        // Its pointer points into `buffer`, alive until the words are copied below; its length is in bytes.
        let line = &*buffer.as_ptr().cast::<UNICODE_STRING>();
        Some(String::from_utf16_lossy(std::slice::from_raw_parts(line.Buffer.0, usize::from(line.Length) / 2)))
    }
}

/// A switch's value in a command line: `--name=value`, `--name value`, either quoted, or the whole quoted.
fn switch_of(line: &str, name: &str) -> Option<String> {
    let at = line.find(name)?;
    // Only the first mention is read, and only as a whole switch: "x--user-data-dir" is no switch.
    if !line[..at].ends_with([' ', '"']) {
        return None;
    }
    let whole_quoted = line[..at].ends_with('"');
    let rest = line[at + name.len()..].strip_prefix(['=', ' '])?;
    let value = if let Some(quoted) = rest.strip_prefix('"') {
        quoted.split('"').next()
    } else if whole_quoted {
        rest.split('"').next()
    } else {
        rest.split(' ').next()
    };
    // "--user-data-dir --new-window": the next word is another switch, so this one has no value.
    value.filter(|value| !value.is_empty() && !value.starts_with('-')).map(str::to_string)
}

/// A window's own program started again with these words, on the same profile as the window (a browser's or VS Code's
/// `--user-data-dir`, which would otherwise send them to the person's other copy). Never through a shell. True when
/// it started. Windows gives the program's file from the window's own process, never from a note.
pub(crate) fn start_like(id: isize, words: &[String]) -> bool {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let pid = process_of(hwnd(id));
    let Some(path) = path_of(pid) else { return false };
    let line = command_line_of(pid).unwrap_or_default();
    let mut command = std::process::Command::new(path);
    for name in ["--user-data-dir", "--extensions-dir"] {
        if let Some(value) = switch_of(&line, name) {
            command.arg(format!("{name}={value}"));
        }
    }
    command.args(words).creation_flags(CREATE_NO_WINDOW).spawn().is_ok()
}

/// A window's program file ("POWERPNT.EXE") and title, for its place (place.rs).
pub(crate) fn program_and_title(window: HWND) -> (String, String) {
    (program_of(process_of(window)).map(|(file, _)| file).unwrap_or_default(), title_of(window))
}

fn hwnd(id: isize) -> HWND {
    HWND(id as *mut c_void)
}

fn text(buffer: &[u16], length: i32) -> String {
    String::from_utf16_lossy(&buffer[..length.max(0) as usize])
}

fn title_of(window: HWND) -> String {
    let mut buffer = [0u16; 512];
    let length = unsafe { GetWindowTextW(window, &mut buffer) };
    text(&buffer, length)
}

fn class_of(window: HWND) -> String {
    let mut buffer = [0u16; 256];
    let length = unsafe { GetClassNameW(window, &mut buffer) };
    text(&buffer, length)
}

fn process_of(window: HWND) -> u32 {
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(window, Some(&mut pid)) };
    pid
}

/// The whole path of a process's program file; none when Windows will not say.
fn path_of(pid: u32) -> Option<String> {
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = [0u16; 1024];
        let mut length = buffer.len() as u32;
        let named = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buffer.as_mut_ptr()), &mut length).is_ok();
        let _ = CloseHandle(process);
        named.then(|| text(&buffer, length as i32))
    }
}

/// The program's file and whether it runs as administrator; none when Windows will not say (a protected process).
fn program_of(pid: u32) -> Option<(String, bool)> {
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = [0u16; 1024];
        let mut length = buffer.len() as u32;
        let named = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buffer.as_mut_ptr()), &mut length).is_ok();
        let path = if named { text(&buffer, length as i32) } else { String::new() };
        let mut token = HANDLE::default();
        let mut elevated = None;
        if OpenProcessToken(process, TOKEN_QUERY, &mut token).is_ok() {
            let mut elevation = TOKEN_ELEVATION::default();
            let mut size = 0u32;
            let size_of = std::mem::size_of::<TOKEN_ELEVATION>() as u32;
            if GetTokenInformation(token, TokenElevation, Some(&mut elevation as *mut _ as *mut c_void), size_of, &mut size).is_ok() {
                elevated = Some(elevation.TokenIsElevated != 0);
            }
            let _ = CloseHandle(token);
        }
        let _ = CloseHandle(process);
        let file = path.rsplit('\\').next().unwrap_or_default().to_string();
        // A token that cannot be read gives none, like a name that cannot: never taken for "not administrator".
        Some((file, elevated?))
    }
}

/// What the page is told when ShellNote itself runs as administrator.
const AS_ADMINISTRATOR: &str = "shellnote was started as administrator, so it puts no other program on a panel. Start ShellNote the usual way to use the panel.";

/// Why no program may be put on a panel now, or none: ShellNote itself runs as administrator (the research's rule,
/// 3.9: a ShellNote run as administrator could move any window, the person's elevated ones too, so the panel is off
/// then, and says why; found missing 25 October 2026). Read once. `SHELLNOTE_APPS_AS_ADMIN=1` makes it so for the
/// check (`desktop:apps`), which never runs ShellNote as administrator: it can only switch the panel off, never on.
fn switched_off() -> Option<&'static str> {
    static OFF: OnceLock<bool> = OnceLock::new();
    let off = *OFF.get_or_init(|| crate::check_switch("SHELLNOTE_APPS_AS_ADMIN").is_some_and(|value| value == "1") || program_of(unsafe { GetCurrentProcessId() }).is_some_and(|(_, elevated)| elevated));
    off.then_some(AS_ADMINISTRATOR)
}

/// What the person sees of a window: its frame without the invisible borders Windows adds round it.
fn seen(window: HWND) -> RECT {
    let mut rect = RECT::default();
    let size = std::mem::size_of::<RECT>() as u32;
    if unsafe { DwmGetWindowAttribute(window, DWMWA_EXTENDED_FRAME_BOUNDS, &mut rect as *mut RECT as *mut c_void, size) }.is_err() {
        let _ = unsafe { GetWindowRect(window, &mut rect) };
    }
    rect
}

/// Windows calls some windows visible while its compositor hides them, those on another virtual desktop among them.
fn cloaked(window: HWND) -> bool {
    let mut value = 0u32;
    let size = std::mem::size_of::<u32>() as u32;
    unsafe { DwmGetWindowAttribute(window, DWMWA_CLOAKED, &mut value as *mut u32 as *mut c_void, size) }.is_ok() && value != 0
}

/// A window a person would call a program's: shown, its own (not a tool palette, not owned by another), on this
/// desktop, with a title; never the desktop or the taskbar.
fn listable(window: HWND) -> bool {
    unsafe {
        if !IsWindowVisible(window).as_bool() || GetWindow(window, GW_OWNER).is_ok_and(|owner| !owner.is_invalid()) {
            return false;
        }
        if GetWindowLongPtrW(window, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW.0 != 0 || cloaked(window) {
            return false;
        }
    }
    !title_of(window).trim().is_empty() && !matches!(class_of(window).as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd")
}

const NOT_OFFERED: &str = "That window is not one ShellNote offers";

/// Whether a window is one the list offers: a program's own top window, as `listable` says, never a part of a
/// window (a button, a pane), which Windows would also take for "a window". The page names a window by a number, and
/// a page gone wrong could send any: only what a person could have chosen from the list is ever held.
fn offered(window: HWND) -> bool {
    let top = unsafe { GetAncestor(window, GA_ROOT) } == window;
    top && listable(window)
}

/// The windows a person could put on a panel, in the order Windows keeps them (the one in front first). Windows of
/// ShellNote itself are not listed; those it cannot hold are, with the reason. None at all, with the reason, while
/// ShellNote runs as administrator.
#[tauri::command]
pub fn apps_list() -> Result<Vec<AppWindow>, String> {
    if let Some(why) = switched_off() {
        return Err(why.into());
    }
    unsafe extern "system" fn each(window: HWND, found: LPARAM) -> windows::core::BOOL {
        let found = unsafe { &mut *(found.0 as *mut Vec<isize>) };
        found.push(window.0 as isize);
        true.into()
    }
    let mut found: Vec<isize> = Vec::new();
    // `each` gets `found` through the number Windows passes along; `EnumWindows` returns only when done.
    let _ = unsafe { EnumWindows(Some(each), LPARAM(&mut found as *mut Vec<isize> as isize)) };
    let own = unsafe { GetCurrentProcessId() };
    let held: Vec<isize> = HELD.lock().map(|held| held.iter().map(|h| h.target).collect()).unwrap_or_default();
    // A closed window's toolbar forgotten: its number may come back for another window.
    if let Ok(mut read) = TOOLBARS.lock() {
        read.retain(|(one, _)| found.contains(one));
    }
    Ok(found
        .into_iter()
        .filter(|&id| listable(hwnd(id)))
        .filter_map(|id| {
            let window = hwnd(id);
            let pid = process_of(window);
            if pid == own {
                return None;
            }
            let (program, left_out) = match program_of(pid) {
                Some((program, true)) => (program, Some("administrator")),
                Some((program, false)) => (program, None),
                None => (String::new(), Some("unknown")),
            };
            let left_out = if held.contains(&id) { Some("held") } else { left_out };
            let title = title_of(window);
            let left_out = match private(window, &program, &title) {
                Private::Yes => return None,
                Private::NotYetRead => Some("checking"),
                Private::No => left_out,
            };
            Some(AppWindow { id: id as i64, title, program, left_out })
        })
        .collect())
}

/// Where the box is on the screen: from the top left of what the page fills (Tauri's inner position).
fn on_screen(host: &WebviewWindow, area: Area) -> Option<RECT> {
    let origin = host.inner_position().ok()?;
    let left = origin.x + area.x.round() as i32;
    let top = origin.y + area.y.round() as i32;
    Some(RECT { left, top, right: left + area.width.round() as i32, bottom: top + area.height.round() as i32 })
}

/// The window's outer box that makes what is seen of it fill `want` exactly: its invisible borders added back.
fn outer_for(outer: RECT, seen: RECT, want: RECT) -> RECT {
    RECT {
        left: want.left - (seen.left - outer.left),
        top: want.top - (seen.top - outer.top),
        right: want.right + (outer.right - seen.right),
        bottom: want.bottom + (outer.bottom - seen.bottom),
    }
}

/// Place a held window on its box; true when Windows let it.
fn place(held: &mut Held, host: &WebviewWindow) -> bool {
    place_with(held, host, SET_WINDOW_POS_FLAGS(0))
}

/// Placed, with more of Windows' flags: `SWP_ASYNCWINDOWPOS` posts the move to the program instead of waiting for it.
fn place_with(held: &mut Held, host: &WebviewWindow, extra: SET_WINDOW_POS_FLAGS) -> bool {
    let Some(want) = on_screen(host, held.area) else { return false };
    let window = hwnd(held.target);
    let mut outer = RECT::default();
    if unsafe { GetWindowRect(window, &mut outer) }.is_err() {
        return false;
    }
    let to = outer_for(outer, seen(window), want);
    // Noted before the move: Windows tells the hook of it, and `heard` must not take this move for the person's.
    held.placed = want;
    unsafe { SetWindowPos(window, None, to.left, to.top, to.right - to.left, to.bottom - to.top, SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER | extra) }.is_ok()
}

fn host_hwnd(host: &WebviewWindow) -> Result<isize, String> {
    host.hwnd().map(|h| h.0 as isize).map_err(|error| error.to_string())
}

/// ShellNote's frame round the program: square corners and the panel's border colour (0xRRGGBB), or as Windows
/// draws them (none).
fn frame(window: HWND, border: Option<u32>) {
    let corners = if border.is_some() { DWMWCP_DONOTROUND } else { DWMWCP_DEFAULT };
    // Windows takes the colour as 0x00BBGGRR.
    let colour = border.map(|rgb| ((rgb & 0xFF) << 16) | (rgb & 0xFF00) | ((rgb >> 16) & 0xFF)).unwrap_or(DWMWA_COLOR_DEFAULT);
    let size = std::mem::size_of::<u32>() as u32;
    unsafe {
        let _ = DwmSetWindowAttribute(window, DWMWA_WINDOW_CORNER_PREFERENCE, &corners as *const u32 as *const c_void, size);
        let _ = DwmSetWindowAttribute(window, DWMWA_BORDER_COLOR, &colour as *const u32 as *const c_void, size);
    }
}

fn tell(told: Told) {
    if let Some(app) = APP.get() {
        let _ = app.emit("apps", told);
    }
}

/// Windows' events for a held program: its closing, the person's moves, its title.
unsafe extern "system" fn heard(_hook: HWINEVENTHOOK, event: u32, window: HWND, object: i32, child: i32, _thread: u32, _time: u32) {
    if object != OBJID_WINDOW || child != CHILDID_SELF {
        return;
    }
    let id = window.0 as isize;
    let told = {
        // Never waited for: Windows may deliver an event while a command on this same thread holds the list (placing
        // a window sends it messages); an event missed so is ShellNote's own doing, or found by the next command.
        let Ok(mut held) = HELD.try_lock() else { return };
        let Some(index) = held.iter().position(|h| h.target == id) else { return };
        match event {
            EVENT_OBJECT_DESTROY => {
                let gone = held.remove(index);
                let _ = unsafe { UnhookWinEvent(HWINEVENTHOOK(gone.hook as *mut c_void)) };
                Some(Told::Closed { id: id as i64 })
            }
            EVENT_OBJECT_NAMECHANGE => Some(Told::Title { id: id as i64, title: title_of(window) }),
            EVENT_OBJECT_LOCATIONCHANGE => {
                let now = seen(window);
                let was = held[index].placed;
                let minimised = unsafe { IsIconic(window) }.as_bool();
                let off = (now.left - was.left).abs().max((now.top - was.top).abs()).max((now.right - was.right).abs()).max((now.bottom - was.bottom).abs());
                (minimised || off > SLACK).then_some(Told::Moved { id: id as i64, x: now.left, y: now.top, width: now.right - now.left, height: now.bottom - now.top, minimised })
            }
            _ => None,
        }
    };
    if let Some(told) = told {
        // Here, with the list's lock let go: `save_record` takes it.
        if let Told::Closed { id } = told {
            if let Ok(mut original) = ORIGINAL.lock() {
                original.retain(|(t, _)| *t != id as isize);
            }
            save_record();
        }
        tell(told);
    }
}

/// Hold a program's window on a box of this window's page (`Area`): made this window's own, restored if it was minimised or
/// maximised, framed as ShellNote's panel (`border`, 0xRRGGBB; none leaves Windows' frame), and placed. Refused for a
/// window run as administrator, one of ShellNote's own, or one already held.
#[tauri::command]
pub fn apps_hold(window: WebviewWindow, id: i64, area: Area, border: Option<u32>, again: Option<bool>) -> Result<(), String> {
    // Not `async`: this must stay on the main thread, whose message loop the hook set below needs.
    // Refused while ShellNote runs as administrator, even when the page asks without the list.
    if let Some(why) = switched_off() {
        return Err(why.into());
    }
    let _ = APP.set(window.app_handle().clone());
    let target = hwnd(id as isize);
    if !unsafe { IsWindow(Some(target)) }.as_bool() {
        return Err("that window is gone".into());
    }
    let pid = process_of(target);
    if pid == unsafe { GetCurrentProcessId() } {
        return Err("a window of ShellNote itself".into());
    }
    // Only a window the list offers: never the taskbar or the desktop, a tool window, a hidden one, or a part of
    // another program's window, whatever number the page sends.
    if !offered(target) {
        return Err(NOT_OFFERED.into());
    }
    match program_of(pid) {
        Some((program, false)) => {
            if private(target, &program, &title_of(target)) != Private::No {
                return Err(PRIVATE.into());
            }
        }
        Some((_, true)) => return Err("run as administrator: ShellNote cannot move it".into()),
        None => return Err("Windows will not say who runs it".into()),
    }
    let mut held = HELD.lock().map_err(|_| "busy")?;
    if held.iter().any(|h| h.target == id as isize) {
        return Err("already on a panel".into());
    }
    let host = host_hwnd(&window)?;
    // Its own place, size and state kept first, to be given back; put back after a drag off (`again`), the
    // first one kept.
    if let (Some(before), Ok(mut original)) = (placement_of(target), ORIGINAL.lock()) {
        let known = original.iter().position(|(t, _)| *t == id as isize);
        match (known, again.unwrap_or(false)) {
            (Some(_), true) => {}
            (Some(at), false) => original[at].1 = before,
            (None, _) => original.push((id as isize, before)),
        }
    }
    unsafe {
        if IsIconic(target).as_bool() || IsZoomed(target).as_bool() {
            let _ = ShowWindow(target, SW_RESTORE);
        }
        // Despite its name, on a top-level window this sets the owner window, not a parent: it stays its own program's window.
        SetWindowLongPtrW(target, GWLP_HWNDPARENT, host);
    }
    frame(target, border);
    let thread = unsafe { GetWindowThreadProcessId(target, None) };
    // Filtered to this program's process and the window's thread; `heard` then finds the one window among what comes.
    let hook = unsafe { SetWinEventHook(EVENT_OBJECT_DESTROY, EVENT_OBJECT_NAMECHANGE, None, Some(heard), pid, thread, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS) };
    let mut one = Held { target: id as isize, host: window.label().to_string(), area, placed: RECT::default(), hook: hook.0 as isize, covered: false };
    let placed = place(&mut one, &window);
    // Raised now: an owner set later does not bring its window above it until the owner comes in front again, and the
    // person chose it from ShellNote, already in front (found 25 October 2026: behind ShellNote one time in six).
    raise(one.target);
    held.push(one);
    drop(held);
    save_record();
    start_watcher();
    if placed { Ok(()) } else { Err("Windows would not move it".into()) }
}

/// The panel's box changed on the page (dragged, resized, the workspace laid out again): the program placed on it.
#[tauri::command]
pub fn apps_place(window: WebviewWindow, id: i64, area: Area) -> Result<(), String> {
    let mut held = HELD.lock().map_err(|_| "busy")?;
    let one = held.iter_mut().find(|h| h.target == id as isize && h.host == window.label()).ok_or("not on a panel of this window")?;
    one.area = area;
    if place(one, &window) { Ok(()) } else { Err("Windows would not move it".into()) }
}

/// Something of ShellNote opened over the panel (a menu, a dialog, the side panel; stage 2's airspace swap): the
/// program hidden, its owner kept, so the page's own is seen; uncovered, shown without taking the focus, placed on its
/// box and raised. A hidden window's place does not change, so the hook tells no move for it.
#[tauri::command]
pub fn apps_cover(window: WebviewWindow, id: i64, covered: bool) -> Result<(), String> {
    // The record keeps `covered`: a ShellNote that ends while this program is hidden must have it shown (`give_back`).
    let result: Result<(), String> = {
        let mut held = HELD.lock().map_err(|_| "busy")?;
        let one = held.iter_mut().find(|h| h.target == id as isize && h.host == window.label()).ok_or("not on a panel of this window")?;
        let target = hwnd(one.target);
        one.covered = covered;
        // Posted to the program, never waited for: one that has stopped answering must not stop ShellNote as a menu
        // opens (25 October 2026: ShowWindow held it 3.7 s). Done in order when the program answers.
        if covered {
            let _ = unsafe { ShowWindowAsync(target, SW_HIDE) };
            Ok(())
        } else {
            let _ = unsafe { ShowWindowAsync(target, SW_SHOWNA) };
            if !answering(target) {
                // Not answering: shown when it answers, where it was hidden, on its box; placed again by the next move
                // of ShellNote or of the panel. Placing or raising it now waited for it all the same (3.7 s, 25 October
                // 2026: an owned window shares ShellNote's input, so Windows' "do not wait" flag does not apply).
                Ok(())
            } else {
                let placed = place_with(one, &window, SWP_ASYNCWINDOWPOS);
                raise_with(one.target, SWP_ASYNCWINDOWPOS);
                if placed { Ok(()) } else { Err("Windows would not move it".into()) }
            }
        }
    };
    save_record();
    result
}

/// Let a program go: hidden, its owner removed, its frame as before, shown again where it is without taking the
/// focus (the spike's order: its taskbar button comes back).
fn let_go(one: Held, restore: bool) {
    let window = hwnd(one.target);
    // Its own place from before the panel, given back, unless the person dragged it off: then it stays
    // where they dropped it, its first place kept for "Put back".
    let before = if restore { ORIGINAL.lock().ok().and_then(|mut original| original.iter().position(|(t, _)| *t == one.target).map(|at| original.remove(at).1)) } else { None };
    unsafe {
        let _ = UnhookWinEvent(HWINEVENTHOOK(one.hook as *mut c_void));
        if !IsWindow(Some(window)).as_bool() {
            return;
        }
        if !answering(window) {
            // Not answering: nothing waited on. Let go where it is, shown when it answers again (posted, in order,
            // after its owner is removed, so its taskbar button comes back).
            SetWindowLongPtrW(window, GWLP_HWNDPARENT, 0);
            frame(window, None);
            let _ = ShowWindowAsync(window, SW_HIDE);
            let _ = ShowWindowAsync(window, SW_SHOWNA);
            return;
        }
        let _ = ShowWindow(window, SW_HIDE);
        SetWindowLongPtrW(window, GWLP_HWNDPARENT, 0);
        frame(window, None);
        match before {
            Some(mut placement) => {
                placement.showCmd = gentle(placement.showCmd);
                let _ = SetWindowPlacement(window, &placement);
            }
            None => {
                let _ = ShowWindow(window, SW_SHOWNA);
            }
        }
    }
}

/// Let a program go, at the page's asking. `restore` false (a drag off): it stays where the person dropped it and its
/// first place is kept for "Put back"; otherwise (the default) its own place from before the panel is given back.
#[tauri::command]
pub fn apps_let_go(id: i64, restore: Option<bool>) -> Result<(), String> {
    let one = {
        let mut held = HELD.lock().map_err(|_| "busy")?;
        let index = held.iter().position(|h| h.target == id as isize).ok_or("not on a panel")?;
        held.remove(index)
    };
    let_go(one, restore.unwrap_or(true));
    save_record();
    Ok(())
}

/// ShellNote's window moved, resized or changed screens: its programs placed again, from here, with no trip through
/// the page.
pub fn host_moved(host: &WebviewWindow) {
    let Ok(mut held) = HELD.lock() else { return };
    for one in held.iter_mut().filter(|h| h.host == host.label()) {
        place(one, host);
    }
}

/// ShellNote's window came in front: its programs raised above it, not activated (PowerPoint alone dropped behind its
/// owner in the spike; raised, it was back in 5 ms with ShellNote still in front).
pub fn host_in_front(host: &WebviewWindow) {
    let Ok(held) = HELD.lock() else { return };
    for one in held.iter().filter(|h| h.host == host.label()) {
        raise(one.target);
    }
}

/// A held window raised to the top, not activated, not moved.
fn raise(target: isize) {
    raise_with(target, SET_WINDOW_POS_FLAGS(0));
}

fn raise_with(target: isize, extra: SET_WINDOW_POS_FLAGS) {
    let _ = unsafe { SetWindowPos(hwnd(target), Some(HWND_TOP), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | extra) };
}

/// ShellNote's window is closing: its programs let go first, so they stay open and shown (an owned window is hidden
/// with its owner, and must never go with it).
pub fn host_closing(label: &str) {
    let gone: Vec<Held> = {
        let Ok(mut held) = HELD.lock() else { return };
        let (gone, kept) = held.drain(..).partition(|h| h.host == label);
        *held = kept;
        gone
    };
    // With the list's lock let go: `let_go` talks to other programs, and `save_record` takes the lock.
    for one in gone {
        let_go(one, true);
    }
    save_record();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_invisible_borders_are_added_back() {
        // At 125 %, Windows keeps 9 px on the left, right and bottom, none on top (the spike's windows).
        let outer = RECT { left: 100, top: 50, right: 920, bottom: 959 };
        let seen = RECT { left: 109, top: 50, right: 911, bottom: 950 };
        let want = RECT { left: 711, top: 118, right: 1531, bottom: 981 };
        let to = outer_for(outer, seen, want);
        assert_eq!((to.left, to.top, to.right, to.bottom), (702, 118, 1540, 990));
    }

    #[test]
    fn a_switch_read_from_a_command_line() {
        let dir = "--user-data-dir";
        assert_eq!(switch_of(r#"chrome.exe --user-data-dir=C:\a --new-window"#, dir).as_deref(), Some(r"C:\a"));
        assert_eq!(switch_of(r#"chrome.exe --user-data-dir="C:\a b" --new-window"#, dir).as_deref(), Some(r"C:\a b"));
        assert_eq!(switch_of(r#"chrome.exe "--user-data-dir=C:\a b" x"#, dir).as_deref(), Some(r"C:\a b"));
        assert_eq!(switch_of(r#"Code.exe --user-data-dir "C:\a b" x"#, dir).as_deref(), Some(r"C:\a b"));
        assert_eq!(switch_of("Code.exe --user-data-dir C:\\a", dir).as_deref(), Some(r"C:\a"));
        assert_eq!(switch_of("chrome.exe --new-window", dir), None);
        assert_eq!(switch_of("chrome.exe --user-data-dir --new-window", dir), None);
        assert_eq!(switch_of("chrome.exe x--user-data-dir=C:\\a", dir), None);
    }

    #[test]
    fn the_command_line_of_this_process() {
        let line = command_line_of(unsafe { GetCurrentProcessId() }).expect("Windows says");
        assert!(line.to_lowercase().contains("shellnote"), "{line}");
    }

    #[test]
    fn a_private_window_is_known_by_its_title_in_the_browsers_own_languages() {
        // Edge says InPrivate in every language; Firefox's English words end any window's title.
        assert!(private_by_title("msedge.exe", "New tab - [InPrivate] - Microsoft\u{200b} Edge"));
        assert!(private_by_title("firefox.exe", "Example Domain — Mozilla Firefox Private Browsing"));
        // Firefox in other languages, the browser's name before its words or after them, and a browser made from it.
        for title in [
            "Beispiel — Mozilla Firefox Privater Modus",
            "Exemple — Navigation privée de Mozilla Firefox",
            "Ejemplo — Mozilla Firefox Navegación privada",
            "Пример — Приватный просмотр Mozilla Firefox",
            "例 — Mozilla Firefox プライベートブラウジング",
            "示例 — Mozilla Firefox 隐私浏览",
            "Voorbeeld — Mozilla Firefox-privénavigatie",
            "Przykład — Mozilla Firefox — tryb prywatny",
        ] {
            assert!(private_by_title("firefox.exe", title), "{title}");
            assert!(private_by_title("LibreWolf.exe", &title.replace("Mozilla Firefox", "LibreWolf")), "{title}");
        }
        // An ordinary window is not taken for private, in Firefox or elsewhere; and a page that only speaks of
        // private browsing, in another program, is that program's ordinary window.
        assert!(!private_by_title("firefox.exe", "Example Domain — Mozilla Firefox"));
        assert!(!private_by_title("chrome.exe", "Navigation privée de Mozilla Firefox - Google Chrome"));
        assert!(!private_by_title("notepad.exe", "notes.txt - Notepad"));
    }

    #[test]
    fn a_chromium_browsers_private_mark_in_its_own_languages() {
        let chrome = private_marks("chrome.exe").unwrap();
        for word in ["Incognito", "Inkognito", "Navigation privée", "Инкогнито", "シークレット モード", "无痕模式", "गुप्त", "التصفح المتخفي"] {
            assert!(chrome.contains(&word), "{word}");
        }
        // Brave's own word, and Chrome's where Brave has none of its own.
        let brave = private_marks("Brave.exe").unwrap();
        for word in ["Private", "Privat", "Privé", "プライベート", "Navigation privée", "시크릿 모드"] {
            assert!(brave.contains(&word), "{word}");
        }
        assert_eq!(private_marks("Chromium.exe").unwrap(), chrome);
        assert!(private_marks("msedge.exe").is_none() && private_marks("notepad.exe").is_none());
        // No word is empty or short enough to name something else by chance, and none is there twice.
        for list in [CHROME_PRIVATE, BRAVE_PRIVATE, FIREFOX_PRIVATE] {
            for (at, word) in list.iter().enumerate() {
                assert!(word.trim().chars().count() >= 2, "{word:?}");
                assert!(!list[..at].contains(word), "{word:?} twice");
            }
        }
    }

    #[test]
    fn the_watcher_only_when_started_as_one() {
        let words = |list: &[&str]| list.iter().map(|word| word.to_string()).collect::<Vec<_>>();
        // ShellNote itself, started as usual or with words of another's: not the watcher.
        assert!(!watcher(&words(&["shellnote.exe"])));
        assert!(!watcher(&words(&["shellnote.exe", "--other"])));
        // The watcher with its words missing: done at once, nothing waited for.
        assert!(watcher(&words(&["shellnote.exe", WATCH])));
    }

    #[test]
    fn the_watcher_of_a_shellnote_already_gone_ends_at_once() {
        assert!(made_at(unsafe { GetCurrentProcess() }) > 0);
        // No such process, no record: it returns, waiting for nothing, giving back nothing.
        watch(u32::MAX, 0, Path::new("no-such-folder/programs-held.txt"));
    }
}
