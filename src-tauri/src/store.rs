use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::Result;
use crate::lp::{Queue, Standing};
use crate::matches::MatchDetail;

const MIGRATIONS: &[&str] = &[r#"
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE ranked_snapshots (
    id INTEGER PRIMARY KEY,
    puuid TEXT NOT NULL,
    queue TEXT NOT NULL,
    tier TEXT NOT NULL,
    division TEXT NOT NULL,
    lp INTEGER NOT NULL,
    wins INTEGER NOT NULL,
    losses INTEGER NOT NULL,
    captured_at INTEGER NOT NULL
);
CREATE INDEX ranked_snapshots_lookup ON ranked_snapshots (puuid, queue, captured_at);
CREATE TABLE lp_changes (
    id INTEGER PRIMARY KEY,
    puuid TEXT NOT NULL,
    queue TEXT NOT NULL,
    kind TEXT NOT NULL,
    game_id INTEGER,
    champion_id INTEGER,
    win INTEGER,
    delta INTEGER,
    tier TEXT NOT NULL,
    division TEXT NOT NULL,
    lp INTEGER NOT NULL,
    kills INTEGER,
    deaths INTEGER,
    assists INTEGER,
    recorded_at INTEGER NOT NULL
);
CREATE INDEX lp_changes_lookup ON lp_changes (puuid, queue, recorded_at);
CREATE UNIQUE INDEX lp_changes_game ON lp_changes (puuid, game_id) WHERE game_id IS NOT NULL;
"#, r#"
CREATE TABLE matches (
    puuid TEXT NOT NULL,
    game_id INTEGER NOT NULL,
    queue_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    source TEXT NOT NULL,
    detail TEXT NOT NULL,
    PRIMARY KEY (puuid, game_id)
);
CREATE INDEX matches_recent ON matches (puuid, created_at);
"#];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum LpKind {
    Game,
    Adjustment,
    Untracked,
}

