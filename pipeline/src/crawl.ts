import {
  addPlayers,
  hasMatch,
  markCrawled,
  nextPlayer,
  openDb,
  prune,
  patchCounts,
  saveMatch,
} from "./db.ts";
import { compact, type RiotMatch, type RiotTimeline } from "./compact.ts";
import { comparePatch } from "./patch.ts";
import { RiotClient, routingFor } from "./riot.ts";

interface LeagueEntry {
  puuid?: string;
}

interface LeagueList {
  entries: LeagueEntry[];
}

const key = process.env.RIOT_API_KEY;
if (!key) throw new Error("RIOT_API_KEY is not set");
const platforms = (process.env.PLATFORMS ?? "EUW1,EUN1,NA1,KR")
  .split(",")
  .map((p) => p.trim().toUpperCase());
const maxMinutes = Number(process.env.MAX_MINUTES ?? 45);
const dbPath = process.env.DB_PATH ?? "teeto-data.db";
const lookbackMs = 14 * 86_400_000;
const recrawlMs = 12 * 3_600_000;
const timelineRate = Number(process.env.TIMELINE_RATE ?? 0.5);

const riot = new RiotClient(key, process.env.RIOT_KEY_KIND === "production");
const db = openDb(dbPath);
const deadline = Date.now() + maxMinutes * 60_000;

async function seed(platform: string): Promise<void> {
  const host = platform.toLowerCase();
  const apex = ["challengerleagues", "grandmasterleagues", "masterleagues"];
  for (const league of apex) {
    const list = await riot.get<LeagueList>(
      host,
      `/lol/league/v4/${league}/by-queue/RANKED_SOLO_5x5`,
    );
    addPlayers(
      db,
      platform,
      (list?.entries ?? []).flatMap((e) => (e.puuid ? [e.puuid] : [])),
    );
  }
  for (const [tier, division] of [
    ["DIAMOND", "I"],
    ["DIAMOND", "II"],
    ["EMERALD", "I"],
  ] as const) {
    const entries = await riot.get<LeagueEntry[]>(
      host,
      `/lol/league-exp/v4/entries/RANKED_SOLO_5x5/${tier}/${division}?page=1`,
    );
    addPlayers(
      db,
      platform,
      (entries ?? []).flatMap((e) => (e.puuid ? [e.puuid] : [])),
    );
  }
}

async function crawlPlayer(platform: string, puuid: string): Promise<number> {
  const routing = routingFor(platform);
  const start = Math.floor((Date.now() - lookbackMs) / 1000);
  const ids =
    (await riot.get<string[]>(
      routing,
      `/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&type=ranked&count=20&startTime=${start}`,
    )) ?? [];
  let added = 0;
  for (const id of ids) {
    if (Date.now() > deadline) break;
    if (hasMatch(db, id)) continue;
    const match = await riot.get<RiotMatch>(
      routing,
      `/lol/match/v5/matches/${id}`,
    );
    if (!match || match.info.queueId !== 420 || match.info.gameDuration < 300)
      continue;
    const timeline =
      Math.random() < timelineRate
        ? await riot.get<RiotTimeline>(routing, `/lol/match/v5/matches/${id}/timeline`)
        : null;
    saveMatch(db, compact(platform, match, timeline));
    addPlayers(db, platform, match.metadata.participants);
    added++;
  }
  markCrawled(db, puuid);
  return added;
}

async function main(): Promise<void> {
  for (const platform of platforms) await seed(platform);
  let added = 0;
  let idle = 0;
  while (Date.now() < deadline && idle < platforms.length) {
    idle = 0;
    for (const platform of platforms) {
      if (Date.now() > deadline) break;
      const puuid = nextPlayer(db, platform, Date.now() - recrawlMs);
      if (!puuid) {
        idle++;
        continue;
      }
      added += await crawlPlayer(platform, puuid);
    }
  }

  const patches = patchCounts(db)
    .map((p) => p.patch)
    .sort(comparePatch)
    .reverse();
  prune(db, patches.slice(0, 2));
  console.log(
    `added ${added} matches with ${riot.requests} requests; patches ${patches.slice(0, 2).join(", ")}`,
  );
}

await main();
