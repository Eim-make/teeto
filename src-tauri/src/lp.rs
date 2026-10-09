use serde::{Deserialize, Serialize};
use ts_rs::TS;

const TIERS: [&str; 7] = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND"];
const APEX: [&str; 3] = ["MASTER", "GRANDMASTER", "CHALLENGER"];
const DIVISIONS: [&str; 4] = ["IV", "III", "II", "I"];
pub const APEX_BASE: i32 = (TIERS.len() as i32) * 400;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Queue {
    Solo,
    Flex,
}

impl Queue {
    pub const ALL: [Queue; 2] = [Queue::Solo, Queue::Flex];

    pub fn key(self) -> &'static str {
        match self {
            Queue::Solo => "RANKED_SOLO_5x5",
            Queue::Flex => "RANKED_FLEX_SR",
        }
    }

    pub fn from_key(key: &str) -> Option<Queue> {
        Queue::ALL.into_iter().find(|q| q.key() == key)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Standing {
    pub tier: String,
    pub division: String,
    pub lp: i32,
    pub wins: i32,
    pub losses: i32,
}

impl Standing {
    pub fn absolute(&self) -> Option<i32> {
        absolute_lp(&self.tier, &self.division, self.lp)
    }

    pub fn games(&self) -> i32 {
        self.wins + self.losses
    }
}

pub fn absolute_lp(tier: &str, division: &str, lp: i32) -> Option<i32> {
    let tier = tier.to_ascii_uppercase();
    if APEX.contains(&tier.as_str()) {
        return Some(APEX_BASE + lp);
    }
    let t = TIERS.iter().position(|x| *x == tier)? as i32;
    let d = DIVISIONS.iter().position(|x| *x == division)? as i32;
    Some(t * 400 + d * 100 + lp)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Change {
    pub delta: Option<i32>,
    pub games_played: i32,
    pub won: Option<bool>,
}

pub fn diff(before: &Standing, after: &Standing) -> Change {
    let games_played = after.games() - before.games();
    let won = match (games_played, after.wins - before.wins) {
        (1, 1) => Some(true),
        (1, 0) => Some(false),
        _ => None,
    };
    let delta = match (before.absolute(), after.absolute()) {
        (Some(b), Some(a)) => Some(a - b),
        _ => None,
    };
    Change { delta, games_played, won }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(tier: &str, division: &str, lp: i32, wins: i32, losses: i32) -> Standing {
        Standing { tier: tier.into(), division: division.into(), lp, wins, losses }
    }

    #[test]
    fn absolute_lp_orders_tiers_and_divisions() {
        assert_eq!(absolute_lp("IRON", "IV", 0), Some(0));
        assert_eq!(absolute_lp("IRON", "I", 99), Some(399));
        assert_eq!(absolute_lp("EMERALD", "II", 64), Some(5 * 400 + 200 + 64));
        assert_eq!(absolute_lp("MASTER", "I", 0), Some(APEX_BASE));
        assert_eq!(absolute_lp("CHALLENGER", "I", 1200), Some(APEX_BASE + 1200));
    }

    #[test]
    fn unranked_has_no_absolute() {
        assert_eq!(absolute_lp("NONE", "NA", 0), None);
        assert_eq!(absolute_lp("", "", 0), None);
    }

    #[test]
    fn win_within_division() {
        let c = diff(&s("GOLD", "II", 40, 10, 10), &s("GOLD", "II", 63, 11, 10));
        assert_eq!(c, Change { delta: Some(23), games_played: 1, won: Some(true) });
    }

    #[test]
    fn promotion_counts_across_divisions() {
        let c = diff(&s("GOLD", "I", 90, 10, 10), &s("PLATINUM", "IV", 12, 11, 10));
        assert_eq!(c.delta, Some(22));
        assert_eq!(c.won, Some(true));
    }

    #[test]
    fn demotion_counts_across_divisions() {
        let c = diff(&s("EMERALD", "IV", 5, 10, 10), &s("PLATINUM", "I", 75, 10, 11));
        assert_eq!(c.delta, Some(-30));
        assert_eq!(c.won, Some(false));
    }

    #[test]
    fn apex_promotion_from_diamond() {
        let c = diff(&s("DIAMOND", "I", 95, 50, 40), &s("MASTER", "I", 15, 51, 40));
        assert_eq!(c.delta, Some(20));
    }

    #[test]
    fn decay_is_not_a_game() {
        let c = diff(&s("DIAMOND", "IV", 50, 50, 40), &s("DIAMOND", "IV", 0, 50, 40));
        assert_eq!(c, Change { delta: Some(-50), games_played: 0, won: None });
    }

    #[test]
    fn placement_finish_has_no_delta() {
        let c = diff(&s("", "", 0, 4, 0), &s("SILVER", "II", 0, 5, 0));
        assert_eq!(c.delta, None);
        assert_eq!(c.won, Some(true));
    }

    #[test]
    fn missed_games_are_not_attributed() {
        let c = diff(&s("GOLD", "II", 40, 10, 10), &s("GOLD", "II", 80, 13, 11));
        assert_eq!(c.games_played, 4);
        assert_eq!(c.won, None);
    }
}
