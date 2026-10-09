use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use ts_rs::TS;

use crate::error::Result;
use crate::lcu::models::{CurrentSummoner, EogStatsBlock, MatchHistory, RankedStats};
use crate::lcu::{discover, ws, LcuClient};
use crate::live::Profiles;
use crate::lp::{self, Queue};
use crate::matches::{self, Timeline};
use crate::store::{GameInfo, LpKind, NewLp, Store};

const PHASE: &str = "/lol-gameflow/v1/gameflow-phase";
const RANKED: &str = "/lol-ranked/v1/current-ranked-stats";
const EOG: &str = "/lol-end-of-game/v1/eog-stats-block";
const SUMMONER: &str = "/lol-summoner/v1/current-summoner";
const HISTORY: &str = "/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=20";
const LAST_SUMMONER: &str = "last_summoner";
const POST_GAME_PHASES: [&str; 3] = ["WaitingForStats", "PreEndOfGame", "EndOfGame"];
const RANKED_POLL: Duration = Duration::from_secs(4);
const RANKED_POLL_WINDOW: Duration = Duration::from_secs(150);
const PENDING_TTL_MS: i64 = 20 * 60 * 1000;
const RETRY: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Summoner {
    pub puuid: String,
    pub game_name: String,
    pub tag_line: String,
    pub level: i32,
    pub profile_icon_id: i32,
}

impl From<CurrentSummoner> for Summoner {
    fn from(s: CurrentSummoner) -> Self {
        Summoner {
            puuid: s.puuid,
            game_name: s.game_name,
            tag_line: s.tag_line,
            level: s.summoner_level,
            profile_icon_id: s.profile_icon_id,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "state", rename_all = "camelCase")]
#[ts(export)]
pub enum ClientStatus {
    Disconnected { summoner: Option<Summoner> },
    Connected { summoner: Summoner, phase: String },
}

#[derive(Default)]
pub struct Shared {
    status: RwLock<Option<ClientStatus>>,
    client: RwLock<Option<LcuClient>>,
    pub profiles: Profiles,
}

impl Shared {
    pub fn client(&self) -> Option<LcuClient> {
        self.client.read().ok()?.clone()
    }

    fn set_client(&self, client: Option<LcuClient>) {
        if let Ok(mut c) = self.client.write() {
            *c = client;
        }
    }
}

pub struct AppState {
    pub store: Arc<Store>,
    pub shared: Arc<Shared>,
    pub scanner: crate::overlay::Scanner,
    pub harvester: crate::harvest::Harvester,
}

impl AppState {
    pub fn status(&self) -> ClientStatus {
        self.shared
            .status
            .read()
            .ok()
            .and_then(|s| s.clone())
            .unwrap_or_else(|| ClientStatus::Disconnected { summoner: last_summoner(&self.store) })
    }

