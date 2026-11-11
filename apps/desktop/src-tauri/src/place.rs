//! Stage 4 of other programs inside shellnote: a program's place, read the moment a line is written beside it.
//! Family by family, each the same way for everyone, whatever the person's language (by the kind of each part,
//! never its name): - a browser (Chrome, Edge, Brave): its page's address, from the page itself or else its address
//! bar, through UI
//!   Automation, read only when asked, never constantly (Chromium's accessibility costs it some processor while on);
//!   a PDF in its own viewer: the page in the viewer's page box too;
//! - VS Code: its file's whole path and line from the companion extension the person installs, read from the
//!   small file it keeps on this computer; without it, the file's name from its window's title. Never its UI Automation,
//!   which can switch it into screen-reader mode;
//! - PowerPoint: its slide, through its own automation (the slide's id, which stays as slides move, its number, its deck);
//! - any other program: no place; its title and picture stand in.
//! A program that does not answer within `WAIT` gives none: the line is kept all the same.
//!
//! The words of a place, read once a place as a line is written (`apps_words_of`): PowerPoint's slide and its notes through
//! its own automation, a page's words through UI Automation; never VS Code's, and a PDF's page is not its whole file. For
//! the rest, what the picture shows, read by Windows' own text reading, on this computer (`apps_read_picture`).
//!
//! And back to a place (`apps_go_to`), the person's own tap on a line's mark, never a command's: no command, agent or
//! terminal controls another program. Local programs only, through their own ways,
//! to the program's own place, never a recorded state and never an online service (the research's patent rules, 3.11).
//! What comes from a note is never trusted as a command: a note can be someone else's file, so only a web page's or a
//! file's address is passed on, and only a file that is there, as one argument, never a switch.

use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use windows::core::{w, Interface, BSTR, GUID, PCWSTR};
use windows::Win32::Foundation::{E_FAIL, HWND};
use windows::Win32::System::Com::{CLSIDFromProgID, CoCreateInstance, CoInitializeEx, CoUninitialize, IDispatch, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, DISPATCH_FLAGS, DISPATCH_METHOD, DISPATCH_PROPERTYGET, DISPPARAMS};
use windows::Win32::System::Ole::GetActiveObject;
use windows::Win32::System::Variant::VARIANT;
use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::DataWriter;
use windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationTextPattern, IUIAutomationValuePattern, TreeScope_Descendants, UIA_ControlTypePropertyId, UIA_DocumentControlTypeId, UIA_EditControlTypeId, UIA_IsOffscreenPropertyId, UIA_IsPasswordPropertyId, UIA_CONTROLTYPE_ID, UIA_TextPatternId, UIA_ValuePatternId};

