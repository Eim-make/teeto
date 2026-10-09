import type { CompactMatch, CompactPlayer } from "./db.ts";

export interface ItemInfo {
  boots: Set<number>;
  legendary: Set<number>;
}

interface Tally {
  games: number;
  wins: number;
}

export interface Option<T> {
  value: T;
  games: number;
  winRate: number;
  pickRate: number;
}

export interface Matchup {
  championId: number;
  games: number;
  winRate: number;
}

export interface RoleStats {
  championId: number;
  position: string;
  games: number;
  winRate: number;
  pickRate: number;
  banRate: number;
  tier: string;
  score: number;
  blended?: boolean;
  runes: Option<{ primaryStyle: number; subStyle: number; perks: number[]; shards: number[] }>[];
  start: Option<number[]>[];
  buildOrder: Option<number[]>[];
  skillPriority: Option<number[]> | null;
  skillOrder: number[] | null;
  spells: Option<number[]>[];
  boots: Option<number>[];
  core: Option<number[]>[];
  best: Matchup[];
  worst: Matchup[];
  matchups: Matchup[];
}

const POSITIONS = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
const MIN_ROLE_GAMES = 20;
const MIN_MATCHUP_GAMES = 8;

function bump<K>(map: Map<K, Tally>, key: K, win: boolean): void {
  const t = map.get(key) ?? { games: 0, wins: 0 };
  t.games++;
  if (win) t.wins++;
  map.set(key, t);
}

function wilson(wins: number, games: number): number {
  if (games === 0) return 0;
  const z = 1.64;
  const p = wins / games;
  return (
    (p +
      (z * z) / (2 * games) -
      z * Math.sqrt((p * (1 - p) + (z * z) / (4 * games)) / games)) /
    (1 + (z * z) / games)
  );
}

function top<T>(
  map: Map<string, Tally>,
  total: number,
  decode: (k: string) => T,
  n: number,
  minShare = 0.02,
): Option<T>[] {
  return [...map.entries()]
    .filter(([, t]) => t.games / total >= minShare)
    .sort((a, b) => b[1].games - a[1].games)
    .slice(0, n)
    .map(([k, t]) => ({
      value: decode(k),
      games: t.games,
      winRate: round(t.wins / t.games),
      pickRate: round(t.games / total),
    }));
}

const round = (x: number) => Math.round(x * 10000) / 10000;

const sum = (map: Map<string, Tally>) => [...map.values()].reduce((s, t) => s + t.games, 0) || 1;

export function skillPriority(skills: number[]): number[] {
  const firstSeen = new Map<number, number>();
  const points = new Map<number, number>();
  skills.slice(0, 15).forEach((slot, i) => {
    if (slot === 4) return;
    points.set(slot, (points.get(slot) ?? 0) + 1);
    if ((points.get(slot) ?? 0) === 3) firstSeen.set(slot, i);
  });
  return [1, 2, 3].sort(
    (a, b) => (points.get(b) ?? 0) - (points.get(a) ?? 0) || (firstSeen.get(a) ?? 99) - (firstSeen.get(b) ?? 99),
  );
}

function topSkills(sequences: Map<string, Tally>, priorities: Map<string, Tally>): number[] | null {
  const best = [...priorities.entries()].sort((a, b) => b[1].games - a[1].games)[0]?.[0];
  if (!best) return null;
  const match = [...sequences.entries()]
    .map(([k, t]) => ({ seq: k.split(",").map(Number), games: t.games }))
    .filter((s) => skillPriority(s.seq).join(",") === best)
    .sort((a, b) => b.games - a.games)[0];
  return match?.seq ?? null;
}

interface Bucket {
  tally: Tally;
  runes: Map<string, Tally>;
  spells: Map<string, Tally>;
  boots: Map<string, Tally>;
  core: Map<string, Tally>;
  vs: Map<number, Tally>;
  start: Map<string, Tally>;
  order: Map<string, Tally>;
  priority: Map<string, Tally>;
  skills: Map<string, Tally>;
  shards: Map<string, Tally>;
}

function bucket(): Bucket {
  return {
    tally: { games: 0, wins: 0 },
    runes: new Map(),
    spells: new Map(),
    boots: new Map(),
    core: new Map(),
    vs: new Map(),
    start: new Map(),
    order: new Map(),
    priority: new Map(),
    skills: new Map(),
    shards: new Map(),
  };
}

