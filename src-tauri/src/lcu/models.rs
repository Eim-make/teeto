use std::collections::HashMap;

use serde::Deserialize;

use crate::lp::{Queue, Standing};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentSummoner {
    pub puuid: String,
    #[serde(default)]
    pub game_name: String,
    #[serde(default)]
    pub tag_line: String,
    #[serde(default)]
    pub summoner_level: i32,
    #[serde(default)]
    pub profile_icon_id: i32,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RankedStats {
    #[serde(default)]
    pub queue_map: HashMap<String, RankedQueue>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RankedQueue {
    pub tier: String,
    pub division: String,
    pub league_points: i32,
    pub wins: i32,
    pub losses: i32,
    pub is_provisional: bool,
    pub highest_tier: String,
    pub highest_division: String,
    pub previous_season_end_tier: String,
    pub previous_season_end_division: String,
}

impl RankedStats {
    pub fn standing(&self, queue: Queue) -> Option<Standing> {
        let q = self.queue_map.get(queue.key())?;
        Some(Standing {
            tier: q.tier.clone(),
            division: q.division.clone(),
            lp: q.league_points,
            wins: q.wins,
            losses: q.losses,
        })
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EogStatsBlock {
    pub game_id: i64,
    #[serde(default)]
    pub queue_type: String,
    pub local_player: EogPlayer,
    #[serde(default)]
    pub teams: Vec<EogTeam>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EogPlayer {
    pub champion_id: i32,
    #[serde(default)]
    pub stats: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EogTeam {
    #[serde(default)]
    pub is_player_team: bool,
    #[serde(default)]
    pub is_winning_team: bool,
}

impl EogStatsBlock {
    pub fn stat(&self, key: &str) -> Option<i32> {
        self.local_player.stats.get(key)?.as_i64().map(|v| v as i32)
    }

    pub fn won(&self) -> Option<bool> {
        self.teams.iter().find(|t| t.is_player_team).map(|t| t.is_winning_team)
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct MatchHistory {
    pub games: MatchHistoryGames,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MatchHistoryGames {
    #[serde(default)]
    pub games: Vec<HistoryGame>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryGame {
    pub game_id: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ranked_stats() {
        let json = r#"{"queueMap":{"RANKED_SOLO_5x5":{"tier":"EMERALD","division":"II","leaguePoints":64,"wins":40,"losses":31,"isProvisional":false,"extra":1}}}"#;
        let stats: RankedStats = serde_json::from_str(json).unwrap();
        let s = stats.standing(Queue::Solo).unwrap();
        assert_eq!((s.tier.as_str(), s.division.as_str(), s.lp, s.wins), ("EMERALD", "II", 64, 40));
        assert!(stats.standing(Queue::Flex).is_none());
    }

    #[test]
    fn parses_eog_block() {
        let json = r#"{"gameId":7012345678,"queueType":"RANKED_SOLO_5x5","localPlayer":{"championId":17,"stats":{"CHAMPIONS_KILLED":9,"NUM_DEATHS":2,"ASSISTS":11}},"teams":[{"isPlayerTeam":false,"isWinningTeam":false},{"isPlayerTeam":true,"isWinningTeam":true}]}"#;
        let eog: EogStatsBlock = serde_json::from_str(json).unwrap();
        assert_eq!(eog.game_id, 7012345678);
        assert_eq!(eog.stat("CHAMPIONS_KILLED"), Some(9));
        assert_eq!(eog.won(), Some(true));
    }
}
