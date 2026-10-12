use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

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

const HOT_INTERVAL: Duration = Duration::from_millis(250);
const COLD_INTERVAL: Duration = Duration::from_millis(1500);
const IDLE_INTERVAL: Duration = Duration::from_millis(1000);
const HOT_FULL_SEARCH: Duration = Duration::from_secs(2);
const COLD_FULL_SEARCH: Duration = Duration::from_secs(6);
const LEVEL_CHECK: Duration = Duration::from_secs(1);
const MISSES_BEFORE_HIDE: u32 = 3;
const PICK_LEVELS: [i32; 3] = [7, 11, 15];
const HOT_AFTER_HIDE: Duration = Duration::from_secs(5);
const SETTLE_READS: u8 = 2;
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

struct Detection {
    rect: Rect,
    found: Vec<Found>,
    shot: RgbaImage,
    partly_visible: bool,
}

async fn detect(app: &AppHandle, allow_full: bool) -> Result<Option<Detection>> {
    let Some(rect) = game_window() else { return Ok(None) };
    let shot = tauri::async_runtime::spawn_blocking(move || capture(rect))
        .await
        .map_err(|e| Error::Server(e.to_string()))??;
    let library = library(app).await?;
    let known = stored_layout(app);
    let (w, h) = (shot.width(), shot.height());
    let (found, partly_visible) = tauri::async_runtime::spawn_blocking({
        let shot = shot.clone();
        move || {
            let catalog = &library;
            let mut found = Vec::new();
            let mut partly_visible = false;
            if let Some(layout) = known {
                let quick = catalog.library.identify(&shot, &absolute(&layout, w, h));
                let matched = quick.iter().filter(|f| f.score >= MATCH_THRESHOLD).count();
                partly_visible = matched >= 2;
                if partly_visible {
                    found = quick;
                }
            }
            let complete = |f: &[Found]| f.len() == 3 && f.iter().all(|f| f.score >= MATCH_THRESHOLD);
            if !complete(&found) && allow_full {
                let row = catalog.library.search(&shot);
                if row.len() == 3 {
                    let full = catalog.library.identify(&shot, &row.iter().map(|f| f.slot).collect::<Vec<_>>());
                    if found.is_empty() || complete(&full) {
                        found = full;
                    }
                }
            }
            if found.len() == 3 {
                let titles = titles(&shot, &found);
                resolve(&mut found, &catalog.meta, &titles);
                let even = normalize_layout(&found.iter().map(|f| f.slot).collect::<Vec<_>>());
                for (f, slot) in found.iter_mut().zip(even) {
                    f.slot = slot;
                }
            }
            (found, partly_visible)
        }
    })
    .await
    .map_err(|e| Error::Server(e.to_string()))?;
    if found.len() == 3 && found.iter().all(|f| f.score >= MATCH_THRESHOLD) {
        remember_layout(app, relative(&found.iter().map(|f| f.slot).collect::<Vec<_>>(), w, h));
    }
    Ok(Some(Detection { rect, found, shot, partly_visible }))
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
    let Detection { rect, found, shot, .. } =
        detect(app, true).await?.ok_or_else(|| Error::Server("the League game window isn't open".into()))?;
    let found: Vec<Found> = found.into_iter().filter(|f| f.score >= MATCH_THRESHOLD).collect();
    let message = found.is_empty().then(|| "Couldn't spot the augment cards. Try again while they're on screen.".into());
    let scan = to_scan(&found, my_champion(app).await, message);
    if let Ok(cache) = app.path().app_cache_dir() {
        save_debug(&cache.join("scans"), &shot, &scan);
    }
    show(app, rect, &scan)?;
    Ok(scan)
}

#[derive(Debug, Default)]
struct Pacing {
    level: i32,
    picks_seen: usize,
    hidden_at: Option<Instant>,
}

impl Pacing {
    fn unlocked(&self) -> usize {
        1 + PICK_LEVELS.iter().filter(|&&l| self.level >= l).count()
    }

    fn hot(&self, showing: bool) -> bool {
        showing
            || self.picks_seen < self.unlocked()
            || self.hidden_at.is_some_and(|t| t.elapsed() < HOT_AFTER_HIDE)
    }

    fn closed(&mut self) {
        self.picks_seen = (self.picks_seen + 1).min(self.unlocked());
        self.hidden_at = Some(Instant::now());
    }

    fn interval(&self, showing: bool) -> Duration {
        if self.hot(showing) { HOT_INTERVAL } else { COLD_INTERVAL }
    }

    fn full_search_every(&self, showing: bool) -> Duration {
        if self.hot(showing) { HOT_FULL_SEARCH } else { COLD_FULL_SEARCH }
    }
}

#[derive(Debug, Default)]
struct Settle {
    ids: Vec<i32>,
    streak: Vec<u8>,
}