    pub fn puuid(&self) -> Option<String> {
        match self.status() {
            ClientStatus::Connected { summoner, .. } => Some(summoner.puuid),
            ClientStatus::Disconnected { summoner } => summoner.map(|s| s.puuid),
        }
    }
}

fn last_summoner(store: &Store) -> Option<Summoner> {
    serde_json::from_str(&store.get_meta(LAST_SUMMONER).ok()??).ok()
}

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or_default()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingGame {
    pub queue: Queue,
    pub info: GameInfo,
    pub won: Option<bool>,
    pub at: i64,
}

impl PendingGame {
    pub fn from_eog(eog: &EogStatsBlock, at: i64) -> Option<Self> {
        Some(PendingGame {
            queue: Queue::from_key(&eog.queue_type)?,
            info: GameInfo {
                game_id: Some(eog.game_id),
                champion_id: Some(eog.local_player.champion_id),
                kills: eog.stat("CHAMPIONS_KILLED"),
                deaths: eog.stat("NUM_DEATHS"),
                assists: eog.stat("ASSISTS"),
            },
            won: eog.won(),
            at,
        })
    }
}

pub fn record(
    store: &Store,
    puuid: &str,
    stats: &RankedStats,
    pending: &mut Option<PendingGame>,
    now: i64,
) -> Result<bool> {
    if pending.as_ref().is_some_and(|p| now - p.at > PENDING_TTL_MS) {
        *pending = None;
    }
    let mut changed = false;
    for queue in Queue::ALL {
        let Some(current) = stats.standing(queue) else { continue };
        let previous = store.latest_standing(puuid, queue)?;
        if previous.as_ref() == Some(&current) {
            continue;
        }
        store.insert_snapshot(puuid, queue, &current, now)?;
        changed = true;
        let Some(previous) = previous else { continue };

        let change = lp::diff(&previous, &current);
        if change.games_played < 0 {
            continue;
        }
        let (kind, game, won) = match change.games_played {
            0 => (LpKind::Adjustment, GameInfo::default(), None),
            1 => {
                let matched = pending.take_if(|p| p.queue == queue);
                let won = change.won.or(matched.as_ref().and_then(|p| p.won));
                (LpKind::Game, matched.map(|p| p.info).unwrap_or_default(), won)
            }
            _ => (LpKind::Untracked, GameInfo::default(), None),
        };
        store.insert_lp(
            puuid,
            &NewLp { queue, kind, win: won, delta: change.delta, after: &current, game, recorded_at: now },
        )?;
    }
    Ok(changed)
}

pub fn attach_late(store: &Store, puuid: &str, pending: &mut Option<PendingGame>) -> Result<bool> {
    let Some(p) = pending.as_ref() else { return Ok(false) };
    let attached = store.attach_game(puuid, p.queue, p.at - PENDING_TTL_MS, &p.info)?;
    if attached {
        *pending = None;
    }
    Ok(attached)
}

pub async fn fetch_game(client: &LcuClient, game_id: i64) -> Result<matches::MatchDetail> {
    let game: matches::lcu::Game = client.get(&format!("/lol-match-history/v1/games/{game_id}")).await?;
    let timeline: Option<Timeline> =
        client.get(&format!("/lol-match-history/v1/game-timelines/{game_id}")).await.ok();
    Ok(matches::lcu::convert(game, timeline))
}

async fn sync_matches(client: &LcuClient, store: &Store, puuid: &str) -> Result<usize> {
    let history: MatchHistory = client.get(HISTORY).await?;
    let mut added = 0;
    for game in &history.games.games {
        if store.has_match(puuid, game.game_id)? {
            continue;
        }
        let detail = fetch_game(client, game.game_id).await?;
        store.save_match(puuid, &detail, "client")?;
        added += 1;
    }
    Ok(added)
}

pub struct Tracker {
    app: AppHandle,
    store: Arc<Store>,
    shared: Arc<Shared>,
}

impl Tracker {
    pub fn new(app: AppHandle, store: Arc<Store>, shared: Arc<Shared>) -> Self {
        Self { app, store, shared }
    }

    pub async fn run(self) {
        loop {
            let creds = tauri::async_runtime::spawn_blocking(discover::find).await.ok().flatten();
            if let Some(creds) = creds {
                if let Err(err) = self.session(creds).await {
                    eprintln!("lcu session ended: {err}");
                }
                self.shared.set_client(None);
                self.set_status(ClientStatus::Disconnected { summoner: last_summoner(&self.store) });
            }
            tokio::time::sleep(RETRY).await;
        }
    }

