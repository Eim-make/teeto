use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MatchDetail {
    #[ts(type = "number")]
    pub game_id: i64,
    #[ts(type = "number")]
    pub queue_id: i64,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub duration_sec: i64,
    pub patch: String,
    pub teams: Vec<TeamDetail>,
    pub players: Vec<PlayerDetail>,
    pub gold_diff: Vec<i32>,
    pub events: Vec<MatchEvent>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TeamDetail {
    pub team_id: i32,
    pub win: bool,
    pub bans: Vec<i32>,
    pub towers: i32,
    pub dragons: i32,
    pub barons: i32,
    pub heralds: i32,
    pub grubs: i32,
    pub inhibitors: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PlayerDetail {
    pub participant_id: i32,
    pub team_id: i32,
    pub puuid: String,
    pub game_name: String,
    pub tag_line: String,
    pub champion_id: i32,
    pub champ_level: i32,
    pub position: String,
    pub spells: Vec<i32>,
    pub items: Vec<i32>,
    pub primary_style: i32,
    pub sub_style: i32,
    pub perks: Vec<i32>,
    pub kills: i32,
    pub deaths: i32,
    pub assists: i32,
    pub cs: i32,
    pub gold: i32,
    pub damage_to_champions: i32,
    pub damage_taken: i32,
    pub vision_score: i32,
    pub wards_placed: i32,
    pub control_wards: i32,
    pub win: bool,
    #[serde(default)]
    pub largest_multi_kill: i32,
    #[serde(default)]
    pub first_blood: bool,
    #[serde(default)]
    pub badges: Vec<crate::badges::Badge>,
    #[serde(default)]
    pub augments: Vec<i32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum EventKind {
    Kill,
    Tower,
    Inhibitor,
    Dragon,
    Baron,
    Herald,
    Grubs,
    Atakhan,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MatchEvent {
    #[ts(type = "number")]
    pub at_ms: i64,
    pub kind: EventKind,
    pub team_id: i32,
    pub killer: i32,
    pub victim: i32,
    pub assists: Vec<i32>,
    pub detail: String,
}

impl MatchDetail {
    pub fn player(&self, puuid: &str) -> Option<&PlayerDetail> {
        self.players.iter().find(|p| p.puuid == puuid)
    }

    fn team_of(&self, participant: i32) -> i32 {
        self.players.iter().find(|p| p.participant_id == participant).map_or(0, |p| p.team_id)
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Timeline {
    #[serde(default)]
    pub frames: Vec<Frame>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    #[serde(default)]
    pub participant_frames: HashMap<String, ParticipantFrame>,
    #[serde(default)]
    pub events: Vec<RawEvent>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ParticipantFrame {
    pub total_gold: i32,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RawEvent {
    #[serde(rename = "type")]
    pub kind: String,
    pub timestamp: i64,
    pub killer_id: i32,
    pub victim_id: i32,
    pub team_id: i32,
    pub assisting_participant_ids: Vec<i32>,
    pub building_type: String,
    pub lane_type: String,
    pub monster_type: String,
    pub monster_sub_type: String,
}

fn apply_timeline(detail: &mut MatchDetail, timeline: &Timeline) {
    detail.gold_diff = timeline
        .frames
        .iter()
        .map(|f| {
            f.participant_frames.iter().fold(0, |acc, (id, pf)| {
                match id.parse().map(|id| detail.team_of(id)) {
                    Ok(100) => acc + pf.total_gold,
                    Ok(200) => acc - pf.total_gold,
                    _ => acc,
                }
            })
        })
        .collect();

    let mut events = Vec::new();
    for e in timeline.frames.iter().flat_map(|f| &f.events) {
        let killer_team = detail.team_of(e.killer_id);
        let (kind, team_id, detail_text) = match e.kind.as_str() {
            "CHAMPION_KILL" => (EventKind::Kill, killer_team, String::new()),
            "BUILDING_KILL" => {
                let kind = if e.building_type == "INHIBITOR_BUILDING" { EventKind::Inhibitor } else { EventKind::Tower };
                let team = if e.team_id == 100 { 200 } else if e.team_id == 200 { 100 } else { killer_team };
                (kind, team, e.lane_type.clone())
            }
            "ELITE_MONSTER_KILL" => {
                let kind = match e.monster_type.as_str() {
                    "DRAGON" => EventKind::Dragon,
                    "BARON_NASHOR" => EventKind::Baron,
                    "RIFTHERALD" => EventKind::Herald,
                    "HORDE" => EventKind::Grubs,
                    "ATAKHAN" => EventKind::Atakhan,
                    _ => continue,
                };
                let team = if killer_team == 0 { e.team_id } else { killer_team };
                (kind, team, e.monster_sub_type.clone())
            }
            _ => continue,
        };
        events.push(MatchEvent {
            at_ms: e.timestamp,
            kind,
            team_id,
            killer: e.killer_id,
            victim: e.victim_id,
            assists: e.assisting_participant_ids.clone(),
            detail: detail_text,
        });
    }
    detail.events = events;
}

fn patch_of(version: &str) -> String {
    version.split('.').take(2).collect::<Vec<_>>().join(".")
}

fn position(lane: &str, role: &str) -> String {
    match (lane, role) {
        ("TOP", _) => "TOP",
        ("JUNGLE", _) => "JUNGLE",
        ("MIDDLE" | "MID", _) => "MIDDLE",
        ("BOTTOM" | "BOT", "DUO_SUPPORT" | "SUPPORT") => "UTILITY",
        ("BOTTOM" | "BOT", _) => "BOTTOM",
        ("UTILITY", _) => "UTILITY",
        _ => "",
    }
    .to_owned()
}

pub mod lcu {
    use super::*;

    #[derive(Debug, Clone, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Game {
        pub game_id: i64,
        pub queue_id: i64,
        pub game_creation: i64,
        pub game_duration: i64,
        #[serde(default)]
        pub game_version: String,
        #[serde(default)]
        pub participants: Vec<Participant>,
        #[serde(default)]
        pub participant_identities: Vec<Identity>,
        #[serde(default)]
        pub teams: Vec<Team>,
    }

    #[derive(Debug, Clone, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Participant {
        pub participant_id: i32,
        pub team_id: i32,
        pub champion_id: i32,
        #[serde(default)]
        pub spell1_id: i32,
        #[serde(default)]
        pub spell2_id: i32,
        pub stats: HashMap<String, serde_json::Value>,
        #[serde(default)]
        pub timeline: Lane,
    }

    #[derive(Debug, Clone, Default, Deserialize)]
    #[serde(default)]
    pub struct Lane {
        pub lane: String,
        pub role: String,
    }

    #[derive(Debug, Clone, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Identity {
        pub participant_id: i32,
        pub player: Player,
    }

    #[derive(Debug, Clone, Default, Deserialize)]
    #[serde(rename_all = "camelCase", default)]
    pub struct Player {
        pub puuid: String,
        pub game_name: String,
        pub tag_line: String,
    }

    #[derive(Debug, Clone, Default, Deserialize)]
    #[serde(rename_all = "camelCase", default)]
    pub struct Team {
        pub team_id: i32,
        pub win: String,
        pub bans: Vec<Ban>,
        pub tower_kills: i32,
        pub dragon_kills: i32,
        pub baron_kills: i32,
        pub rift_herald_kills: i32,
        pub horde_kills: i32,
        pub inhibitor_kills: i32,
    }

    #[derive(Debug, Clone, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Ban {
        pub champion_id: i32,
    }

    fn stat(stats: &HashMap<String, serde_json::Value>, key: &str) -> i32 {
        match stats.get(key) {
            Some(serde_json::Value::Bool(b)) => *b as i32,
            Some(v) => v.as_i64().unwrap_or_default() as i32,
            None => 0,
        }
    }

    pub fn convert(game: Game, timeline: Option<Timeline>) -> MatchDetail {
        let identities: HashMap<i32, Player> =
            game.participant_identities.into_iter().map(|i| (i.participant_id, i.player)).collect();
        let players = game
            .participants
            .into_iter()
            .map(|p| {
                let s = &p.stats;
                let who = identities.get(&p.participant_id).cloned().unwrap_or_default();
                PlayerDetail {
                    participant_id: p.participant_id,
                    team_id: p.team_id,
                    puuid: who.puuid,
                    game_name: who.game_name,
                    tag_line: who.tag_line,
                    champion_id: p.champion_id,
                    champ_level: stat(s, "champLevel"),
                    position: position(&p.timeline.lane, &p.timeline.role),
                    spells: vec![p.spell1_id, p.spell2_id],
                    items: (0..7).map(|i| stat(s, &format!("item{i}"))).collect(),
                    primary_style: stat(s, "perkPrimaryStyle"),
                    sub_style: stat(s, "perkSubStyle"),
                    perks: (0..6).map(|i| stat(s, &format!("perk{i}"))).collect(),
                    kills: stat(s, "kills"),
                    deaths: stat(s, "deaths"),
                    assists: stat(s, "assists"),
                    cs: stat(s, "totalMinionsKilled") + stat(s, "neutralMinionsKilled"),
                    gold: stat(s, "goldEarned"),
                    damage_to_champions: stat(s, "totalDamageDealtToChampions"),
                    damage_taken: stat(s, "totalDamageTaken"),
                    vision_score: stat(s, "visionScore"),
                    wards_placed: stat(s, "wardsPlaced"),
                    control_wards: stat(s, "visionWardsBoughtInGame"),
                    win: stat(s, "win") == 1,
                    largest_multi_kill: stat(s, "largestMultiKill"),
                    first_blood: stat(s, "firstBloodKill") == 1,
                    badges: Vec::new(),
                    augments: (1..=6).map(|i| stat(s, &format!("playerAugment{i}"))).filter(|a| *a > 0).collect(),
                }
            })
            .collect();
        let teams = game
            .teams
            .into_iter()
            .map(|t| TeamDetail {
                team_id: t.team_id,
                win: t.win == "Win",
                bans: t.bans.into_iter().map(|b| b.champion_id).collect(),
                towers: t.tower_kills,
                dragons: t.dragon_kills,
                barons: t.baron_kills,
                heralds: t.rift_herald_kills,
                grubs: t.horde_kills,
                inhibitors: t.inhibitor_kills,
            })
            .collect();
        let mut detail = MatchDetail {
            game_id: game.game_id,
            queue_id: game.queue_id,
            created_at: game.game_creation,
            duration_sec: game.game_duration,
            patch: patch_of(&game.game_version),
            teams,
            players,
            gold_diff: Vec::new(),
            events: Vec::new(),
        };
        if let Some(t) = timeline {
            apply_timeline(&mut detail, &t);
        }
        detail
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LCU_GAME: &str = r#"{
        "gameId": 1, "queueId": 420, "gameCreation": 1000, "gameDuration": 1800, "gameVersion": "16.20.712.1234",
        "participants": [
            {"participantId": 1, "teamId": 100, "championId": 17, "spell1Id": 4, "spell2Id": 14,
             "stats": {"win": true, "kills": 5, "deaths": 1, "assists": 3, "item0": 3020, "item6": 3340,
                       "totalMinionsKilled": 180, "neutralMinionsKilled": 8, "perk0": 8010, "perkPrimaryStyle": 8000, "perkSubStyle": 8200},
             "timeline": {"lane": "TOP", "role": "SOLO"}},
            {"participantId": 2, "teamId": 200, "championId": 122, "stats": {"win": false, "kills": 1},
             "timeline": {"lane": "BOTTOM", "role": "DUO_SUPPORT"}}
        ],
        "participantIdentities": [
            {"participantId": 1, "player": {"puuid": "me", "gameName": "Shroom", "tagLine": "EUW"}},
            {"participantId": 2, "player": {"puuid": "them", "gameName": "Axe", "tagLine": "EUW"}}
        ],
        "teams": [
            {"teamId": 100, "win": "Win", "bans": [{"championId": 25}], "towerKills": 8, "dragonKills": 3},
            {"teamId": 200, "win": "Fail", "bans": [], "towerKills": 2}
        ]
    }"#;

    const TIMELINE: &str = r#"{"frames": [
        {"participantFrames": {"1": {"totalGold": 500}, "2": {"totalGold": 500}}, "events": []},
        {"participantFrames": {"1": {"totalGold": 1500}, "2": {"totalGold": 1100}}, "events": [
            {"type": "CHAMPION_KILL", "timestamp": 65000, "killerId": 1, "victimId": 2, "assistingParticipantIds": []},
            {"type": "BUILDING_KILL", "timestamp": 70000, "killerId": 1, "teamId": 200, "buildingType": "TOWER_BUILDING", "laneType": "TOP_LANE"},
            {"type": "ELITE_MONSTER_KILL", "timestamp": 80000, "killerId": 2, "monsterType": "DRAGON", "monsterSubType": "FIRE_DRAGON"},
            {"type": "ITEM_PURCHASED", "timestamp": 90000, "participantId": 1}
        ]}
    ]}"#;

    #[test]
    fn converts_lcu_game_with_timeline() {
        let game: lcu::Game = serde_json::from_str(LCU_GAME).unwrap();
        let timeline: Timeline = serde_json::from_str(TIMELINE).unwrap();
        let d = lcu::convert(game, Some(timeline));

        assert_eq!(d.patch, "16.20");
        let me = d.player("me").unwrap();
        assert_eq!((me.kills, me.cs, me.win, me.position.as_str()), (5, 188, true, "TOP"));
        assert_eq!(me.items[0], 3020);
        assert_eq!(me.spells, vec![4, 14]);
        assert_eq!(d.player("them").unwrap().position, "UTILITY");
        assert!(d.teams[0].win && !d.teams[1].win);
        assert_eq!(d.teams[0].bans, vec![25]);

        assert_eq!(d.gold_diff, vec![0, 400]);
        let kinds: Vec<_> = d.events.iter().map(|e| (e.kind, e.team_id)).collect();
        assert_eq!(kinds, vec![(EventKind::Kill, 100), (EventKind::Tower, 100), (EventKind::Dragon, 200)]);
    }

}
