use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

use crate::badges::{self, Badge};
use crate::error::{Error, Result};
use crate::lp::Queue;
use crate::matches::MatchDetail;
use crate::store::{LpEntry, RankEntry};
use crate::tracker::{fetch_game, AppState, ClientStatus};

const RANKED_QUEUES: [i64; 2] = [420, 440];

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum MatchFilter {
    Ranked,
    All,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MatchSummary {
    #[ts(type = "number")]
    pub game_id: i64,
    #[ts(type = "number")]
    pub queue_id: i64,
    pub champion_id: i32,
    pub champ_level: i32,
    pub position: String,
    pub win: bool,
    pub remake: bool,
    pub kills: i32,
    pub deaths: i32,
    pub assists: i32,
    pub kill_participation: i32,
    pub cs: i32,
    pub items: Vec<i32>,
    pub spells: Vec<i32>,
    pub keystone: i32,
    pub sub_style: i32,
    #[ts(type = "number")]
    pub duration_sec: i64,
    #[ts(type = "number")]
    pub created_at: i64,
    pub lp_delta: Option<i32>,
    pub badges: Vec<Badge>,
}

fn summarize(detail: &MatchDetail, puuid: &str, lp_delta: Option<i32>) -> Option<MatchSummary> {
    let me = detail.player(puuid)?;
    let team_kills: i32 = detail.players.iter().filter(|p| p.team_id == me.team_id).map(|p| p.kills).sum();
    Some(MatchSummary {
        game_id: detail.game_id,
        queue_id: detail.queue_id,
        champion_id: me.champion_id,
        champ_level: me.champ_level,
        position: me.position.clone(),
        win: me.win,
        remake: detail.duration_sec < 300,
        kills: me.kills,
        deaths: me.deaths,
        assists: me.assists,
        kill_participation: if team_kills > 0 { (me.kills + me.assists) * 100 / team_kills } else { 0 },
        cs: me.cs,
        items: me.items.clone(),
        spells: me.spells.clone(),
        keystone: me.perks.first().copied().unwrap_or_default(),
        sub_style: me.sub_style,
        duration_sec: detail.duration_sec,
        created_at: detail.created_at,
        lp_delta,
        badges: me.badges.clone(),
    })
}

#[tauri::command]
pub fn client_status(state: State<'_, AppState>) -> ClientStatus {
    state.status()
}

#[tauri::command]
pub fn ranks(state: State<'_, AppState>) -> Result<Vec<RankEntry>> {
    match state.puuid() {
        Some(puuid) => state.store.ranks(&puuid),
        None => Ok(Vec::new()),
    }
}

#[tauri::command]
pub fn lp_history(state: State<'_, AppState>, queue: Queue, since: i64) -> Result<Vec<LpEntry>> {
    match state.puuid() {
        Some(puuid) => state.store.lp_history(&puuid, queue, since),
        None => Ok(Vec::new()),
    }
}

#[tauri::command]
pub fn matches(
    state: State<'_, AppState>,
    filter: MatchFilter,
    before: Option<i64>,
    limit: u32,
) -> Result<Vec<MatchSummary>> {
    let Some(puuid) = state.puuid() else { return Ok(Vec::new()) };
    let queues = match filter {
        MatchFilter::Ranked => Some(&RANKED_QUEUES[..]),
        MatchFilter::All => None,
    };
    let mut details = state.store.matches(&puuid, queues, before.unwrap_or(i64::MAX), limit.clamp(1, 100))?;
    details.iter_mut().for_each(badges::annotate);
    let ids: Vec<i64> = details.iter().map(|d| d.game_id).collect();
    let deltas = state.store.deltas_for_games(&puuid, &ids)?;
    Ok(details.iter().filter_map(|d| summarize(d, &puuid, deltas.get(&d.game_id).copied())).collect())
}

#[tauri::command]
pub async fn match_detail(state: State<'_, AppState>, game_id: i64) -> Result<MatchDetail> {
    if let Some(mut detail) = state.store.match_detail(game_id)? {
        badges::annotate(&mut detail);
        return Ok(detail);
    }
    let client = state.shared.client().ok_or(Error::NotConnected)?;
    let mut detail = fetch_game(&client, game_id).await?;
    if let Some(puuid) = state.puuid() {
        if detail.player(&puuid).is_some() {
            state.store.save_match(&puuid, &detail, "client")?;
        }
    }
    badges::annotate(&mut detail);
    Ok(detail)
}


#[tauri::command]
pub async fn data_file(path: String) -> Result<serde_json::Value> {
    crate::data::data_file(&path).await
}

#[tauri::command]
pub async fn import_runes(
    state: State<'_, AppState>,
    name: String,
    primary_style: i32,
    sub_style: i32,
    perks: Vec<i32>,
    shards: Vec<i32>,
) -> Result<()> {
    let client = state.shared.client().ok_or(Error::NotConnected)?;
    crate::runes::import(&client, &name, primary_style, sub_style, &perks, &shards).await
}

#[tauri::command]
pub async fn live_game(state: State<'_, AppState>) -> Result<Option<crate::live::LiveGame>> {
    let client = state.shared.client().ok_or(Error::NotConnected)?;
    let puuid = state.puuid().ok_or(Error::NotConnected)?;
    crate::live::scout_game(&client, &state.shared.profiles, &puuid).await
}

#[tauri::command]
pub async fn champ_select(state: State<'_, AppState>) -> Result<crate::champselect::ChampSelect> {
    let client = state.shared.client().ok_or(Error::NotConnected)?;
    let puuid = state.puuid().ok_or(Error::NotConnected)?;
    crate::champselect::read(&client, &state.shared.profiles, &puuid).await
}

#[tauri::command]
pub async fn set_spells(state: State<'_, AppState>, spell1: i32, spell2: i32) -> Result<()> {
    let client = state.shared.client().ok_or(Error::NotConnected)?;
    crate::champselect::set_spells(&client, spell1, spell2).await
}

#[tauri::command]
pub fn mayhem_augments(state: State<'_, AppState>) -> Result<Vec<crate::augments::ChampionAugments>> {
    let games = state.store.games_in_queue(crate::augments::MAYHEM_QUEUE)?;
    Ok(crate::augments::tally(&games))
}

#[tauri::command]
pub async fn harvest_mayhem(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<crate::harvest::HarvestProgress> {
    let seeds = crate::harvest::players_in(&state.store)?;
    crate::harvest::run(app, seeds).await
}

#[tauri::command]
pub async fn in_game() -> Option<crate::ingame::InGame> {
    crate::ingame::read().await
}

#[tauri::command]
pub async fn scan_augments(app: tauri::AppHandle) -> Result<crate::overlay::AugmentScan> {
    crate::overlay::scan(&app).await
}
