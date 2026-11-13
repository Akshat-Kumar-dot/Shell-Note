//! The library kept in a folder the person chooses, such as one a cloud service copies between their devices: the
//! files the page asks for (apps/web/src/library/folder/desktopFiles.ts). The page never names a folder: it says
//! "shared" (the folder chosen here, in a dialog of the system's, and kept on this side) or "own" (this device's own
//! copies, in the app's data folder), and a path inside it. A path that would leave the folder, by ".." or a drive or
//! through a link to elsewhere, is refused, so nothing the page is given can read or write outside what the person chose.
//! A third word, "server", is the place the MCP server keeps for this library (apps/mcp-server): there the page may
//! read each note's log of what assistants did, to show it, and may do nothing else.
//!
//! Inside the folder, the page reaches the library's files and no others, whatever script runs in it: it reads,
//! writes and removes notes (`.shellnote` files) and the library's own small files (its hidden `.shellnote` folder;
//! this device's copies), and nothing else the folder holds. A folder is removed only once it is empty, never with
//! what it holds; a move never takes another file's place. A name Windows would read as another (dots or spaces at
//! its end, a short `NAME~1` form, a device's name) is refused, so the name checked is the file reached.
//!
//! Each write goes to a temporary file beside the target, then is renamed over it: a reader, or a cloud service
//! copying the folder, never finds half a note.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

/// The largest file read or written: a note with its pictures and videos (the page's own limit is 1 GiB of content).
const MAX_BYTES: u64 = (1 << 30) + (64 << 20);
/// How deep, and how much, a listing goes at most: a folder that loops or is not a library ends there.
const MAX_DEPTH: usize = 40;
const MAX_ENTRIES: usize = 500_000;
static WRITES: AtomicU64 = AtomicU64::new(0);

/// The library's own hidden folder in the folder chosen (layout.ts), and the end of a note's file name.
const HIDDEN: &str = ".shellnote";
const NOTE: &str = ".shellnote";
const NOT_THE_LIBRARYS: &str = "That is not a note, nor a file of the library's own.";

/// Beside the web view's own data, as the window's place is: a copy of the app the checks open never shares the
/// person's choice.
fn data_folder(app: &AppHandle) -> Result<PathBuf, String> {
    std::env::var_os("WEBVIEW2_USER_DATA_FOLDER")
        .map(PathBuf::from)
        .or_else(|| app.path().app_local_data_dir().ok())
        .ok_or_else(|| "The app's own folder was not found.".to_string())
}

fn choice_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_folder(app)?.join("library-folder.txt"))
}

/// The folder the person chose, if any. The checks name one of their own (SHELLNOTE_LIBRARY_FOLDER), so they never
/// need the dialog.
fn chosen(app: &AppHandle) -> Option<PathBuf> {
    let named = crate::check_switch("SHELLNOTE_LIBRARY_FOLDER").map(PathBuf::from);
    let folder = named.or_else(|| fs::read_to_string(choice_file(app).ok()?).ok().map(|text| PathBuf::from(text.trim())))?;
    folder.is_absolute().then_some(folder)
}

/// A short name for a folder's path, the same each time: this device's copies of each library chosen stay apart.
fn name_of(path: &Path) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in path.to_string_lossy().to_lowercase().bytes() {
        hash = (hash ^ u64::from(byte)).wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// Which folder the page means.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Root {
    /// The folder the person chose.
    Shared,
    /// This device's own copies, in the app's data folder.
    Own,
    /// What the MCP server keeps for this library, in a place of its own beside the app's data (apps/mcp-server):
    /// the page may read each note's log of what assistants did, and nothing more. It is never listed, written,
    /// moved or removed from here, and never made: it is there only once a server has run.
    Server,
}

fn root(app: &AppHandle, which: &str) -> Result<(Root, PathBuf), String> {
    let shared = chosen(app).ok_or("No folder is chosen for the library.")?;
    match which {
        "shared" => Ok((Root::Shared, shared)),
        "own" => {
            let own = data_folder(app)?.join("library").join(name_of(&shared));
            fs::create_dir_all(&own).map_err(|error| error.to_string())?;
            Ok((Root::Own, own))
        }
        "server" => Ok((Root::Server, data_folder(app)?.join("mcp").join(name_of(&shared)))),
        _ => Err("There is no such place.".into()),
    }
}

/// A name Windows keeps for one of its devices, in any folder and whatever comes after a dot ("NUL", "con.txt",
/// "COM1"): a file cannot be called one, and opening one reaches the device.
fn is_device(part: &str) -> bool {
    let stem: Vec<char> = part.split('.').next().unwrap_or_default().trim_end_matches(' ').to_lowercase().chars().collect();
    let text: String = stem.iter().collect();
    if matches!(text.as_str(), "con" | "prn" | "aux" | "nul" | "conin$" | "conout$") {
        return true;
    }
    stem.len() == 4 && (text.starts_with("com") || text.starts_with("lpt")) && (stem[3].is_ascii_digit() || matches!(stem[3], '¹' | '²' | '³'))
}

