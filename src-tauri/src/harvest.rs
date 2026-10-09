use std::collections::{HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use ts_rs::TS;

use crate::augments::MAYHEM_QUEUE;
use crate::error::Result;
use crate::lcu::LcuClient;
use crate::matches::lcu::{convert, Game};
use crate::matches::MatchDetail;
use crate::store::Store;
use crate::tracker::AppState;

const SHARED_OWNER: &str = "*";
const REQUEST_GAP: Duration = Duration::from_millis(200);
const PLAYERS_PER_RUN: usize = 80;

#[derive(Default)]
pub struct Harvester {
    running: AtomicBool,
    visited: Mutex<HashSet<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct HarvestProgress {
    pub players: u32,
    pub games_added: u32,
    pub total_games: u32,
    pub done: bool,
}

#[derive(Deserialize)]
struct History {
    games: HistoryGames,
}

#[derive(Deserialize)]
struct HistoryGames {
    #[serde(default)]
    games: Vec<Game>,
}

pub fn anonymize(detail: &mut MatchDetail) {
    for p in &mut detail.players {
        p.puuid.clear();
        p.game_name.clear();
        p.tag_line.clear();
    }
    detail.events.clear();
    detail.gold_diff.clear();
}

pub fn players_in(store: &Store) -> Result<Vec<String>> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for game in store.games_in_queue(MAYHEM_QUEUE)? {
        for p in game.players {
            if !p.puuid.is_empty() && seen.insert(p.puuid.clone()) {
                out.push(p.puuid);
            }
        }
    }
    Ok(out)
}

async fn harvest_player(client: &LcuClient, store: &Store, puuid: &str, queue: &mut VecDeque<String>) -> u32 {
    let path = format!("/lol-match-history/v1/products/lol/{puuid}/matches?begIndex=0&endIndex=20");
    let Ok(history) = client.get::<History>(&path).await else { return 0 };
    let mut added = 0;
    for listed in history.games.games.iter().filter(|g| g.queue_id == MAYHEM_QUEUE && g.game_duration >= 300) {
        if store.has_game(listed.game_id).unwrap_or(true) {
            continue;
        }
        tokio::time::sleep(REQUEST_GAP).await;
        let Ok(game) = client.get::<Game>(&format!("/lol-match-history/v1/games/{}", listed.game_id)).await else {
            continue;
        };
        let mut detail = convert(game, None);
        for p in &detail.players {
            if !p.puuid.is_empty() {
                queue.push_back(p.puuid.clone());
            }
        }
        anonymize(&mut detail);
        if store.save_match(SHARED_OWNER, &detail, "client").is_ok() {
            added += 1;
        }
    }
    added
}

pub async fn run(app: AppHandle, seeds: Vec<String>) -> Result<HarvestProgress> {
    let state = app.state::<AppState>();
    let client = state.shared.client().ok_or(crate::error::Error::NotConnected)?;
    let harvester = &state.harvester;
    if harvester.running.swap(true, Ordering::SeqCst) {
        return Ok(HarvestProgress { players: 0, games_added: 0, total_games: 0, done: false });
    }

    let mut queue: VecDeque<String> = seeds.into_iter().collect();
    let mut progress = HarvestProgress { players: 0, games_added: 0, total_games: 0, done: false };
    while let Some(puuid) = queue.pop_front() {
        if progress.players as usize >= PLAYERS_PER_RUN {
            break;
        }
        let fresh = harvester.visited.lock().map(|mut v| v.insert(puuid.clone())).unwrap_or(false);
        if !fresh {
            continue;
        }
        progress.games_added += harvest_player(&client, &state.store, &puuid, &mut queue).await;
        progress.players += 1;
        progress.total_games = state.store.games_in_queue(MAYHEM_QUEUE).map(|g| g.len() as u32).unwrap_or(0);
        let _ = app.emit("harvest-progress", &progress);
        tokio::time::sleep(REQUEST_GAP).await;
    }
    progress.done = true;
    progress.total_games = state.store.games_in_queue(MAYHEM_QUEUE).map(|g| g.len() as u32).unwrap_or(0);
    let _ = app.emit("harvest-progress", &progress);
    if progress.games_added > 0 {
        let _ = app.emit("matches-changed", ());
    }
    harvester.running.store(false, Ordering::SeqCst);
    Ok(progress)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_identities_but_keeps_augments() {
        let json = r#"{"gameId":1,"queueId":2400,"createdAt":0,"durationSec":900,"patch":"16.20","teams":[],"goldDiff":[1,2],"events":[],
            "players":[{"participantId":1,"teamId":100,"puuid":"abc","gameName":"Someone","tagLine":"EUW","championId":17,"champLevel":18,"position":"","spells":[],"items":[],"primaryStyle":0,"subStyle":0,"perks":[],"kills":0,"deaths":0,"assists":0,"cs":0,"gold":0,"damageToChampions":0,"damageTaken":0,"visionScore":0,"wardsPlaced":0,"controlWards":0,"win":true,"augments":[1205]}]}"#;
        let mut detail: MatchDetail = serde_json::from_str(json).unwrap();
        anonymize(&mut detail);
        let p = &detail.players[0];
        assert!(p.puuid.is_empty() && p.game_name.is_empty() && p.tag_line.is_empty());
        assert_eq!((p.champion_id, p.augments.clone(), p.win), (17, vec![1205], true));
        assert!(detail.gold_diff.is_empty());
    }
}