/// A place, as the note keeps it (core's `Place`, file format version 4).
/// Untagged: serde takes the first variant whose fields are there and passes over any others, so the order counts:
/// `Page` stays before `File`, which `{"page":4,"file":"x"}` would fit too.
#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(untagged)]
pub enum Place {
    Slide { slide: u32, n: u32, #[serde(skip_serializing_if = "Option::is_none")] deck: Option<String> },
    Page { page: u32, #[serde(skip_serializing_if = "Option::is_none")] file: Option<String> },
    Address { address: String },
    File { file: String, #[serde(skip_serializing_if = "Option::is_none")] line: Option<u32> },
}

/// How long a program's place is waited for.
const WAIT: Duration = Duration::from_millis(1500);

/// The place of window `id` now, by its program; none when its program has none to give, or does not answer.
/// Async, on a blocking thread of Tauri's: a read may wait up to `WAIT`, and ShellNote's main thread must not.
#[tauri::command]
pub async fn apps_place_of(id: i64) -> Result<Option<Place>, String> {
    let window = crate::apps::may_picture(id)?;
    let (program, title) = crate::apps::program_and_title(window);
    let id = window.0 as isize;
    let read = move || match program.to_ascii_lowercase().as_str() {
        "chrome.exe" | "msedge.exe" | "brave.exe" => within(id, move || browser_place(id).ok().flatten()).flatten(),
        // Only a file of this computer and the title: nothing of the program to wait for, so not `within`.
        "code.exe" | "code - insiders.exe" => companion_place(&companion_records(), &title, now_ms()).or_else(|| code_file(&title).map(|file| Place::File { file, line: None })),
        "powerpnt.exe" => within(id, move || slide_of(&title).ok().flatten()).flatten(),
        _ => None,
    };
    tauri::async_runtime::spawn_blocking(read).await.map_err(|error| error.to_string())
}

/// An address a note may send a browser to: a web page, or a file on a drive of this computer ("file:///C:/…"). Never
/// a switch of the browser's, nor any other scheme, nor a file on another computer: "file://///server/share/x" would
/// make Windows sign in to that server, handing it the person's name and a hash of their password.
fn may_open(address: &str) -> bool {
    let lower = address.to_ascii_lowercase();
    if lower.starts_with("https://") || lower.starts_with("http://") {
        return true;
    }
    let Some(path) = lower.strip_prefix("file:///") else { return false };
    let bytes = path.as_bytes();
    // A drive's letter, then the path; and no second way of writing a server's name inside it.
    let on_a_drive = bytes.len() > 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'/';
    on_a_drive && !path.contains("//") && !path.contains('\\') && !path.contains("%5c") && !path.contains("%2f")
}

/// A file a note may send VS Code to: a whole path, to a file that is there.
fn may_edit(file: &str) -> bool {
    let bytes = file.as_bytes();
    let whole = bytes.len() > 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && (bytes[2] == b'/' || bytes[2] == b'\\');
    whole && std::path::Path::new(file).is_file()
}

/// Back to a place (the person's tap on a line's mark): true when the program went, false when it cannot (its deck
/// closed, its slide deleted, a file named but not whole). `front`: the window is brought in front, not being seen.
#[tauri::command]
pub async fn apps_go_to(id: i64, place: Place, front: bool) -> Result<bool, String> {
    let window = crate::apps::may_picture(id)?;
    let (program, title) = crate::apps::program_and_title(window);
    let id = window.0 as isize;
    let go = move || match (program.to_ascii_lowercase().as_str(), place) {
        ("powerpnt.exe", Place::Slide { slide, deck, .. }) => {
            let went = within(id, move || go_to_slide(&title, deck.as_deref(), slide).unwrap_or(false)).unwrap_or(false);
            if went && front {
                crate::apps::bring_forward(id);
            }
            went
        }
        ("chrome.exe" | "msedge.exe" | "brave.exe", wanted @ (Place::Address { .. } | Place::Page { .. })) => browser_go_to(id, wanted),
        ("code.exe" | "code - insiders.exe", Place::File { file, line }) if may_edit(&file) => crate::apps::start_like(id, &["--goto".to_string(), format!("{file}:{}", line.unwrap_or(1))]),
        _ => false,
    };
    tauri::async_runtime::spawn_blocking(go).await.map_err(|error| error.to_string())
}

/// A browser sent to a page: nothing done if it is there already; else its window brought in front and its own program
/// started with the address, which opens it in a new tab of the window last in front. No clean way drives one window of a
/// browser from outside.
fn browser_go_to(id: isize, wanted: Place) -> bool {
    let address = match &wanted {
        Place::Address { address } => address.clone(),
        Place::Page { page, file: Some(file) } => format!("{}#page={page}", file.split('#').next().unwrap_or_default()),
        _ => return false,
    };
    if !may_open(&address) {
        return false;
    }
    let there = within(id, move || browser_place(id).ok().flatten()).flatten();
    if there.as_ref() == Some(&wanted) {
        return true;
    }
    crate::apps::bring_forward(id);
    // A moment for Windows to make it the window last in front, which is where the browser opens the new tab.
    std::thread::sleep(Duration::from_millis(150));
    crate::apps::start_like(id, &[address])
}

/// The windows being read now.
static READING: Mutex<Vec<isize>> = Mutex::new(Vec::new());

/// `read` on a thread of its own, waited for `WAIT` at most: a program that hangs holds that thread, never ShellNote.
/// One read at a time for each window: while a hung program holds one, a new line asks nothing of it, so lines written
/// beside it never pile up threads waiting on it.
fn within<T: Send + 'static>(id: isize, read: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    {
        let mut reading = READING.lock().ok()?;
        if reading.contains(&id) {
            return None;
        }
        reading.push(id);
    }
    let (send, receive) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let answer = read();
        if let Ok(mut reading) = READING.lock() {
            reading.retain(|one| *one != id);
        }
        let _ = send.send(answer);
    });
    receive.recv_timeout(WAIT).ok()
}

/// COM on this thread while it lives: declared first, so what was made with it goes first.
/// The multithreaded kind: these are plain worker threads with no message loop, and that kind needs none. Bound to a
/// name (`_com`): a bare `_` would end it at once.
struct Com(bool);

impl Com {
    fn new() -> Self {
        Self(unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok())
    }
}

impl Drop for Com {
    fn drop(&mut self) {
        if self.0 {
            unsafe { CoUninitialize() };
        }
    }
}

/// VS Code's file from its window's title ("waves.ts - project - Visual Studio Code", a dot first when unsaved; Insiders
/// ends "Visual Studio Code - Insiders"). A title the person changed (`window.title`) gives none; the companion
/// extension gives the file and line whatever the title.
pub fn code_file(title: &str) -> Option<String> {
    let parts: Vec<&str> = title.split(" - ").collect();
    if parts.iter().rposition(|part| part.contains("Visual Studio Code")).unwrap_or(0) == 0 {
        return None;
    }
    let file = parts[0].trim().trim_start_matches('●').trim();
    (!file.is_empty() && !file.starts_with("Welcome")).then(|| file.to_string())
}

/// What the companion extension keeps for one VS Code window (apps/vscode-companion/extension/extension.js).
#[derive(Deserialize, Debug, Clone, PartialEq)]
pub struct CompanionRecord {
    workspace: Option<String>,
    file: Option<String>,
    line: Option<u32>,
    at: u64,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |since| since.as_millis() as u64)
}

/// A record older than this is ignored, in milliseconds: one left by a VS Code that ended without saying (a day).
const RECORD_LASTS: u64 = 24 * 60 * 60 * 1000;

/// The most of the companion's folder that is read: a record is a few hundred bytes, one a window. Any program of the
/// person's can write there, so a file too large to be a record is passed over, and the count has an end.
const RECORD_BYTES: u64 = 64 * 1024;
const RECORDS: usize = 200;

/// What the companion keeps on this computer, read as a line is written beside VS Code.
fn companion_records() -> Vec<CompanionRecord> {
    let Some(base) = std::env::var_os("LOCALAPPDATA") else { return Vec::new() };
    let Ok(files) = std::fs::read_dir(std::path::Path::new(&base).join("shellnote").join("vscode")) else { return Vec::new() };
    files
        .flatten()
        .filter(|file| file.path().extension().is_some_and(|extension| extension == "json"))
        .filter(|file| file.metadata().is_ok_and(|meta| meta.is_file() && meta.len() <= RECORD_BYTES))
        .take(RECORDS)
        .filter_map(|file| serde_json::from_str(&std::fs::read_to_string(file.path()).ok()?).ok())
        .collect()
}