/// One name of a path, as Windows keeps it: not empty, not "." or "..", no character a name cannot hold (a drive's or
/// a stream's ":" among them), no dot or space at its end (Windows drops those, so "a.shellnote." is "a.shellnote" and
/// "..." is the folder itself), and not a device's name.
fn plain(part: &str) -> bool {
    !part.is_empty()
        && part != "."
        && part != ".."
        && !part.ends_with(['.', ' '])
        && part.encode_utf16().count() <= 255
        && !part.chars().any(|c| c < ' ' || matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        && !is_device(part)
}

/// The place a path names inside a folder. Refused: a name that is not plain (`plain`), any part that is a link to
/// elsewhere (a symbolic link or a junction), and a short form of another name ("NOTES~1" for "Notes of May").
fn inside(root: &Path, path: &str) -> Result<PathBuf, String> {
    const OUTSIDE: &str = "That path is not inside the library's folder.";
    if path.is_empty() || path.len() > 2048 {
        return Err(OUTSIDE.into());
    }
    let mut full = root.to_path_buf();
    for part in path.split('/') {
        if !plain(part) {
            return Err(OUTSIDE.into());
        }
        full.push(part);
        if fs::symlink_metadata(&full).map(|meta| meta.file_type().is_symlink()).unwrap_or(false) {
            return Err(OUTSIDE.into());
        }
        // Windows gives a long name a short one too, with a "~" in it: the name on the disk must be the one asked for.
        if part.contains('~') {
            if let Ok(real) = fs::canonicalize(&full) {
                let same = real.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.to_lowercase() == part.to_lowercase());
                if !same {
                    return Err(OUTSIDE.into());
                }
            }
        }
    }
    Ok(full)
}

/// What a path is to the library, by its name alone.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Kind {
    /// A note: a `.shellnote` file, in no hidden folder.
    Note,
    /// One of the library's own small files: in its hidden folder (the mark, the pen's hand, thumbnails, when each
    /// deleted item went), or one of this device's copies.
    Own,
    /// A small file other programs leave in any folder (`desktop.ini`), or what an interrupted write left.
    Clutter,
    /// Anything else the folder holds: the person's, never the library's.
    Other,
}

fn is_clutter(name: &str) -> bool {
    let lower = name.to_lowercase();
    if matches!(lower.as_str(), "desktop.ini" | "thumbs.db" | ".ds_store") {
        return true;
    }
    // A write's temporary file: ".<name>.tmp-<process>-<count>".
    let Some((before, numbers)) = name.rsplit_once(".tmp-") else { return false };
    let counted = numbers.split_once('-').is_some_and(|(a, b)| !a.is_empty() && !b.is_empty() && a.bytes().all(|c| c.is_ascii_digit()) && b.bytes().all(|c| c.is_ascii_digit()));
    before.starts_with('.') && counted
}

fn kind_of(root: Root, path: &str) -> Kind {
    let parts: Vec<&str> = path.split('/').collect();
    let Some(last) = parts.last().copied() else { return Kind::Other };
    let lower = last.to_lowercase();
    let id = |text: &str| !text.is_empty() && text.len() <= 64 && text.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-');
    match root {
        Root::Own => match parts[..] {
            ["device.json"] => Kind::Own,
            ["notes", name] => {
                let known = [".doc.json", ".state.json", ".base.json"].iter().any(|end| name.strip_suffix(end).is_some_and(id));
                if known { Kind::Own } else { Kind::Other }
            }
            ["assets", hash] => {
                if (4..=64).contains(&hash.len()) && hash.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)) { Kind::Own } else { Kind::Other }
            }
            _ => Kind::Other,
        },
        // A note's log, and no other file the server keeps (its copies of the notes, its lock).
        Root::Server => match parts[..] {
            ["log", name] if name.strip_suffix(".json").is_some_and(id) => Kind::Own,
            _ => Kind::Other,
        },
        Root::Shared if parts[0].eq_ignore_ascii_case(HIDDEN) => {
            // The hidden folder holds small files of two kinds, at most one folder down: nothing that could run.
            let small = lower.ends_with(".json") || lower.ends_with(".webp");
            if (2..=3).contains(&parts.len()) && small { Kind::Own } else { Kind::Other }
        }
        Root::Shared => {
            if is_clutter(last) {
                Kind::Clutter
            } else if lower.ends_with(NOTE) && lower.len() > NOTE.len() && parts.iter().all(|part| !part.starts_with('.') && !part.starts_with("~$")) {
                Kind::Note
            } else {
                Kind::Other
            }
        }
    }
}