impl LpKind {
    fn as_str(self) -> &'static str {
        match self {
            LpKind::Game => "game",
            LpKind::Adjustment => "adjustment",
            LpKind::Untracked => "untracked",
        }
    }

    fn parse(s: &str) -> LpKind {
        match s {
            "game" => LpKind::Game,
            "adjustment" => LpKind::Adjustment,
            _ => LpKind::Untracked,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GameInfo {
    pub game_id: Option<i64>,
    pub champion_id: Option<i32>,
    pub kills: Option<i32>,
    pub deaths: Option<i32>,
    pub assists: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LpEntry {
    #[ts(type = "number")]
    pub id: i64,
    pub queue: Queue,
    pub kind: LpKind,
    #[ts(type = "number | null")]
    pub game_id: Option<i64>,
    pub champion_id: Option<i32>,
    pub win: Option<bool>,
    pub delta: Option<i32>,
    pub after: Standing,
    pub kills: Option<i32>,
    pub deaths: Option<i32>,
    pub assists: Option<i32>,
    #[ts(type = "number")]
    pub recorded_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RankEntry {
    pub queue: Queue,
    pub standing: Standing,
    #[ts(type = "number")]
    pub captured_at: i64,
}

pub struct NewLp<'a> {
    pub queue: Queue,
    pub kind: LpKind,
    pub win: Option<bool>,
    pub delta: Option<i32>,
    pub after: &'a Standing,
    pub game: GameInfo,
    pub recorded_at: i64,
}

pub struct Store {
    conn: Mutex<Connection>,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        Self::init(Connection::open(path)?)
    }

    #[cfg(test)]
    pub fn in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.execute_batch("PRAGMA journal_mode = WAL;")?;
        let version: usize = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
        for (i, sql) in MIGRATIONS.iter().enumerate().skip(version) {
            conn.execute_batch(sql)?;
            conn.pragma_update(None, "user_version", i + 1)?;
        }
        Ok(Self { conn: Mutex::new(conn) })
    }

    fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn get_meta(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .conn()
            .query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0))
            .optional()?)
    }

    pub fn set_meta(&self, key: &str, value: &str) -> Result<()> {
        self.conn().execute(
            "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [key, value],
        )?;
        Ok(())
    }

    pub fn latest_standing(&self, puuid: &str, queue: Queue) -> Result<Option<Standing>> {
        Ok(self
            .conn()
            .query_row(
                "SELECT tier, division, lp, wins, losses FROM ranked_snapshots
                 WHERE puuid = ?1 AND queue = ?2 ORDER BY captured_at DESC, id DESC LIMIT 1",
                params![puuid, queue.key()],
                standing_from,
            )
            .optional()?)
    }

    pub fn insert_snapshot(&self, puuid: &str, queue: Queue, s: &Standing, at: i64) -> Result<()> {
        self.conn().execute(
            "INSERT INTO ranked_snapshots (puuid, queue, tier, division, lp, wins, losses, captured_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![puuid, queue.key(), s.tier, s.division, s.lp, s.wins, s.losses, at],
        )?;
        Ok(())
    }

    pub fn insert_lp(&self, puuid: &str, e: &NewLp) -> Result<LpEntry> {
        let conn = self.conn();
        conn.execute(
            "INSERT OR IGNORE INTO lp_changes
             (puuid, queue, kind, game_id, champion_id, win, delta, tier, division, lp, kills, deaths, assists, recorded_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                puuid,
                e.queue.key(),
                e.kind.as_str(),
                e.game.game_id,
                e.game.champion_id,
                e.win,
                e.delta,
                e.after.tier,
                e.after.division,
                e.after.lp,
                e.game.kills,
                e.game.deaths,
                e.game.assists,
                e.recorded_at
            ],
        )?;
        Ok(LpEntry {
            id: conn.last_insert_rowid(),
            queue: e.queue,
            kind: e.kind,
            game_id: e.game.game_id,
            champion_id: e.game.champion_id,
            win: e.win,
            delta: e.delta,
            after: e.after.clone(),
            kills: e.game.kills,
            deaths: e.game.deaths,
            assists: e.game.assists,
            recorded_at: e.recorded_at,
        })
    }

    pub fn attach_game(&self, puuid: &str, queue: Queue, since: i64, game: &GameInfo) -> Result<bool> {
        let updated = self.conn().execute(
            "UPDATE lp_changes SET game_id = ?1, champion_id = ?2, kills = ?3, deaths = ?4, assists = ?5
             WHERE id = (SELECT id FROM lp_changes WHERE puuid = ?6 AND queue = ?7 AND kind = 'game'
                         AND game_id IS NULL AND recorded_at >= ?8 ORDER BY recorded_at DESC, id DESC LIMIT 1)",
            params![game.game_id, game.champion_id, game.kills, game.deaths, game.assists, puuid, queue.key(), since],
        )?;
        Ok(updated > 0)
    }

    pub fn lp_history(&self, puuid: &str, queue: Queue, since: i64) -> Result<Vec<LpEntry>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT id, queue, kind, game_id, champion_id, win, delta, tier, division, lp, kills, deaths, assists, recorded_at
             FROM lp_changes WHERE puuid = ?1 AND queue = ?2 AND recorded_at >= ?3 ORDER BY recorded_at, id",
        )?;
        let rows = stmt.query_map(params![puuid, queue.key(), since], lp_from)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn ranks(&self, puuid: &str) -> Result<Vec<RankEntry>> {
        let mut out = Vec::new();
        for queue in Queue::ALL {
            let row = self
                .conn()
                .query_row(
                    "SELECT tier, division, lp, wins, losses, captured_at FROM ranked_snapshots
                     WHERE puuid = ?1 AND queue = ?2 ORDER BY captured_at DESC, id DESC LIMIT 1",
                    params![puuid, queue.key()],
                    |r| Ok((standing_from(r)?, r.get::<_, i64>(5)?)),
                )
                .optional()?;
            if let Some((standing, captured_at)) = row {
                out.push(RankEntry { queue, standing, captured_at });
            }
        }
        Ok(out)
    }

    pub fn has_match(&self, puuid: &str, game_id: i64) -> Result<bool> {
        Ok(self
            .conn()
            .query_row("SELECT 1 FROM matches WHERE puuid = ?1 AND game_id = ?2", params![puuid, game_id], |_| Ok(()))
            .optional()?
            .is_some())
    }

    pub fn save_match(&self, puuid: &str, detail: &MatchDetail, source: &str) -> Result<()> {
        self.conn().execute(
            "INSERT INTO matches (puuid, game_id, queue_id, created_at, source, detail) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(puuid, game_id) DO UPDATE SET detail = excluded.detail, source = excluded.source",
            params![puuid, detail.game_id, detail.queue_id, detail.created_at, source, serde_json::to_string(detail)?],
        )?;
        Ok(())
    }

    pub fn matches(&self, puuid: &str, queues: Option<&[i64]>, before: i64, limit: u32) -> Result<Vec<MatchDetail>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT queue_id, detail FROM matches WHERE puuid = ?1 AND created_at < ?2 ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![puuid, before], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
        let mut out = Vec::new();
        for row in rows {
            let (queue_id, json) = row?;
            if queues.is_some_and(|q| !q.contains(&queue_id)) {
                continue;
            }
            out.push(serde_json::from_str(&json)?);
            if out.len() >= limit as usize {
                break;
            }
        }
        Ok(out)
    }

    pub fn has_game(&self, game_id: i64) -> Result<bool> {
        Ok(self
            .conn()
            .query_row("SELECT 1 FROM matches WHERE game_id = ?1 LIMIT 1", [game_id], |_| Ok(()))
            .optional()?
            .is_some())
    }

    pub fn games_in_queue(&self, queue_id: i64) -> Result<Vec<MatchDetail>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT detail FROM matches WHERE queue_id = ?1 AND rowid IN (SELECT MIN(rowid) FROM matches GROUP BY game_id)",
        )?;
        let rows = stmt.query_map([queue_id], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for json in rows {
            out.push(serde_json::from_str(&json?)?);
        }
        Ok(out)
    }

    pub fn match_detail(&self, game_id: i64) -> Result<Option<MatchDetail>> {
        let json: Option<String> = self
            .conn()
            .query_row("SELECT detail FROM matches WHERE game_id = ?1 LIMIT 1", [game_id], |r| r.get(0))
            .optional()?;
        Ok(json.map(|j| serde_json::from_str(&j)).transpose()?)
    }

    pub fn deltas_for_games(&self, puuid: &str, game_ids: &[i64]) -> Result<HashMap<i64, i32>> {
        let conn = self.conn();
        let mut stmt =
            conn.prepare("SELECT delta FROM lp_changes WHERE puuid = ?1 AND game_id = ?2 AND delta IS NOT NULL")?;
        let mut out = HashMap::new();
        for id in game_ids {
            if let Some(delta) = stmt.query_row(params![puuid, id], |r| r.get(0)).optional()? {
                out.insert(*id, delta);
            }
        }
        Ok(out)
    }
}

