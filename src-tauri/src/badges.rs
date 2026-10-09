use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::matches::{MatchDetail, PlayerDetail};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Badge {
    Mvp,
    Ace,
    Penta,
    Quadra,
    Unkillable,
    FirstBlood,
    TopDamage,
    Vision,
    Farmer,
    Tank,
    Teamplayer,
}

const MIN_GAME_SEC: i64 = 15 * 60;

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

pub fn annotate(detail: &mut MatchDetail) {
    if detail.duration_sec < 300 || detail.players.len() < 10 {
        return;
    }
    let minutes = (detail.duration_sec as f64 / 60.0).max(1.0);
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

    let snapshot = detail.players.clone();
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
        if p.deaths == 0 && detail.duration_sec >= MIN_GAME_SEC {
            badges.push(Badge::Unkillable);
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
        p.badges = badges;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn hands_out_badges() {
        let mut g = game();
        annotate(&mut g);
        let carry = &g.players[0].badges;
        for b in [Badge::Mvp, Badge::Penta, Badge::Unkillable, Badge::FirstBlood, Badge::TopDamage, Badge::Farmer, Badge::Teamplayer] {
            assert!(carry.contains(&b), "missing {b:?} in {carry:?}");
        }
        assert!(g.players[6].badges.contains(&Badge::Vision));
        assert_eq!(g.players.iter().filter(|p| p.badges.contains(&Badge::Ace)).count(), 1);
        assert!(g.players.iter().filter(|p| p.win).all(|p| !p.badges.contains(&Badge::Ace)));
    }

    #[test]
    fn remakes_get_nothing() {
        let mut g = game();
        g.duration_sec = 200;
        annotate(&mut g);
        assert!(g.players.iter().all(|p| p.badges.is_empty()));
    }
}