/// The place of the VS Code window titled `title`, from the companion's records: the newest naming the title's file, in
/// the title's workspace if one is. A title the person changed names no file: the newest of the title's workspace, or
/// the only record. None on a tab that is no file (Settings, Welcome), in a default title, as no record fits it.
fn companion_place(records: &[CompanionRecord], title: &str, now: u64) -> Option<Place> {
    let fresh = records.iter().filter(|record| record.file.is_some() && now.saturating_sub(record.at) < RECORD_LASTS);
    let newest = |list: Vec<&CompanionRecord>| list.into_iter().max_by_key(|record| record.at).cloned();
    let in_title = |record: &CompanionRecord| record.workspace.as_deref().is_some_and(|workspace| title.contains(workspace));
    let chosen = match code_file(title) {
        Some(name) => {
            let named: Vec<&CompanionRecord> = fresh.filter(|record| record.file.as_deref().is_some_and(|file| file.rsplit(['/', '\\']).next() == Some(name.as_str()))).collect();
            newest(named.iter().copied().filter(|record| in_title(record)).collect()).or_else(|| newest(named))
        }
        None if title.contains("Visual Studio Code") => None,
        None => {
            let all: Vec<&CompanionRecord> = fresh.collect();
            newest(all.iter().copied().filter(|record| in_title(record)).collect()).or_else(|| (all.len() == 1).then(|| all[0].clone()))
        }
    }?;
    Some(Place::File { file: chosen.file?, line: chosen.line.filter(|line| *line > 0) })
}

/// Chromium's own viewer of PDFs, in Chrome, Edge and Brave: a page inside it means a PDF, whatever its address says
/// ("https://arxiv.org/pdf/1234.5678" has no ".pdf").
const PDF_VIEWER: &str = "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/";

/// An address without what address bars leave out, to compare: its scheme, "www.", a last slash.
fn plain(address: &str) -> String {
    let rest = address.split_once("://").map_or(address, |(_, rest)| rest).trim_start_matches('/');
    rest.strip_prefix("www.").unwrap_or(rest).trim_end_matches('/').replace("%20", " ").to_lowercase()
}

/// Which of a window's pages (each its address and its area on the screen) is the tab's: the one its address bar names.
/// DevTools docked and Edge's own dialogs are pages too, and DevTools comes first and may be the largest (6 November
/// 2026). While the bar names none (being typed in): the largest, never DevTools.
fn page_among(pages: &[(&str, i64)], bar: Option<&str>) -> Option<usize> {
    if let Some(bar) = bar.map(plain).filter(|bar| !bar.is_empty()) {
        if let Some(named) = pages.iter().position(|(address, _)| plain(address) == bar) {
            return Some(named);
        }
    }
    let mut best: Option<(usize, i64)> = None;
    for (at, (address, area)) in pages.iter().enumerate() {
        if !address.starts_with("devtools:") && best.is_none_or(|(_, most)| *area > most) {
            best = Some((at, *area));
        }
    }
    best.map(|(at, _)| at)
}

/// What an address bar shows, as an address: it leaves out "https://" and "file:///", and a window's first read comes
/// before its pages can be read (Chromium's accessibility starts then). None for words being typed.
fn bar_address(text: &str) -> Option<String> {
    let text = text.trim();
    if text.contains("://") || text.starts_with("about:") {
        return Some(text.to_string());
    }
    let bytes = text.as_bytes();
    if bytes.len() > 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'/' {
        return Some(format!("file:///{}", text.replace(' ', "%20")));
    }
    let host = text.split(['/', '?', '#']).next().unwrap_or_default();
    if text.contains(char::is_whitespace) || !(host.contains('.') || host.contains(':') || host == "localhost") {
        return None;
    }
    let local = host == "localhost" || host.starts_with("localhost:") || host.starts_with("127.");
    Some(format!("{}{text}", if local { "http://" } else { "https://" }))
}

/// A page with nothing of its own: no place.
fn is_blank(address: &str) -> bool {
    address.starts_with("about:") || address.contains("://newtab") || address.contains("://new-tab-page")
}

/// A browser's window as UI Automation shows it: its pages, each with its address and its area; which is the tab's; its
/// address bar's words.
struct Tab {
    pages: Vec<(IUIAutomationElement, String, i64)>,
    chosen: Option<usize>,
    bar: Option<String>,
}

fn tab_of(automation: &IUIAutomation, window: &IUIAutomationElement) -> windows::core::Result<Tab> {
    unsafe {
        let of_kind = |kind: UIA_CONTROLTYPE_ID| automation.CreatePropertyCondition(UIA_ControlTypePropertyId, &VARIANT::from(kind.0));
        // The toolbar comes first: the window's first box is its address bar.
        let bar = window.FindFirst(TreeScope_Descendants, &of_kind(UIA_EditControlTypeId)?).ok().as_ref().and_then(value_of);
        let documents = window.FindAll(TreeScope_Descendants, &of_kind(UIA_DocumentControlTypeId)?)?;
        let mut pages = Vec::new();
        for n in 0..documents.Length()? {
            let Ok(document) = documents.GetElement(n) else { continue };
            // A document with no address as its value is no page of a tab.
            let Some(address) = value_of(&document).filter(|address| address.contains(':')) else { continue };
            let area = document.CurrentBoundingRectangle().map_or(0, |at| i64::from(at.right - at.left) * i64::from(at.bottom - at.top));
            pages.push((document, address, area));
        }
        let listed: Vec<(&str, i64)> = pages.iter().map(|(_, address, area)| (address.as_str(), *area)).collect();
        let chosen = page_among(&listed, bar.as_deref());
        Ok(Tab { pages, chosen, bar })
    }
}

