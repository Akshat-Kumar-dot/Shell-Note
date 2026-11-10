//! The library kept in a folder the person chooses, such as one a cloud service copies between their devices: the
//! files the page asks for (apps/web/src/library/folder/desktopFiles.ts). The page never names a folder: it says
//! "shared" (the folder chosen here, in a dialog of the system's, and kept on this side) or "own" (this device's own
//! copies, in the app's data folder), and a path inside it. A path that would leave the folder, by ".." or a drive or
//! through a link to elsewhere, is refused, so nothing the page is given can read or write outside what the person chose.
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
    let named = std::env::var_os("SHELLNOTE_LIBRARY_FOLDER").map(PathBuf::from).filter(|path| !path.as_os_str().is_empty());
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

fn root(app: &AppHandle, which: &str) -> Result<PathBuf, String> {
    let shared = chosen(app).ok_or("No folder is chosen for the library.")?;
    match which {
        "shared" => Ok(shared),
        "own" => {
            let own = data_folder(app)?.join("library").join(name_of(&shared));
            fs::create_dir_all(&own).map_err(|error| error.to_string())?;
            Ok(own)
        }
        _ => Err("There is no such place.".into()),
    }
}

/// The place a path names inside a folder. Refused: an empty part, "." and "..", a drive or a stream (":"), a
/// backslash, a control character, and any part that is a link to elsewhere.
fn inside(root: &Path, path: &str) -> Result<PathBuf, String> {
    const OUTSIDE: &str = "That path is not inside the library's folder.";
    if path.is_empty() || path.len() > 2048 {
        return Err(OUTSIDE.into());
    }
    let mut full = root.to_path_buf();
    for part in path.split('/') {
        if part.is_empty() || part == "." || part == ".." || part.chars().any(|c| c == '\\' || c == ':' || c < ' ') {
            return Err(OUTSIDE.into());
        }
        full.push(part);
        if fs::symlink_metadata(&full).map(|meta| meta.file_type().is_symlink()).unwrap_or(false) {
            return Err(OUTSIDE.into());
        }
    }
    Ok(full)
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
    let file = choice_file(&app)?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(&file, folder.to_string_lossy().as_bytes()).map_err(|error| error.to_string())?;
    Ok(Some(folder.to_string_lossy().into_owned()))
}

/// Keep the notes in the app again: the folder and all in it stay as they are.
#[tauri::command]
pub fn library_forget(app: AppHandle) -> Result<(), String> {
    match fs::remove_file(choice_file(&app)?) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.to_string()),
        _ => Ok(()),
    }
}

/// Everything in the folder, at any depth.
#[tauri::command]
pub async fn library_list(app: AppHandle, root_name: String) -> Result<Vec<Entry>, String> {
    let folder = root(&app, &root_name)?;
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
    let full = inside(&root(&app, &root_name)?, &path)?;
    Ok(fs::symlink_metadata(full).ok().map(|meta| entry(path, &meta)))
}

/// A file's bytes. A file the cloud service keeps online only is fetched as it is read, which may take a while.
#[tauri::command]
pub async fn library_read(app: AppHandle, root_name: String, path: String) -> Result<tauri::ipc::Response, String> {
    let full = inside(&root(&app, &root_name)?, &path)?;
    let read = move || {
        let size = fs::metadata(&full).map_err(|error| error.to_string())?.len();
        if size > MAX_BYTES {
            return Err("That file is too large to be a note.".to_string());
        }
        fs::read(&full).map_err(|error| error.to_string())
    };
    let bytes = tauri::async_runtime::spawn_blocking(read).await.map_err(|error| error.to_string())??;
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

/// Write a file whole or not at all: the bytes are the request's body, the place in its `x-root` and `x-path`.
#[tauri::command]
pub async fn library_write(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("Nothing to write.".into()) };
    let header = |name: &str| request.headers().get(name).and_then(|value| value.to_str().ok()).and_then(unescaped);
    let (Some(root_name), Some(path)) = (header("x-root"), header("x-path")) else { return Err("No place to write to.".into()) };
    if bytes.len() as u64 > MAX_BYTES {
        return Err("That is too large to be a note.".into());
    }
    let full = inside(&root(&app, &root_name)?, &path)?;
    let bytes = bytes.clone();
    let write = move || -> Result<(), String> {
        let folder = full.parent().ok_or("No folder to write in.")?;
        fs::create_dir_all(folder).map_err(|error| error.to_string())?;
        if full.is_dir() {
            return Err("A folder is there under that name.".into());
        }
        let name = full.file_name().and_then(|name| name.to_str()).ok_or("No name to write under.")?;
        let temporary = folder.join(format!(".{name}.tmp-{}-{}", std::process::id(), WRITES.fetch_add(1, Ordering::Relaxed)));
        let written = (|| -> std::io::Result<()> {
            let mut file = fs::File::create(&temporary)?;
            file.write_all(&bytes)?;
            // On the disk before it takes the note's name: a power cut then leaves the old note, never half of the new.
            file.sync_all()?;
            drop(file);
            rename_over(&temporary, &full)
        })();
        if written.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        written.map_err(|error| error.to_string())
    };
    tauri::async_runtime::spawn_blocking(write).await.map_err(|error| error.to_string())?
}

