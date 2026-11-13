fn main() {
    // The libraries the program names (dwmapi.dll, d3d11.dll, propsys.dll and the rest) are loaded from Windows' own
    // folder only (the linker's /DEPENDENTLOADFLAG, 0x800: search System32). Without it Windows looks first in the
    // folder the program lies in, where a file of the same name would be loaded in its place.
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        println!("cargo:rustc-link-arg-bins=/DEPENDENTLOADFLAG:0x800");
    }
    // The app's own commands, each a permission of its own ("allow-apps-hold"), so a window may call only those its
    // capability lists (capabilities/default.json).
    let commands = tauri_build::AppManifest::new().commands(&[
        "where_running",
        "ready_to_close",
        "size_for_tests",
        "listen",
        "stop_listening",
        "apps_list",
        "apps_hold",
        "apps_place",
        "apps_let_go",
        "apps_cover",
        "apps_icon",
        "apps_picture",
        "apps_picture_stop",
        "apps_pictures_running",
        "apps_place_of",
        "apps_go_to",
        "apps_words_of",
        "apps_read_picture",
        "apps_may_keep_picture",
        "titlebar_snap",
        "library_folder",
        "library_choose",
        "library_forget",
        "library_list",
        "library_info",
        "library_read",
        "library_write",
        "library_move",
        "library_remove",
        "library_make_folder",
        "key_read",
        "key_keep",
        "key_forget",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(commands)).expect("the app's build failed");
}
