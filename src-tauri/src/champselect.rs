use futures_util::future::join_all;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::json;
use ts_rs::TS;

use crate::error::Result;
use crate::lcu::LcuClient;
use crate::live::{scout_player, LivePlayer, Profiles, QueueInfo, Seat};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SelectSlot {
    pub cell_id: i32,
    pub champion_id: i32,
    pub locked: bool,
    pub position: String,
    pub game_name: String,
    pub tag_line: String,
    pub hidden: bool,
    pub is_me: bool,
    pub spells: Vec<i32>,
    pub scout: Option<LivePlayer>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ChampSelect {
    #[ts(type = "number")]
    pub queue_id: i64,
    pub phase: String,
    #[ts(type = "number")]
    pub time_left_ms: i64,
    pub my_team: Vec<SelectSlot>,
    pub their_team: Vec<SelectSlot>,
    pub my_bans: Vec<i32>,
    pub their_bans: Vec<i32>,
    pub bench: Vec<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Session {
    #[serde(default)]
    local_player_cell_id: i32,
    #[serde(default)]
    my_team: Vec<Member>,
    #[serde(default)]
    their_team: Vec<Member>,
    #[serde(default)]
    bans: Bans,
    #[serde(default)]
    actions: Vec<Vec<Action>>,
    #[serde(default)]
    timer: Timer,
    #[serde(default)]
    bench_champions: Vec<Bench>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Member {
    cell_id: i32,
    champion_id: i32,
    champion_pick_intent: i32,
    assigned_position: String,
    puuid: String,
    game_name: String,
    tag_line: String,
    name_visibility_type: String,
    spell1_id: i64,
    spell2_id: i64,
    team: i32,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Bans {
    my_team_bans: Vec<i32>,
    their_team_bans: Vec<i32>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Action {
    actor_cell_id: i32,
    champion_id: i32,
    completed: bool,
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Timer {
    phase: String,
    adjusted_time_left_in_phase: i64,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Bench {
    champion_id: i32,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Gameflow {
    #[serde(default)]
    game_data: GameDataQueue,
}

#[derive(Debug, Default, Deserialize)]
struct GameDataQueue {
    #[serde(default)]
    queue: QueueInfo,
}

fn slot(m: &Member, actions: &[Action], me: i32) -> SelectSlot {
    let locked = actions.iter().any(|a| a.actor_cell_id == m.cell_id && a.kind == "pick" && a.completed);
    let champion_id = if m.champion_id > 0 { m.champion_id } else { m.champion_pick_intent };
    let hidden = m.name_visibility_type == "HIDDEN" || m.game_name.is_empty();
    SelectSlot {
        cell_id: m.cell_id,
        champion_id,
        locked: locked || (m.champion_id > 0 && actions.is_empty()),
        position: m.assigned_position.to_ascii_uppercase(),
        game_name: if hidden { String::new() } else { m.game_name.clone() },
        tag_line: if hidden { String::new() } else { m.tag_line.clone() },
        hidden,
        is_me: m.cell_id == me,
        spells: [m.spell1_id, m.spell2_id].iter().filter(|s| **s > 0 && **s < 100_000).map(|s| *s as i32).collect(),
        scout: None,
    }
}

pub async fn read(client: &LcuClient, profiles: &Profiles, me_puuid: &str) -> Result<ChampSelect> {
    let (session, flow) = tokio::join!(
        client.get::<Session>("/lol-champ-select/v1/session"),
        client.get::<Gameflow>("/lol-gameflow/v1/session"),
    );
    let session = session?;
    let queue_id = flow.map(|f| f.game_data.queue.id).unwrap_or_default();
    let actions: Vec<Action> = session.actions.into_iter().flatten().collect();
    let me = session.local_player_cell_id;

    let mut my_team: Vec<SelectSlot> = session.my_team.iter().map(|m| slot(m, &actions, me)).collect();
    let their_team: Vec<SelectSlot> = session.their_team.iter().map(|m| slot(m, &actions, me)).collect();

    let scouts = join_all(session.my_team.iter().zip(&my_team).map(|(m, s)| async move {
        if s.hidden || m.puuid.is_empty() {
            return None;
        }
        let seat = Seat { puuid: &m.puuid, team_id: m.team, champion_id: s.champion_id, position: &s.position };
        Some(scout_player(client, profiles, &seat, queue_id, me_puuid).await)
    }))
    .await;
    for (slot, scout) in my_team.iter_mut().zip(scouts) {
        slot.scout = scout;
    }

    Ok(ChampSelect {
        queue_id,
        phase: session.timer.phase,
        time_left_ms: session.timer.adjusted_time_left_in_phase,
        my_team,
        their_team,
        my_bans: session.bans.my_team_bans.into_iter().filter(|b| *b > 0).collect(),
        their_bans: session.bans.their_team_bans.into_iter().filter(|b| *b > 0).collect(),
        bench: session.bench_champions.into_iter().map(|b| b.champion_id).collect(),
    })
}

pub async fn set_spells(client: &LcuClient, spell1: i32, spell2: i32) -> Result<()> {
    let body = json!({ "spell1Id": spell1, "spell2Id": spell2 });
    client.send(Method::PATCH, "/lol-champ-select/v1/session/my-selection", Some(&body)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hides_anonymous_allies() {
        let member = |cell: i32, vis: &str| Member {
            cell_id: cell,
            champion_pick_intent: 17,
            game_name: "Someone".into(),
            name_visibility_type: vis.into(),
            spell1_id: 4,
            spell2_id: 14,
            ..Default::default()
        };
        let actions = vec![Action { actor_cell_id: 1, champion_id: 17, completed: true, kind: "pick".into() }];
        let hidden = slot(&member(0, "HIDDEN"), &actions, 1);
        assert!(hidden.hidden && hidden.game_name.is_empty());
        assert!(!hidden.locked);
        assert_eq!(hidden.champion_id, 17);
        let me = slot(&member(1, "VISIBLE"), &actions, 1);
        assert!(me.is_me && me.locked && !me.hidden);
        assert_eq!(me.spells, vec![4, 14]);
    }
}
