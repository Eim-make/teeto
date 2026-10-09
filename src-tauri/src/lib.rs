mod augments;
mod augscan;
mod badges;
mod champselect;
mod commands;
mod data;
mod error;
mod harvest;
mod ingame;
mod lcu;
mod live;
mod lp;
mod matches;
mod ocr;
mod overlay;
mod runes;
mod store;
mod tracker;

use std::sync::Arc;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use store::Store;
use tracker::{AppState, Shared, Tracker};

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Open Teeto", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Teeto")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn setup_hotkey(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(err) = overlay::scan(&app).await {
                            let _ = app.emit("augment-scan-error", err.to_string());
                        }
                    });
                }
            })
            .build(),
    )?;
    app.global_shortcut().register(overlay::SHORTCUT)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let store = Arc::new(Store::open(&dir.join("teeto.db"))?);
            let shared = Arc::new(Shared::default());
            app.manage(AppState { store: store.clone(), shared: shared.clone(), scanner: Default::default(), harvester: Default::default() });

            let tracker = Tracker::new(app.handle().clone(), store, shared);
            tauri::async_runtime::spawn(tracker.run());

            setup_tray(app.handle())?;
            setup_hotkey(app.handle())?;
            tauri::async_runtime::spawn(overlay::watch(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::client_status,
            commands::ranks,
            commands::lp_history,
            commands::matches,
            commands::match_detail,
            commands::data_file,
            commands::import_runes,
            commands::live_game,
            commands::champ_select,
            commands::set_spells,
            commands::mayhem_augments,
            commands::in_game,
            commands::scan_augments,
            commands::harvest_mayhem,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start Teeto");
}
