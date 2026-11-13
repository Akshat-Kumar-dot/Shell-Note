//! The key of a hosted AI service (OpenRouter's), kept for the person by Windows itself. The page kept it in the web
//! view's own storage, which lies on the disk as plain text: anyone who could read the disk, a backup of it, or
//! another account's copy of the folder, had the key. Here Windows seals it for this account (its data protection,
//! the same that keeps a browser's saved passwords): the file on the disk is of use to no other account and on no
//! other computer. The page asks for the key when a request is to be sent, as it read its own storage before; a
//! script in the page could ask too, as it could read the storage, which is why the page takes scripts from the app
//! alone (tauri.conf.json).

use std::fs;
use std::path::PathBuf;

use tauri::AppHandle;

/// The longest key kept: a service's key is some tens of characters.
const LONGEST: usize = 512;

/// The file a key is kept in, by the service's name: one of those the app knows, never a name from the page.
fn file(app: &AppHandle, service: &str) -> Result<PathBuf, String> {
    let name = match service {
        "openrouter" => "openrouter.key",
        _ => return Err("There is no such key.".into()),
    };
    Ok(crate::library::data_folder(app)?.join("keys").join(name))
}

/// A key as a service gives one: letters, digits and marks that are seen, no spaces, and not too long.
fn is_key(value: &str) -> bool {
    !value.is_empty() && value.len() <= LONGEST && value.bytes().all(|byte| byte.is_ascii_graphic())
}

/// The key kept for a service; none when none is kept, or when what is kept cannot be opened by this account.
#[tauri::command]
pub fn key_read(app: AppHandle, service: String) -> Result<Option<String>, String> {
    let Ok(sealed) = fs::read(file(&app, &service)?) else { return Ok(None) };
    Ok(opened(&sealed).and_then(|plain| String::from_utf8(plain).ok()).filter(|key| is_key(key)))
}

/// Keep a key for a service, sealed for this account.
#[tauri::command]
pub fn key_keep(app: AppHandle, service: String, value: String) -> Result<(), String> {
    let file = file(&app, &service)?;
    if !is_key(&value) {
        return Err("That is not a key.".into());
    }
    let sealed = sealed(value.as_bytes()).ok_or("Windows could not seal the key.")?;
    if let Some(folder) = file.parent() {
        fs::create_dir_all(folder).map_err(|error| error.to_string())?;
    }
    fs::write(file, sealed).map_err(|error| error.to_string())
}

/// Forget the key kept for a service; nothing happens when none is kept.
#[tauri::command]
pub fn key_forget(app: AppHandle, service: String) -> Result<(), String> {
    match fs::remove_file(file(&app, &service)?) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.to_string()),
        _ => Ok(()),
    }
}

/// What the seal is for, mixed into it: bytes sealed by another program for another use do not open here.
#[cfg(windows)]
const PURPOSE: &[u8] = b"ShellNote: the key of a hosted AI service";

/// Bytes sealed by Windows for this account (CryptProtectData), with no question asked of the person.
#[cfg(windows)]
fn sealed(plain: &[u8]) -> Option<Vec<u8>> {
    protected(plain, true)
}

/// Sealed bytes opened again, by the account that sealed them and no other.
#[cfg(windows)]
fn opened(sealed: &[u8]) -> Option<Vec<u8>> {
    protected(sealed, false)
}

#[cfg(windows)]
fn protected(input: &[u8], seal: bool) -> Option<Vec<u8>> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};

    let from = CRYPT_INTEGER_BLOB { cbData: u32::try_from(input.len()).ok()?, pbData: input.as_ptr() as *mut u8 };
    let purpose = CRYPT_INTEGER_BLOB { cbData: PURPOSE.len() as u32, pbData: PURPOSE.as_ptr() as *mut u8 };
    let mut out = CRYPT_INTEGER_BLOB::default();
    unsafe {
        let done = if seal {
            CryptProtectData(&from, None, Some(&purpose), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        } else {
            CryptUnprotectData(&from, None, Some(&purpose), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        };
        if done.is_err() || out.pbData.is_null() {
            return None;
        }
        // Windows gave the bytes in memory of its own: copied, then given back.
        let bytes = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(out.pbData.cast())));
        Some(bytes)
    }
}

/// Elsewhere there is no such keeper yet: the page keeps the key as it did.
#[cfg(not(windows))]
fn sealed(_plain: &[u8]) -> Option<Vec<u8>> {
    None
}

#[cfg(not(windows))]
fn opened(_sealed: &[u8]) -> Option<Vec<u8>> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_key_is_seen_characters_and_not_too_long() {
        for key in ["made-up-for-this-test-0123", "a", "A_b-c.d/e+f=", &"k".repeat(LONGEST)] {
            assert!(is_key(key), "{key}");
        }
        for other in ["", " ", "two words", "a-line\n", "a-zero\u{0}", "ключ", &"k".repeat(LONGEST + 1)] {
            assert!(!is_key(other), "{other:?}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn a_key_sealed_by_windows_opens_again_and_is_not_on_the_disk_as_written() {
        let key = b"made-up-for-this-test-and-of-no-account";
        let sealed = sealed(key).expect("Windows seals it");
        // What would lie on the disk holds nothing of the key as written.
        assert!(sealed.len() > key.len());
        assert!(!sealed.windows(8).any(|part| key.windows(8).any(|piece| piece == part)));
        assert_eq!(opened(&sealed).as_deref(), Some(&key[..]));
        // Bytes that were never sealed, or were changed since, open as nothing.
        assert!(opened(key).is_none());
        let mut changed = sealed.clone();
        let last = changed.len() - 1;
        changed[last] ^= 0xff;
        assert!(opened(&changed).is_none());
        assert!(opened(&[]).is_none());
    }
}