/// Whether a tab shows a PDF in Chromium's own viewer, by its address or the viewer's page inside it.
fn is_pdf(tab: &Tab, address: &str) -> bool {
    let (path, _) = address.split_once(['#', '?']).unwrap_or((address, ""));
    path.to_ascii_lowercase().ends_with(".pdf") || tab.pages.iter().any(|(_, address, _)| address.starts_with(PDF_VIEWER))
}

/// A browser's place: the page of a PDF in its own viewer, else its address.
fn browser_place(id: isize) -> windows::core::Result<Option<Place>> {
    unsafe {
        let _com = Com::new();
        let automation: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)?;
        let window = automation.ElementFromHandle(HWND(id as *mut _))?;
        let tab = tab_of(&automation, &window)?;
        let Tab { pages, chosen, bar } = &tab;
        // The bar names a blank page (a new tab): no place, whatever documents the window still holds.
        if bar.as_deref().is_some_and(is_blank) {
            return Ok(None);
        }
        // The page read, else the bar's words: a window's first read comes before its pages can be read.
        let address = chosen.map(|at| pages[at].1.clone()).or_else(|| bar.as_deref().and_then(bar_address)).filter(|address| !is_blank(address));
        let Some(address) = address else { return Ok(None) };
        if !is_pdf(&tab, &address) {
            return Ok(Some(Place::Address { address }));
        }
        // A PDF: its viewer's page box, the one box of the page holding a whole number (all boxes of a PDF of 500 pages
        // found in about 30 ms, 6 November 2026).
        let scope = chosen.map_or(&window, |at| &pages[at].0);
        let boxes = scope.FindAll(TreeScope_Descendants, &automation.CreatePropertyCondition(UIA_ControlTypePropertyId, &VARIANT::from(UIA_EditControlTypeId.0))?)?;
        for n in 0..boxes.Length()? {
            let page = boxes.GetElement(n).ok().as_ref().and_then(value_of).and_then(|value| value.trim().parse::<u32>().ok()).filter(|&page| page > 0);
            if let Some(page) = page {
                let file = address.split('#').next().map(str::to_string);
                return Ok(Some(Place::Page { page, file }));
            }
        }
        // A PDF with no box giving a number: its address alone.
        Ok(Some(Place::Address { address }))
    }
}

/// VS Code and the editors made from it: never read through UI Automation (it can switch them into screen-reader mode).
fn is_code_like(program: &str) -> bool {
    matches!(program.to_ascii_lowercase().as_str(), "code.exe" | "code - insiders.exe" | "vscodium.exe" | "cursor.exe" | "windsurf.exe")
}

/// Whether a small picture of window `id` may be kept with a line now: never while the window shows a password box, and,
/// since that cannot be asked of it, never of VS Code, to stay on the careful side.
/// A read that fails, or takes too long, keeps none. The picture itself is the page's, from the frame it has.
#[tauri::command]
pub async fn apps_may_keep_picture(id: i64) -> Result<bool, String> {
    let window = crate::apps::may_picture(id)?;
    let (program, _) = crate::apps::program_and_title(window);
    if is_code_like(&program) {
        return Ok(false);
    }
    let id = window.0 as isize;
    let read = move || within(id, move || shows_password(id).map(|shows| !shows).unwrap_or(false)).unwrap_or(false);
    tauri::async_runtime::spawn_blocking(read).await.map_err(|error| error.to_string())
}

/// Whether a window shows a password box now.
fn shows_password(id: isize) -> windows::core::Result<bool> {
    unsafe {
        let _com = Com::new();
        let automation: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)?;
        let window = automation.ElementFromHandle(HWND(id as *mut _))?;
        let password = automation.CreatePropertyCondition(UIA_IsPasswordPropertyId, &VARIANT::from(true))?;
        let seen = automation.CreatePropertyCondition(UIA_IsOffscreenPropertyId, &VARIANT::from(false))?;
        let both = automation.CreateAndCondition(&password, &seen)?;
        // Ok means found: the windows crate turns an answer of "nothing found" into an error. So a failure of this one
        // call reads as "no password box" too, unlike a failure on the lines above, which keeps no picture.
        Ok(window.FindFirst(TreeScope_Descendants, &both).is_ok())
    }
}

/// The most of a place's words read, in characters: a page may be as long as a book.
const MOST_WORDS: i32 = 20_000;

/// The words of window `id`'s place now, from the program itself; none when it has none to give (VS Code never does),
/// so its picture's words are read instead.
#[tauri::command]
pub async fn apps_words_of(id: i64) -> Result<Option<String>, String> {
    let window = crate::apps::may_picture(id)?;
    let (program, title) = crate::apps::program_and_title(window);
    let id = window.0 as isize;
    let read = move || match program.to_ascii_lowercase().as_str() {
        "chrome.exe" | "msedge.exe" | "brave.exe" => within(id, move || page_words(id).ok().flatten()).flatten(),
        "powerpnt.exe" => within(id, move || slide_words(&title).ok().flatten()).flatten(),
        _ => None,
    };
    tauri::async_runtime::spawn_blocking(read).await.map_err(|error| error.to_string())
}