/// In the library's own hidden folder, or that folder itself.
fn in_hidden(path: &str) -> bool {
    path.split('/').next().is_some_and(|first| first.eq_ignore_ascii_case(HIDDEN))
}

#[derive(serde::Serialize)]
pub struct Entry {
    path: String,
    folder: bool,
    size: u64,
    modified: u64,
}

fn entry(path: String, meta: &fs::Metadata) -> Entry {
    let modified = meta.modified().ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok()).map_or(0, |since| since.as_millis() as u64);
    Entry { path, folder: meta.is_dir(), size: if meta.is_dir() { 0 } else { meta.len() }, modified }
}

fn walk(folder: &Path, prefix: &str, depth: usize, out: &mut Vec<Entry>) -> Result<(), String> {
    for item in fs::read_dir(folder).map_err(|error| error.to_string())? {
        let item = item.map_err(|error| error.to_string())?;
        // A name that is not text, and a link to elsewhere, are not the library's.
        let Some(name) = item.file_name().to_str().map(str::to_string) else { continue };
        let Ok(meta) = fs::symlink_metadata(item.path()) else { continue };
        if meta.file_type().is_symlink() || out.len() >= MAX_ENTRIES {
            continue;
        }
        let path = if prefix.is_empty() { name } else { format!("{prefix}/{name}") };
        let is_folder = meta.is_dir();
        out.push(entry(path.clone(), &meta));
        if is_folder && depth < MAX_DEPTH {
            walk(&item.path(), &path, depth + 1, out)?;
        }
    }
    Ok(())
}

/// The folder chosen for the library, as the person reads it; none while the app keeps the notes itself.
#[tauri::command]
pub fn library_folder(app: AppHandle) -> Option<String> {
    chosen(&app).map(|folder| folder.to_string_lossy().into_owned())
}

/// Ask the person for the library's folder, in the system's own dialog; none when they close it.
#[tauri::command]
pub async fn library_choose(app: AppHandle, window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    let picked = pick(&window).await?;
    let Some(folder) = picked else { return Ok(None) };
    if !folder.is_absolute() || !folder.is_dir() {
        return Err("That is not a folder on this computer.".into());
    }
    // The library makes folders of its own in it, and lists all it holds: a folder for the notes, not a whole drive.
    if folder.parent().is_none() {
        return Err("Choose a folder for your notes, not a whole drive.".into());
    }
    let file = choice_file(&app)?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(&file, folder.to_string_lossy().as_bytes()).map_err(|error| error.to_string())?;
    Ok(Some(folder.to_string_lossy().into_owned()))
}

/// Keep the notes in the app again: the folder and all in it stay as they are. This device's own copies for that
/// folder go, since the page calls this only once every note is back in the app, read and compared: left behind, they
/// would be taken for the folder's notes should the same folder be chosen again later, emptied meanwhile.
#[tauri::command]
pub fn library_forget(app: AppHandle) -> Result<(), String> {
    if let Some(shared) = chosen(&app) {
        let own = data_folder(&app)?.join("library").join(name_of(&shared));
        if own.is_dir() {
            fs::remove_dir_all(&own).map_err(|error| error.to_string())?;
        }
    }
    match fs::remove_file(choice_file(&app)?) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.to_string()),
        _ => Ok(()),
    }
}

/// Everything in the folder, at any depth.
#[tauri::command]
pub async fn library_list(app: AppHandle, root_name: String) -> Result<Vec<Entry>, String> {
    let (which, folder) = root(&app, &root_name)?;
    if which == Root::Server {
        return Err(NOT_THE_LIBRARYS.into());
    }
    let list = move || {
        let mut out = Vec::new();
        walk(&folder, "", 0, &mut out)?;
        Ok(out)
    };
    tauri::async_runtime::spawn_blocking(list).await.map_err(|error| error.to_string())?
}

/// One file or folder as it is now; none when it is not there.
#[tauri::command]
pub fn library_info(app: AppHandle, root_name: String, path: String) -> Result<Option<Entry>, String> {
    let (which, folder) = root(&app, &root_name)?;
    if which == Root::Server {
        return Err(NOT_THE_LIBRARYS.into());
    }
    let full = inside(&folder, &path)?;
    Ok(fs::symlink_metadata(full).ok().map(|meta| entry(path, &meta)))
}

/// A note's bytes, or those of one of the library's own files: never another file of the folder.
fn read_at(root: Root, folder: &Path, path: &str) -> Result<Vec<u8>, String> {
    let full = inside(folder, path)?;
    if !matches!(kind_of(root, path), Kind::Note | Kind::Own) {
        return Err(NOT_THE_LIBRARYS.into());
    }
    let size = fs::metadata(&full).map_err(|error| error.to_string())?.len();
    if size > MAX_BYTES {
        return Err("That file is too large to be a note.".to_string());
    }
    fs::read(&full).map_err(|error| error.to_string())
}