    async fn session(&self, creds: discover::Credentials) -> Result<()> {
        let client = LcuClient::new(creds)?;
        let summoner = self.wait_for_summoner(&client).await?;
        self.store.set_meta(LAST_SUMMONER, &serde_json::to_string(&summoner)?)?;
        self.shared.set_client(Some(client.clone()));

        let mut phase: String = client.get(PHASE).await.unwrap_or_else(|_| "None".into());
        self.set_status(ClientStatus::Connected { summoner: summoner.clone(), phase: phase.clone() });

        let puuid = summoner.puuid.clone();
        let mut pending: Option<PendingGame> = None;
        self.sync_ranked(&client, &puuid, &mut pending).await;
        self.sync_matches(&client, &puuid).await;

        let topics = [ws::topic(PHASE), ws::topic(RANKED), ws::topic(EOG)];
        let topics: Vec<&str> = topics.iter().map(String::as_str).collect();
        let events = ws::subscribe(&client, &topics).await?;
        tokio::pin!(events);

        let mut poll_until: Option<Instant> = None;
        let mut ticker = tokio::time::interval(RANKED_POLL);
        loop {
            tokio::select! {
                event = events.next() => {
                    let Some(event) = event else { break };
                    match event.uri.as_str() {
                        PHASE => {
                            if let Some(next) = event.data.as_str() {
                                phase = next.to_owned();
                                self.set_status(ClientStatus::Connected { summoner: summoner.clone(), phase: phase.clone() });
                                if POST_GAME_PHASES.contains(&next) {
                                    poll_until = Some(Instant::now() + RANKED_POLL_WINDOW);
                                }
                            }
                        }
                        EOG if event.event_type != "Delete" => {
                            if let Ok(eog) = serde_json::from_value::<EogStatsBlock>(event.data) {
                                pending = PendingGame::from_eog(&eog, now_ms());
                                if attach_late(&self.store, &puuid, &mut pending).unwrap_or(false) {
                                    self.notify_ranked();
                                }
                                poll_until = Some(Instant::now() + RANKED_POLL_WINDOW);
                            }
                        }
                        RANKED => {
                            if let Ok(stats) = serde_json::from_value::<RankedStats>(event.data) {
                                self.apply(&puuid, &stats, &mut pending);
                            }
                        }
                        _ => {}
                    }
                }
                _ = ticker.tick() => {
                    if poll_until.is_some_and(|t| Instant::now() < t) {
                        self.sync_ranked(&client, &puuid, &mut pending).await;
                        self.sync_matches(&client, &puuid).await;
                    } else {
                        poll_until = None;
                    }
                }
            }
        }
        Ok(())
    }

    async fn wait_for_summoner(&self, client: &LcuClient) -> Result<Summoner> {
        let mut attempts = 0;
        loop {
            match client.get::<CurrentSummoner>(SUMMONER).await {
                Ok(s) if !s.puuid.is_empty() => return Ok(s.into()),
                Err(err) if attempts >= 40 => return Err(err),
                _ => {
                    attempts += 1;
                    tokio::time::sleep(Duration::from_millis(1500)).await;
                }
            }
        }
    }

    async fn sync_ranked(&self, client: &LcuClient, puuid: &str, pending: &mut Option<PendingGame>) {
        if let Ok(stats) = client.get::<RankedStats>(RANKED).await {
            self.apply(puuid, &stats, pending);
        }
    }

    fn apply(&self, puuid: &str, stats: &RankedStats, pending: &mut Option<PendingGame>) {
        match record(&self.store, puuid, stats, pending, now_ms()) {
            Ok(true) => self.notify_ranked(),
            Ok(false) => {}
            Err(err) => eprintln!("failed to record ranked stats: {err}"),
        }
    }

    async fn sync_matches(&self, client: &LcuClient, puuid: &str) {
        match sync_matches(client, &self.store, puuid).await {
            Ok(0) => {}
            Ok(_) => {
                let _ = self.app.emit("matches-changed", ());
            }
            Err(err) => eprintln!("failed to sync matches: {err}"),
        }
    }

    fn notify_ranked(&self) {
        let _ = self.app.emit("ranked-changed", ());
    }

