import type { ChampionAugments } from "./bindings/ChampionAugments";

export interface RankedAugment {
  id: number;
  games: number;
  wins: number;
  score: number;
  tier: string;
}

function wilson(wins: number, games: number): number {
  if (games === 0) return 0;
  const z = 1.0;
  const p = wins / games;
  return (p + (z * z) / (2 * games) - z * Math.sqrt((p * (1 - p) + (z * z) / (4 * games)) / games)) / (1 + (z * z) / games);
}

export function rankAugments(stats: { id: number; games: number; wins: number }[]): RankedAugment[] {
  const scored = stats
    .map((s) => ({ ...s, score: wilson(s.wins, s.games) + Math.min(0.05, s.games * 0.004), tier: "" }))
    .sort((a, b) => b.score - a.score);
  scored.forEach((s, i) => {
    const q = i / Math.max(1, scored.length);
    s.tier = q < 0.1 ? "S" : q < 0.3 ? "A" : q < 0.6 ? "B" : q < 0.85 ? "C" : "D";
  });
  return scored;
}

export function overallAugments(data: ChampionAugments[]): { id: number; games: number; wins: number }[] {
  const map = new Map<number, { id: number; games: number; wins: number }>();
  for (const c of data)
    for (const a of c.augments) {
      const e = map.get(a.id) ?? { id: a.id, games: 0, wins: 0 };
      e.games += a.games;
      e.wins += a.wins;
      map.set(a.id, e);
    }
  return [...map.values()];
}

export const TIER_STYLE: Record<string, string> = {
  S: "bg-crimson text-white",
  A: "bg-soft text-ink-950",
  B: "bg-ink-700 text-fg",
  C: "bg-ink-800 text-muted",
  D: "bg-ink-800 text-faint",
};
