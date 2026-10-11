use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::matches::{EventKind, MatchDetail, PlayerDetail};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Badge {
    Mvp,
    Ace,
    Penta,
    Quadra,
    Unkillable,
    Comeback,
    WireToWire,
    BigBrain,
    CleanLaning,
    FirstBlood,
    TopDamage,
    Vision,
    Farmer,
    Tank,
    Teamplayer,
    Demolisher,
    Lockdown,
    IronWall,
    WardHunter,
    BargainBin,
    Speedrun,
    Marathon,
    NightOwl,
    Grinder,
    BounceBack,
    PocketPick,
    Heartbreaker,
    GrayScreen,
    Generous,
    Pacifist,
    WardrobeEmpty,
}

const MIN_GAME_SEC: i64 = 15 * 60;
const SPEEDRUN_SEC: i64 = 20 * 60;
const MARATHON_SEC: i64 = 40 * 60;
const SWING_GOLD: i32 = 5000;
const BEHIND_GOLD: i32 = 1000;
const LANING_MS: i64 = 14 * 60_000;
const MIN_WARDS_KILLED: i32 = 3;
const GRAY_SCREEN_DEATHS: i32 = 10;
const GRINDER_GAMES: usize = 10;
const BOUNCE_BACK_LOSSES: usize = 3;
const POCKET_PICK_HISTORY: usize = 20;
const HOWLING_ABYSS_QUEUES: [i64; 4] = [100, 450, 720, 2400];

fn score(p: &PlayerDetail, team_kills: i32, duration_min: f64) -> f64 {
    let kda = (p.kills + p.assists) as f64 / p.deaths.max(1) as f64;
    let kp = if team_kills > 0 { (p.kills + p.assists) as f64 / team_kills as f64 } else { 0.0 };
    let dpm = p.damage_to_champions as f64 / duration_min;
    let vpm = p.vision_score as f64 / duration_min;
    kda.min(10.0) * 1.2 + kp * 6.0 + dpm / 250.0 + vpm * 1.5
}

fn is_max(players: &[PlayerDetail], p: &PlayerDetail, value: impl Fn(&PlayerDetail) -> i32) -> bool {
    let v = value(p);
    v > 0 && players.iter().all(|o| value(o) <= v)
}

fn lead_for(detail: &MatchDetail, team: i32) -> impl Iterator<Item = i32> + '_ {
    let sign = if team == 100 { 1 } else { -1 };
    detail.gold_diff.iter().map(move |d| d * sign)
}

fn lead_at(detail: &MatchDetail, team: i32, at_ms: i64) -> Option<i32> {
    lead_for(detail, team).nth((at_ms / 60_000) as usize)
}

fn on_rift(detail: &MatchDetail) -> bool {
    !HOWLING_ABYSS_QUEUES.contains(&detail.queue_id)
}