    fn set_status(&self, status: ClientStatus) {
        if let Ok(mut s) = self.shared.status.write() {
            if s.as_ref() == Some(&status) {
                return;
            }
            *s = Some(status.clone());
        }
        let _ = self.app.emit("client-status", status);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lcu::models::RankedQueue;

    fn stats(tier: &str, division: &str, lp: i32, wins: i32, losses: i32) -> RankedStats {
        let mut s = RankedStats::default();
        s.queue_map.insert(
            Queue::Solo.key().into(),
            RankedQueue { tier: tier.into(), division: division.into(), league_points: lp, wins, losses, is_provisional: false, ..Default::default() },
        );
        s
    }

    fn pending(game_id: i64, at: i64) -> Option<PendingGame> {
        Some(PendingGame {
            queue: Queue::Solo,
            info: GameInfo { game_id: Some(game_id), champion_id: Some(17), kills: Some(9), deaths: Some(2), assists: Some(11) },
            won: Some(true),
            at,
        })
    }

    #[test]
    fn first_sight_is_baseline_only() {
        let store = Store::in_memory().unwrap();
        assert!(record(&store, "p", &stats("GOLD", "II", 40, 10, 10), &mut None, 0).unwrap());
        assert!(store.lp_history("p", Queue::Solo, 0).unwrap().is_empty());
        assert!(!record(&store, "p", &stats("GOLD", "II", 40, 10, 10), &mut None, 1).unwrap());
    }

    #[test]
    fn game_takes_pending_info() {
        let store = Store::in_memory().unwrap();
        record(&store, "p", &stats("GOLD", "I", 90, 10, 10), &mut None, 0).unwrap();
        let mut p = pending(77, 1000);
        record(&store, "p", &stats("PLATINUM", "IV", 13, 11, 10), &mut p, 2000).unwrap();
        assert!(p.is_none());

        let h = store.lp_history("p", Queue::Solo, 0).unwrap();
        assert_eq!(h.len(), 1);
        assert_eq!((h[0].kind, h[0].delta, h[0].win, h[0].game_id), (LpKind::Game, Some(23), Some(true), Some(77)));
    }

    #[test]
    fn stale_pending_is_dropped() {
        let store = Store::in_memory().unwrap();
        record(&store, "p", &stats("GOLD", "II", 40, 10, 10), &mut None, 0).unwrap();
        let mut p = pending(77, 0);
        record(&store, "p", &stats("GOLD", "II", 22, 10, 11), &mut p, PENDING_TTL_MS + 1).unwrap();
        let h = store.lp_history("p", Queue::Solo, 0).unwrap();
        assert_eq!((h[0].game_id, h[0].win, h[0].delta), (None, Some(false), Some(-18)));
    }

    #[test]
    fn late_eog_attaches_to_game() {
        let store = Store::in_memory().unwrap();
        record(&store, "p", &stats("GOLD", "II", 40, 10, 10), &mut None, 0).unwrap();
        record(&store, "p", &stats("GOLD", "II", 62, 11, 10), &mut None, 1000).unwrap();
        let mut p = pending(88, 2000);
        assert!(attach_late(&store, "p", &mut p).unwrap());
        assert_eq!(store.lp_history("p", Queue::Solo, 0).unwrap()[0].game_id, Some(88));
    }

    #[test]
    fn decay_and_offline_games_are_labelled() {
        let store = Store::in_memory().unwrap();
        record(&store, "p", &stats("DIAMOND", "IV", 50, 10, 10), &mut None, 0).unwrap();
        record(&store, "p", &stats("DIAMOND", "IV", 0, 10, 10), &mut None, 1).unwrap();
        record(&store, "p", &stats("DIAMOND", "IV", 60, 14, 11), &mut None, 2).unwrap();
        let kinds: Vec<_> = store.lp_history("p", Queue::Solo, 0).unwrap().iter().map(|e| e.kind).collect();
        assert_eq!(kinds, vec![LpKind::Adjustment, LpKind::Untracked]);
    }

    #[test]
    fn season_reset_is_not_an_entry() {
        let store = Store::in_memory().unwrap();
        record(&store, "p", &stats("GOLD", "II", 40, 100, 90), &mut None, 0).unwrap();
        record(&store, "p", &stats("", "", 0, 0, 0), &mut None, 1).unwrap();
        assert!(store.lp_history("p", Queue::Solo, 0).unwrap().is_empty());
    }
}
