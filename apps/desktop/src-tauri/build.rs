fn main() {
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
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(commands)).expect("the app's build failed");
}
