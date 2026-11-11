//! Other programs inside ShellNote: a program's live picture on its panel, view only. Windows.Graphics.Capture pictures
//! the one window through the graphics chip, as OBS and Teams do. Each new frame (at most 30 a second, none while the
//! window is still) is scaled down to the panel's box and copied into one of two buffers shared with the page once
//! (WebView2's shared buffers, never a new one a frame: one report has WebView2 fail after about 32,000), and a short
//! message names the one just filled. The picture is for when the window itself cannot be seen on the panel: while
//! something of ShellNote covers it (its last picture, where it was), and a program left where it is, elsewhere
//!. Nothing is kept: the two buffers are overwritten, never written to a disk.
//!
//! What the page is told (`desktop.ts`): each buffer once, as WebView2's shared buffer named by
//! `{shellnotePicture: id, buffer: n}`; then a web message per frame naming the buffer just filled, with its width and
//! height; or `closed` when the window closed, or `problem` with its words when the capture failed.

use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Manager, WebviewWindow};
use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2Environment12, ICoreWebView2SharedBuffer, ICoreWebView2_17, COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_ONLY};
use windows::core::{factory, Interface, HSTRING};
use windows::Graphics::Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Graphics::SizeInt32;
use windows::Win32::Foundation::{HMODULE, HWND};
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11DeviceContext, ID3D11Texture2D, D3D11_BOX, D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC,
    D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
use windows::Win32::System::WinRT::Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::UI::WindowsAndMessaging::IsWindow;

/// Frames at most every 33 ms while the picture is seen (30 a second); every 500 ms while the window itself is on the
/// panel, so a last picture is there should something of ShellNote cover it.
const SEEN_EVERY: u32 = 33;
const KEPT_EVERY: u32 = 500;
/// The largest side of a picture, in pixels (an 8K screen's width), and the most pictures at once: a panel shows one
/// program, and a line's mark another for a moment.
const MOST_SIDE: u32 = 8192;
const MOST_LIVE: usize = 8;

/// One window pictured for one ShellNote window.
struct Live {
    /// This picture's own number: a picture of the same window started again is another.
    serial: u64,
    id: i64,
    label: String,
    stop: Arc<AtomicBool>,
    /// The panel's box, its width and height in pixels as one number, read by the capture at each frame.
    size: Arc<AtomicU64>,
    every: Arc<AtomicU32>,
}

static LIVE: Mutex<Vec<Live>> = Mutex::new(Vec::new());
static SERIAL: AtomicU64 = AtomicU64::new(1);

/// The page's two buffers: WebView2's objects, made and closed on ShellNote's own thread only (they are not for
/// another), carried by the capture's thread until it ends.
struct Buffers([ICoreWebView2SharedBuffer; 2]);
unsafe impl Send for Buffers {}

impl Buffers {
    /// Closed, on ShellNote's own thread: the page's views of them end.
    fn close(self) {
        for buffer in self.0 {
            let _ = unsafe { buffer.Close() };
        }
    }
}

/// Where a buffer's bytes are, written by the capture's thread while the buffer lives.
/// Sent to the capture's thread by hand: that thread writes only while `Buffers` lives, closed only after it ends.
#[derive(Clone, Copy)]
struct Memory(*mut u8, usize);
unsafe impl Send for Memory {}

/// Width and height as one number, so the capture never reads the width of one box with the height of another.
const fn packed(width: u32, height: u32) -> u64 {
    ((width as u64) << 32) | height as u64
}