/// A file's bytes. A file the cloud service keeps online only is fetched as it is read, which may take a while.
#[tauri::command]
pub async fn library_read(app: AppHandle, root_name: String, path: String) -> Result<tauri::ipc::Response, String> {
    let (which, folder) = root(&app, &root_name)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || read_at(which, &folder, &path)).await.map_err(|error| error.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

/// `%41` and the like back into the text they stand for: a header holds plain letters only.
fn unescaped(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = text.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Rename `from` over `to`, trying again for a moment: a cloud service or a virus scanner may hold a file as it reads it.
fn rename_over(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut tries = 0;
    loop {
        match fs::rename(from, to) {
            Err(error) if tries < 8 && error.kind() == std::io::ErrorKind::PermissionDenied => {
                tries += 1;
                std::thread::sleep(Duration::from_millis(60));
            }
            done => return done,
        }
    }
}

/// A note, or one of the library's own files, written whole or not at all: never a file of another kind.
fn write_at(root: Root, folder: &Path, path: &str, bytes: &[u8]) -> Result<(), String> {
    let full = inside(folder, path)?;
    if root == Root::Server || !matches!(kind_of(root, path), Kind::Note | Kind::Own) {
        return Err(NOT_THE_LIBRARYS.into());
    }
    let parent = full.parent().ok_or("No folder to write in.")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    if full.is_dir() {
        return Err("A folder is there under that name.".into());
    }
    let name = full.file_name().and_then(|name| name.to_str()).ok_or("No name to write under.")?;
    let temporary = parent.join(format!(".{name}.tmp-{}-{}", std::process::id(), WRITES.fetch_add(1, Ordering::Relaxed)));
    let written = (|| -> std::io::Result<()> {
        let mut file = fs::File::create(&temporary)?;
        file.write_all(bytes)?;
        // On the disk before it takes the note's name: a power cut then leaves the old note, never half of the new.
        file.sync_all()?;
        drop(file);
        rename_over(&temporary, &full)
    })();
    if written.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    written.map_err(|error| error.to_string())
}

/// Write a file whole or not at all: the bytes are the request's body, the place in its `x-root` and `x-path`.
#[tauri::command]
pub async fn library_write(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("Nothing to write.".into()) };
    let header = |name: &str| request.headers().get(name).and_then(|value| value.to_str().ok()).and_then(unescaped);
    let (Some(root_name), Some(path)) = (header("x-root"), header("x-path")) else { return Err("No place to write to.".into()) };
    if bytes.len() as u64 > MAX_BYTES {
        return Err("That is too large to be a note.".into());
    }
    let (which, folder) = root(&app, &root_name)?;
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || write_at(which, &folder, &path, &bytes)).await.map_err(|error| error.to_string())?
}

/// Whether two paths are one file on the disk: the same name in other letters (Notes, notes) on Windows.
fn same_file(a: &Path, b: &Path) -> bool {
    matches!((fs::canonicalize(a), fs::canonicalize(b)), (Ok(a), Ok(b)) if a == b)
}