/// The words of a browser's page, as it gives them to screen readers (a password box gives dots, never its words). A PDF
/// gives its whole file, not its page: none, so what is seen of it is read instead.
fn page_words(id: isize) -> windows::core::Result<Option<String>> {
    unsafe {
        let _com = Com::new();
        let automation: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)?;
        let window = automation.ElementFromHandle(HWND(id as *mut _))?;
        let tab = tab_of(&automation, &window)?;
        let Some((page, address, _)) = tab.chosen.map(|at| &tab.pages[at]) else { return Ok(None) };
        if is_blank(address) || is_pdf(&tab, address) {
            return Ok(None);
        }
        let pattern: IUIAutomationTextPattern = page.GetCurrentPatternAs(UIA_TextPatternId)?;
        let words = pattern.DocumentRange()?.GetText(MOST_WORDS)?.to_string();
        Ok(Some(words).filter(|words| !words.trim().is_empty()))
    }
}

/// The words of the slide shown in PowerPoint's window of this title: each shape's that holds words, then its notes'.
fn slide_words(title: &str) -> windows::core::Result<Option<String>> {
    let _com = Com::new();
    let app = powerpoint()?;
    let Some(window) = window_of(&app, title)? else { return Ok(None) };
    let slide = object(&object(&window, "View")?, "Slide")?;
    let mut out = Vec::new();
    let shape_words = |shape: &IDispatch| -> windows::core::Result<String> {
        if number(shape, "HasTextFrame")? == 0 {
            return Ok(String::new());
        }
        words(&object(&object(shape, "TextFrame")?, "TextRange")?, "Text")
    };
    let shapes = object(&slide, "Shapes")?;
    for n in 1..=number(&shapes, "Count")? {
        // A `Result` extends as one item or none: a shape that gives no words loses only its own.
        out.extend(shape_words(&item(&shapes, n)?));
    }
    // Its notes: the page's second placeholder, when it has one.
    if let Ok(placeholders) = object(&slide, "NotesPage").and_then(|page| object(&page, "Shapes")).and_then(|shapes| object(&shapes, "Placeholders")) {
        if number(&placeholders, "Count").is_ok_and(|count| count >= 2) {
            out.extend(item(&placeholders, 2).and_then(|notes| shape_words(&notes)));
        }
    }
    // PowerPoint ends a paragraph with a carriage return, and a line within one with a vertical tab.
    let text: Vec<String> = out.iter().map(|words| words.replace('\r', "\n").replace('\u{b}', "\n")).filter(|words| !words.trim().is_empty()).collect();
    Ok((!text.is_empty()).then(|| text.join("\n")))
}

/// What a program's picture shows, read by Windows' own text reading, on this computer: the page sends the frame it has,
/// red, green, blue and alpha, row by row, its size in the request's `x-width` and `x-height`. No words, or no language
/// Windows can read: none.
#[tauri::command]
pub async fn apps_read_picture(request: tauri::ipc::Request<'_>) -> Result<Option<String>, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("no picture".into()) };
    let size = |name: &str| request.headers().get(name).and_then(|value| value.to_str().ok()).and_then(|value| value.parse::<u32>().ok()).unwrap_or(0);
    let (width, height) = (size("x-width"), size("x-height"));
    if !whole_picture(width, height, bytes.len()) {
        return Err("not a whole picture".into());
    }
    let bytes = bytes.clone();
    let read = move || picture_words(bytes, width, height).ok().map(|words| words.trim().to_string()).filter(|words| !words.is_empty());
    tauri::async_runtime::spawn_blocking(read).await.map_err(|error| error.to_string())
}

/// The largest side of a picture Windows' text reading takes (its `OcrEngine.MaxImageDimension`).
const MOST_SIDE: u32 = 10_000;

/// Whether `bytes` is a picture of `width` by `height`, four bytes a pixel, of a size Windows reads. The sizes come
/// from the page, so they are multiplied with care: two large ones would wrap round to a small number.
fn whole_picture(width: u32, height: u32, bytes: usize) -> bool {
    if width == 0 || height == 0 || width > MOST_SIDE || height > MOST_SIDE {
        return false;
    }
    (width as usize).checked_mul(height as usize).and_then(|pixels| pixels.checked_mul(4)) == Some(bytes)
}

fn picture_words(mut pixels: Vec<u8>, width: u32, height: u32) -> windows::core::Result<String> {
    let _com = Com::new();
    // Blue first, as Windows takes them.
    for pixel in pixels.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }
    let writer = DataWriter::new()?;
    writer.WriteBytes(&pixels)?;
    let bitmap = SoftwareBitmap::CreateCopyFromBuffer(&writer.DetachBuffer()?, BitmapPixelFormat::Bgra8, width as i32, height as i32)?;
    let engine = OcrEngine::TryCreateFromUserProfileLanguages()?;
    // `join` waits here for Windows' answer: hence the blocking thread in `apps_read_picture`.
    Ok(engine.RecognizeAsync(&bitmap)?.join()?.Text()?.to_string())
}

/// What a part of a window holds as its value: an address bar's text, a page's address.
fn value_of(element: &IUIAutomationElement) -> Option<String> {
    unsafe {
        let pattern: IUIAutomationValuePattern = element.GetCurrentPatternAs(UIA_ValuePatternId).ok()?;
        Some(pattern.CurrentValue().ok()?.to_string())
    }
}

/// A member of another program's object, by its name, as a script would reach it (late bound): a property, or a method.
fn member(object: &IDispatch, name: &str, flags: DISPATCH_FLAGS, args: &[VARIANT]) -> windows::core::Result<VARIANT> {
    let wide: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
    let names = [PCWSTR(wide.as_ptr())];
    let mut id = 0i32;
    // Last first, as COM takes them.
    let mut args: Vec<VARIANT> = args.iter().rev().cloned().collect();
    let params = DISPPARAMS { rgvarg: args.as_mut_ptr(), cArgs: args.len() as u32, ..Default::default() };
    let mut result = VARIANT::default();
    unsafe {
        // Asked by name each time, as a script does; the zero GUID is what `IDispatch` requires in that place.
        object.GetIDsOfNames(&GUID::zeroed(), names.as_ptr(), 1, 0, &mut id)?;
        object.Invoke(id, &GUID::zeroed(), 0, flags, &params, Some(&mut result), None, None)?;
    }
    Ok(result)
}

