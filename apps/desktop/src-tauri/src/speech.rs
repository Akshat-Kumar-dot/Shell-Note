//! The AI box's microphone inside the app, on Windows. WebView2 has the
//! browser's speech recognition, but not the online service Edge sends the
//! voice to: it hears, then fails with "network" (found 18 October 2026). So
//! the app asks Windows' own recognizer, its dictation, which is online as
//! Edge's is (Settings → Privacy & security → Speech), and tells the page what
//! is heard as the browser's would (apps/web/src/desktop.ts): first a start,
//! then what is heard so far as it grows, then the last of it, then an end;
//! or an error, named as the browser names it, then an end.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::ipc::Channel;
use windows::core::{Ref, HSTRING};
use windows::Foundation::{TimeSpan, TypedEventHandler};
use windows::Globalization::Language;
use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
use windows::Media::SpeechRecognition::{SpeechRecognitionHypothesisGeneratedEventArgs, SpeechRecognitionResultStatus, SpeechRecognizer};

/// What the page is told, as the browser's speech recognition tells it (its events, by `kind`).
#[derive(Clone, serde::Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Heard {
    Start,
    /// What has been heard so far; `last` once it is all.
    Result { text: String, last: bool },
    /// Named as the browser names its errors: "not-allowed", "no-speech", "network", …
    Error { error: String },
    End,
}

/// The recognizer listening now, and what it has heard so far, for Stop.
struct Listening {
    recognizer: SpeechRecognizer,
    heard: String,
    /// Stop was pressed: what was heard so far is kept (the browser's stop), or, aborted, dropped.
    stopped: Option<bool>,
}

static NOW: Mutex<Option<Listening>> = Mutex::new(None);

/// How long it waits for the person to start speaking, and how long a pause ends the request, about as the browser's.
const WAIT_FOR_SPEECH: Duration = Duration::from_secs(8);
const PAUSE_ENDS: Duration = Duration::from_millis(1200);

/// Listen for one request in `lang` ("en-IN"), or the language Windows speaks when it has no recognizer for that one.
///
/// The microphone is the person's: it opens only for the window they are in (their press on the microphone button is
/// in the window in front), never for one in the background, and for one request at a time, with the one being
/// stopped beside it at most. A page gone wrong cannot keep it open unseen, nor start a hundred listeners.
#[tauri::command]
pub fn listen(window: tauri::WebviewWindow, lang: String, events: Channel<Heard>) {
    // Windows' own word on which window is in front: the web view inside the window holds the keyboard, the window
    // itself is the one in front.
    let in_front = window.hwnd().is_ok_and(|own| unsafe { GetForegroundWindow() }.0 as isize == own.0 as isize);
    if !in_front || LISTENERS.load(Ordering::SeqCst) >= MOST_LISTENERS {
        // Ended as a request the person dropped: nothing heard, and no fault to show.
        let _ = events.send(Heard::Error { error: "aborted".into() });
        let _ = events.send(Heard::End);
        return;
    }
    LISTENERS.fetch_add(1, Ordering::SeqCst);
    std::thread::spawn(move || {
        if let Err(error) = hear(&lang, &events) {
            let _ = events.send(Heard::Error { error });
        }
        LISTENERS.fetch_sub(1, Ordering::SeqCst);
        let _ = events.send(Heard::End);
    });
}

/// How many requests are being listened for now, and the most at once: the one being spoken, and one just stopped
/// that Windows has not yet let go of.
static LISTENERS: AtomicUsize = AtomicUsize::new(0);
const MOST_LISTENERS: usize = 2;

/// Stop listening: `keep`, what was heard so far is the request (the browser's stop); else it is dropped (abort).
#[tauri::command]
pub fn stop_listening(keep: bool) {
    let Ok(mut now) = NOW.lock() else { return };
    if let Some(listening) = now.as_mut() {
        listening.stopped = Some(keep);
        // Not waited for here: the listening thread ends once it has stopped.
        let _ = listening.recognizer.StopRecognitionAsync();
    }
}

