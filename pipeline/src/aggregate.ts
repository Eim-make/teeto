import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { matchesForPatch, openDb, patchCounts } from "./db.ts";
import { comparePatch } from "./patch.ts";
import { aggregate, blend, type ItemInfo, type RoleStats } from "./stats.ts";

const dbPath = process.env.DB_PATH ?? "teeto-data.db";
const outDir = process.env.OUT_DIR ?? "out";
const MIN_PATCH_GAMES = 1500;

interface ItemJson {
  data: Record<
    string,
    {
      into?: string[];
      tags?: string[];
      gold: { total: number };
      maps: Record<string, boolean>;
    }
  >;
}

async function itemInfo(): Promise<ItemInfo> {
  const versions = (await fetch(
    "https://ddragon.leagueoflegends.com/api/versions.json",
  ).then((r) => r.json())) as string[];
  const json = (await fetch(
    `https://ddragon.leagueoflegends.com/cdn/${versions[0]}/data/en_US/item.json`,
  ).then((r) => r.json())) as ItemJson;
  const boots = new Set<number>();
  const legendary = new Set<number>();
  for (const [id, item] of Object.entries(json.data)) {
    if (!item.maps["11"]) continue;
    if (item.tags?.includes("Boots") && item.gold.total > 300)
      boots.add(Number(id));
    else if (!item.into?.length && item.gold.total >= 2200)
      legendary.add(Number(id));
  }
  return { boots, legendary };
}

function write(path: string, data: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(data));
}

async function main(): Promise<void> {
  const db = openDb(dbPath);
  const counts = patchCounts(db).sort((a, b) => comparePatch(b.patch, a.patch));
  const latest = counts[0];
  if (!latest) {
    console.log("no matches yet");
    return;
  }
  const previous = counts[1];
  const items = await itemInfo();
  const current = matchesForPatch(db, latest.patch);
  const older = previous ? matchesForPatch(db, previous.patch) : [];
  const rows = blend(aggregate(current, items), aggregate([...current, ...older], items));
  const sources = previous ? [latest, previous] : [latest];
  const matches = current;
  const patch = latest.patch;

  const tierlist = rows
    .map(
      ({ championId, position, games, winRate, pickRate, banRate, tier, blended }) => ({
        blended: blended ?? false,
        championId,
        position,
        games,
        winRate,
        pickRate,
        banRate,
        tier,
      }),
    )
    .sort((a, b) => b.pickRate - a.pickRate);
  write(join(outDir, patch, "tierlist.json"), tierlist);

  const byChampion = new Map<number, RoleStats[]>();
  for (const r of rows)
    byChampion.set(r.championId, [...(byChampion.get(r.championId) ?? []), r]);
  for (const [id, roles] of byChampion) {
    write(join(outDir, patch, "champions", `${id}.json`), {
      championId: id,
      roles: roles
        .sort((a, b) => b.games - a.games)
        .map(({ score: _score, ...rest }) => rest),
    });
  }

  write(join(outDir, "index.json"), {
    updatedAt: Date.now(),
    patch,
    patches: counts.map((c) => c.patch),
    games: matches.length,
    mergedPatches: sources.map((s) => s.patch),
    previousGames: older.length,
  });
  console.log(
    `wrote ${tierlist.length} champion roles for ${patch} from ${matches.length} games`,
  );
}

await main();