export function aggregate(
  matches: CompactMatch[],
  items: ItemInfo,
): RoleStats[] {
  const buckets = new Map<string, Bucket>();
  const bans = new Map<number, number>();
  const total = matches.length;

  for (const m of matches) {
    for (const id of new Set(m.bans)) bans.set(id, (bans.get(id) ?? 0) + 1);
    for (const p of m.players) {
      if (!POSITIONS.includes(p.position)) continue;
      const key = `${p.champion}:${p.position}`;
      const b = buckets.get(key) ?? bucket();
      buckets.set(key, b);
      b.tally.games++;
      if (p.win) b.tally.wins++;
      bump(b.runes, `${p.primaryStyle}|${p.subStyle}|${p.perks.join(",")}`, p.win);
      if (p.shards?.length === 3) bump(b.shards, p.shards.join(","), p.win);
      if (p.start?.length) bump(b.start, [...p.start].sort((x, y) => x - y).join(","), p.win);
      if (p.buys) {
        const order = [...new Set(p.buys.filter((i) => items.legendary.has(i)))].slice(0, 3);
        if (order.length === 3) bump(b.order, order.join(","), p.win);
      }
      if (p.skills && p.skills.length >= 15) {
        bump(b.priority, skillPriority(p.skills).join(","), p.win);
        bump(b.skills, p.skills.slice(0, 15).join(","), p.win);
      }
      bump(b.spells, [...p.spells].sort((x, y) => x - y).join(","), p.win);
      const boots = p.items.find((i) => items.boots.has(i));
      if (boots) bump(b.boots, String(boots), p.win);
      const core = p.items.filter((i) => items.legendary.has(i)).slice(0, 3);
      if (core.length === 3) bump(b.core, core.join(","), p.win);
      const opponent = m.players.find(
        (o: CompactPlayer) => o.team !== p.team && o.position === p.position,
      );
      if (opponent) bump(b.vs, opponent.champion, p.win);
    }
  }

  const rows: RoleStats[] = [];
  for (const [key, b] of buckets) {
    if (b.tally.games < MIN_ROLE_GAMES) continue;
    const [champion = "0", position = ""] = key.split(":");
    const championId = Number(champion);
    const matchups = [...b.vs.entries()]
      .filter(([, t]) => t.games >= MIN_MATCHUP_GAMES)
      .map(([id, t]) => ({
        championId: id,
        games: t.games,
        winRate: round(t.wins / t.games),
      }));
    rows.push({
      championId,
      position,
      games: b.tally.games,
      winRate: round(b.tally.wins / b.tally.games),
      pickRate: round(b.tally.games / total),
      banRate: round((bans.get(championId) ?? 0) / total),
      tier: "",
      score:
        wilson(b.tally.wins, b.tally.games) +
        Math.min(0.03, (b.tally.games / total) * 0.3),
      runes: top(
        b.runes,
        b.tally.games,
        (k) => {
          const [primary = "0", sub = "0", perks = ""] = k.split("|");
          return {
            primaryStyle: Number(primary),
            subStyle: Number(sub),
            perks: perks.split(",").map(Number),
            shards: top(b.shards, sum(b.shards), (s) => s.split(",").map(Number), 1, 0)[0]?.value ?? [],
          };
        },
        3,
      ),
      spells: top(b.spells, b.tally.games, (k) => k.split(",").map(Number), 2),
      boots: top(b.boots, b.tally.games, Number, 2),
      core: top(
        b.core,
        b.tally.games,
        (k) => k.split(",").map(Number),
        3,
        0.01,
      ),
      start: top(b.start, sum(b.start), (k) => k.split(",").map(Number), 2),
      buildOrder: top(b.order, sum(b.order), (k) => k.split(",").map(Number), 3, 0.01),
      skillPriority: top(b.priority, sum(b.priority), (k) => k.split(",").map(Number), 1)[0] ?? null,
      skillOrder: topSkills(b.skills, b.priority),
      matchups: [...matchups].sort((a, z) => z.games - a.games),
      best: matchups
        .filter((m) => m.winRate > 0.5)
        .sort((a, z) => z.winRate - a.winRate).slice(0, 5),
      worst: matchups
        .filter((m) => m.winRate < 0.5)
        .sort((a, z) => a.winRate - z.winRate).slice(0, 5),
    });
  }

  assignTiers(rows);
  return rows;
}

export const MIN_CURRENT_GAMES = 150;

export function blend(current: RoleStats[], combined: RoleStats[]): RoleStats[] {
  const byKey = new Map(current.map((r) => [`${r.championId}:${r.position}`, r]));
  const out = combined.map((c) => {
    const now = byKey.get(`${c.championId}:${c.position}`);
    return now && now.games >= MIN_CURRENT_GAMES ? now : { ...c, blended: true };
  });
  assignTiers(out);
  return out;
}

function assignTiers(rows: RoleStats[]): void {
  for (const position of POSITIONS) {
    const inRole = rows.filter((r) => r.position === position).sort((a, z) => z.score - a.score);
    inRole.forEach((r, i) => {
      const q = i / Math.max(1, inRole.length);
      r.tier = q < 0.08 ? "S" : q < 0.25 ? "A" : q < 0.55 ? "B" : q < 0.85 ? "C" : "D";
    });
  }
}
