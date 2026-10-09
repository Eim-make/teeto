import { useEffect, useState } from "react";

const BASE = "https://arammayhem.com/data/v1/latest";
const CACHE_KEY = "teeto.mayhem.v1";
const MAX_AGE = 6 * 3_600_000;
export const MAYHEM_ATTRIBUTION = { label: "Data: arammayhem.com", url: "https://arammayhem.com/" };

export interface GlobalAugment {
  name: string;
  rarity: string;
  pickRate: number;
  change: number | null;
  rank: number;
  rarityRank: number;
  rarityCount: number;
  tier: string;
  url: string;
}

export interface GlobalChampion {
  id: string;
  pickRate: number;
  rank: number;
}

export interface MayhemGlobal {
  patch: string;
  fetchedAt: number;
  augments: Record<string, GlobalAugment>;
  champions: Record<string, GlobalChampion>;
}

interface RawFile<T> {
  meta: { patch: string };
  rows: T[];
}

interface RawAugment {
  name: { en: string };
  rarity: string;
  pickRate: number;
  pickRateRank: number;
  pickRateChange: number | null;
  retiredPatch: string | null;
  url: string;
}

interface RawChampion {
  championId: string;
  pickRate: number;
  pickRateRank: number;
}

export const augmentKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

function tierFor(position: number, count: number): string {
  const q = position / Math.max(1, count);
  return q < 0.1 ? "S" : q < 0.3 ? "A" : q < 0.6 ? "B" : q < 0.85 ? "C" : "D";
}

export function buildGlobal(augs: RawFile<RawAugment>, champs: RawFile<RawChampion>, fetchedAt: number): MayhemGlobal {
  const live = augs.rows.filter((a) => !a.retiredPatch);
  const byRarity = new Map<string, RawAugment[]>();
  for (const a of live) byRarity.set(a.rarity, [...(byRarity.get(a.rarity) ?? []), a]);
  const augments: MayhemGlobal["augments"] = {};
  for (const group of byRarity.values()) {
    group.sort((a, b) => b.pickRate - a.pickRate);
    group.forEach((a, i) => {
      augments[augmentKey(a.name.en)] = {
        name: a.name.en,
        rarity: a.rarity,
        pickRate: a.pickRate,
        change: a.pickRateChange,
        rank: a.pickRateRank,
        rarityRank: i + 1,
        rarityCount: group.length,
        tier: tierFor(i, group.length),
        url: a.url,
      };
    });
  }
  const champions: MayhemGlobal["champions"] = {};
  for (const c of champs.rows) champions[c.championId.toLowerCase()] = { id: c.championId, pickRate: c.pickRate, rank: c.pickRateRank };
  return { patch: augs.meta.patch, fetchedAt, augments, champions };
}

function readCache(): MayhemGlobal | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as MayhemGlobal) : null;
  } catch {
    return null;
  }
}

let pending: Promise<MayhemGlobal> | null = null;

async function load(): Promise<MayhemGlobal> {
  const cached = readCache();
  if (cached && Date.now() - cached.fetchedAt < MAX_AGE) return cached;
  try {
    const [augs, champs] = await Promise.all([
      fetch(`${BASE}/augments.json`).then((r) => r.json() as Promise<RawFile<RawAugment>>),
      fetch(`${BASE}/champions.json`).then((r) => r.json() as Promise<RawFile<RawChampion>>),
    ]);
    const data = buildGlobal(augs, champs, Date.now());
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch {
      return data;
    }
    return data;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}

export function useMayhemGlobal(): MayhemGlobal | null {
  const [data, setData] = useState<MayhemGlobal | null>(readCache);
  useEffect(() => {
    pending ??= load();
    pending.then(setData).catch(() => {
      pending = null;
    });
  }, []);
  return data;
}
