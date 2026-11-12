// No console window behind the app in a release build.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // First of all: where Windows looks for a library named by its name alone (lib.rs).
    #[cfg(windows)]
    shellnote_lib::only_known_libraries();
    // Started as the watcher of a ShellNote that holds other programs (apps.rs): that alone, no app.
    #[cfg(windows)]
    if shellnote_lib::run_as_watcher() {
        return;
    }
    shellnote_lib::run()
}