/// A recognizer ready for dictation (no constraints added: whatever is said), in `lang` when Windows can hear it,
/// else in the language Windows itself speaks.
fn recognizer(lang: &str) -> Result<SpeechRecognizer, String> {
    let ready = |recognizer: SpeechRecognizer| -> Result<SpeechRecognizer, String> {
        let compiled = recognizer.CompileConstraintsAsync().and_then(|op| op.join()).map_err(|error| named(&error))?;
        match compiled.Status().map_err(|error| named(&error))? {
            SpeechRecognitionResultStatus::Success => Ok(recognizer),
            status => Err(failed(status)),
        }
    };
    let asked = Language::CreateLanguage(&HSTRING::from(lang)).and_then(|language| SpeechRecognizer::Create(&language));
    match asked.map_err(|error| named(&error)).and_then(ready) {
        Ok(recognizer) => Ok(recognizer),
        Err(error) if error == "language-not-supported" => ready(SpeechRecognizer::new().map_err(|error| named(&error))?),
        Err(error) => Err(error),
    }
}

fn hear(lang: &str, events: &Channel<Heard>) -> Result<(), String> {
    let recognizer = recognizer(lang)?;
    if let Ok(timeouts) = recognizer.Timeouts() {
        let _ = timeouts.SetInitialSilenceTimeout(TimeSpan::from(WAIT_FOR_SPEECH));
        let _ = timeouts.SetEndSilenceTimeout(TimeSpan::from(PAUSE_ENDS));
    }
    let growing = events.clone();
    recognizer
        .HypothesisGenerated(&TypedEventHandler::new(move |_, args: Ref<SpeechRecognitionHypothesisGeneratedEventArgs>| {
            if let Some(text) = args.as_ref().and_then(|args| args.Hypothesis().ok()).and_then(|h| h.Text().ok()) {
                let text = text.to_string();
                if let Ok(mut now) = NOW.lock() {
                    if let Some(listening) = now.as_mut() {
                        listening.heard.clone_from(&text);
                    }
                }
                let _ = growing.send(Heard::Result { text, last: false });
            }
            Ok(())
        }))
        .map_err(|error| named(&error))?;
    if let Ok(mut now) = NOW.lock() {
        *now = Some(Listening { recognizer: recognizer.clone(), heard: String::new(), stopped: None });
    }
    let _ = events.send(Heard::Start);
    let result = recognizer.RecognizeAsync().and_then(|op| op.join());
    let listening = NOW.lock().ok().and_then(|mut now| now.take());
    let (heard, stopped) = listening.map(|l| (l.heard, l.stopped)).unwrap_or_default();
    let _ = recognizer.Close();
    match stopped {
        // Aborted: nothing more is said.
        Some(false) => return Ok(()),
        // Stopped: what was heard so far is the request.
        Some(true) => {
            if !heard.is_empty() {
                let _ = events.send(Heard::Result { text: heard, last: true });
            }
            return Ok(());
        }
        None => {}
    }
    let result = result.map_err(|error| named(&error))?;
    let status = result.Status().map_err(|error| named(&error))?;
    if status != SpeechRecognitionResultStatus::Success {
        return Err(failed(status));
    }
    let text = result.Text().map(|t| t.to_string()).unwrap_or_default();
    if text.is_empty() {
        return Err("no-speech".into());
    }
    let _ = events.send(Heard::Result { text, last: true });
    Ok(())
}

/// A result that is not a success, named as the browser names its errors.
fn failed(status: SpeechRecognitionResultStatus) -> String {
    match status {
        SpeechRecognitionResultStatus::TimeoutExceeded => "no-speech",
        SpeechRecognitionResultStatus::UserCanceled => "aborted",
        SpeechRecognitionResultStatus::NetworkFailure => "network",
        SpeechRecognitionResultStatus::MicrophoneUnavailable | SpeechRecognitionResultStatus::AudioQualityFailure => "audio-capture",
        SpeechRecognitionResultStatus::TopicLanguageNotSupported | SpeechRecognitionResultStatus::GrammarLanguageMismatch => "language-not-supported",
        _ => "unknown",
    }
    .into()
}

/// A Windows error, named as the browser names its errors; the code itself when it is none of those.
fn named(error: &windows::core::Error) -> String {
    /// Online speech recognition is off (Settings → Privacy & security → Speech).
    const PRIVACY_POLICY_NOT_ACCEPTED: u32 = 0x8004_5509;
    /// The microphone is off for desktop apps (Settings → Privacy & security → Microphone).
    const ACCESS_DENIED: u32 = 0x8007_0005;
    /// No recognizer for the language asked for (its speech pack not installed).
    const RECOGNIZER_NOT_FOUND: u32 = 0x8004_503A;
    match error.code().0 as u32 {
        PRIVACY_POLICY_NOT_ACCEPTED => "service-not-allowed".into(),
        ACCESS_DENIED => "not-allowed".into(),
        RECOGNIZER_NOT_FOUND => "language-not-supported".into(),
        code => format!("windows {code:#010x}"),
    }
}
