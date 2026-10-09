import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ChampSelect } from "./bindings/ChampSelect";
import type { ChampionAugments } from "./bindings/ChampionAugments";
import type { AugmentScan } from "./bindings/AugmentScan";
import type { ClientStatus } from "./bindings/ClientStatus";
import type { HarvestProgress } from "./bindings/HarvestProgress";
import type { InGame } from "./bindings/InGame";
import type { LiveGame } from "./bindings/LiveGame";
import type { LpEntry } from "./bindings/LpEntry";
import type { MatchDetail } from "./bindings/MatchDetail";
import type { MatchFilter } from "./bindings/MatchFilter";
import type { MatchSummary } from "./bindings/MatchSummary";
import type { Queue } from "./bindings/Queue";
import type { RankEntry } from "./bindings/RankEntry";
import { demo } from "./demo";

export const native = isTauri();

export const api = {
  clientStatus: (): Promise<ClientStatus> =>
    native ? invoke("client_status") : Promise.resolve(demo.status),
  ranks: (): Promise<RankEntry[]> =>
    native ? invoke("ranks") : Promise.resolve(demo.ranks),
  lpHistory: (queue: Queue, since: number): Promise<LpEntry[]> =>
    native
      ? invoke("lp_history", { queue, since })
      : Promise.resolve(
          demo.history.filter(
            (e) => e.queue === queue && e.recordedAt >= since,
          ),
        ),
  matches: (filter: MatchFilter, limit: number, before?: number): Promise<MatchSummary[]> =>
    native
      ? invoke("matches", { filter, limit, before: before ?? null })
      : Promise.resolve(demo.matchList(filter, limit, before)),
  liveGame: (): Promise<LiveGame | null> => (native ? invoke("live_game") : Promise.resolve(demo.live)),
  importRunes: (page: {
    name: string;
    primaryStyle: number;
    subStyle: number;
    perks: number[];
    shards: number[];
  }): Promise<void> => (native ? invoke("import_runes", page) : Promise.resolve()),
  champSelect: (): Promise<ChampSelect> =>
    native ? invoke("champ_select") : Promise.resolve(demo.champSelect),
  setSpells: (spell1: number, spell2: number): Promise<void> =>
    native ? invoke("set_spells", { spell1, spell2 }) : Promise.resolve(),
  mayhemAugments: (): Promise<ChampionAugments[]> =>
    native ? invoke("mayhem_augments") : Promise.resolve([]),
  inGame: (): Promise<InGame | null> => (native ? invoke("in_game") : Promise.resolve(demo.inGame)),
  scanAugments: (): Promise<AugmentScan> =>
    native ? invoke("scan_augments") : Promise.reject(new Error("Only available in the desktop app")),
  harvestMayhem: (): Promise<HarvestProgress> =>
    native ? invoke("harvest_mayhem") : Promise.reject(new Error("Only available in the desktop app")),
  matchDetail: (gameId: number): Promise<MatchDetail> =>
    native ? invoke("match_detail", { gameId }) : Promise.resolve(demo.detail(gameId)),
};

export type AppEvent = {
  "client-status": ClientStatus;
  "ranked-changed": null;
  "matches-changed": null;
  "augment-scan-error": string;
  "harvest-progress": HarvestProgress;
};

export function on<K extends keyof AppEvent>(
  name: K,
  handler: (payload: AppEvent[K]) => void,
): () => void {
  if (!native) return () => {};
  let unlisten: UnlistenFn | undefined;
  let disposed = false;
  listen<AppEvent[K]>(name, (e) => handler(e.payload)).then((fn) => {
    if (disposed) fn();
    else unlisten = fn;
  });
  return () => {
    disposed = true;
    unlisten?.();
  };
}