/// Start the live picture of window `id` for this ShellNote window, at most `width` by `height` screen pixels (the
/// panel's box), or change those and how often (`seen`: up to 30 frames a second, else 2) if it runs already.
#[tauri::command]
pub fn apps_picture(window: WebviewWindow, id: i64, width: u32, height: u32, seen: bool) -> Result<(), String> {
    // Windows' handles go between threads as numbers.
    let target = crate::apps::may_picture(id)?.0 as isize;
    let every = if seen { SEEN_EVERY } else { KEPT_EVERY };
    let label = window.label().to_string();
    // The sizes come from the page: kept to what a panel can be, so no buffer is ever asked for that memory cannot give.
    let (width, height) = (width.clamp(1, MOST_SIDE), height.clamp(1, MOST_SIDE));
    {
        let live = LIVE.lock().map_err(|_| "busy")?;
        if let Some(one) = live.iter().find(|one| one.id == id && one.label == label) {
            one.size.store(packed(width, height), Ordering::SeqCst);
            one.every.store(every, Ordering::SeqCst);
            return Ok(());
        }
        // Each picture holds two buffers as large as the screen: a page asking for one of every window is refused.
        if live.len() >= MOST_LIVE {
            return Err("Too many programs are pictured at once.".into());
        }
    }
    let stop = Arc::new(AtomicBool::new(false));
    let size = Arc::new(AtomicU64::new(packed(width, height)));
    let rate = Arc::new(AtomicU32::new(every));
    let serial = SERIAL.fetch_add(1, Ordering::SeqCst);
    // Listed at once, before its buffers exist: a second call for this window finds it and only changes its numbers.
    LIVE.lock().map_err(|_| "busy")?.push(Live { serial, id, label: label.clone(), stop: stop.clone(), size: size.clone(), every: rate.clone() });
    // The largest frame: the screen ShellNote is on, so the buffers are made once, whatever the panel's size later.
    let capacity = screen_of(&window).max(packed_bytes(width, height)).min(packed_bytes(MOST_SIDE, MOST_SIDE));
    let app = window.app_handle().clone();
    // WebView2's buffers are made on ShellNote's own thread; the capture then runs on a thread of its own.
    window
        .with_webview(move |webview| {
            let made = (|| -> windows::core::Result<(Buffers, [Memory; 2])> {
                let environment: ICoreWebView2Environment12 = webview.environment().cast()?;
                let core: ICoreWebView2_17 = unsafe { webview.controller().CoreWebView2()? }.cast()?;
                let make = |n: usize| -> windows::core::Result<(ICoreWebView2SharedBuffer, Memory)> {
                    let buffer = unsafe { environment.CreateSharedBuffer(capacity as u64)? };
                    let mut bytes: *mut u8 = std::ptr::null_mut();
                    unsafe { buffer.Buffer(&mut bytes)? };
                    let told = HSTRING::from(format!(r#"{{"shellnotePicture":{id},"buffer":{n}}}"#));
                    unsafe { core.PostSharedBufferToScript(&buffer, COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_ONLY, &told)? };
                    Ok((buffer, Memory(bytes, capacity)))
                };
                let (first, a) = make(0)?;
                let (second, b) = make(1)?;
                Ok((Buffers([first, second]), [a, b]))
            })();
            match made {
                Ok((buffers, memory)) => {
                    std::thread::spawn(move || capture(target, serial, id, label, app, stop, size, rate, buffers, memory));
                }
                Err(error) => {
                    forget(serial);
                    tell(&app, &label, &format!(r#"{{"shellnotePicture":{id},"problem":{}}}"#, json(&error.message())));
                }
            }
        })
        .map_err(|error| error.to_string())
}

/// Stop the live picture of window `id` for this ShellNote window.
/// Only a flag: the capture sees it after its sleep (500 ms at most), and ends. A new picture of the window may start
/// before that, which is why each has its `serial`.
#[tauri::command]
pub fn apps_picture_stop(window: WebviewWindow, id: i64) {
    stop_where(|one| one.id == id && one.label == window.label());
}

/// How many pictures run, for the checks: none after the panel closes, a reload, or the program closing.
#[tauri::command]
pub fn apps_pictures_running() -> usize {
    LIVE.lock().map(|live| live.len()).unwrap_or(0)
}

/// Every picture of a ShellNote window stopped: its page starts loading again, or it closes (lib.rs).
pub fn host_closing(label: &str) {
    stop_where(|one| one.label == label);
}

fn stop_where(which: impl Fn(&Live) -> bool) {
    if let Ok(mut live) = LIVE.lock() {
        live.retain(|one| {
            if which(one) {
                one.stop.store(true, Ordering::SeqCst);
                false
            } else {
                true
            }
        });
    }
}

/// A picture that ended, out of the list: only itself (stopping the window's picture by its window would stop a new
/// picture of it, started as the old one ended: found 2 November 2026, a program brought onto the panel lost its own).
fn forget(serial: u64) {
    stop_where(|one| one.serial == serial);
}

fn packed_bytes(width: u32, height: u32) -> usize {
    width as usize * height as usize * 4
}

/// The bytes of a picture as large as the screen ShellNote is on.
fn screen_of(window: &WebviewWindow) -> usize {
    let Ok(host) = window.hwnd() else { return packed_bytes(1920, 1080) };
    let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
    let monitor = unsafe { MonitorFromWindow(HWND(host.0 as *mut c_void), MONITOR_DEFAULTTONEAREST) };
    if !unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
        return packed_bytes(1920, 1080);
    }
    let r = info.rcMonitor;
    packed_bytes((r.right - r.left).max(1) as u32, (r.bottom - r.top).max(1) as u32)
}

fn json(text: &str) -> String {
    format!("\"{}\"", text.replace('\\', "\\\\").replace('"', "\\\""))
}

/// A short message to the page of ShellNote window `label`: which buffer was filled, or what went wrong.
fn tell(app: &AppHandle, label: &str, message: &str) {
    let Some(window) = app.get_webview_window(label) else { return };
    let message = HSTRING::from(message);
    let _ = window.with_webview(move |webview| {
        if let Ok(core) = unsafe { webview.controller().CoreWebView2() } {
            let _ = unsafe { core.PostWebMessageAsJson(&message) };
        }
    });
}

/// The capture of one window, on a thread of its own, until it is stopped or the window closes. The buffers end with
/// it, closed on ShellNote's own thread.
#[allow(clippy::too_many_arguments)]
fn capture(target: isize, serial: u64, id: i64, label: String, app: AppHandle, stop: Arc<AtomicBool>, size: Arc<AtomicU64>, every: Arc<AtomicU32>, buffers: Buffers, memory: [Memory; 2]) {
    let target = HWND(target as *mut c_void);
    let ended = (|| -> windows::core::Result<Option<String>> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok()? };
        let mut device3d = None;
        let mut context: Option<ID3D11DeviceContext> = None;
        unsafe { D3D11CreateDevice(None, D3D_DRIVER_TYPE_HARDWARE, HMODULE::default(), D3D11_CREATE_DEVICE_BGRA_SUPPORT, None, D3D11_SDK_VERSION, Some(&mut device3d), None, Some(&mut context))? };
        let (Some(device3d), Some(context)) = (device3d, context) else { return Ok(Some("No graphics device".into())) };
        let dxgi: IDXGIDevice = device3d.cast()?;
        let device: IDirect3DDevice = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi)? }.cast()?;
        let interop = factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
        let item: GraphicsCaptureItem = unsafe { interop.CreateForWindow(target)? };
        let mut pool_size = item.Size()?;
        // Free threaded: this thread has no message loop, and the other kind of pool needs a dispatcher queue on it.
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(&device, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, pool_size)?;
        let session = pool.CreateCaptureSession(&item)?;
        // No yellow border round the program (allowed for an ordinary app, the spike found), no pointer drawn in.
        let _ = session.SetIsBorderRequired(false);
        let _ = session.SetIsCursorCaptureEnabled(false);
        session.StartCapture()?;
        let mut staging: Option<(ID3D11Texture2D, u32, u32)> = None;
        let mut next = 0usize;
        let mut ended = None;
        while !stop.load(Ordering::SeqCst) {
            // Polled, the sleep being the rate. Windows has a frame only when the window's picture changed, so a still
            // window costs a look at the pool and nothing else.
            std::thread::sleep(Duration::from_millis(every.load(Ordering::SeqCst) as u64));
            // Only the newest frame: older ones are passed over.
            let mut newest = None;
            while let Ok(frame) = pool.TryGetNextFrame() {
                newest = Some(frame);
            }
            let Some(frame) = newest else {
                if !unsafe { IsWindow(Some(target)) }.as_bool() {
                    ended = Some("closed".to_string());
                    break;
                }
                continue;
            };
            let content = frame.ContentSize()?;
            if content.Width != pool_size.Width || content.Height != pool_size.Height {
                // The window was resized: the next frames come at its new size.
                pool_size = SizeInt32 { Width: content.Width.max(1), Height: content.Height.max(1) };
                pool.Recreate(&device, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, pool_size)?;
            }
            let texture: ID3D11Texture2D = unsafe { frame.Surface()?.cast::<IDirect3DDxgiInterfaceAccess>()?.GetInterface()? };
            let mut described = D3D11_TEXTURE2D_DESC::default();
            unsafe { texture.GetDesc(&mut described) };
            // This frame may still be in a texture of the old size: never read past it.
            let width = (content.Width.max(1) as u32).min(described.Width);
            let height = (content.Height.max(1) as u32).min(described.Height);
            // The processor cannot read the graphics chip's texture: it is copied into a "staging" one, which can be
            // mapped. That one is made again only when the size changes.
            if staging.as_ref().is_none_or(|(_, w, h)| *w != width || *h != height) {
                let wanted = D3D11_TEXTURE2D_DESC {
                    Width: width,
                    Height: height,
                    MipLevels: 1,
                    ArraySize: 1,
                    Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                    SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                    Usage: D3D11_USAGE_STAGING,
                    CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
                    ..Default::default()
                };
                let mut made = None;
                unsafe { device3d.CreateTexture2D(&wanted, None, Some(&mut made))? };
                staging = made.map(|texture| (texture, width, height));
            }
            let Some((copy, _, _)) = staging.as_ref() else { continue };
            let region = D3D11_BOX { left: 0, top: 0, front: 0, right: width, bottom: height, back: 1 };
            unsafe { context.CopySubresourceRegion(copy, 0, 0, 0, 0, &texture, 0, Some(&region)) };
            // Given back to the pool now: the copy holds all that is needed.
            drop(frame);
            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            unsafe { context.Map(copy, 0, D3D11_MAP_READ, 0, Some(&mut mapped))? };
            let wanted = size.load(Ordering::SeqCst);
            let (box_width, box_height) = ((wanted >> 32) as u32, wanted as u32);
            let (out_width, out_height) = fit(width, height, box_width, box_height, memory[next].1);
            // `RowPitch`, not the width times 4: Windows may pad each row.
            let source = unsafe { std::slice::from_raw_parts(mapped.pData as *const u8, mapped.RowPitch as usize * height as usize) };
            let target_bytes = unsafe { std::slice::from_raw_parts_mut(memory[next].0, packed_bytes(out_width, out_height)) };
            scale(source, mapped.RowPitch as usize, width, height, target_bytes, out_width, out_height);
            unsafe { context.Unmap(copy, 0) };
            tell(&app, &label, &format!(r#"{{"shellnotePicture":{id},"buffer":{next},"width":{out_width},"height":{out_height}}}"#));
            // The other buffer next: the page has just been told to read this one.
            next ^= 1;
        }
        let _ = session.Close();
        let _ = pool.Close();
        Ok(ended)
    })();
    match ended {
        Ok(Some(why)) if why == "closed" => tell(&app, &label, &format!(r#"{{"shellnotePicture":{id},"closed":true}}"#)),
        Ok(Some(why)) => tell(&app, &label, &format!(r#"{{"shellnotePicture":{id},"problem":{}}}"#, json(&why))),
        Ok(None) => {}
        Err(error) => tell(&app, &label, &format!(r#"{{"shellnotePicture":{id},"problem":{}}}"#, json(&error.message()))),
    }
    forget(serial);
    // The buffers closed on ShellNote's own thread, after the last frame was written.
    let _ = app.run_on_main_thread(move || buffers.close());
}

/// The largest size within the panel's box with the window's shape, never larger than the window itself, and never
/// more bytes than a buffer holds.
fn fit(width: u32, height: u32, box_width: u32, box_height: u32, capacity: usize) -> (u32, u32) {
    let (w, h) = (width.max(1) as f64, height.max(1) as f64);
    let mut scale = (box_width.max(1) as f64 / w).min(box_height.max(1) as f64 / h).min(1.0);
    let room = (capacity / 4) as f64;
    if w * h * scale * scale > room {
        scale = (room / (w * h)).sqrt();
    }
    let (mut out_width, mut out_height) = (((w * scale).floor() as u32).max(1), ((h * scale).floor() as u32).max(1));
    // A side brought up to one pixel may have passed the room: the other gives way, so the bytes written always fit.
    while out_width as usize * out_height as usize > capacity / 4 && (out_width > 1 || out_height > 1) {
        if out_width >= out_height {
            out_width = (out_width / 2).max(1);
        } else {
            out_height = (out_height / 2).max(1);
        }
    }
    (out_width, out_height)
}

/// Scaled down by averaging each area of Windows' blue, green, red and alpha into one pixel of red, green, blue and
/// alpha, as the page's canvas takes them.
fn scale(source: &[u8], pitch: usize, width: u32, height: u32, target: &mut [u8], out_width: u32, out_height: u32) {
    let (width, height, out_width, out_height) = (width as usize, height as usize, out_width as usize, out_height as usize);
    for y in 0..out_height {
        // Each pixel out averages its own area of the source, at least one source pixel wide and high.
        let top = y * height / out_height;
        let bottom = ((y + 1) * height / out_height).max(top + 1).min(height);
        for x in 0..out_width {
            let left = x * width / out_width;
            let right = ((x + 1) * width / out_width).max(left + 1).min(width);
            let mut sum = [0u32; 4];
            for row in top..bottom {
                let line = &source[row * pitch..];
                for column in left..right {
                    let pixel = &line[column * 4..column * 4 + 4];
                    for (total, value) in sum.iter_mut().zip(pixel) {
                        *total += *value as u32;
                    }
                }
            }
            let count = ((bottom - top) * (right - left)) as u32;
            let out = &mut target[(y * out_width + x) * 4..(y * out_width + x) * 4 + 4];
            out[0] = (sum[2] / count) as u8;
            out[1] = (sum[1] / count) as u8;
            out[2] = (sum[0] / count) as u8;
            out[3] = (sum[3] / count) as u8;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_picture_fits_the_panel_with_its_shape_and_never_grows() {
        assert_eq!(fit(1600, 900, 800, 800, usize::MAX), (800, 450));
        assert_eq!(fit(400, 300, 1000, 1000, usize::MAX), (400, 300));
        // Never more bytes than a buffer holds.
        let (w, h) = fit(1000, 1000, 1000, 1000, 100 * 100 * 4);
        assert!(w as usize * h as usize * 4 <= 100 * 100 * 4);
        // A window one pixel wide and very tall, a box of nothing, a buffer of a few pixels: still never past it.
        for (width, height, box_width, box_height, capacity) in [(1, 60_000, 1, 60_000, 64), (60_000, 1, 60_000, 1, 64), (3, 3, 0, 0, 4), (16_384, 16_384, u32::MAX, u32::MAX, 4 * 7)] {
            let (w, h) = fit(width, height, box_width, box_height, capacity);
            assert!(w >= 1 && h >= 1 && w as usize * h as usize * 4 <= capacity, "{width} by {height} into {capacity} bytes gave {w} by {h}");
        }
    }

    #[test]
    fn scaled_by_averaging_into_red_green_blue_alpha() {
        // Two by two, Windows' blue-green-red-alpha: blue, red, blue, red; one pixel out: half each, as red, green, blue.
        let source = [255, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255, 0, 0, 255, 255];
        let mut out = [0u8; 4];
        scale(&source, 8, 2, 2, &mut out, 1, 1);
        assert_eq!(out, [127, 0, 127, 255]);
    }
}
