import type { LpEntry } from "./bindings/LpEntry";

const TIERS = [
  "IRON",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "EMERALD",
  "DIAMOND",
] as const;
const APEX = ["MASTER", "GRANDMASTER", "CHALLENGER"] as const;
const DIVISIONS = ["IV", "III", "II", "I"] as const;
export const APEX_BASE = TIERS.length * 400;

export interface Placement {
  tier: string;
  division: string;
  lp: number;
}

export function absolute({ tier, division, lp }: Placement): number | null {
  const t = tier.toUpperCase();
  if ((APEX as readonly string[]).includes(t)) return APEX_BASE + lp;
  const ti = (TIERS as readonly string[]).indexOf(t);
  const di = (DIVISIONS as readonly string[]).indexOf(division);
  if (ti < 0 || di < 0) return null;
  return ti * 400 + di * 100 + lp;
}

export function fromAbsolute(abs: number): Placement {
  if (abs >= APEX_BASE)
    return { tier: "MASTER", division: "I", lp: abs - APEX_BASE };
  const ti = Math.max(0, Math.floor(abs / 400));
  const di = Math.floor((abs % 400) / 100);
  return {
    tier: TIERS[ti] ?? "IRON",
    division: DIVISIONS[di] ?? "IV",
    lp: abs % 100,
  };
}

export function isApex(tier: string): boolean {
  return (APEX as readonly string[]).includes(tier.toUpperCase());
}

export function tierName(tier: string): string {
  if (!tier || tier === "NONE") return "Unranked";
  return tier.charAt(0) + tier.slice(1).toLowerCase();
}

export function rankLabel(p: Placement): string {
  if (absolute(p) === null) return "Unranked";
  return isApex(p.tier)
    ? tierName(p.tier)
    : `${tierName(p.tier)} ${p.division}`;
}

export function boundaryLabel(abs: number): string {
  return rankLabel(fromAbsolute(abs));
}

const SESSION_GAP = 2 * 3_600_000;

export function sessionStart(entries: LpEntry[]): number {
  let start = entries[entries.length - 1]?.recordedAt ?? Date.now();
  for (let i = entries.length - 1; i > 0; i--) {
    const cur = entries[i];
    const prev = entries[i - 1];
    if (!cur || !prev || cur.recordedAt - prev.recordedAt > SESSION_GAP) break;
    start = prev.recordedAt;
  }
  return start;
}

export type MmrHint = "above" | "near" | "below" | "unknown";

export interface LpStats {
  avgGain: number | null;
  avgLoss: number | null;
  wins: number;
  losses: number;
  net: number;
  mmr: MmrHint;
  streak: { win: boolean; count: number } | null;
}

export function lpStats(entries: LpEntry[], window = 20): LpStats {
  const games = entries
    .filter((e) => e.kind === "game" && e.win !== null)
    .slice(-window);
  const gains = games
    .filter((e) => e.win && e.delta !== null && e.delta > 0)
    .map((e) => e.delta ?? 0);
  const losses = games
    .filter((e) => e.win === false && e.delta !== null && e.delta < 0)
    .map((e) => -(e.delta ?? 0));
  const mean = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const avgGain = mean(gains);
  const avgLoss = mean(losses);

  let mmr: MmrHint = "unknown";
  if (
    avgGain !== null &&
    avgLoss !== null &&
    gains.length >= 3 &&
    losses.length >= 3
  ) {
    const gap = avgGain - avgLoss;
    mmr = gap > 3 ? "above" : gap < -3 ? "below" : "near";
  }

  let streak: LpStats["streak"] = null;
  for (let i = games.length - 1; i >= 0; i--) {
    const w = games[i]?.win;
    if (w === null || w === undefined) break;
    if (!streak) streak = { win: w, count: 1 };
    else if (streak.win === w) streak.count++;
    else break;
  }

  return {
    avgGain,
    avgLoss,
    wins: games.filter((e) => e.win).length,
    losses: games.filter((e) => e.win === false).length,
    net: entries.reduce((sum, e) => sum + (e.delta ?? 0), 0),
    mmr,
    streak,
  };
}

export function winsToPromote(
  p: Placement,
  avgGain: number | null,
): number | null {
  if (isApex(p.tier) || absolute(p) === null || !avgGain) return null;
  return Math.max(1, Math.ceil((100 - p.lp) / avgGain));
}