impl Settle {
    fn observe(&mut self, ids: &[i32]) -> Vec<bool> {
        if self.ids.len() != ids.len() {
            self.ids = ids.to_vec();
            self.streak = vec![0; ids.len()];
        }
        for (i, &id) in ids.iter().enumerate() {
            if self.ids[i] == id {
                self.streak[i] = self.streak[i].saturating_add(1);
            } else {
                self.ids[i] = id;
                self.streak[i] = 1;
            }
        }
        self.streak.iter().map(|&n| n >= SETTLE_READS).collect()
    }
}

fn my_level(game: &crate::ingame::InGame) -> Option<i32> {
    let me = game.me.to_lowercase();
    let name = me.split('#').next().unwrap_or_default();
    game.players
        .iter()
        .find(|p| p.riot_id.to_lowercase() == me)
        .or_else(|| game.players.iter().find(|p| p.riot_id.to_lowercase().split('#').next() == Some(name)))
        .map(|p| p.level)
}

pub async fn watch(app: AppHandle) {
    let mut shown: Vec<i32> = Vec::new();
    let mut champion = 0;
    let mut mayhem: Option<bool> = None;
    let mut misses: u32 = 0;
    let mut pacing = Pacing::default();
    let mut settle = Settle::default();
    let mut started = Instant::now();
    let mut last_full: Option<Instant> = None;
    let mut last_level: Option<Instant> = None;
    loop {
        let interval = if mayhem == Some(true) { pacing.interval(!shown.is_empty()) } else { IDLE_INTERVAL };
        tokio::time::sleep(interval.saturating_sub(started.elapsed())).await;
        started = Instant::now();
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
            pacing = Pacing::default();
            settle = Settle::default();
            last_full = None;
            last_level = None;
            continue;
        }
        if mayhem.is_none() || last_level.is_none_or(|t| t.elapsed() >= LEVEL_CHECK) {
            if let Some(game) = crate::ingame::read().await {
                mayhem = Some(game.mode == MAYHEM_MODE);
                pacing.level = my_level(&game).unwrap_or(pacing.level);
                last_level = Some(Instant::now());
            }
        }
        if mayhem != Some(true) {
            continue;
        }
        if champion == 0 {
            champion = my_champion(&app).await;
        }
        let full_every = if stored_layout(&app).is_some() { COLD_FULL_SEARCH } else { pacing.full_search_every(false) };
        let allow_full = shown.is_empty() && last_full.is_none_or(|t| t.elapsed() >= full_every);
        if allow_full {
            last_full = Some(Instant::now());
        }
        let Ok(Some(Detection { rect, found, shot, partly_visible })) = detect(&app, allow_full).await else { continue };
        if found.len() == 3 || partly_visible {
            misses = 0;
        }
        if found.len() == 3 {
            let reads: Vec<i32> = found.iter().map(|f| if f.score >= MATCH_THRESHOLD { f.id } else { 0 }).collect();
            let settled = settle.observe(&reads);
            let stable: Vec<Found> =
                found.iter().zip(&reads).zip(&settled).filter(|((_, &id), &ok)| ok && id != 0).map(|((f, _), _)| f.clone()).collect();
            let ids: Vec<i32> = stable.iter().map(|f| f.id).collect();
            if !stable.is_empty() && ids != shown {
                let scan = to_scan(&stable, champion, None);
                if show(&app, rect, &scan).is_ok() {
                    shown = ids;
                }
                if let Ok(cache) = app.path().app_cache_dir() {
                    tauri::async_runtime::spawn_blocking(move || save_debug(&cache.join("scans"), &shot, &scan));
                }
            }
        } else if found.len() < 3 && !partly_visible && !shown.is_empty() {
            misses += 1;
            if misses >= MISSES_BEFORE_HIDE {
                hide(&app);
                shown.clear();
                misses = 0;
                pacing.closed();
                settle = Settle::default();
            }
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

    #[test]
    fn stays_hot_until_each_unlocked_pick_is_seen() {
        let mut p = Pacing { level: 1, ..Pacing::default() };
        assert!(p.hot(false));
        p.closed();
        assert!(p.hot(false));
        p.hidden_at = Instant::now().checked_sub(HOT_AFTER_HIDE);
        assert!(!p.hot(false));
        assert!(p.hot(true));
        p.level = 7;
        assert!(p.hot(false));
        p.closed();
        p.closed();
        assert_eq!(p.picks_seen, 2);
        p.level = 18;
        assert_eq!(p.unlocked(), 4);
        assert!(p.hot(false));
    }

    #[test]
    fn only_settles_a_card_after_repeated_reads() {
        let mut s = Settle::default();
        assert_eq!(s.observe(&[1, 2, 3]), [false, false, false]);
        assert_eq!(s.observe(&[1, 2, 3]), [true, true, true]);
        assert_eq!(s.observe(&[9, 2, 3]), [false, true, true]);
        assert_eq!(s.observe(&[8, 2, 3]), [false, true, true]);
        assert_eq!(s.observe(&[8, 2, 3]), [true, true, true]);
    }
}