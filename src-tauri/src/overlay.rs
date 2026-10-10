use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use image::RgbaImage;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::OnceCell;
use ts_rs::TS;

use crate::augscan::{resolve, title_region, Found, Library, Meta, Slot, MATCH_THRESHOLD};
use crate::error::{Error, Result};
use crate::tracker::AppState;

const AUGMENTS_JSON: &str =
    "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json";
const CDRAGON_ASSETS: &str = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/";
const GAME_WINDOW: &str = "League of Legends (TM) Client";
pub const SHORTCUT: &str = "CommandOrControl+Shift+A";

pub struct Catalog {
    library: Library,
    meta: HashMap<i32, Meta>,
}

#[derive(Default)]
pub struct Scanner {
    library: OnceCell<Arc<Catalog>>,
    layout: Mutex<Option<Vec<Slot>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ScannedCard {
    pub augment_id: i32,
    pub x: f32,
    pub y: f32,
    pub size: f32,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AugmentScan {
    pub cards: Vec<ScannedCard>,
    pub champion_id: i32,
    pub message: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawAugment {
    id: i32,
    augment_name_id: String,
    augment_small_icon_path: String,
    #[serde(default, rename = "nameTRA")]
    name: String,
    #[serde(default)]
    rarity: String,
}

fn icon_url(path: &str) -> String {
    let rest = path.trim_start_matches("/lol-game-data/assets/").to_lowercase();
    format!("{CDRAGON_ASSETS}{rest}")
}

async fn load_library(dir: PathBuf) -> Result<Catalog> {
    std::fs::create_dir_all(&dir)?;
    let http = reqwest::Client::builder().timeout(Duration::from_secs(20)).build()?;
    let list: Vec<RawAugment> = http.get(AUGMENTS_JSON).send().await?.json().await?;
    let mut icons = Vec::new();
    let mut meta = HashMap::new();
    for a in list.iter().filter(|a| a.augment_name_id.starts_with("ARAM_")) {
        meta.insert(a.id, Meta { name: a.name.clone(), rarity: a.rarity.clone() });
        let file = dir.join(format!("{}.png", a.id));
        let bytes = match std::fs::read(&file) {
            Ok(b) => b,
            Err(_) => {
                let Ok(res) = http.get(icon_url(&a.augment_small_icon_path)).send().await else { continue };
                let Ok(b) = res.bytes().await else { continue };
                let _ = std::fs::write(&file, &b);
                b.to_vec()
            }
        };
        if let Ok(img) = image::load_from_memory(&bytes) {
            icons.push((a.id, img.to_rgba8()));
        }
    }
    Ok(Catalog { library: Library::new(icons), meta })
}

#[derive(Debug, Clone, Copy)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

pub fn game_window() -> Option<Rect> {
    xcap::Window::all().ok()?.into_iter().find_map(|w| {
        let title = w.title().ok()?;
        if !title.contains(GAME_WINDOW) || w.is_minimized().unwrap_or(false) {
            return None;
        }
        Some(Rect { x: w.x().ok()?, y: w.y().ok()?, width: w.width().ok()?, height: w.height().ok()? })
    })
}

fn capture(rect: Rect) -> Result<RgbaImage> {
    let fail = |e: xcap::XCapError| Error::Server(format!("screen capture failed: {e}"));
    let monitor = xcap::Monitor::from_point(rect.x + rect.width as i32 / 2, rect.y + rect.height as i32 / 2).map_err(fail)?;
    let (mx, my) = (monitor.x().map_err(fail)?, monitor.y().map_err(fail)?);
    let shot = monitor.capture_image().map_err(fail)?;
    let x = (rect.x - mx).max(0) as u32;
    let y = (rect.y - my).max(0) as u32;
    let w = rect.width.min(shot.width().saturating_sub(x));
    let h = rect.height.min(shot.height().saturating_sub(y));
    Ok(image::imageops::crop_imm(&shot, x, y, w, h).to_image())
}

fn relative(slots: &[Slot], width: u32, height: u32) -> Vec<Slot> {
    slots
        .iter()
        .map(|s| Slot { x: s.x / width as f32, y: s.y / height as f32, size: s.size / height as f32 })
        .collect()
}

fn absolute(slots: &[Slot], width: u32, height: u32) -> Vec<Slot> {
    slots
        .iter()
        .map(|s| Slot { x: s.x * width as f32, y: s.y * height as f32, size: s.size * height as f32 })
        .collect()
}

fn save_debug(dir: &Path, img: &RgbaImage, scan: &AugmentScan) {
    let _ = std::fs::create_dir_all(dir);
    let _ = img.save(dir.join("last-scan.png"));
    if let Ok(json) = serde_json::to_string_pretty(scan) {
        let _ = std::fs::write(dir.join("last-scan.json"), json);
    }
}

async fn my_champion(app: &AppHandle) -> i32 {
    #[derive(Deserialize, Default)]
    #[serde(rename_all = "camelCase")]
    struct Session {
        #[serde(default)]
        game_data: GameData,
    }
    #[derive(Deserialize, Default)]
    #[serde(rename_all = "camelCase")]
    struct GameData {
        #[serde(default)]
        player_champion_selections: Vec<Pick>,
    }
    #[derive(Deserialize, Default)]
    #[serde(rename_all = "camelCase")]
    struct Pick {
        #[serde(default)]
        puuid: String,
        #[serde(default)]
        champion_id: i32,
    }
    let state = app.state::<AppState>();
    let (Some(client), Some(puuid)) = (state.shared.client(), state.puuid()) else { return 0 };
    let session: Session = client.get("/lol-gameflow/v1/session").await.unwrap_or_default();
    session.game_data.player_champion_selections.into_iter().find(|p| p.puuid == puuid).map_or(0, |p| p.champion_id)
}

const WATCH_INTERVAL: Duration = Duration::from_millis(1000);
const FULL_SEARCH_EVERY: u32 = 3;
const MAYHEM_MODE: &str = "KIWI";

async fn library(app: &AppHandle) -> Result<Arc<Catalog>> {
    let cache = app.path().app_cache_dir()?;
    let state = app.state::<AppState>();
    let library = state
        .scanner
        .library
        .get_or_try_init(|| async { load_library(cache.join("augment-icons")).await.map(Arc::new) })
        .await?
        .clone();
    if library.library.len() == 0 {
        return Err(Error::Server("couldn't load augment icons".into()));
    }
    Ok(library)
}

pub fn normalize_layout(slots: &[Slot]) -> Vec<Slot> {
    let median = |mut v: Vec<f32>| {
        v.sort_by(|a, b| a.total_cmp(b));
        v[v.len() / 2]
    };
    if slots.is_empty() {
        return Vec::new();
    }
    let size = median(slots.iter().map(|s| s.size).collect());
    let y = median(slots.iter().map(|s| s.y).collect());
    slots.iter().map(|s| Slot { x: s.x + (s.size - size) / 2.0, y, size }).collect()
}

fn layout_file(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_cache_dir().ok()?.join("augment-layout.json"))
}

fn stored_layout(app: &AppHandle) -> Option<Vec<Slot>> {
    let state = app.state::<AppState>();
    if let Some(l) = state.scanner.layout.lock().ok().and_then(|l| l.clone()) {
        return Some(l);
    }
    let raw: Vec<Slot> = serde_json::from_str(&std::fs::read_to_string(layout_file(app)?).ok()?).ok()?;
    let layout = normalize_layout(&raw);
    if let Ok(mut l) = state.scanner.layout.lock() {
        *l = Some(layout.clone());
    }
    Some(layout)
}

fn remember_layout(app: &AppHandle, layout: Vec<Slot>) {
    let layout = normalize_layout(&layout);
    if let (Some(file), Ok(json)) = (layout_file(app), serde_json::to_string(&layout)) {
        let _ = std::fs::write(file, json);
    }
    if let Ok(mut l) = app.state::<AppState>().scanner.layout.lock() {
        *l = Some(layout);
    }
}

fn titles(shot: &RgbaImage, found: &[Found]) -> Vec<Option<String>> {
    found
        .iter()
        .map(|f| {
            if f.alternatives.len() <= 1 {
                return None;
            }
            let (x, y, w, h) = title_region(&f.slot, shot.width(), shot.height());
            if w == 0 || h == 0 {
                return None;
            }
            crate::ocr::read_text(&image::imageops::crop_imm(shot, x, y, w, h).to_image())
        })
        .collect()
}

async fn detect(app: &AppHandle, allow_full: bool) -> Result<Option<(Rect, Vec<Found>, RgbaImage)>> {
    let Some(rect) = game_window() else { return Ok(None) };
    let shot = tauri::async_runtime::spawn_blocking(move || capture(rect))
        .await
        .map_err(|e| Error::Server(e.to_string()))??;
    let library = library(app).await?;
    let known = stored_layout(app);
    let (w, h) = (shot.width(), shot.height());
    let found = tauri::async_runtime::spawn_blocking({
        let shot = shot.clone();
        move || {
            let catalog = &library;
            let mut found = Vec::new();
            if let Some(layout) = known {
                let quick = catalog.library.identify(&shot, &absolute(&layout, w, h));
                if quick.iter().all(|f| f.score >= MATCH_THRESHOLD) {
                    found = quick;
                }
            }
            if found.is_empty() && allow_full {
                let row = catalog.library.search(&shot);
                if row.len() == 3 {
                    found = catalog.library.identify(&shot, &row.iter().map(|f| f.slot).collect::<Vec<_>>());
                }
            }
            if found.len() == 3 {
                let titles = titles(&shot, &found);
                resolve(&mut found, &catalog.meta, &titles);
            }
            found
        }
    })
    .await
    .map_err(|e| Error::Server(e.to_string()))?;
    if found.len() == 3 {
        remember_layout(app, relative(&found.iter().map(|f| f.slot).collect::<Vec<_>>(), w, h));
    }
    Ok(Some((rect, found, shot)))
}

fn to_scan(found: &[Found], champion_id: i32, message: Option<String>) -> AugmentScan {
    AugmentScan {
        message,
        cards: found
            .iter()
            .map(|f| ScannedCard { augment_id: f.id, x: f.slot.x, y: f.slot.y, size: f.slot.size, confidence: f.score })
            .collect(),
        champion_id,
    }
}

pub async fn scan(app: &AppHandle) -> Result<AugmentScan> {
    let (rect, found, shot) =
        detect(app, true).await?.ok_or_else(|| Error::Server("the League game window isn't open".into()))?;
    let message = (found.len() < 3).then(|| "Couldn't spot the augment cards. Try again while they're on screen.".into());
    let scan = to_scan(&found, my_champion(app).await, message);
    if let Ok(cache) = app.path().app_cache_dir() {
        save_debug(&cache.join("scans"), &shot, &scan);
    }
    show(app, rect, &scan)?;
    Ok(scan)
}

pub async fn watch(app: AppHandle) {
    let mut tick: u32 = 0;
    let mut shown: Vec<i32> = Vec::new();
    let mut champion = 0;
    let mut mayhem: Option<bool> = None;
    loop {
        tokio::time::sleep(WATCH_INTERVAL).await;
        tick = tick.wrapping_add(1);
        let in_game = matches!(
            app.state::<AppState>().status(),
            crate::tracker::ClientStatus::Connected { ref phase, .. } if phase == "InProgress"
        );
        if !in_game {
            if !shown.is_empty() {
                hide(&app);
                shown.clear();
            }
            champion = 0;
            mayhem = None;
            continue;
        }
        if mayhem.is_none() {
            mayhem = crate::ingame::read().await.map(|g| g.mode == MAYHEM_MODE);
        }
        if mayhem != Some(true) {
            continue;
        }
        let allow_full = shown.is_empty() && tick.is_multiple_of(FULL_SEARCH_EVERY);
        let Ok(Some((rect, found, shot))) = detect(&app, allow_full).await else { continue };
        let ids: Vec<i32> = found.iter().map(|f| f.id).collect();
        if found.len() == 3 && ids != shown {
            if champion == 0 {
                champion = my_champion(&app).await;
            }
            let scan = to_scan(&found, champion, None);
            if let Ok(cache) = app.path().app_cache_dir() {
                save_debug(&cache.join("scans"), &shot, &scan);
            }
            if show(&app, rect, &scan).is_ok() {
                shown = ids;
            }
        } else if found.len() < 3 && !shown.is_empty() {
            hide(&app);
            shown.clear();
        }
    }
}

fn hide(app: &AppHandle) {
    let _ = app.emit_to("overlay", "augment-scan", AugmentScan { cards: Vec::new(), champion_id: 0, message: None });
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.hide();
    }
}

fn show(app: &AppHandle, rect: Rect, scan: &AugmentScan) -> Result<()> {
    let window = match app.get_webview_window("overlay") {
        Some(w) => w,
        None => WebviewWindowBuilder::new(app, "overlay", WebviewUrl::App("overlay.html".into()))
            .title("Teeto overlay")
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
    window.set_position(PhysicalPosition::new(rect.x, rect.y))?;
    window.set_size(PhysicalSize::new(rect.width, rect.height))?;
    window.set_ignore_cursor_events(true)?;
    window.set_content_protected(true)?;
    window.show()?;
    app.emit_to("overlay", "augment-scan", scan)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evens_out_a_misdetected_card() {
        let raw = [
            Slot { x: 0.272, y: 0.2198, size: 0.1429 },
            Slot { x: 0.4556, y: 0.2042, size: 0.1677 },
            Slot { x: 0.6478, y: 0.2042, size: 0.1677 },
        ];
        let out = normalize_layout(&raw);
        assert!(out.iter().all(|s| (s.size - 0.1677).abs() < 1e-4 && (s.y - 0.2042).abs() < 1e-4));
        assert!((out[0].x - (0.272 - (0.1677 - 0.1429) / 2.0)).abs() < 1e-4);
    }
}