/// A note renamed or moved to another note's name, or a folder renamed or moved; never over something that is
/// there, never a file of another kind, and nothing into or out of the library's own hidden folder.
fn move_at(root: Root, folder: &Path, from: &str, to: &str) -> Result<(), String> {
    let (source, target) = (inside(folder, from)?, inside(folder, to)?);
    if root != Root::Shared || in_hidden(from) || in_hidden(to) {
        return Err(NOT_THE_LIBRARYS.into());
    }
    let meta = fs::symlink_metadata(&source).map_err(|error| error.to_string())?;
    if !meta.is_dir() && (kind_of(root, from) != Kind::Note || kind_of(root, to) != Kind::Note) {
        return Err(NOT_THE_LIBRARYS.into());
    }
    // Only the item itself may be there already: its own name in other letters. The disk says whether it is the same
    // file, not the letters: two names may differ on the disk and still read the same once made lower case.
    if fs::symlink_metadata(&target).is_ok() && !same_file(&source, &target) {
        return Err(format!("{to} is there already."));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    rename_over(&source, &target).map_err(|error| error.to_string())
}

/// Rename a file or a folder, or move it; never over something that is there.
#[tauri::command]
pub fn library_move(app: AppHandle, root_name: String, from: String, to: String) -> Result<(), String> {
    let (which, folder) = root(&app, &root_name)?;
    move_at(which, &folder, &from, &to)
}

/// Whether a folder holds folders only, at any depth: no file, and no link to elsewhere.
fn holds_nothing(folder: &Path, depth: usize) -> std::io::Result<bool> {
    if depth > MAX_DEPTH {
        return Ok(false);
    }
    for item in fs::read_dir(folder)? {
        let item = item?;
        let meta = fs::symlink_metadata(item.path())?;
        if meta.file_type().is_symlink() || !meta.is_dir() || !holds_nothing(&item.path(), depth + 1)? {
            return Ok(false);
        }
    }
    Ok(true)
}

/// An empty folder removed, with the empty folders in it: `remove_dir` takes a folder only when nothing is in it.
fn remove_empty(folder: &Path) -> std::io::Result<()> {
    for item in fs::read_dir(folder)? {
        remove_empty(&item?.path())?;
    }
    fs::remove_dir(folder)
}

/// A note removed, or one of the library's own files, or a small file other programs leave; or a folder, once it
/// holds no file. Never another file, never a folder with what it holds, never the library's hidden folder itself.
fn remove_at(root: Root, folder: &Path, path: &str) -> Result<(), String> {
    let full = inside(folder, path)?;
    if root == Root::Server {
        return Err(NOT_THE_LIBRARYS.into());
    }
    let Ok(meta) = fs::symlink_metadata(&full) else { return Ok(()) };
    if meta.is_dir() {
        if path.eq_ignore_ascii_case(HIDDEN) {
            return Err(NOT_THE_LIBRARYS.into());
        }
        if !holds_nothing(&full, 0).map_err(|error| error.to_string())? {
            return Err("That folder still holds files: only an empty folder is removed.".into());
        }
        return remove_empty(&full).map_err(|error| error.to_string());
    }
    if !matches!(kind_of(root, path), Kind::Note | Kind::Own | Kind::Clutter) {
        return Err(NOT_THE_LIBRARYS.into());
    }
    fs::remove_file(&full).map_err(|error| error.to_string())
}

/// Remove a note or one of the library's own files, or a folder that holds no file; nothing happens when it is not there.
#[tauri::command]
pub fn library_remove(app: AppHandle, root_name: String, path: String) -> Result<(), String> {
    let (which, folder) = root(&app, &root_name)?;
    remove_at(which, &folder, &path)
}

/// Make a folder, and those on the way to it.
#[tauri::command]
pub fn library_make_folder(app: AppHandle, root_name: String, path: String) -> Result<(), String> {
    let (which, folder) = root(&app, &root_name)?;
    let full = inside(&folder, &path)?;
    // A folder of the person's, in the folder chosen: the library's own folders are made as its files are written.
    if which != Root::Shared || in_hidden(&path) {
        return Err(NOT_THE_LIBRARYS.into());
    }
    fs::create_dir_all(full).map_err(|error| error.to_string())
}

/// The system's dialog for choosing a folder, over the app's window.
#[cfg(windows)]
async fn pick(window: &tauri::WebviewWindow) -> Result<Option<PathBuf>, String> {
    use windows::core::w;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE};
    use windows::Win32::UI::Shell::{FileOpenDialog, IFileOpenDialog, FOS_FORCEFILESYSTEM, FOS_PATHMUSTEXIST, FOS_PICKFOLDERS, SIGDN_FILESYSPATH};

    let owner = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
    let show = move || -> Result<Option<PathBuf>, String> {
        // The dialog lives on this thread, which is here for it alone.
        let started = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) }.is_ok();
        let picked = (|| -> windows::core::Result<Option<PathBuf>> {
            unsafe {
                let dialog: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)?;
                dialog.SetOptions(dialog.GetOptions()? | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST)?;
                dialog.SetTitle(w!("Choose the folder for your notes"))?;
                // Closed without a choice: no folder, and no fault.
                if dialog.Show(Some(HWND(owner as *mut core::ffi::c_void))).is_err() {
                    return Ok(None);
                }
                let name = dialog.GetResult()?.GetDisplayName(SIGDN_FILESYSPATH)?;
                let path = name.to_string().ok().map(PathBuf::from);
                CoTaskMemFree(Some(name.0 as *const core::ffi::c_void));
                Ok(path)
            }
        })();
        if started {
            unsafe { CoUninitialize() };
        }
        picked.map_err(|error| error.message())
    };
    tauri::async_runtime::spawn_blocking(show).await.map_err(|error| error.to_string())?
}

