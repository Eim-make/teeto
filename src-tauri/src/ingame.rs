use std::collections::HashMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

const DRAGON_FIRST: f64 = 300.0;
const DRAGON_RESPAWN: f64 = 300.0;
const ELDER_RESPAWN: f64 = 360.0;
const BARON_FIRST: f64 = 1200.0;
const BARON_RESPAWN: f64 = 360.0;
const INHIB_RESPAWN: f64 = 300.0;
const SUMMONERS_RIFT: i32 = 11;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct InGamePlayer {
    pub riot_id: String,
    pub champion: String,
    pub team_id: i32,
    pub position: String,
    pub level: i32,
    pub items: Vec<i32>,
    pub gold: i32,
    pub kills: i32,
    pub deaths: i32,
    pub assists: i32,
    pub cs: i32,
    pub ward_score: i32,
    pub dead: bool,
    pub respawn_in: f64,
    pub keystone: i32,
    pub sub_style: i32,
    pub spells: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ObjectiveTimer {
    pub kind: String,
    pub label: String,
    pub team_id: i32,
    pub respawn_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct InGame {
    pub game_time: f64,
    pub mode: String,
    pub map: i32,
    pub me: String,
    pub my_gold: i32,
    pub players: Vec<InGamePlayer>,
    pub timers: Vec<ObjectiveTimer>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct AllGameData {
    active_player: RawActivePlayer,
    all_players: Vec<RawPlayer>,
    events: RawEvents,
    game_data: RawGameData,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawActivePlayer {
    riot_id: String,
    summoner_name: String,
    current_gold: f64,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawGameData {
    game_time: f64,
    game_mode: String,
    map_number: i32,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawEvents {
    #[serde(rename = "Events")]
    events: Vec<RawEvent>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawEvent {
    #[serde(rename = "EventName")]
    name: String,
    #[serde(rename = "EventTime")]
    time: f64,
    #[serde(rename = "KillerName")]
    killer: String,
    #[serde(rename = "DragonType")]
    dragon: String,
    #[serde(rename = "InhibKilled")]
    inhib: String,
    #[serde(rename = "InhibRespawned")]
    inhib_respawned: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawPlayer {
    raw_champion_name: String,
    riot_id: String,
    riot_id_game_name: String,
    riot_id_tag_line: String,
    summoner_name: String,
    team: String,
    position: String,
    level: i32,
    items: Vec<RawItem>,
    scores: RawScores,
    is_dead: bool,
    respawn_timer: f64,
    runes: Option<RawRunes>,
    summoner_spells: Option<RawSpells>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawItem {
    #[serde(rename = "itemID")]
    item_id: i32,
    count: i32,
    price: i32,
    slot: i32,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawScores {
    kills: i32,
    deaths: i32,
    assists: i32,
    creep_score: i32,
    ward_score: f64,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawRunes {
    keystone: RawId,
    secondary_rune_tree: RawId,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawId {
    id: i32,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawSpells {
    summoner_spell_one: RawSpell,
    summoner_spell_two: RawSpell,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawSpell {
    raw_display_name: String,
}

fn team(raw: &str) -> i32 {
    if raw.eq_ignore_ascii_case("CHAOS") {
        200
    } else {
        100
    }
}

fn champion_id(raw: &str) -> String {
    raw.rsplit('_').next().unwrap_or(raw).to_owned()
}

fn inhib_label(id: &str) -> (i32, String) {
    let owner = if id.contains("_T2_") { 200 } else { 100 };
    let label = match id.rsplit('_').next() {
        Some("L1") => "Top inhibitor",
        Some("C1") => "Mid inhibitor",
        Some("R1") => "Bot inhibitor",
        _ => "Inhibitor",
    };
    (owner, label.to_owned())
}

fn timers(data: &AllGameData) -> Vec<ObjectiveTimer> {
    let names: HashMap<String, i32> = data
        .all_players
        .iter()
        .flat_map(|p| {
            let t = team(&p.team);
            [
                (p.riot_id_game_name.to_lowercase(), t),
                (p.summoner_name.to_lowercase(), t),
                (p.riot_id.to_lowercase(), t),
            ]
        })
        .filter(|(n, _)| !n.is_empty())
        .collect();
    let killer_team = |name: &str| {
        let lower = name.to_lowercase();
        names.get(&lower).copied().or_else(|| names.get(lower.split('#').next().unwrap_or("")).copied()).unwrap_or(0)
    };

    let now = data.game_data.game_time;
    let rift = data.game_data.map_number == SUMMONERS_RIFT;
    let events = &data.events.events;
    let mut out = Vec::new();

    if rift {
        let last_dragon = events.iter().rfind(|e| e.name == "DragonKill");
        out.push(match last_dragon {
            Some(e) => ObjectiveTimer {
                kind: "dragon".into(),
                label: format!("{} dragon taken", if e.dragon.is_empty() { "Last" } else { &e.dragon }),
                team_id: killer_team(&e.killer),
                respawn_at: e.time + if e.dragon == "Elder" { ELDER_RESPAWN } else { DRAGON_RESPAWN },
            },
            None => ObjectiveTimer { kind: "dragon".into(), label: "Dragon".into(), team_id: 0, respawn_at: DRAGON_FIRST },
        });
        let last_baron = events.iter().rfind(|e| e.name == "BaronKill");
        out.push(match last_baron {
            Some(e) => ObjectiveTimer {
                kind: "baron".into(),
                label: "Baron taken".into(),
                team_id: killer_team(&e.killer),
                respawn_at: e.time + BARON_RESPAWN,
            },
            None => ObjectiveTimer { kind: "baron".into(), label: "Baron".into(), team_id: 0, respawn_at: BARON_FIRST },
        });
    }

    let mut inhibs: HashMap<&str, f64> = HashMap::new();
    for e in events {
        match e.name.as_str() {
            "InhibKilled" if !e.inhib.is_empty() => {
                inhibs.insert(&e.inhib, e.time + INHIB_RESPAWN);
            }
            "InhibRespawned" if !e.inhib_respawned.is_empty() => {
                inhibs.remove(e.inhib_respawned.as_str());
            }
            _ => {}
        }
    }
    let mut down: Vec<_> = inhibs.into_iter().filter(|(_, at)| *at > now).collect();
    down.sort_by(|a, b| a.1.total_cmp(&b.1));
    for (id, at) in down {
        let (owner, label) = inhib_label(id);
        out.push(ObjectiveTimer { kind: "inhibitor".into(), label, team_id: owner, respawn_at: at });
    }
    out
}

fn player(p: &RawPlayer) -> InGamePlayer {
    let mut items: Vec<&RawItem> = p.items.iter().collect();
    items.sort_by_key(|i| i.slot);
    InGamePlayer {
        riot_id: if p.riot_id.is_empty() {
            format!("{}#{}", p.riot_id_game_name, p.riot_id_tag_line)
        } else {
            p.riot_id.clone()
        },
        champion: champion_id(&p.raw_champion_name),
        team_id: team(&p.team),
        position: p.position.to_ascii_uppercase(),
        level: p.level,
        items: items.iter().map(|i| i.item_id).collect(),
        gold: p.items.iter().map(|i| i.price * i.count.max(1)).sum(),
        kills: p.scores.kills,
        deaths: p.scores.deaths,
        assists: p.scores.assists,
        cs: p.scores.creep_score,
        ward_score: p.scores.ward_score.round() as i32,
        dead: p.is_dead,
        respawn_in: p.respawn_timer,
        keystone: p.runes.as_ref().map_or(0, |r| r.keystone.id),
        sub_style: p.runes.as_ref().map_or(0, |r| r.secondary_rune_tree.id),
        spells: p
            .summoner_spells
            .as_ref()
            .map(|s| {
                [&s.summoner_spell_one, &s.summoner_spell_two]
                    .iter()
                    .filter_map(|s| crate::live::spell_id(&s.raw_display_name))
                    .collect()
            })
            .unwrap_or_default(),
    }
}

fn build(data: &AllGameData) -> InGame {
    InGame {
        game_time: data.game_data.game_time,
        mode: data.game_data.game_mode.clone(),
        map: data.game_data.map_number,
        me: if data.active_player.riot_id.is_empty() {
            data.active_player.summoner_name.clone()
        } else {
            data.active_player.riot_id.clone()
        },
        my_gold: data.active_player.current_gold.floor() as i32,
        players: data.all_players.iter().map(player).collect(),
        timers: timers(data),
    }
}

pub async fn read() -> Option<InGame> {
    let http = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_millis(1500))
        .build()
        .ok()?;
    let res = http.get("https://127.0.0.1:2999/liveclientdata/allgamedata").send().await.ok()?;
    if !res.status().is_success() {
        return None;
    }
    let data: AllGameData = res.json().await.ok()?;
    (!data.all_players.is_empty()).then(|| build(&data))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
      "activePlayer": {"riotId": "Kaido#EUW", "currentGold": 1234.7},
      "allPlayers": [
        {"rawChampionName": "game_character_displayname_LeeSin", "riotId": "Kaido#EUW", "riotIdGameName": "Kaido", "riotIdTagLine": "EUW",
         "team": "ORDER", "position": "JUNGLE", "level": 9, "isDead": false, "respawnTimer": 0.0,
         "items": [{"itemID": 3047, "count": 1, "price": 1100, "slot": 1}, {"itemID": 1036, "count": 2, "price": 350, "slot": 0}],
         "scores": {"kills": 3, "deaths": 1, "assists": 4, "creepScore": 90, "wardScore": 12.6},
         "runes": {"keystone": {"id": 8010}, "secondaryRuneTree": {"id": 8200}},
         "summonerSpells": {"summonerSpellOne": {"rawDisplayName": "GeneratedTip_SummonerSpell_SummonerFlash_DisplayName"},
                            "summonerSpellTwo": {"rawDisplayName": "GeneratedTip_SummonerSpell_SummonerSmite_DisplayName"}}},
        {"rawChampionName": "game_character_displayname_Ahri", "riotId": "Nyx#EUW", "team": "CHAOS", "level": 8,
         "items": [], "scores": {"kills": 1, "deaths": 3, "assists": 0, "creepScore": 80, "wardScore": 5.0}}
      ],
      "events": {"Events": [
        {"EventName": "GameStart", "EventTime": 0.0},
        {"EventName": "DragonKill", "EventTime": 400.0, "DragonType": "Fire", "KillerName": "Kaido"},
        {"EventName": "InhibKilled", "EventTime": 1500.0, "InhibKilled": "Barracks_T2_C1", "KillerName": "Kaido"},
        {"EventName": "InhibKilled", "EventTime": 1100.0, "InhibKilled": "Barracks_T1_L1", "KillerName": "Nyx"},
        {"EventName": "InhibRespawned", "EventTime": 1400.0, "InhibRespawned": "Barracks_T1_L1"}
      ]},
      "gameData": {"gameTime": 1600.0, "gameMode": "CLASSIC", "mapNumber": 11}
    }"#;

    #[test]
    fn tolerates_null_runes_in_aram() {
        let json = r#"{"allPlayers":[{"rawChampionName":"game_character_displayname_Maokai","riotId":"TDEimas#EUNE","team":"CHAOS",
            "runes":null,"summonerSpells":{"summonerSpellOne":{"rawDisplayName":"GeneratedTip_SummonerSpell_SummonerFlash_DisplayName"}},
            "items":[],"scores":{"kills":0,"deaths":0,"assists":0,"creepScore":0,"wardScore":0.0}}],
            "events":{"Events":[]},"gameData":{"gameMode":"KIWI","gameTime":0.06,"mapNumber":12}}"#;
        let data: AllGameData = serde_json::from_str(json).unwrap();
        let g = build(&data);
        assert_eq!((g.players[0].keystone, g.players[0].team_id), (0, 200));
        assert_eq!(g.players[0].spells, vec!["SummonerFlash"]);
        assert!(g.timers.is_empty());
    }

    #[test]
    fn reads_players_and_timers() {
        let data: AllGameData = serde_json::from_str(SAMPLE).unwrap();
        let g = build(&data);
        let lee = &g.players[0];
        assert_eq!((lee.champion.as_str(), lee.team_id, lee.gold, lee.ward_score), ("LeeSin", 100, 1800, 13));
        assert_eq!(lee.items, vec![1036, 3047]);
        assert_eq!((g.me.as_str(), g.my_gold, lee.position.as_str()), ("Kaido#EUW", 1234, "JUNGLE"));
        assert_eq!(lee.spells, vec!["SummonerFlash", "SummonerSmite"]);
        assert_eq!(g.players[1].team_id, 200);

        let dragon = g.timers.iter().find(|t| t.kind == "dragon").unwrap();
        assert_eq!((dragon.respawn_at, dragon.team_id), (700.0, 100));
        let baron = g.timers.iter().find(|t| t.kind == "baron").unwrap();
        assert_eq!(baron.respawn_at, 1200.0);
        let inhibs: Vec<_> = g.timers.iter().filter(|t| t.kind == "inhibitor").collect();
        assert_eq!(inhibs.len(), 1);
        assert_eq!((inhibs[0].team_id, inhibs[0].label.as_str(), inhibs[0].respawn_at), (200, "Mid inhibitor", 1800.0));
    }
}