fn object(of: &IDispatch, name: &str) -> windows::core::Result<IDispatch> {
    IDispatch::try_from(&member(of, name, DISPATCH_PROPERTYGET, &[])?)
}

fn number(of: &IDispatch, name: &str) -> windows::core::Result<i32> {
    i32::try_from(&member(of, name, DISPATCH_PROPERTYGET, &[])?)
}

fn words(of: &IDispatch, name: &str) -> windows::core::Result<String> {
    Ok(BSTR::try_from(&member(of, name, DISPATCH_PROPERTYGET, &[])?)?.to_string())
}

/// The `n`th of a collection of another program's objects, from 1.
fn item(collection: &IDispatch, n: i32) -> windows::core::Result<IDispatch> {
    // Asked as a method or a property: a collection's `Item` may be either.
    IDispatch::try_from(&member(collection, "Item", DISPATCH_FLAGS(DISPATCH_METHOD.0 | DISPATCH_PROPERTYGET.0), &[VARIANT::from(n)])?)
}

/// PowerPoint, as the person runs it; an error when it does not run.
fn powerpoint() -> windows::core::Result<IDispatch> {
    unsafe {
        let class = CLSIDFromProgID(w!("PowerPoint.Application"))?;
        let mut running = None;
        // The copy already running, from Windows' table of running objects: this never starts PowerPoint.
        GetActiveObject(&class, None, &mut running)?;
        running.ok_or(windows::core::Error::from(E_FAIL))?.cast()
    }
}

/// Whether a window titled `title` is PowerPoint's document window of this caption ("lecture.pptx" in "lecture.pptx -
/// PowerPoint"; "lecture.pptx  -  1" with two windows of one deck).
fn is_titled(title: &str, caption: &str) -> bool {
    !caption.is_empty() && (title == caption || title.strip_prefix(caption).is_some_and(|rest| rest.starts_with(" - ")))
}

/// PowerPoint's window of this title: an editing window by its caption, the longest that fits, or a slide show in a
/// window ("PowerPoint Slide Show  -  lecture.pptx  -  2 - PowerPoint") by its deck's name. PowerPoint's windows have no
/// handle to ask for: `HWND` is "member not found" on each (6 November 2026).
fn window_of(app: &IDispatch, title: &str) -> windows::core::Result<Option<IDispatch>> {
    let windows = object(app, "Windows")?;
    let mut best: Option<(usize, IDispatch)> = None;
    for n in 1..=number(&windows, "Count")? {
        let window = item(&windows, n)?;
        let Ok(caption) = words(&window, "Caption") else { continue };
        if is_titled(title, &caption) && best.as_ref().is_none_or(|(most, _)| caption.len() > *most) {
            best = Some((caption.len(), window));
        }
    }
    if let Some((_, window)) = best {
        return Ok(Some(window));
    }
    let shows = object(app, "SlideShowWindows")?;
    for n in 1..=number(&shows, "Count")? {
        let show = item(&shows, n)?;
        if title.contains(&words(&object(&show, "Presentation")?, "Name")?) {
            return Ok(Some(show));
        }
    }
    Ok(None)
}

/// PowerPoint's window of a deck, by its full name: this title's window if it shows that deck, else the deck's slide
/// show, else its first window. None when that deck is not open. No deck named (a line kept before decks were): this
/// title's window.
fn window_of_deck(app: &IDispatch, title: &str, deck: Option<&str>) -> windows::core::Result<Option<IDispatch>> {
    let own = window_of(app, title)?;
    let Some(deck) = deck else { return Ok(own) };
    let shows_it = |window: &IDispatch| object(window, "Presentation").and_then(|shown| words(&shown, "FullName")).is_ok_and(|name| name == deck);
    if let Some(window) = own.filter(|window| shows_it(window)) {
        return Ok(Some(window));
    }
    for list in ["SlideShowWindows", "Windows"] {
        let windows = object(app, list)?;
        for n in 1..=number(&windows, "Count")? {
            let window = item(&windows, n)?;
            if shows_it(&window) {
                return Ok(Some(window));
            }
        }
    }
    Ok(None)
}

/// PowerPoint sent to a slide, found by its id (its number may have changed): false when its deck is closed, or it was
/// deleted.
fn go_to_slide(title: &str, deck: Option<&str>, slide: u32) -> windows::core::Result<bool> {
    let _com = Com::new();
    let app = powerpoint()?;
    let Some(window) = window_of_deck(&app, title, deck)? else { return Ok(false) };
    let slides = object(&object(&window, "Presentation")?, "Slides")?;
    let Ok(found) = member(&slides, "FindBySlideID", DISPATCH_METHOD, &[VARIANT::from(slide as i32)]).and_then(|found| IDispatch::try_from(&found)) else { return Ok(false) };
    member(&object(&window, "View")?, "GotoSlide", DISPATCH_METHOD, &[VARIANT::from(number(&found, "SlideIndex")?)])?;
    Ok(true)
}