pub fn annotate(detail: &mut MatchDetail) {
    if detail.duration_sec < 300 || detail.players.len() < 10 {
        return;
    }
    let minutes = (detail.duration_sec as f64 / 60.0).max(1.0);
    let rift = on_rift(detail);
    let team_kills = |team: i32| detail.players.iter().filter(|p| p.team_id == team).map(|p| p.kills).sum::<i32>();
    let scores: Vec<f64> = detail.players.iter().map(|p| score(p, team_kills(p.team_id), minutes)).collect();
    let best_of = |win: bool| {
        detail
            .players
            .iter()
            .zip(&scores)
            .filter(|(p, _)| p.win == win)
            .max_by(|a, b| a.1.total_cmp(b.1))
            .map(|(p, _)| p.participant_id)
    };
    let (mvp, ace) = (best_of(true), best_of(false));
    let comebacks: Vec<i32> = [100, 200].into_iter().filter(|&t| lead_for(detail, t).any(|l| l <= -SWING_GOLD)).collect();
    let wire_to_wire: Vec<i32> = [100, 200]
        .into_iter()
        .filter(|&t| detail.gold_diff.len() > 3 && lead_for(detail, t).skip(3).all(|l| l > 0))
        .collect();
    let big_brains: Vec<i32> = detail
        .events
        .iter()
        .filter(|e| matches!(e.kind, EventKind::Baron | EventKind::Dragon))
        .filter(|e| lead_at(detail, e.team_id, e.at_ms).is_some_and(|l| l <= -BEHIND_GOLD))
        .map(|e| e.killer)
        .collect();
    let early_deaths: Vec<i32> =
        detail.events.iter().filter(|e| e.kind == EventKind::Kill && e.at_ms < LANING_MS).map(|e| e.victim).collect();
    let has_timeline = !detail.events.is_empty();
    let bargain = detail
        .players
        .iter()
        .filter(|p| p.gold > 0)
        .max_by(|a, b| {
            (a.damage_to_champions as f64 / a.gold as f64).total_cmp(&(b.damage_to_champions as f64 / b.gold as f64))
        })
        .map(|p| p.participant_id);

    let snapshot = detail.players.clone();
    let duration = detail.duration_sec;
    for p in &mut detail.players {
        let mut badges = Vec::new();
        if Some(p.participant_id) == mvp {
            badges.push(Badge::Mvp);
        }
        if Some(p.participant_id) == ace {
            badges.push(Badge::Ace);
        }
        match p.largest_multi_kill {
            5.. => badges.push(Badge::Penta),
            4 => badges.push(Badge::Quadra),
            _ => {}
        }
        if p.deaths == 0 && duration >= MIN_GAME_SEC {
            badges.push(Badge::Unkillable);
        }
        if p.win && comebacks.contains(&p.team_id) {
            badges.push(Badge::Comeback);
        }
        if p.win && wire_to_wire.contains(&p.team_id) {
            badges.push(Badge::WireToWire);
        }
        if big_brains.contains(&p.participant_id) {
            badges.push(Badge::BigBrain);
        }
        if rift && has_timeline && duration >= MIN_GAME_SEC && !early_deaths.contains(&p.participant_id) {
            badges.push(Badge::CleanLaning);
        }
        if p.first_blood {
            badges.push(Badge::FirstBlood);
        }
        if is_max(&snapshot, p, |o| o.damage_to_champions) {
            badges.push(Badge::TopDamage);
        }
        if is_max(&snapshot, p, |o| o.vision_score) {
            badges.push(Badge::Vision);
        }
        if is_max(&snapshot, p, |o| o.damage_taken) {
            badges.push(Badge::Tank);
        }
        if p.position != "UTILITY" && p.cs as f64 / minutes >= 8.5 {
            badges.push(Badge::Farmer);
        }
        let kills = snapshot.iter().filter(|o| o.team_id == p.team_id).map(|o| o.kills).sum::<i32>();
        if kills >= 10 && (p.kills + p.assists) * 100 >= kills * 70 {
            badges.push(Badge::Teamplayer);
        }
        if is_max(&snapshot, p, |o| o.turret_damage) {
            badges.push(Badge::Demolisher);
        }
        if is_max(&snapshot, p, |o| o.cc_time) {
            badges.push(Badge::Lockdown);
        }
        if is_max(&snapshot, p, |o| o.mitigated) {
            badges.push(Badge::IronWall);
        }
        if p.wards_killed >= MIN_WARDS_KILLED && is_max(&snapshot, p, |o| o.wards_killed) {
            badges.push(Badge::WardHunter);
        }
        if Some(p.participant_id) == bargain {
            badges.push(Badge::BargainBin);
        }
        if rift && p.win && duration < SPEEDRUN_SEC {
            badges.push(Badge::Speedrun);
        }
        if rift && duration >= MARATHON_SEC {
            badges.push(Badge::Marathon);
        }
        p.badges = badges;
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Played {
    pub game_id: i64,
    pub created_at: i64,
    pub duration_sec: i64,
    pub champion_id: i32,
    pub win: bool,
}

const DAY_MS: i64 = 86_400_000;
const HOUR_MS: i64 = 3_600_000;

pub fn annotate_self(detail: &mut MatchDetail, puuid: &str, history: &[Played], utc_offset_min: i32) {
    if detail.duration_sec < 300 || detail.players.len() < 10 {
        return;
    }
    let rift = on_rift(detail);
    let led_big: Vec<i32> = [100, 200].into_iter().filter(|&t| lead_for(detail, t).any(|l| l >= SWING_GOLD)).collect();
    let first_victim = detail.events.iter().find(|e| e.kind == EventKind::Kill).map(|e| e.victim);
    let (game_id, created_at, duration) = (detail.game_id, detail.created_at, detail.duration_sec);
    let Some(me) = detail.players.iter_mut().find(|p| p.puuid == puuid) else { return };
    let full_length = duration >= SPEEDRUN_SEC;
    let local = |at: i64| at + utc_offset_min as i64 * 60_000;

    let mut extra = Vec::new();
    let end = local(created_at + duration * 1000);
    if (3..6).contains(&end.rem_euclid(DAY_MS).div_euclid(HOUR_MS)) {
        extra.push(Badge::NightOwl);
    }
    let earlier: Vec<&Played> =
        history.iter().filter(|g| g.duration_sec >= 300 && g.created_at < created_at && g.game_id != game_id).collect();
    let today = local(created_at).div_euclid(DAY_MS);
    if earlier.iter().filter(|g| local(g.created_at).div_euclid(DAY_MS) == today).count() + 1 >= GRINDER_GAMES {
        extra.push(Badge::Grinder);
    }
    if me.win
        && earlier.len() >= BOUNCE_BACK_LOSSES
        && earlier.iter().rev().take(BOUNCE_BACK_LOSSES).all(|g| !g.win)
    {
        extra.push(Badge::BounceBack);
    }
    if me.win && earlier.len() >= POCKET_PICK_HISTORY && earlier.iter().all(|g| g.champion_id != me.champion_id) {
        extra.push(Badge::PocketPick);
    }
    if !me.win && led_big.contains(&me.team_id) {
        extra.push(Badge::Heartbreaker);
    }
    if me.deaths >= GRAY_SCREEN_DEATHS {
        extra.push(Badge::GrayScreen);
    }
    if first_victim == Some(me.participant_id) {
        extra.push(Badge::Generous);
    }
    if full_length && me.kills == 0 && me.position != "UTILITY" {
        extra.push(Badge::Pacifist);
    }
    if rift && full_length && me.wards_placed == 0 && me.position != "UTILITY" {
        extra.push(Badge::WardrobeEmpty);
    }
    me.badges.extend(extra);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::matches::MatchEvent;

    fn player(id: i32, team: i32, win: bool, k: i32, d: i32, a: i32, dmg: i32) -> PlayerDetail {
        PlayerDetail {
            participant_id: id,
            team_id: team,
            puuid: format!("p{id}"),
            game_name: String::new(),
            tag_line: String::new(),
            champion_id: 1,
            champ_level: 18,
            position: "MIDDLE".into(),
            spells: vec![],
            items: vec![],
            primary_style: 0,
            sub_style: 0,
            perks: vec![],
            kills: k,
            deaths: d,
            assists: a,
            cs: 150,
            gold: 10000,
            damage_to_champions: dmg,
            damage_taken: 10000,
            vision_score: 20,
            wards_placed: 5,
            control_wards: 1,
            win,
            largest_multi_kill: 1,
            first_blood: false,
            turret_damage: 1000,
            cc_time: 10,
            mitigated: 5000,
            wards_killed: 2,
            badges: vec![],
            augments: vec![],
        }
    }

    fn game() -> MatchDetail {
        let mut players: Vec<PlayerDetail> =
            (1..=5).map(|i| player(i, 100, true, 3, 3, 3, 15000)).chain((6..=10).map(|i| player(i, 200, false, 2, 4, 2, 14000))).collect();
        players[0] = PlayerDetail { kills: 12, deaths: 0, assists: 8, damage_to_champions: 40000, largest_multi_kill: 5, first_blood: true, cs: 300, ..players[0].clone() };
        players[6].vision_score = 80;
        MatchDetail {
            game_id: 1,
            queue_id: 420,
            created_at: 0,
            duration_sec: 30 * 60,
            patch: "16.20".into(),
            teams: vec![],
            players,
            gold_diff: vec![],
            events: vec![],
        }
    }

    fn event(kind: EventKind, minute: i64, team_id: i32, killer: i32, victim: i32) -> MatchEvent {
        MatchEvent { at_ms: minute * 60_000, kind, team_id, killer, victim, assists: vec![], detail: String::new() }
    }

    fn played(game_id: i64, created_at: i64, champion_id: i32, win: bool) -> Played {
        Played { game_id, created_at, duration_sec: 1800, champion_id, win }
    }

    fn has(g: &MatchDetail, id: i32, b: Badge) -> bool {
        g.players.iter().find(|p| p.participant_id == id).is_some_and(|p| p.badges.contains(&b))
    }

    #[test]
    fn hands_out_badges() {
        let mut g = game();
        annotate(&mut g);
        let carry = &g.players[0].badges;
        for b in [Badge::Mvp, Badge::Penta, Badge::Unkillable, Badge::FirstBlood, Badge::TopDamage, Badge::Farmer, Badge::Teamplayer, Badge::BargainBin] {
            assert!(carry.contains(&b), "missing {b:?} in {carry:?}");
        }
        assert!(g.players[6].badges.contains(&Badge::Vision));
        assert_eq!(g.players.iter().filter(|p| p.badges.contains(&Badge::Ace)).count(), 1);
        assert!(g.players.iter().filter(|p| p.win).all(|p| !p.badges.contains(&Badge::Ace)));
        assert!(g.players.iter().all(|p| !p.badges.contains(&Badge::WardHunter)));
    }

    #[test]
    fn remakes_get_nothing() {
        let mut g = game();
        g.duration_sec = 200;
        annotate(&mut g);
        annotate_self(&mut g, "p1", &[], 0);
        assert!(g.players.iter().all(|p| p.badges.is_empty()));
    }

    #[test]
    fn reads_the_gold_lead_story() {
        let mut g = game();
        g.gold_diff = vec![0, -1500, -6000, -2000, 3000, 8000];
        g.events = vec![event(EventKind::Kill, 3, 200, 7, 2), event(EventKind::Baron, 2, 100, 3, 0), event(EventKind::Dragon, 5, 100, 4, 0)];
        annotate(&mut g);
        assert!(has(&g, 1, Badge::Comeback) && !has(&g, 6, Badge::Comeback));
        assert!(!has(&g, 1, Badge::WireToWire));
        assert!(has(&g, 3, Badge::BigBrain) && !has(&g, 4, Badge::BigBrain));
        assert!(!has(&g, 2, Badge::CleanLaning) && has(&g, 1, Badge::CleanLaning));

        let mut lead = game();
        lead.gold_diff = vec![0, 200, -100, 900, 2000, 4000];
        annotate(&mut lead);
        assert!(has(&lead, 1, Badge::WireToWire) && !has(&lead, 6, Badge::WireToWire));
    }

    #[test]
    fn length_badges_skip_aram() {
        let mut fast = game();
        fast.duration_sec = 18 * 60;
        annotate(&mut fast);
        assert!(has(&fast, 1, Badge::Speedrun) && !has(&fast, 6, Badge::Speedrun));
        fast.queue_id = 450;
        annotate(&mut fast);
        assert!(!has(&fast, 1, Badge::Speedrun));

        let mut long = game();
        long.duration_sec = 45 * 60;
        annotate(&mut long);
        assert!(has(&long, 6, Badge::Marathon));
    }

    #[test]
    fn spicy_badges_only_land_on_me() {
        let mut g = game();
        g.gold_diff = vec![0, -2000, -6000, -1000, 3000];
        g.events = vec![event(EventKind::Kill, 2, 100, 1, 7)];
        let me = g.players.iter_mut().find(|p| p.participant_id == 7).unwrap();
        me.deaths = 11;
        me.kills = 0;
        me.wards_placed = 0;
        annotate_self(&mut g, "p7", &[], 0);
        for b in [Badge::Heartbreaker, Badge::GrayScreen, Badge::Generous, Badge::Pacifist, Badge::WardrobeEmpty] {
            assert!(has(&g, 7, b), "missing {b:?}");
        }
        assert!(g.players.iter().filter(|p| p.participant_id != 7).all(|p| p.badges.is_empty()));
    }

    #[test]
    fn session_badges_use_my_history() {
        let start = 10 * DAY_MS + 2 * HOUR_MS;
        let mut g = game();
        g.created_at = start + 9 * HOUR_MS;
        g.players[0].champion_id = 99;
        let mut history: Vec<Played> = (0..20).map(|i| played(100 + i, start - DAY_MS + i * 60_000, 1, true)).collect();
        history.extend((0..9).map(|i| played(200 + i, start + i * HOUR_MS, 1, i < 6)));
        annotate_self(&mut g, "p1", &history, 0);
        for b in [Badge::Grinder, Badge::BounceBack, Badge::PocketPick] {
            assert!(has(&g, 1, b), "missing {b:?}");
        }
        assert!(!has(&g, 1, Badge::NightOwl));

        let mut late = game();
        late.created_at = start + HOUR_MS / 2;
        annotate_self(&mut late, "p1", &[], 0);
        assert!(has(&late, 1, Badge::NightOwl));
        let mut shifted = game();
        shifted.created_at = start + HOUR_MS / 2;
        annotate_self(&mut shifted, "p1", &[], -180);
        assert!(!has(&shifted, 1, Badge::NightOwl));
    }
}