/// Rename a file or a folder, or move it; never over something that is there.
#[tauri::command]
pub fn library_move(app: AppHandle, root_name: String, from: String, to: String) -> Result<(), String> {
    let folder = root(&app, &root_name)?;
    let (source, target) = (inside(&folder, &from)?, inside(&folder, &to)?);
    // The same name in other letters (Notes, notes) is the same place on Windows: a rename of the item itself.
    if fs::symlink_metadata(&target).is_ok() && from.to_lowercase() != to.to_lowercase() {
        return Err(format!("{to} is there already."));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    rename_over(&source, &target).map_err(|error| error.to_string())
}

/// Remove a file, or a folder with all it holds; nothing happens when it is not there.
#[tauri::command]
pub fn library_remove(app: AppHandle, root_name: String, path: String) -> Result<(), String> {
    let full = inside(&root(&app, &root_name)?, &path)?;
    let removed = match fs::symlink_metadata(&full) {
        Err(_) => return Ok(()),
        Ok(meta) if meta.is_dir() => fs::remove_dir_all(&full),
        Ok(_) => fs::remove_file(&full),
    };
    removed.map_err(|error| error.to_string())
}

/// Make a folder, and those on the way to it.
#[tauri::command]
pub fn library_make_folder(app: AppHandle, root_name: String, path: String) -> Result<(), String> {
    fs::create_dir_all(inside(&root(&app, &root_name)?, &path)?).map_err(|error| error.to_string())
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

    #[test]
    fn a_path_never_leaves_the_folder() {
        let root = std::env::temp_dir();
        for bad in ["", ".", "..", "a/../b", "/a", "a//b", "a/", "C:/x", "a\\b", "a:b", "a/\u{1}"] {
            assert!(inside(&root, bad).is_err(), "{bad:?} should be refused");
        }
        assert_eq!(inside(&root, "Notes/My note.shellnote").unwrap(), root.join("Notes").join("My note.shellnote"));
    }

    #[test]
    fn a_header_reads_back_as_the_text_it_stands_for() {
        assert_eq!(unescaped("Caf%C3%A9%2Fnote.shellnote").as_deref(), Some("Café/note.shellnote"));
        assert_eq!(unescaped("50%"), None);
        assert_eq!(unescaped("%ZZ"), None);
    }

    #[test]
    fn a_write_is_whole_and_a_listing_shows_it() {
        let root = std::env::temp_dir().join(format!("shellnote-library-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("Folder")).unwrap();
        fs::write(root.join("Folder").join("a.shellnote"), b"one").unwrap();
        let mut out = Vec::new();
        walk(&root, "", 0, &mut out).unwrap();
        let mut paths: Vec<_> = out.iter().map(|entry| (entry.path.clone(), entry.folder, entry.size)).collect();
        paths.sort();
        assert_eq!(paths, vec![("Folder".to_string(), true, 0), ("Folder/a.shellnote".to_string(), false, 3)]);
        rename_over(&root.join("Folder").join("a.shellnote"), &root.join("Folder").join("b.shellnote")).unwrap();
        assert!(root.join("Folder").join("b.shellnote").exists());
        fs::remove_dir_all(&root).unwrap();
    }
}
