use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use futures_util::future::join_all;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::Result;
use crate::lcu::models::RankedStats;
use crate::lcu::LcuClient;
use crate::lp::{Queue, Standing};
use crate::matches::lcu::Game;

const RANKED_QUEUES: [i64; 2] = [420, 440];
const PROFILE_TTL: Duration = Duration::from_secs(10 * 60);
const RECENT_SHOWN: usize = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PlayerBadge {
    HotStreak,
    Main,
    Expert,
    HighWinRate,
    Veteran,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RecentGame {
    pub champion_id: i32,
    pub win: bool,
    pub kills: i32,
    pub deaths: i32,
    pub assists: i32,
    #[ts(type = "number")]
    pub queue_id: i64,
    #[ts(type = "number")]
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ChampionCount {
    pub champion_id: i32,
    pub games: i32,
    pub wins: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RoleCount {
    pub role: String,
    pub games: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LivePlayer {
    pub puuid: String,
    pub team_id: i32,
    pub champion_id: i32,
    pub game_name: String,
    pub tag_line: String,
    pub level: i32,
    pub position: String,
    pub rank: Option<Standing>,
    pub peak: Option<Standing>,
    pub last_season: Option<Standing>,
    pub mastery_level: i32,
    pub mastery_points: i32,
    pub recent_games: i32,
    pub recent_wins: i32,
    pub recent_kda: Vec<i32>,
    pub champion_games: i32,
    pub champion_wins: i32,
    pub champion_kda: Vec<i32>,
    pub recent: Vec<RecentGame>,
    pub main_role: String,
    pub roles: Vec<RoleCount>,
    pub top_champions: Vec<ChampionCount>,
    pub day_games: i32,
    pub day_wins: i32,
    pub streak: i32,
    pub badges: Vec<PlayerBadge>,
    pub is_me: bool,
    pub spells: Vec<String>,
    pub spell_ids: Vec<i32>,
    pub keystone: i32,
    pub sub_style: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LiveGame {
    #[ts(type = "number")]
    pub game_id: i64,
    #[ts(type = "number")]
    pub queue_id: i64,
    pub players: Vec<LivePlayer>,
}

#[derive(Debug, Clone, Default)]
pub struct Profile {
    game_name: String,
    tag_line: String,
    level: i32,
    ranked: Option<RankedStats>,
    mastery: HashMap<i32, (i32, i32)>,
    games: Vec<(RecentGame, &'static str)>,
}

#[derive(Default)]
pub struct Profiles {
    cache: Mutex<HashMap<String, (Instant, Profile)>>,
}

impl Profiles {
    fn get(&self, puuid: &str) -> Option<Profile> {
        let cache = self.cache.lock().ok()?;
        let (at, profile) = cache.get(puuid)?;
        (at.elapsed() < PROFILE_TTL).then(|| profile.clone())
    }

    fn put(&self, puuid: &str, profile: &Profile) {
        if let Ok(mut cache) = self.cache.lock() {
            cache.insert(puuid.to_owned(), (Instant::now(), profile.clone()));
        }
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Summoner {
    game_name: String,
    tag_line: String,
    summoner_level: i32,
}

#[derive(Debug, Deserialize)]
struct History {
    games: HistoryGames,
}

#[derive(Debug, Deserialize)]
struct HistoryGames {
    #[serde(default)]
    games: Vec<Game>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Mastery {
    champion_id: i32,
    #[serde(default)]
    champion_level: i32,
    #[serde(default)]
    champion_points: i32,
}

fn lane(lane: &str, role: &str) -> &'static str {
    match (lane, role) {
        ("TOP", _) => "TOP",
        ("JUNGLE", _) => "JUNGLE",
        ("MIDDLE" | "MID", _) => "MIDDLE",
        ("BOTTOM" | "BOT", "DUO_SUPPORT" | "SUPPORT") => "UTILITY",
        ("BOTTOM" | "BOT", _) => "BOTTOM",
        _ => "",
    }
}

fn int(stats: &HashMap<String, serde_json::Value>, key: &str) -> i32 {
    stats.get(key).and_then(|v| v.as_i64()).unwrap_or_default() as i32
}

async fn load_profile(client: &LcuClient, profiles: &Profiles, puuid: &str) -> Profile {
    if let Some(p) = profiles.get(puuid) {
        return p;
    }
    let paths = [
        format!("/lol-summoner/v2/summoners/puuid/{puuid}"),
        format!("/lol-ranked/v1/ranked-stats/{puuid}"),
        format!("/lol-match-history/v1/products/lol/{puuid}/matches?begIndex=0&endIndex=20"),
        format!("/lol-champion-mastery/v1/{puuid}/champion-mastery"),
    ];
    let (summoner, ranked, history, mastery) = tokio::join!(
        client.get::<Summoner>(&paths[0]),
        client.get::<RankedStats>(&paths[1]),
        client.get::<History>(&paths[2]),
        client.get::<Vec<Mastery>>(&paths[3]),
    );
    let summoner = summoner.unwrap_or_default();
    let mut games: Vec<(i64, RecentGame, &'static str)> = history
        .map(|h| h.games.games)
        .unwrap_or_default()
        .iter()
        .filter(|g| g.game_duration >= 300)
        .filter_map(|g| {
            let part = g.participants.first()?;
            let s = &part.stats;
            Some((
                g.game_creation,
                RecentGame {
                    champion_id: part.champion_id,
                    win: s.get("win").and_then(|v| v.as_bool()).unwrap_or(false),
                    kills: int(s, "kills"),
                    deaths: int(s, "deaths"),
                    assists: int(s, "assists"),
                    queue_id: g.queue_id,
                    created_at: g.game_creation,
                },
                lane(&part.timeline.lane, &part.timeline.role),
            ))
        })
        .collect();
    games.sort_by_key(|g| std::cmp::Reverse(g.0));
    let profile = Profile {
        game_name: summoner.game_name,
        tag_line: summoner.tag_line,
        level: summoner.summoner_level,
        ranked: ranked.ok(),
        mastery: mastery
            .unwrap_or_default()
            .into_iter()
            .map(|m| (m.champion_id, (m.champion_level, m.champion_points)))
            .collect(),
        games: games.into_iter().map(|(_, g, l)| (g, l)).collect(),
    };
    profiles.put(puuid, &profile);
    profile
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct Form {
    pub games: i32,
    pub wins: i32,
    pub kda: [i32; 3],
    pub champion_games: i32,
    pub champion_wins: i32,
    pub champion_kda: [i32; 3],
    pub main_role: String,
    pub main_champion_share: f64,
    pub streak: i32,
}

pub fn form(games: &[(RecentGame, &'static str)], champion: i32) -> Form {
    let mut f = Form { games: games.len() as i32, ..Default::default() };
    let mut roles: HashMap<&str, i32> = HashMap::new();
    for (g, role) in games {
        f.wins += g.win as i32;
        f.kda = [f.kda[0] + g.kills, f.kda[1] + g.deaths, f.kda[2] + g.assists];
        if g.champion_id == champion {
            f.champion_games += 1;
            f.champion_wins += g.win as i32;
            f.champion_kda = [f.champion_kda[0] + g.kills, f.champion_kda[1] + g.deaths, f.champion_kda[2] + g.assists];
        }
        if !role.is_empty() {
            *roles.entry(role).or_default() += 1;
        }
    }
    f.main_role = roles.into_iter().max_by_key(|(_, n)| *n).map(|(r, _)| r.to_owned()).unwrap_or_default();
    f.main_champion_share = if f.games > 0 { f.champion_games as f64 / f.games as f64 } else { 0.0 };
    if let Some((first, _)) = games.first() {
        let run = games.iter().take_while(|(g, _)| g.win == first.win).count() as i32;
        f.streak = if first.win { run } else { -run };
    }
    f
}

const DAY_MS: i64 = 24 * 3600 * 1000;

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or_default()
}

pub fn day(games: &[(RecentGame, &'static str)]) -> (i32, i32) {
    let since = now_ms() - DAY_MS;
    games
        .iter()
        .filter(|(g, _)| g.created_at >= since)
        .fold((0, 0), |(n, w), (g, _)| (n + 1, w + g.win as i32))
}

pub fn top_champions(games: &[(RecentGame, &'static str)], n: usize) -> Vec<ChampionCount> {
    let mut by: HashMap<i32, (i32, i32)> = HashMap::new();
    for (g, _) in games {
        let e = by.entry(g.champion_id).or_default();
        e.0 += 1;
        e.1 += g.win as i32;
    }
    let mut out: Vec<ChampionCount> =
        by.into_iter().map(|(champion_id, (games, wins))| ChampionCount { champion_id, games, wins }).collect();
    out.sort_by(|a, b| b.games.cmp(&a.games).then(b.wins.cmp(&a.wins)));
    out.truncate(n);
    out
}

pub fn roles(games: &[(RecentGame, &'static str)]) -> Vec<RoleCount> {
    let mut by: HashMap<&str, i32> = HashMap::new();
    for (_, role) in games.iter().filter(|(_, r)| !r.is_empty()) {
        *by.entry(role).or_default() += 1;
    }
    let mut out: Vec<RoleCount> = by.into_iter().map(|(role, games)| RoleCount { role: role.to_owned(), games }).collect();
    out.sort_by_key(|r| std::cmp::Reverse(r.games));
    out
}

pub struct BadgeInput<'a> {
    pub form: &'a Form,
    pub rank: Option<&'a Standing>,
    pub mastery_points: i32,
}

pub fn player_badges(i: &BadgeInput) -> Vec<PlayerBadge> {
    let f = i.form;
    let mut b = Vec::new();
    if f.streak >= 3 {
        b.push(PlayerBadge::HotStreak);
    }
    if i.mastery_points >= 100_000 {
        b.push(PlayerBadge::Expert);
    } else if f.games >= 8 && f.main_champion_share >= 0.6 {
        b.push(PlayerBadge::Main);
    }
    if let Some(r) = i.rank {
        let games = r.wins + r.losses;
        if games >= 25 && r.wins as f64 / games as f64 >= 0.6 {
            b.push(PlayerBadge::HighWinRate);
        }
        if games >= 400 {
            b.push(PlayerBadge::Veteran);
        }
    }
    b
}

fn standing(tier: &str, division: &str) -> Option<Standing> {
    let s = Standing { tier: tier.into(), division: division.into(), lp: 0, wins: 0, losses: 0 };
    s.absolute().is_some().then_some(s)
}

pub struct Seat<'a> {
    pub puuid: &'a str,
    pub team_id: i32,
    pub champion_id: i32,
    pub position: &'a str,
}

pub async fn scout_player(client: &LcuClient, profiles: &Profiles, seat: &Seat<'_>, queue_id: i64, me: &str) -> LivePlayer {
    let p = load_profile(client, profiles, seat.puuid).await;
    let rank_queue = if queue_id == 440 { Queue::Flex } else { Queue::Solo };
    let solo = p.ranked.as_ref().and_then(|r| r.queue_map.get(Queue::Solo.key()));
    let rank = p.ranked.as_ref().and_then(|r| r.standing(rank_queue)).filter(|s| s.absolute().is_some());
    let f = form(&p.games, seat.champion_id);
    let (mastery_level, mastery_points) = p.mastery.get(&seat.champion_id).copied().unwrap_or_default();
    let position = if RANKED_QUEUES.contains(&queue_id) { seat.position.to_ascii_uppercase() } else { String::new() };
    let badges = player_badges(&BadgeInput { form: &f, rank: rank.as_ref(), mastery_points });

    LivePlayer {
        puuid: seat.puuid.to_owned(),
        team_id: seat.team_id,
        champion_id: seat.champion_id,
        game_name: p.game_name,
        tag_line: p.tag_line,
        level: p.level,
        position,
        rank,
        peak: solo.and_then(|q| standing(&q.highest_tier, &q.highest_division)),
        last_season: solo.and_then(|q| standing(&q.previous_season_end_tier, &q.previous_season_end_division)),
        mastery_level,
        mastery_points,
        recent_games: f.games,
        recent_wins: f.wins,
        recent_kda: f.kda.to_vec(),
        champion_games: f.champion_games,
        champion_wins: f.champion_wins,
        champion_kda: f.champion_kda.to_vec(),
        recent: p.games.iter().take(RECENT_SHOWN).map(|(g, _)| g.clone()).collect(),
        main_role: f.main_role,
        roles: roles(&p.games),
        top_champions: top_champions(&p.games, 3),
        day_games: day(&p.games).0,
        day_wins: day(&p.games).1,
        streak: f.streak,
        badges,
        is_me: seat.puuid == me,
        spells: Vec::new(),
        spell_ids: Vec::new(),
        keystone: 0,
        sub_style: 0,
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Session {
    game_data: GameData,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GameData {
    #[serde(default)]
    game_id: i64,
    #[serde(default)]
    queue: QueueInfo,
    #[serde(default)]
    team_one: Vec<SessionPlayer>,
    #[serde(default)]
    team_two: Vec<SessionPlayer>,
    #[serde(default)]
    player_champion_selections: Vec<Selection>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Selection {
    puuid: String,
    spell1_id: i64,
    spell2_id: i64,
}

#[derive(Debug, Default, Deserialize)]
pub struct QueueInfo {
    #[serde(default)]
    pub id: i64,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct SessionPlayer {
    puuid: String,
    champion_id: i32,
    selected_position: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct InGamePlayer {
    riot_id: String,
    riot_id_game_name: String,
    riot_id_tag_line: String,
    summoner_name: String,
    summoner_spells: Option<InGameSpells>,
    runes: Option<InGameRunes>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct InGameSpells {
    summoner_spell_one: InGameSpell,
    summoner_spell_two: InGameSpell,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct InGameSpell {
    raw_display_name: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct InGameRunes {
    keystone: InGameRune,
    secondary_rune_tree: InGameRune,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct InGameRune {
    id: i32,
}

fn same_player(g: &InGamePlayer, name: &str, tag: &str, full: &str) -> bool {
    if name.is_empty() {
        return false;
    }
    (g.riot_id_game_name.eq_ignore_ascii_case(name) && (g.riot_id_tag_line.is_empty() || g.riot_id_tag_line.eq_ignore_ascii_case(tag)))
        || g.riot_id.eq_ignore_ascii_case(full)
        || g.summoner_name.eq_ignore_ascii_case(name)
        || g.summoner_name.eq_ignore_ascii_case(full)
}

pub fn spell_id(raw: &str) -> Option<String> {
    let name = raw.strip_prefix("GeneratedTip_SummonerSpell_")?.strip_suffix("_DisplayName")?;
    (!name.is_empty()).then(|| name.to_owned())
}

async fn in_game_players() -> Vec<InGamePlayer> {
    let Ok(http) = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(2))
        .build()
    else {
        return Vec::new();
    };
    match http.get("https://127.0.0.1:2999/liveclientdata/playerlist").send().await {
        Ok(res) if res.status().is_success() => res.json().await.unwrap_or_default(),
        _ => Vec::new(),
    }
}

pub async fn scout_game(client: &LcuClient, profiles: &Profiles, me: &str) -> Result<Option<LiveGame>> {
    let session: Session = client.get("/lol-gameflow/v1/session").await?;
    let data = session.game_data;
    if data.team_one.is_empty() && data.team_two.is_empty() {
        return Ok(None);
    }
    let queue_id = data.queue.id;
    let seats: Vec<Seat> = data
        .team_one
        .iter()
        .map(|p| (p, 100))
        .chain(data.team_two.iter().map(|p| (p, 200)))
        .filter(|(p, _)| !p.puuid.is_empty())
        .map(|(p, team_id)| Seat { puuid: &p.puuid, team_id, champion_id: p.champion_id, position: &p.selected_position })
        .collect();
    let (mut players, in_game) =
        tokio::join!(join_all(seats.iter().map(|s| scout_player(client, profiles, s, queue_id, me))), in_game_players());

    for player in &mut players {
        if let Some(sel) = data.player_champion_selections.iter().find(|s| s.puuid == player.puuid) {
            player.spell_ids =
                [sel.spell1_id, sel.spell2_id].iter().filter(|id| **id > 0 && **id < 100_000).map(|id| *id as i32).collect();
        }
        let full = format!("{}#{}", player.game_name, player.tag_line);
        let found = in_game.iter().find(|g| same_player(g, &player.game_name, &player.tag_line, &full));
        if let Some(g) = found {
            if let Some(spells) = &g.summoner_spells {
                player.spells = [&spells.summoner_spell_one, &spells.summoner_spell_two]
                    .iter()
                    .filter_map(|s| spell_id(&s.raw_display_name))
                    .collect();
            }
            if let Some(runes) = &g.runes {
                player.keystone = runes.keystone.id;
                player.sub_style = runes.secondary_rune_tree.id;
            }
        }
    }
    Ok(Some(LiveGame { game_id: data.game_id, queue_id, players }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn g(champion_id: i32, win: bool, k: i32, d: i32, a: i32, role: &'static str) -> (RecentGame, &'static str) {
        (RecentGame { champion_id, win, kills: k, deaths: d, assists: a, queue_id: 420, created_at: 0 }, role)
    }

    #[test]
    fn reads_recent_form() {
        let games = [g(17, true, 5, 1, 3, "TOP"), g(17, true, 2, 2, 2, "TOP"), g(17, true, 1, 1, 1, "TOP"), g(86, false, 0, 5, 0, "TOP"), g(17, true, 1, 0, 0, "JUNGLE")];
        let f = form(&games, 17);
        assert_eq!((f.games, f.wins, f.champion_games, f.streak), (5, 4, 4, 3));
        assert_eq!(f.champion_kda, [9, 4, 6]);
        assert_eq!(f.kda, [9, 9, 6]);
        assert_eq!(f.main_role, "TOP");
    }

    #[test]
    fn gives_only_positive_badges() {
        let games: Vec<_> = (0..10).map(|i| g(17, i < 4, 1, 1, 1, "TOP")).collect();
        let rank = Standing { tier: "GOLD".into(), division: "I".into(), lp: 50, wins: 70, losses: 30 };
        let f = form(&games, 17);
        let b = player_badges(&BadgeInput { form: &f, rank: Some(&rank), mastery_points: 5000 });
        assert_eq!(b, vec![PlayerBadge::HotStreak, PlayerBadge::Main, PlayerBadge::HighWinRate]);
        let losing: Vec<_> = (0..10).map(|_| g(99, false, 0, 5, 0, "TOP")).collect();
        let low = Standing { tier: "IRON".into(), division: "IV".into(), lp: 0, wins: 10, losses: 40 };
        let f = form(&losing, 17);
        assert!(player_badges(&BadgeInput { form: &f, rank: Some(&low), mastery_points: 0 }).is_empty());
        let b = player_badges(&BadgeInput { form: &f, rank: None, mastery_points: 250_000 });
        assert_eq!(b, vec![PlayerBadge::Expert]);
    }

    #[test]
    fn summarizes_pool_roles_and_last_day() {
        let mut games = vec![g(17, true, 1, 1, 1, "TOP"), g(17, false, 1, 1, 1, "TOP"), g(86, true, 1, 1, 1, "JUNGLE")];
        games[0].0.created_at = now_ms() - 1000;
        games[1].0.created_at = now_ms() - 2 * DAY_MS;
        let top = top_champions(&games, 3);
        assert_eq!((top[0].champion_id, top[0].games, top[0].wins), (17, 2, 1));
        let r = roles(&games);
        assert_eq!((r[0].role.as_str(), r[0].games), ("TOP", 2));
        assert_eq!(day(&games), (1, 1));
    }

    #[test]
    fn parses_live_client_spell_names() {
        assert_eq!(spell_id("GeneratedTip_SummonerSpell_SummonerFlash_DisplayName").as_deref(), Some("SummonerFlash"));
        assert_eq!(spell_id("Flash"), None);
    }
}