fn standing_from(r: &Row) -> rusqlite::Result<Standing> {
    Ok(Standing { tier: r.get(0)?, division: r.get(1)?, lp: r.get(2)?, wins: r.get(3)?, losses: r.get(4)? })
}

fn lp_from(r: &Row) -> rusqlite::Result<LpEntry> {
    let queue: String = r.get(1)?;
    let kind: String = r.get(2)?;
    Ok(LpEntry {
        id: r.get(0)?,
        queue: Queue::from_key(&queue).unwrap_or(Queue::Solo),
        kind: LpKind::parse(&kind),
        game_id: r.get(3)?,
        champion_id: r.get(4)?,
        win: r.get(5)?,
        delta: r.get(6)?,
        after: Standing { tier: r.get(7)?, division: r.get(8)?, lp: r.get(9)?, wins: 0, losses: 0 },
        kills: r.get(10)?,
        deaths: r.get(11)?,
        assists: r.get(12)?,
        recorded_at: r.get(13)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn standing(lp: i32) -> Standing {
        Standing { tier: "GOLD".into(), division: "II".into(), lp, wins: 1, losses: 1 }
    }

    #[test]
    fn migrates_and_round_trips() {
        let store = Store::in_memory().unwrap();
        assert!(store.latest_standing("p", Queue::Solo).unwrap().is_none());

        store.insert_snapshot("p", Queue::Solo, &standing(10), 1).unwrap();
        store.insert_snapshot("p", Queue::Solo, &standing(33), 2).unwrap();
        assert_eq!(store.latest_standing("p", Queue::Solo).unwrap().unwrap().lp, 33);
        assert_eq!(store.ranks("p").unwrap().len(), 1);

        let after = standing(33);
        let game = GameInfo { game_id: Some(42), champion_id: Some(17), ..Default::default() };
        let entry = NewLp { queue: Queue::Solo, kind: LpKind::Game, win: Some(true), delta: Some(23), after: &after, game, recorded_at: 2 };
        store.insert_lp("p", &entry).unwrap();
        store.insert_lp("p", &entry).unwrap();

        let history = store.lp_history("p", Queue::Solo, 0).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].delta, Some(23));
        assert_eq!(history[0].kind, LpKind::Game);
        assert_eq!(store.deltas_for_games("p", &[42, 7]).unwrap().get(&42), Some(&23));
        assert!(store.lp_history("p", Queue::Flex, 0).unwrap().is_empty());
    }

    #[test]
    fn attaches_late_game_info() {
        let store = Store::in_memory().unwrap();
        let after = standing(40);
        let entry = NewLp { queue: Queue::Solo, kind: LpKind::Game, win: Some(false), delta: Some(-17), after: &after, game: GameInfo::default(), recorded_at: 100 };
        store.insert_lp("p", &entry).unwrap();

        let game = GameInfo { game_id: Some(9), champion_id: Some(55), kills: Some(4), deaths: Some(6), assists: Some(3) };
        assert!(!store.attach_game("p", Queue::Solo, 200, &game).unwrap());
        assert!(store.attach_game("p", Queue::Solo, 50, &game).unwrap());
        assert!(!store.attach_game("p", Queue::Solo, 50, &game).unwrap());

        let history = store.lp_history("p", Queue::Solo, 0).unwrap();
        assert_eq!(history[0].game_id, Some(9));
        assert_eq!(history[0].champion_id, Some(55));
    }

    #[test]
    fn stores_and_filters_matches() {
        let store = Store::in_memory().unwrap();
        let game = |id: i64, queue: i64, at: i64| MatchDetail {
            game_id: id,
            queue_id: queue,
            created_at: at,
            duration_sec: 1800,
            patch: "16.20".into(),
            teams: vec![],
            players: vec![],
            gold_diff: vec![],
            events: vec![],
        };
        store.save_match("p", &game(1, 420, 10), "client").unwrap();
        store.save_match("p", &game(2, 2400, 20), "client").unwrap();
        store.save_match("p", &game(3, 440, 30), "riot").unwrap();
        store.save_match("p", &game(3, 440, 30), "client").unwrap();

        assert!(store.has_match("p", 2).unwrap());
        assert!(!store.has_match("q", 2).unwrap());
        let all: Vec<_> = store.matches("p", None, i64::MAX, 10).unwrap().iter().map(|m| m.game_id).collect();
        assert_eq!(all, vec![3, 2, 1]);
        let ranked: Vec<_> = store.matches("p", Some(&[420, 440]), i64::MAX, 10).unwrap().iter().map(|m| m.game_id).collect();
        assert_eq!(ranked, vec![3, 1]);
        let page: Vec<_> = store.matches("p", None, 30, 1).unwrap().iter().map(|m| m.game_id).collect();
        assert_eq!(page, vec![2]);
        assert_eq!(store.match_detail(2).unwrap().unwrap().queue_id, 2400);
    }

    #[test]
    fn dedupes_games_across_owners() {
        let store = Store::in_memory().unwrap();
        let game = |id: i64, queue: i64| MatchDetail {
            game_id: id,
            queue_id: queue,
            created_at: 0,
            duration_sec: 900,
            patch: "16.20".into(),
            teams: vec![],
            players: vec![],
            gold_diff: vec![],
            events: vec![],
        };
        store.save_match("me", &game(1, 2400), "client").unwrap();
        store.save_match("*", &game(1, 2400), "client").unwrap();
        store.save_match("*", &game(2, 2400), "client").unwrap();
        store.save_match("*", &game(3, 420), "client").unwrap();
        assert!(store.has_game(2).unwrap() && !store.has_game(9).unwrap());
        assert_eq!(store.games_in_queue(2400).unwrap().len(), 2);
    }

    #[test]
    fn meta_upserts() {
        let store = Store::in_memory().unwrap();
        store.set_meta("k", "a").unwrap();
        store.set_meta("k", "b").unwrap();
        assert_eq!(store.get_meta("k").unwrap().as_deref(), Some("b"));
    }
}