/// The slide shown in PowerPoint's window of this title: its id, which stays as slides move, its number now, its deck.
/// A slide show's window answers to the same names (`View`, `Slide`, `Presentation`), so one path serves both kinds.
fn slide_of(title: &str) -> windows::core::Result<Option<Place>> {
    let _com = Com::new();
    let app = powerpoint()?;
    let Some(window) = window_of(&app, title)? else { return Ok(None) };
    let slide = object(&object(&window, "View")?, "Slide")?;
    let deck = object(&window, "Presentation").and_then(|deck| words(&deck, "FullName")).ok().filter(|deck| !deck.is_empty());
    Ok(Some(Place::Slide { slide: number(&slide, "SlideID")? as u32, n: number(&slide, "SlideIndex")? as u32, deck }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vs_codes_file_from_its_title() {
        assert_eq!(code_file("waves.ts - project - Visual Studio Code"), Some("waves.ts".into()));
        assert_eq!(code_file("● waves.ts - project - Visual Studio Code"), Some("waves.ts".into()));
        assert_eq!(code_file("Welcome - project - Visual Studio Code"), None);
        assert_eq!(code_file("Notes Rag - Google Chrome"), None);
        assert_eq!(code_file("waves.ts - project - Visual Studio Code - Insiders"), Some("waves.ts".into()));
        assert_eq!(code_file("Visual Studio Code"), None);
        assert_eq!(code_file("my own title"), None);
    }

    #[test]
    fn the_tabs_page_is_the_one_its_address_bar_names() {
        let devtools = ("devtools://devtools/bundled/devtools_app.html?remoteBase=https://x", 1295 * 879);
        let page = ("https://www.example.com/waves/", 602 * 879);
        // DevTools first, and larger: the bar settles it, though it leaves out the scheme, "www." and the last slash.
        assert_eq!(page_among(&[devtools, page], Some("example.com/waves")), Some(1));
        // The bar being typed in: the largest, never DevTools.
        assert_eq!(page_among(&[devtools, page], Some("physics of wa")), Some(1));
        assert_eq!(page_among(&[devtools], None), None);
        // A file's address, as its bar shows it, spaces and all.
        assert_eq!(page_among(&[("file:///C:/My%20Notes/a.html", 10)], Some("C:/My Notes/a.html")), Some(0));
        // Edge's own dialog beside the tab.
        assert_eq!(page_among(&[("edge://sync-confirmation-dialog/", 25), ("https://a.org/", 900)], None), Some(1));
    }

    #[test]
    fn an_address_bars_words_as_an_address() {
        assert_eq!(bar_address("C:/My Notes/big.pdf#page=20").as_deref(), Some("file:///C:/My%20Notes/big.pdf#page=20"));
        assert_eq!(bar_address("example.com/waves").as_deref(), Some("https://example.com/waves"));
        assert_eq!(bar_address("https://example.com/").as_deref(), Some("https://example.com/"));
        assert_eq!(bar_address("localhost:5190/x").as_deref(), Some("http://localhost:5190/x"));
        assert_eq!(bar_address("physics of waves"), None);
        assert_eq!(bar_address("physics"), None);
        assert_eq!(bar_address(""), None);
    }

    #[test]
    fn one_read_at_a_time_for_a_window() {
        let (done, wait) = std::sync::mpsc::channel::<()>();
        // A program that hangs: its read is given up on after `WAIT`, and its thread still holds the window.
        let hung = std::thread::spawn(move || within(77, move || wait.recv().is_ok()));
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(within(77, || true), None, "a second read of a window being read asks nothing");
        assert_eq!(within(78, || true), Some(true), "another window is read as usual");
        assert_eq!(hung.join().unwrap(), None);
        // It answers at last: read as usual again.
        done.send(()).unwrap();
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(within(77, || true), Some(true));
    }

    #[test]
    fn a_note_can_send_a_browser_only_to_a_page_or_a_file() {
        for fine in ["https://example.com/", "http://127.0.0.1:8/a", "file:///C:/a.pdf", "HTTPS://example.com"] {
            assert!(may_open(fine), "{fine}");
        }
        // A note can be someone else's file: never a switch of the browser's, nor another scheme.
        for refused in ["--gpu-launcher=calc.exe", "--load-extension=C:/x", "javascript:alert(1)", "chrome://settings", "ms-settings:", "file://server/x", "C:/a.pdf", ""] {
            assert!(!may_open(refused), "{refused}");
        }
        // A file on another computer, however its server is written: Windows would sign in to it.
        for refused in [
            "file://///server/share/a.pdf",
            "file:////server/share/a.pdf",
            "file:///\\\\server\\share\\a.pdf",
            "file:///%5C%5Cserver/share/a.pdf",
            "file:///C://server/share",
            "file:///C:/a%2F%2Fserver",
            "file:///server/share/a.pdf",
            "FILE://///SERVER/x",
        ] {
            assert!(!may_open(refused), "{refused}");
        }
        assert!(may_open("file:///D:/My%20Notes/big.pdf#page=20"));
    }

    #[test]
    fn a_picture_to_read_is_whole_and_of_a_size_windows_reads() {
        assert!(whole_picture(2, 3, 24));
        assert!(!whole_picture(2, 3, 23));
        assert!(!whole_picture(0, 3, 0));
        // Two sizes whose product wraps round to nothing: no bytes at all would have passed for the whole picture.
        assert!(!whole_picture(1 << 31, 1 << 31, 0));
        assert!(!whole_picture(u32::MAX, u32::MAX, 4));
        assert!(!whole_picture(MOST_SIDE + 1, 1, (MOST_SIDE as usize + 1) * 4));
    }

    #[test]
    fn a_note_can_send_vs_code_only_to_a_file_that_is_there() {
        let here = std::env::current_exe().unwrap();
        assert!(may_edit(here.to_str().unwrap()));
        for refused in ["waves.ts", "--extensions-dir=C:/x", "--install-extension=C:/x.vsix", "C:/no/such/file.ts", "C:", ""] {
            assert!(!may_edit(refused), "{refused}");
        }
    }

    #[test]
    fn a_place_comes_back_from_the_page_as_it_went() {
        let of = |json: &str| serde_json::from_str::<Place>(json).unwrap();
        assert_eq!(of(r#"{"slide":256,"n":3}"#), Place::Slide { slide: 256, n: 3, deck: None });
        assert_eq!(of(r#"{"slide":256,"n":3,"deck":"C:/a.pptx"}"#), Place::Slide { slide: 256, n: 3, deck: Some("C:/a.pptx".into()) });
        assert_eq!(of(r#"{"page":4,"file":"file:///a.pdf"}"#), Place::Page { page: 4, file: Some("file:///a.pdf".into()) });
        assert_eq!(of(r#"{"address":"https://a.org/"}"#), Place::Address { address: "https://a.org/".into() });
        assert_eq!(of(r#"{"file":"C:/a.ts","line":9}"#), Place::File { file: "C:/a.ts".into(), line: Some(9) });
        assert_eq!(of(r#"{"file":"a.ts"}"#), Place::File { file: "a.ts".into(), line: None });
    }

    #[test]
    fn vs_codes_place_from_the_companion() {
        let record = |workspace: &str, file: &str, line, at| CompanionRecord { workspace: Some(workspace.into()), file: Some(file.into()), line: Some(line), at };
        let (a, b, c) = (record("project", r"C:\project\waves.ts", 42, 1000), record("other", r"C:\other\waves.ts", 7, 2000), record("project", "C:/project/notes.md", 3, 3000));
        let place = |file: &str, line| Some(Place::File { file: file.into(), line: Some(line) });
        let all = [a.clone(), b.clone(), c.clone()];
        // The file the title names, in the workspace the title names, though another window's is newer.
        assert_eq!(companion_place(&all, "waves.ts - project - Visual Studio Code", 5000), place(r"C:\project\waves.ts", 42));
        assert_eq!(companion_place(&all, "● notes.md - project - Visual Studio Code", 5000), place("C:/project/notes.md", 3));
        // No such workspace in the title: the newest with the file's name.
        assert_eq!(companion_place(&all, "waves.ts - Visual Studio Code", 5000), place(r"C:\other\waves.ts", 7));
        // A file no record names; a tab that is no file; a stale record.
        assert_eq!(companion_place(&all, "other.ts - project - Visual Studio Code", 5000), None);
        assert_eq!(companion_place(&all, "Welcome - project - Visual Studio Code", 5000), None);
        assert_eq!(companion_place(&all, "waves.ts - project - Visual Studio Code", 1000 + RECORD_LASTS + 1), place(r"C:\other\waves.ts", 7));
        assert_eq!(companion_place(&[a.clone()], "waves.ts - project - Visual Studio Code", 1000 + RECORD_LASTS), None);
        // A title the person changed: by its workspace, or the only one.
        assert_eq!(companion_place(&all, "my project window", 5000), place("C:/project/notes.md", 3));
        assert_eq!(companion_place(&[b.clone()], "my own title", 5000), place(r"C:\other\waves.ts", 7));
        assert_eq!(companion_place(&[a, b], "my own title", 5000), None);
        // A window on no file writes none.
        let none = CompanionRecord { workspace: None, file: None, line: None, at: 1000 };
        assert_eq!(companion_place(&[none.clone()], "my own title", 5000), None);
        assert_eq!(serde_json::from_str::<CompanionRecord>(r#"{"workspace":null,"file":null,"line":null,"at":1000}"#).unwrap(), none);
    }

    #[test]
    fn vs_code_and_its_kin_are_never_read() {
        for program in ["Code.exe", "code.exe", "Code - Insiders.exe", "VSCodium.exe", "Cursor.exe", "Windsurf.exe"] {
            assert!(is_code_like(program), "{program}");
        }
        for program in ["chrome.exe", "POWERPNT.EXE", "notepad.exe"] {
            assert!(!is_code_like(program), "{program}");
        }
    }

    #[test]
    fn a_blank_page_has_no_place() {
        assert!(is_blank("about:blank") && is_blank("chrome://newtab/") && is_blank("edge://newtab/"));
        assert!(!is_blank("https://example.com/newtab"));
    }

    #[test]
    fn powerpoints_window_by_its_caption() {
        assert!(is_titled("lecture.pptx - PowerPoint", "lecture.pptx"));
        assert!(is_titled("lecture.pptx  -  1 - PowerPoint", "lecture.pptx  -  1"));
        assert!(!is_titled("lecture 2.pptx - PowerPoint", "lecture.pptx"));
        assert!(!is_titled("lecture.pptx  -  1 - PowerPoint", "lecture.pptx"));
        assert!(!is_titled("lecture.pptx - PowerPoint", ""));
    }

    #[test]
    fn a_place_as_the_note_keeps_it() {
        assert_eq!(serde_json::to_string(&Place::Slide { slide: 256, n: 3, deck: None }).unwrap(), r#"{"slide":256,"n":3}"#);
        assert_eq!(serde_json::to_string(&Place::Slide { slide: 256, n: 3, deck: Some("C:/a.pptx".into()) }).unwrap(), r#"{"slide":256,"n":3,"deck":"C:/a.pptx"}"#);
        assert_eq!(serde_json::to_string(&Place::Page { page: 4, file: None }).unwrap(), r#"{"page":4}"#);
        assert_eq!(serde_json::to_string(&Place::Address { address: "https://example.com/".into() }).unwrap(), r#"{"address":"https://example.com/"}"#);
        assert_eq!(serde_json::to_string(&Place::File { file: "a.ts".into(), line: Some(9) }).unwrap(), r#"{"file":"a.ts","line":9}"#);
    }
}
