import type { CompactMatch, CompactPlayer } from "./db.ts";
import { patchOf } from "./patch.ts";

export interface RiotMatch {
  metadata: { matchId: string; participants: string[] };
  info: {
    gameCreation: number;
    gameDuration: number;
    gameVersion: string;
    queueId: number;
    participants: {
      participantId?: number;
      championId: number;
      teamPosition: string;
      teamId: number;
      win: boolean;
      summoner1Id: number;
      summoner2Id: number;
      item0: number;
      item1: number;
      item2: number;
      item3: number;
      item4: number;
      item5: number;
      perks: {
        statPerks?: { offense: number; flex: number; defense: number };
        styles: { style: number; selections: { perk: number }[] }[];
      };
    }[];
    teams: { bans: { championId: number }[] }[];
  };
}

export interface RiotTimeline {
  info: {
    frames: {
      events: {
        type: string;
        timestamp: number;
        participantId?: number;
        skillSlot?: number;
        levelUpType?: string;
        itemId?: number;
        beforeId?: number;
      }[];
    }[];
  };
}

const START_WINDOW_MS = 90_000;

interface Purchases {
  skills: number[];
  start: number[];
  buys: number[];
}

export function purchases(timeline: RiotTimeline): Map<number, Purchases> {
  const out = new Map<number, Purchases>();
  const get = (id: number) => {
    let p = out.get(id);
    if (!p) {
      p = { skills: [], start: [], buys: [] };
      out.set(id, p);
    }
    return p;
  };
  for (const e of timeline.info.frames.flatMap((f) => f.events)) {
    if (!e.participantId) continue;
    const p = get(e.participantId);
    if (
      e.type === "SKILL_LEVEL_UP" &&
      e.levelUpType === "NORMAL" &&
      e.skillSlot
    ) {
      p.skills.push(e.skillSlot);
    } else if (e.type === "ITEM_PURCHASED" && e.itemId) {
      (e.timestamp < START_WINDOW_MS ? p.start : p.buys).push(e.itemId);
    } else if (e.type === "ITEM_UNDO" && e.beforeId) {
      for (const list of [p.buys, p.start]) {
        const i = list.lastIndexOf(e.beforeId);
        if (i >= 0) {
          list.splice(i, 1);
          break;
        }
      }
    }
  }
  return out;
}

export function compact(
  platform: string,
  m: RiotMatch,
  timeline?: RiotTimeline | null,
): CompactMatch {
  const bought = timeline ? purchases(timeline) : null;
  const players: CompactPlayer[] = m.info.participants.map((p, i) => {
    const [primary, sub] = p.perks.styles;
    const shards = p.perks.statPerks;
    const t = bought?.get(p.participantId ?? i + 1);
    return {
      champion: p.championId,
      position: p.teamPosition,
      team: p.teamId,
      win: p.win,
      primaryStyle: primary?.style ?? 0,
      subStyle: sub?.style ?? 0,
      perks: [...(primary?.selections ?? []), ...(sub?.selections ?? [])].map(
        (s) => s.perk,
      ),
      shards: shards ? [shards.offense, shards.flex, shards.defense] : [],
      spells: [p.summoner1Id, p.summoner2Id],
      items: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5].filter(
        (id) => id > 0,
      ),
      ...(t
        ? {
            skills: t.skills.slice(0, 18),
            start: t.start.slice(0, 6),
            buys: t.buys.slice(0, 30),
          }
        : {}),
    };
  });
  return {
    id: m.metadata.matchId,
    platform,
    patch: patchOf(m.info.gameVersion),
    createdAt: m.info.gameCreation,
    durationSec: m.info.gameDuration,
    bans: m.info.teams
      .flatMap((t) => t.bans.map((b) => b.championId))
      .filter((id) => id > 0),
    players,
  };
}
