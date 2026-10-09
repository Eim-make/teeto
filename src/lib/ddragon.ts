import { useEffect, useState } from "react";

const BASE = "https://ddragon.leagueoflegends.com";
const CACHE_KEY = "teeto.catalog.v3";

export interface Catalog {
  version: string;
  champions: Record<string, { id: string; name: string; attack: number; magic: number; tags: string[] }>;
  spells: Record<string, { image: string; name: string; id: string }>;
  runes: Record<string, { icon: string; name: string }>;
  items: Record<string, string>;
}

interface ChampionJson {
  data: Record<
    string,
    { id: string; key: string; name: string; tags: string[]; info: { attack: number; magic: number } }
  >;
}

interface SummonerJson {
  data: Record<string, { id: string; key: string; name: string; image: { full: string } }>;
}

interface RuneNode {
  id: number;
  name: string;
  icon: string;
}

type RunesJson = (RuneNode & { slots: { runes: RuneNode[] }[] })[];

interface ItemJson {
  data: Record<string, { name: string }>;
}

let pending: Promise<Catalog> | null = null;

function readCache(): Catalog | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Catalog) : null;
  } catch {
    return null;
  }
}

const getJson = <T>(url: string): Promise<T> =>
  fetch(url).then((r) => r.json() as Promise<T>);

async function load(): Promise<Catalog> {
  const cached = readCache();
  try {
    const versions = await getJson<string[]>(`${BASE}/api/versions.json`);
    const version = versions[0];
    if (!version) throw new Error("no versions");
    if (cached?.version === version) return cached;

    const data = `${BASE}/cdn/${version}/data/en_US`;
    const [champs, summoners, runeTrees, itemJson] = await Promise.all([
      getJson<ChampionJson>(`${data}/champion.json`),
      getJson<SummonerJson>(`${data}/summoner.json`),
      getJson<RunesJson>(`${data}/runesReforged.json`),
      getJson<ItemJson>(`${data}/item.json`),
    ]);

    const catalog: Catalog = {
      version,
      champions: {},
      spells: {},
      runes: {},
      items: {},
    };
    for (const c of Object.values(champs.data))
      catalog.champions[c.key] = { id: c.id, name: c.name, attack: c.info.attack, magic: c.info.magic, tags: c.tags };
    for (const s of Object.values(summoners.data))
      catalog.spells[s.key] = { image: s.image.full, name: s.name, id: s.id };
    for (const tree of runeTrees) {
      catalog.runes[tree.id] = { icon: tree.icon, name: tree.name };
      for (const slot of tree.slots)
        for (const r of slot.runes)
          catalog.runes[r.id] = { icon: r.icon, name: r.name };
    }
    for (const [id, item] of Object.entries(itemJson.data))
      catalog.items[id] = item.name;

    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(catalog));
    } catch {
      return catalog;
    }
    return catalog;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}

export function useCatalog(): Catalog | null {
  const [catalog, setCatalog] = useState<Catalog | null>(readCache);
  useEffect(() => {
    pending ??= load();
    pending.then(setCatalog).catch(() => {
      pending = null;
    });
  }, []);
  return catalog;
}

export function championIcon(
  catalog: Catalog | null,
  key: number | null,
): string | null {
  const champ =
    catalog && key !== null ? catalog.champions[String(key)] : undefined;
  return champ && catalog
    ? `${BASE}/cdn/${catalog.version}/img/champion/${champ.id}.png`
    : null;
}

export function championName(
  catalog: Catalog | null,
  key: number | null,
): string {
  return (
    (catalog && key !== null && catalog.champions[String(key)]?.name) ||
    "Unknown"
  );
}

export function profileIcon(
  catalog: Catalog | null,
  id: number,
): string | null {
  return catalog
    ? `${BASE}/cdn/${catalog.version}/img/profileicon/${id}.png`
    : null;
}

export function itemIcon(catalog: Catalog | null, id: number): string | null {
  return catalog && id > 0
    ? `${BASE}/cdn/${catalog.version}/img/item/${id}.png`
    : null;
}

export function spellIcon(catalog: Catalog | null, key: number): string | null {
  const spell = catalog?.spells[String(key)];
  return spell && catalog
    ? `${BASE}/cdn/${catalog.version}/img/spell/${spell.image}`
    : null;
}

export function runeIcon(catalog: Catalog | null, id: number): string | null {
  const rune = catalog?.runes[String(id)];
  return rune ? `${BASE}/cdn/img/${rune.icon}` : null;
}

export interface Ability {
  key: "P" | "Q" | "W" | "E" | "R";
  name: string;
  icon: string;
}

interface ChampionDetailJson {
  data: Record<
    string,
    {
      passive: { name: string; image: { full: string } };
      spells: { name: string; image: { full: string } }[];
    }
  >;
}

const abilityCache = new Map<string, Promise<Ability[]>>();

export function useAbilities(championKey: number | null): Ability[] | null {
  const catalog = useCatalog();
  const [abilities, setAbilities] = useState<Ability[] | null>(null);
  const champ = catalog && championKey !== null ? catalog.champions[String(championKey)] : undefined;
  const version = catalog?.version;

  useEffect(() => {
    if (!champ || !version) return;
    const cacheKey = `${version}:${champ.id}`;
    let pendingAbilities = abilityCache.get(cacheKey);
    if (!pendingAbilities) {
      pendingAbilities = getJson<ChampionDetailJson>(`${BASE}/cdn/${version}/data/en_US/champion/${champ.id}.json`).then(
        (json) => {
          const c = json.data[champ.id];
          if (!c) return [];
          const keys = ["Q", "W", "E", "R"] as const;
          return [
            { key: "P", name: c.passive.name, icon: `${BASE}/cdn/${version}/img/passive/${c.passive.image.full}` },
            ...c.spells.map((s, i) => ({
              key: keys[i] ?? "Q",
              name: s.name,
              icon: `${BASE}/cdn/${version}/img/spell/${s.image.full}`,
            })),
          ];
        },
      );
      abilityCache.set(cacheKey, pendingAbilities);
    }
    let alive = true;
    pendingAbilities.then((a) => alive && setAbilities(a)).catch(() => abilityCache.delete(cacheKey));
    return () => {
      alive = false;
    };
  }, [champ, version]);

  return abilities;
}

export function spellByName(catalog: Catalog | null, id: string): { key: number; name: string } | null {
  if (!catalog) return null;
  const found = Object.entries(catalog.spells).find(([, s]) => s.id === id);
  return found ? { key: Number(found[0]), name: found[1].name } : null;
}

export function championKeyById(catalog: Catalog | null, id: string): number | null {
  if (!catalog) return null;
  const lower = id.toLowerCase();
  const found = Object.entries(catalog.champions).find(([, c]) => c.id.toLowerCase() === lower);
  return found ? Number(found[0]) : null;
}
