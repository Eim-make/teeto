use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::Notify;
use ts_rs::TS;

use crate::error::Result;
use crate::overlay::{game_window, Rect};
use crate::tracker::{AppState, ClientStatus};

pub const SHORTCUT: &str = "CommandOrControl+Shift+O";
const LABEL: &str = "widgets";
const WATCH_INTERVAL: Duration = Duration::from_millis(1000);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SegmentKind {
    Champion,
    Kda,
    Farm,
    GoldLead,
    Objectives,
    CoreItems,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Segment {
    pub kind: SegmentKind,
    pub visible: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct WidgetSettings {
    pub enabled: bool,
    pub locked: bool,
    pub opacity: f32,
    pub x: f32,
    pub y: f32,
    pub segments: Vec<Segment>,
}

const ALL_SEGMENTS: [SegmentKind; 6] = [
    SegmentKind::Champion,
    SegmentKind::Kda,
    SegmentKind::Farm,
    SegmentKind::GoldLead,
    SegmentKind::Objectives,
    SegmentKind::CoreItems,
];

impl Default for WidgetSettings {
    fn default() -> Self {
        WidgetSettings {
            enabled: true,
            locked: false,
            opacity: 0.9,
            x: 0.5,
            y: 0.01,
            segments: ALL_SEGMENTS.iter().map(|&kind| Segment { kind, visible: true }).collect(),
        }
    }
}

impl WidgetSettings {
    fn complete(mut self) -> Self {
        let mut seen = Vec::new();
        self.segments.retain(|s| {
            let fresh = !seen.contains(&s.kind);
            seen.push(s.kind);
            fresh
        });
        for kind in ALL_SEGMENTS {
            if !seen.contains(&kind) {
                self.segments.push(Segment { kind, visible: true });
            }
        }
        self.opacity = self.opacity.clamp(0.2, 1.0);
        self.x = self.x.clamp(0.0, 1.0);
        self.y = self.y.clamp(0.0, 0.98);
        self
    }
}

pub struct Widgets {
    file: PathBuf,
    settings: Mutex<WidgetSettings>,
    editing: Mutex<bool>,
    wake: Notify,
}

impl Widgets {
    pub fn load(dir: &std::path::Path) -> Self {
        let file = dir.join("widgets.json");
        let settings = std::fs::read_to_string(&file)
            .ok()
            .and_then(|raw| serde_json::from_str::<WidgetSettings>(&raw).ok())
            .unwrap_or_default()
            .complete();
        Widgets { file, settings: Mutex::new(settings), editing: Mutex::new(false), wake: Notify::new() }
    }

    pub fn settings(&self) -> WidgetSettings {
        self.settings.lock().map(|s| s.clone()).unwrap_or_default()
    }

    pub fn editing(&self) -> bool {
        self.editing.lock().map(|e| *e).unwrap_or(false)
    }
}

pub fn save(app: &AppHandle, settings: WidgetSettings) -> Result<WidgetSettings> {
    let widgets = app.state::<Widgets>();
    let settings = settings.complete();
    std::fs::write(&widgets.file, serde_json::to_string_pretty(&settings)?)?;
    if let Ok(mut s) = widgets.settings.lock() {
        *s = settings.clone();
    }
    app.emit("widget-settings", &settings)?;
    widgets.wake.notify_one();
    Ok(settings)
}

pub fn set_editing(app: &AppHandle, editing: bool) -> Result<()> {
    if let Ok(mut e) = app.state::<Widgets>().editing.lock() {
        *e = editing;
    }
    if let Some(w) = app.get_webview_window(LABEL) {
        w.set_ignore_cursor_events(!editing)?;
        if editing {
            let _ = w.set_focus();
        }
    }
    app.emit("widget-editing", editing)?;
    app.state::<Widgets>().wake.notify_one();
    Ok(())
}

pub fn toggle_editing(app: &AppHandle) {
    let editing = app.state::<Widgets>().editing();
    let _ = set_editing(app, !editing);
}

fn in_game(app: &AppHandle) -> bool {
    matches!(
        app.state::<AppState>().status(),
        ClientStatus::Connected { ref phase, .. } if phase == "InProgress"
    )
}

fn screen(app: &AppHandle) -> Option<Rect> {
    let monitor = app
        .get_webview_window("main")
        .and_then(|w| w.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())?;
    let (pos, size) = (monitor.position(), monitor.size());
    Some(Rect { x: pos.x, y: pos.y, width: size.width, height: size.height })
}

fn target(app: &AppHandle) -> Option<Rect> {
    let widgets = app.state::<Widgets>();
    let editing = widgets.editing();
    let game = (widgets.settings().enabled || editing) && in_game(app);
    game.then(game_window).flatten().or_else(|| editing.then(|| screen(app)).flatten())
}

fn sync(app: &AppHandle) -> Result<()> {
    let Some(rect) = target(app) else {
        if let Some(w) = app.get_webview_window(LABEL) {
            w.hide()?;
        }
        return Ok(());
    };
    let window = match app.get_webview_window(LABEL) {
        Some(w) => w,
        None => WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("widgets.html".into()))
            .title("Teeto widgets")
            .transparent(true)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .resizable(false)
            .shadow(false)
            .visible(false)
            .build()?,
    };
    let position = PhysicalPosition::new(rect.x, rect.y);
    let size = PhysicalSize::new(rect.width, rect.height);
    if window.outer_position().ok() != Some(position) {
        window.set_position(position)?;
    }
    if window.inner_size().ok() != Some(size) {
        window.set_size(size)?;
    }
    if !window.is_visible().unwrap_or(false) {
        window.set_ignore_cursor_events(!app.state::<Widgets>().editing())?;
        window.show()?;
    }
    Ok(())
}

pub async fn watch(app: AppHandle) {
    let mut was_in_game = false;
    loop {
        let widgets = app.state::<Widgets>();
        tokio::select! {
            _ = tokio::time::sleep(WATCH_INTERVAL) => {}
            _ = widgets.wake.notified() => {}
        }
        let now_in_game = in_game(&app);
        if was_in_game && !now_in_game && app.state::<Widgets>().editing() {
            let _ = set_editing(&app, false);
        }
        was_in_game = now_in_game;
        let _ = sync(&app);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fills_in_missing_segments_and_clamps_values() {
        let saved = WidgetSettings {
            enabled: false,
            locked: true,
            opacity: 0.0,
            x: 2.0,
            y: -1.0,
            segments: vec![
                Segment { kind: SegmentKind::Farm, visible: false },
                Segment { kind: SegmentKind::Farm, visible: true },
            ],
        };
        let s = saved.complete();
        assert!(!s.enabled && s.locked);
        assert_eq!((s.opacity, s.x, s.y), (0.2, 1.0, 0.0));
        assert_eq!(s.segments.len(), ALL_SEGMENTS.len());
        assert_eq!(s.segments[0], Segment { kind: SegmentKind::Farm, visible: false });
    }

    #[test]
    fn old_widget_files_fall_back_to_defaults() {
        let old = r#"{"enabled":false,"widgets":[{"kind":"farm","visible":true,"locked":false,"opacity":0.9,"x":0.1,"y":0.2}]}"#;
        let s = serde_json::from_str::<WidgetSettings>(old).unwrap().complete();
        assert!(!s.enabled);
        assert_eq!(s.segments.len(), ALL_SEGMENTS.len());
    }
}