/// Elsewhere the notes stay in the app for now.
#[cfg(not(windows))]
async fn pick(_window: &tauri::WebviewWindow) -> Result<Option<PathBuf>, String> {
    Err("A folder for the library can be chosen on Windows only, for now.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A folder of a test's own, emptied first; the test removes it when done.
    fn fresh(name: &str) -> PathBuf {
        let folder = std::env::temp_dir().join(format!("shellnote-library-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&folder);
        fs::create_dir_all(&folder).unwrap();
        folder
    }

    #[test]
    fn a_path_never_leaves_the_folder() {
        let root = std::env::temp_dir();
        for bad in ["", ".", "..", "a/../b", "/a", "a//b", "a/", "C:/x", "a\\b", "a:b", "a/\u{1}", "a.shellnote::$DATA", "a*.shellnote", "a?.shellnote"] {
            assert!(inside(&root, bad).is_err(), "{bad:?} should be refused");
        }
        assert_eq!(inside(&root, "Notes/My note.shellnote").unwrap(), root.join("Notes").join("My note.shellnote"));
    }

    #[test]
    fn a_name_windows_reads_as_another_is_refused() {
        let root = std::env::temp_dir();
        // Windows drops dots and spaces from the end of a name, so each of these would be the folder itself, or
        // another file than the one named; and it keeps some names for its devices, in any folder.
        for bad in ["...", ".. ", ".. .", "Folder/...", "Folder./a.shellnote", "Folder /a.shellnote", "a.shellnote.", "a.shellnote ", "nul", "Folder/NUL", "con", "aux.shellnote", "COM1", "lpt9.txt", "com\u{b9}.shellnote", "CONIN$"] {
            assert!(inside(&root, bad).is_err(), "{bad:?} should be refused");
        }
        for fine in ["console.shellnote", "com.shellnote", "Notes~1/a.shellnote", "nullable.shellnote", "a.b.shellnote", ".shellnote/library.json"] {
            assert!(inside(&root, fine).is_ok(), "{fine:?} is a name like any other");
        }
    }

    #[test]
    fn what_a_path_is_to_the_library() {
        use Kind::*;
        for (path, kind) in [
            ("a.shellnote", Note),
            ("Folder/Sub/My note.SHELLNOTE", Note),
            ("Recently deleted/Old.shellnote", Note),
            (".shellnote", Other),
            (".hidden/a.shellnote", Other),
            ("~$a.shellnote", Other),
            ("a.docx", Other),
            ("a.shellnote.exe", Other),
            ("run.exe", Other),
            ("Folder/desktop.ini", Clutter),
            ("Folder/Thumbs.db", Clutter),
            ("Folder/.a.shellnote.tmp-412-7", Clutter),
            ("Folder/.a.shellnote.tmp-x-7", Other),
            (".shellnote/library.json", Own),
            (".shellnote/pen-profile.json", Own),
            (".shellnote/previews/n1.webp", Own),
            (".shellnote/deleted/Old.shellnote.json", Own),
            (".SHELLNOTE/library.json", Own),
            (".shellnote/run.exe", Other),
            (".shellnote/a/b/c.json", Other),
            (".shellnote/a.shellnote", Other),
        ] {
            assert_eq!(kind_of(Root::Shared, path), kind, "{path:?} in the folder chosen");
        }
        for (path, kind) in [
            ("device.json", Own),
            ("notes/n1.doc.json", Own),
            ("notes/n1.state.json", Own),
            ("notes/n1.base.json", Own),
            ("assets/0a1b2c3d", Own),
            ("notes/n1.json", Other),
            ("notes/.doc.json", Other),
            ("assets/XYZ", Other),
            ("assets/0a", Other),
            ("a.shellnote", Other),
            ("other.txt", Other),
            ("notes/sub/n1.doc.json", Other),
        ] {
            assert_eq!(kind_of(Root::Own, path), kind, "{path:?} among this device's copies");
        }
    }

    #[test]
    fn only_notes_and_the_librarys_own_files_are_read_written_or_removed() {
        let root = fresh("kinds");
        fs::create_dir_all(root.join("Folder").join("Empty").join("Deeper")).unwrap();
        fs::write(root.join("Folder").join("Thesis.docx"), b"the person's own").unwrap();
        fs::write(root.join("a.shellnote"), b"note").unwrap();
        let shared = Root::Shared;

        // Another file of the folder is never read, written over, nor removed.
        assert!(read_at(shared, &root, "Folder/Thesis.docx").is_err());
        assert!(write_at(shared, &root, "Folder/Thesis.docx", b"gone").is_err());
        assert!(remove_at(shared, &root, "Folder/Thesis.docx").is_err());
        assert_eq!(fs::read(root.join("Folder").join("Thesis.docx")).unwrap(), b"the person's own");
        // Nothing that could run is written, in the folder or in the library's hidden one.
        for path in ["run.exe", "Folder/start.bat", "a.shellnote.lnk", "desktop.ini", ".shellnote/run.exe", ".shellnote/previews/x.html"] {
            assert!(write_at(shared, &root, path, b"x").is_err(), "{path:?} must not be written");
            assert!(!root.join(path).exists(), "{path:?} was written");
        }
        // A folder that holds a file stays, with all it holds; and the folder chosen itself is never named.
        assert!(remove_at(shared, &root, "Folder").is_err());
        assert!(root.join("Folder").join("Thesis.docx").exists());
        for whole in ["...", ".. ", "."] {
            assert!(remove_at(shared, &root, whole).is_err(), "{whole:?} must not reach the folder itself");
        }
        assert!(root.join("a.shellnote").exists());

        // A note, and the library's own files, as before.
        write_at(shared, &root, "Folder/b.shellnote", b"two").unwrap();
        assert_eq!(read_at(shared, &root, "Folder/b.shellnote").unwrap(), b"two");
        write_at(shared, &root, ".shellnote/previews/n1.webp", b"picture").unwrap();
        assert_eq!(read_at(shared, &root, ".shellnote/previews/n1.webp").unwrap(), b"picture");
        remove_at(shared, &root, "Folder/b.shellnote").unwrap();
        assert!(!root.join("Folder").join("b.shellnote").exists());
        // The library's hidden folder is never removed whole; an empty folder is, with the empty ones in it.
        assert!(remove_at(shared, &root, ".shellnote").is_err());
        remove_at(shared, &root, "Folder/Empty").unwrap();
        assert!(!root.join("Folder").join("Empty").exists());
        remove_at(shared, &root, "not-there.shellnote").unwrap();

        // This device's own copies: its three kinds of file, and no other.
        let own = fresh("kinds-own");
        write_at(Root::Own, &own, "notes/n1.doc.json", b"{}").unwrap();
        write_at(Root::Own, &own, "assets/0a1b2c3d", b"bytes").unwrap();
        assert_eq!(read_at(Root::Own, &own, "notes/n1.doc.json").unwrap(), b"{}");
        assert!(write_at(Root::Own, &own, "run.exe", b"x").is_err());
        assert!(write_at(Root::Own, &own, "notes/n1.exe", b"x").is_err());
        remove_at(Root::Own, &own, "notes/n1.doc.json").unwrap();
        assert!(move_at(Root::Own, &own, "assets/0a1b2c3d", "assets/0a1b2c3e").is_err());

        // The MCP server's place: a note's log is read, and nothing else is; nothing is written, moved or removed.
        let server = fresh("kinds-server");
        fs::create_dir_all(server.join("log")).unwrap();
        fs::create_dir_all(server.join("notes")).unwrap();
        fs::write(server.join("log").join("n1.json"), b"[]").unwrap();
        fs::write(server.join("notes").join("n1.doc.json"), b"{}").unwrap();
        fs::write(server.join("lock"), b"1").unwrap();
        assert_eq!(read_at(Root::Server, &server, "log/n1.json").unwrap(), b"[]");
        for other in ["notes/n1.doc.json", "lock", "device.json", "log/n1.exe", "log/a/n1.json", "copies/n1/1.json"] {
            assert!(read_at(Root::Server, &server, other).is_err(), "{other} was read");
        }
        assert!(read_at(Root::Server, &server, "log/../notes/n1.doc.json").is_err());
        assert!(write_at(Root::Server, &server, "log/n1.json", b"x").is_err());
        assert!(write_at(Root::Server, &server, "log/n2.json", b"x").is_err());
        assert!(remove_at(Root::Server, &server, "log/n1.json").is_err());
        assert!(move_at(Root::Server, &server, "log/n1.json", "log/n2.json").is_err());
        assert_eq!(fs::read(server.join("log").join("n1.json")).unwrap(), b"[]");
        fs::remove_dir_all(&server).unwrap();

        fs::remove_dir_all(&root).unwrap();
        fs::remove_dir_all(&own).unwrap();
    }

    #[test]
    fn a_move_never_takes_another_files_place() {
        let root = fresh("moves");
        let shared = Root::Shared;
        fs::create_dir_all(root.join("Folder")).unwrap();
        fs::write(root.join("a.shellnote"), b"a").unwrap();
        fs::write(root.join("b.shellnote"), b"b").unwrap();
        fs::write(root.join("Folder").join("Thesis.docx"), b"the person's own").unwrap();

        assert!(move_at(shared, &root, "a.shellnote", "b.shellnote").is_err());
        assert_eq!(fs::read(root.join("b.shellnote")).unwrap(), b"b");
        // The same name in other letters is the note itself: renamed.
        move_at(shared, &root, "a.shellnote", "A.shellnote").unwrap();
        // Two names that differ on the disk and read the same in lower case (the Kelvin sign, and k): two files.
        fs::write(root.join("\u{212a}.shellnote"), b"kelvin").unwrap();
        fs::write(root.join("k.shellnote"), b"k").unwrap();
        if fs::read(root.join("k.shellnote")).unwrap() == b"k" && fs::read(root.join("\u{212a}.shellnote")).unwrap() == b"kelvin" {
            assert!(move_at(shared, &root, "\u{212a}.shellnote", "k.shellnote").is_err(), "one note took another's place");
            assert_eq!(fs::read(root.join("k.shellnote")).unwrap(), b"k");
        }
        // Never a file of another kind, to or from; never into or out of the library's hidden folder.
        assert!(move_at(shared, &root, "Folder/Thesis.docx", "Folder/Thesis.shellnote").is_err());
        assert!(move_at(shared, &root, "b.shellnote", "b.exe").is_err());
        assert!(move_at(shared, &root, "b.shellnote", ".shellnote/b.shellnote").is_err());
        assert!(move_at(shared, &root, "Folder", ".shellnote/Folder").is_err());
        assert!(root.join("Folder").join("Thesis.docx").exists() && root.join("b.shellnote").exists());
        // A folder is renamed with what it holds, and a note moves into a folder made on the way.
        move_at(shared, &root, "Folder", "Renamed").unwrap();
        assert!(root.join("Renamed").join("Thesis.docx").exists());
        move_at(shared, &root, "b.shellnote", "New/b.shellnote").unwrap();
        assert_eq!(fs::read(root.join("New").join("b.shellnote")).unwrap(), b"b");
        fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn a_junction_and_a_short_name_lead_nowhere() {
        let base = fresh("links");
        let (root, outside) = (base.join("library"), base.join("outside"));
        fs::create_dir_all(root.join("A folder with a long name")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret.shellnote"), b"secret").unwrap();
        fs::write(root.join("A folder with a long name").join("a.shellnote"), b"a").unwrap();
        // A junction needs no administrator: any program may leave one in a folder it can write to.
        let made = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(root.join("way-out")).arg(&outside).output().unwrap();
        assert!(made.status.success(), "the junction was not made");
        assert!(inside(&root, "way-out").is_err());
        assert!(read_at(Root::Shared, &root, "way-out/secret.shellnote").is_err());
        assert!(write_at(Root::Shared, &root, "way-out/new.shellnote", b"x").is_err());
        assert!(remove_at(Root::Shared, &root, "way-out/secret.shellnote").is_err());
        assert!(outside.join("secret.shellnote").exists() && !outside.join("new.shellnote").exists());
        let mut listed = Vec::new();
        walk(&root, "", 0, &mut listed).unwrap();
        assert!(listed.iter().all(|entry| !entry.path.starts_with("way-out")), "a listing went through the junction");
        // A folder that holds a junction is not empty: removing it would take the junction, never what it leads to.
        assert!(remove_at(Root::Shared, &root, "way-out").is_err());
        // The short form of a long name, where this disk keeps one, is not the name: refused.
        assert!(read_at(Root::Shared, &root, "AFOLDE~1/a.shellnote").is_err());
        assert_eq!(read_at(Root::Shared, &root, "A folder with a long name/a.shellnote").unwrap(), b"a");
        fs::remove_dir(root.join("way-out")).unwrap();
        fs::remove_dir_all(&base).unwrap();
        assert!(!base.exists());
    }

    #[test]
    fn a_header_reads_back_as_the_text_it_stands_for() {
        assert_eq!(unescaped("Caf%C3%A9%2Fnote.shellnote").as_deref(), Some("Café/note.shellnote"));
        assert_eq!(unescaped("50%"), None);
        assert_eq!(unescaped("%ZZ"), None);
    }

    #[test]
    fn a_write_is_whole_and_a_listing_shows_it() {
        let root = fresh("listing");
        fs::create_dir_all(root.join("Folder")).unwrap();
        fs::write(root.join("Folder").join("a.shellnote"), b"one").unwrap();
        let mut out = Vec::new();
        walk(&root, "", 0, &mut out).unwrap();
        let mut paths: Vec<_> = out.iter().map(|entry| (entry.path.clone(), entry.folder, entry.size)).collect();
        paths.sort();
        assert_eq!(paths, vec![("Folder".to_string(), true, 0), ("Folder/a.shellnote".to_string(), false, 3)]);
        rename_over(&root.join("Folder").join("a.shellnote"), &root.join("Folder").join("b.shellnote")).unwrap();
        assert!(root.join("Folder").join("b.shellnote").exists());
        // A write leaves the note and nothing beside it.
        write_at(Root::Shared, &root, "Folder/c.shellnote", b"three").unwrap();
        let names: Vec<_> = fs::read_dir(root.join("Folder")).unwrap().flatten().map(|item| item.file_name().to_string_lossy().into_owned()).collect();
        assert!(names.iter().all(|name| !name.contains(".tmp-")), "{names:?}");
        fs::remove_dir_all(&root).unwrap();
    }
}
