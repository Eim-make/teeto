import { useEffect, useState } from "react";

const CDRAGON = "https://raw.communitydragon.org/latest";
const CACHE_KEY = "teeto.augments.v1";

export function rankCrest(tier: string): string {
  return `${CDRAGON}/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-mini-crests/${tier.toLowerCase()}.svg`;
}

export interface Augment {
  name: string;
  icon: string;
  rarity: "silver" | "gold" | "prismatic" | "other";
}

interface RawAugment {
  id: number;
  nameTRA: string;
  augmentSmallIconPath: string;
  rarity: string;
}

let pending: Promise<Record<string, Augment>> | null = null;

function iconUrl(path: string): string {
  const rest = path.replace(/^\/lol-game-data\/assets\//i, "").toLowerCase();
  return `${CDRAGON}/plugins/rcp-be-lol-game-data/global/default/${rest}`;
}

function rarity(r: string): Augment["rarity"] {
  return r === "kSilver" ? "silver" : r === "kGold" ? "gold" : r === "kPrismatic" ? "prismatic" : "other";
}

function readCache(): Record<string, Augment> | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Augment>) : null;
  } catch {
    return null;
  }
}

async function load(): Promise<Record<string, Augment>> {
  const list = (await fetch(`${CDRAGON}/plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json`).then((r) =>
    r.json(),
  )) as RawAugment[];
  const out: Record<string, Augment> = {};
  for (const a of list) out[a.id] = { name: a.nameTRA, icon: iconUrl(a.augmentSmallIconPath), rarity: rarity(a.rarity) };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(out));
  } catch {
    return out;
  }
  return out;
}

export function useAugments(): Record<string, Augment> | null {
  const [augments, setAugments] = useState(readCache);
  useEffect(() => {
    if (augments) return;
    pending ??= load();
    pending.then(setAugments).catch(() => {
      pending = null;
    });
  }, [augments]);
  return augments;
}
