//! ShellNote's own title bar on Windows. The
//! window is made without Windows' title bar (lib.rs) and the page draws the bar, with its minimise, maximise and close.
//! What the page cannot do: Windows 11 offers its snap layouts only where a window answers "maximise button" to Windows'
//! hit test (`WM_NCHITTEST` gives `HTMAXBUTTON`, Microsoft's rule for custom title bars), and the page's own window
//! answers for the page. So a small child window of ShellNote', never painted, lies exactly over the page's maximise
//! button and answers so: its press maximises or restores ShellNote, and its hover is told to the page (the event
//! "titlebar": "hover", "leave", "press"), for the button's look.

use std::ffi::c_void;
use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::{TrackMouseEvent, TME_LEAVE, TME_NONCLIENT, TRACKMOUSEEVENT};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, GetAncestor, IsZoomed, LoadCursorW, RegisterClassW, SetWindowPos, ShowWindow, GA_ROOT, HTMAXBUTTON, HWND_TOP, IDC_ARROW, SWP_NOACTIVATE, SWP_SHOWWINDOW, SW_HIDE,
    SW_MAXIMIZE, SW_RESTORE, WINDOW_EX_STYLE, WM_NCHITTEST, WM_NCLBUTTONDBLCLK, WM_NCLBUTTONDOWN, WM_NCLBUTTONUP, WM_NCMOUSELEAVE, WM_NCMOUSEMOVE, WNDCLASSW, WS_CHILD, WS_CLIPSIBLINGS,
};

const CLASS: PCWSTR = w!("shellnote-snap");

/// The maximise button's box, in the screen's pixels from the page's top left (the element's box times the page's
/// `devicePixelRatio`, as for a program's panel).
#[derive(serde::Deserialize, Clone, Copy)]
pub struct Area {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

static APP: OnceLock<AppHandle> = OnceLock::new();
/// The snap window over each ShellNote window's maximise button: the window's label, and the snap window.
static SNAPS: Mutex<Vec<(String, isize)>> = Mutex::new(Vec::new());
/// The snap window the pointer is over, if any: its hover is told once, not at every move.
static HOVERED: AtomicIsize = AtomicIsize::new(0);

/// Put the snap window over the page's maximise button (made the first time), or hide it (no box: full screen, or no
/// button on the page).
#[tauri::command]
pub fn titlebar_snap(window: WebviewWindow, area: Option<Area>) -> Result<(), String> {
    let _ = APP.set(window.app_handle().clone());
    let parent = HWND(window.hwnd().map_err(|error| error.to_string())?.0 as *mut c_void);
    let label = window.label().to_string();
    let known = SNAPS.lock().map_err(|_| "busy")?.iter().find(|(l, _)| *l == label).map(|&(_, snap)| snap);
    let snap = match known {
        Some(snap) => HWND(snap as *mut c_void),
        None => {
            let snap = create(parent)?;
            SNAPS.lock().map_err(|_| "busy")?.push((label, snap.0 as isize));
            snap
        }
    };
    unsafe {
        match area {
            // Above the page's own window, its sibling: the pointer over the button reaches it first.
            Some(a) => SetWindowPos(snap, Some(HWND_TOP), a.x.round() as i32, a.y.round() as i32, a.width.round() as i32, a.height.round() as i32, SWP_NOACTIVATE | SWP_SHOWWINDOW).map_err(|error| error.to_string())?,
            None => {
                let _ = ShowWindow(snap, SW_HIDE);
            }
        }
    }
    Ok(())
}

/// A snap window, a child of ShellNote's window: no paint, no background, so the page's button shows through.
fn create(parent: HWND) -> Result<HWND, String> {
    static REGISTERED: OnceLock<bool> = OnceLock::new();
    let instance = unsafe { GetModuleHandleW(None) }.map_err(|error| error.to_string())?;
    REGISTERED.get_or_init(|| {
        let class = WNDCLASSW { lpfnWndProc: Some(snap_proc), hInstance: instance.into(), lpszClassName: CLASS, hCursor: unsafe { LoadCursorW(None, IDC_ARROW) }.unwrap_or_default(), ..Default::default() };
        unsafe { RegisterClassW(&class) != 0 }
    });
    unsafe { CreateWindowExW(WINDOW_EX_STYLE(0), CLASS, PCWSTR::null(), WS_CHILD | WS_CLIPSIBLINGS, 0, 0, 0, 0, Some(parent), None, Some(instance.into()), None) }.map_err(|error| error.to_string())
}

fn tell(snap: HWND, what: &str) {
    let label = SNAPS.lock().ok().and_then(|snaps| snaps.iter().find(|(_, s)| *s == snap.0 as isize).map(|(label, _)| label.clone()));
    if let (Some(app), Some(label)) = (APP.get(), label) {
        let _ = app.emit_to(label.as_str(), "titlebar", what);
    }
}

unsafe extern "system" fn snap_proc(snap: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match message {
        // Windows' question that brings the snap layouts: here is the maximise button.
        WM_NCHITTEST => LRESULT(HTMAXBUTTON as isize),
        WM_NCMOUSEMOVE => {
            if HOVERED.swap(snap.0 as isize, Ordering::SeqCst) != snap.0 as isize {
                let mut track = TRACKMOUSEEVENT { cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32, dwFlags: TME_LEAVE | TME_NONCLIENT, hwndTrack: snap, dwHoverTime: 0 };
                let _ = unsafe { TrackMouseEvent(&mut track) };
                tell(snap, "hover");
            }
            unsafe { DefWindowProcW(snap, message, wparam, lparam) }
        }
        WM_NCMOUSELEAVE => {
            HOVERED.store(0, Ordering::SeqCst);
            tell(snap, "leave");
            unsafe { DefWindowProcW(snap, message, wparam, lparam) }
        }
        // The press is the page's button's: shown pressed, and maximise or restore when let go over it.
        WM_NCLBUTTONDOWN | WM_NCLBUTTONDBLCLK => {
            tell(snap, "press");
            LRESULT(0)
        }
        WM_NCLBUTTONUP => {
            let top = unsafe { GetAncestor(snap, GA_ROOT) };
            let _ = unsafe { ShowWindow(top, if IsZoomed(top).as_bool() { SW_RESTORE } else { SW_MAXIMIZE }) };
            tell(snap, "hover");
            LRESULT(0)
        }
        _ => unsafe { DefWindowProcW(snap, message, wparam, lparam) },
    }
}
