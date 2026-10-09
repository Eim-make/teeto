use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::matches::MatchDetail;

pub const MAYHEM_QUEUE: i64 = 2400;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AugmentStat {
    pub id: i32,
    pub games: i32,
    pub wins: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ChampionAugments {
    pub champion_id: i32,
    pub games: i32,
    pub wins: i32,
    pub augments: Vec<AugmentStat>,
}

type Tally = (i32, i32, HashMap<i32, (i32, i32)>);

pub fn tally(games: &[MatchDetail]) -> Vec<ChampionAugments> {
    let mut champs: HashMap<i32, Tally> = HashMap::new();
    for g in games.iter().filter(|g| g.queue_id == MAYHEM_QUEUE && g.duration_sec >= 300) {
        for p in &g.players {
            let entry = champs.entry(p.champion_id).or_default();
            entry.0 += 1;
            entry.1 += p.win as i32;
            for a in &p.augments {
                let aug = entry.2.entry(*a).or_default();
                aug.0 += 1;
                aug.1 += p.win as i32;
            }
        }
    }
    let mut out: Vec<ChampionAugments> = champs
        .into_iter()
        .map(|(champion_id, (games, wins, augs))| {
            let mut augments: Vec<AugmentStat> =
                augs.into_iter().map(|(id, (games, wins))| AugmentStat { id, games, wins }).collect();
            augments.sort_by(|a, b| b.games.cmp(&a.games).then(b.wins.cmp(&a.wins)));
            ChampionAugments { champion_id, games, wins, augments }
        })
        .collect();
    out.sort_by_key(|c| std::cmp::Reverse(c.games));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_augments_per_champion() {
        let json = r#"{"gameId":1,"queueId":2400,"createdAt":0,"durationSec":900,"patch":"16.20","teams":[],"goldDiff":[],"events":[],
            "players":[
              {"participantId":1,"teamId":100,"puuid":"a","gameName":"","tagLine":"","championId":17,"champLevel":18,"position":"","spells":[],"items":[],"primaryStyle":0,"subStyle":0,"perks":[],"kills":0,"deaths":0,"assists":0,"cs":0,"gold":0,"damageToChampions":0,"damageTaken":0,"visionScore":0,"wardsPlaced":0,"controlWards":0,"win":true,"augments":[1205,1133]},
              {"participantId":2,"teamId":200,"puuid":"b","gameName":"","tagLine":"","championId":17,"champLevel":18,"position":"","spells":[],"items":[],"primaryStyle":0,"subStyle":0,"perks":[],"kills":0,"deaths":0,"assists":0,"cs":0,"gold":0,"damageToChampions":0,"damageTaken":0,"visionScore":0,"wardsPlaced":0,"controlWards":0,"win":false,"augments":[1205]}
            ]}"#;
        let game: MatchDetail = serde_json::from_str(json).unwrap();
        let mut ranked = game.clone();
        ranked.queue_id = 420;
        let out = tally(&[game, ranked]);
        assert_eq!(out.len(), 1);
        assert_eq!((out[0].games, out[0].wins), (2, 1));
        assert_eq!(out[0].augments[0], AugmentStat { id: 1205, games: 2, wins: 1 });
    }
}
