import { invoke } from "@tauri-apps/api/core";
import { native } from "./ipc";

export interface DataIndex {
  updatedAt: number;
  patch: string;
  patches: string[];
  games: number;
  mergedPatches: string[];
  previousGames?: number;
}

export interface TierRow {
  blended?: boolean;
  championId: number;
  position: string;
  games: number;
  winRate: number;
  pickRate: number;
  banRate: number;
  tier: string;
}

export interface BuildOption<T> {
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

export interface RunePage {
  primaryStyle: number;
  subStyle: number;
  perks: number[];
  shards: number[];
}

export interface RoleBuild extends TierRow {
  runes: BuildOption<RunePage>[];
  spells: BuildOption<number[]>[];
  boots: BuildOption<number>[];
  core: BuildOption<number[]>[];
  start?: BuildOption<number[]>[];
  buildOrder?: BuildOption<number[]>[];
  skillPriority?: BuildOption<number[]> | null;
  skillOrder?: number[] | null;
  best: Matchup[];
  worst: Matchup[];
  matchups?: Matchup[];
}

export interface ChampionBuilds {
  championId: number;
  roles: RoleBuild[];
}

export interface PatchSummary {
  patch: string;
  gameVersion: string;
  title: string;
  publishedAt: string | null;
  description: string;
  image: string | null;
}

export interface Change {
  text: string;
  label: string;
  before: string;
  after: string;
  better: boolean | null;
}

export interface ChangeGroup {
  title: string;
  icon: string | null;
  changes: Change[];
}

export type Verdict = "buff" | "nerf" | "adjusted";

export interface ChangeEntry {
  name: string;
  tag?: string;
  kind?: string;
  image: string | null;
  context: string;
  verdict: Verdict;
  groups: ChangeGroup[];
}

export interface PatchNotes extends PatchSummary {
  url: string;
  sections: { title: string; entries: ChangeEntry[] }[];
}

const cache = new Map<string, Promise<unknown>>();

export function dataFile<T>(path: string): Promise<T> {
  let pending = cache.get(path);
  if (!pending) {
    pending = native
      ? invoke("data_file", { path })
      : fetch(`/data/${path}`).then((r) => {
          if (!r.ok) throw new Error(`${r.status} loading ${path}`);
          return r.json();
        });
    pending.catch(() => cache.delete(path));
    cache.set(path, pending);
  }
  return pending as Promise<T>;
}

export const POSITIONS = [
  { value: "TOP", label: "Top" },
  { value: "JUNGLE", label: "Jungle" },
  { value: "MIDDLE", label: "Mid" },
  { value: "BOTTOM", label: "Bot" },
  { value: "UTILITY", label: "Support" },
] as const;

export const positionLabel = (p: string) =>
  POSITIONS.find((x) => x.value === p)?.label ?? p;

export const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;
