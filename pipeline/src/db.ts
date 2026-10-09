import { DatabaseSync } from "node:sqlite";

export interface CompactPlayer {
  champion: number;
  position: string;
  team: number;
  win: boolean;
  primaryStyle: number;
  subStyle: number;
  perks: number[];
  shards?: number[];
  spells: number[];
  items: number[];
  skills?: number[];
  start?: number[];
  buys?: number[];
}

export interface CompactMatch {
  id: string;
  platform: string;
  patch: string;
  createdAt: number;
  durationSec: number;
  bans: number[];
  players: CompactPlayer[];
}

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      patch TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS matches_patch ON matches (patch);
    CREATE TABLE IF NOT EXISTS players (
      puuid TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      crawled_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS players_next ON players (platform, crawled_at);
  `);
  return db;
}

export function hasMatch(db: DatabaseSync, id: string): boolean {
  return db.prepare("SELECT 1 FROM matches WHERE id = ?").get(id) !== undefined;
}

export function saveMatch(db: DatabaseSync, m: CompactMatch): void {
  db.prepare(
    "INSERT OR IGNORE INTO matches (id, platform, patch, created_at, data) VALUES (?, ?, ?, ?, ?)",
  ).run(m.id, m.platform, m.patch, m.createdAt, JSON.stringify(m));
}

export function addPlayers(
  db: DatabaseSync,
  platform: string,
  puuids: string[],
): void {
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO players (puuid, platform) VALUES (?, ?)",
  );
  for (const p of puuids) stmt.run(p, platform);
}

export function nextPlayer(
  db: DatabaseSync,
  platform: string,
  staleBefore: number,
): string | null {
  const row = db
    .prepare(
      "SELECT puuid FROM players WHERE platform = ? AND crawled_at < ? ORDER BY crawled_at LIMIT 1",
    )
    .get(platform, staleBefore) as { puuid: string } | undefined;
  return row?.puuid ?? null;
}

export function markCrawled(db: DatabaseSync, puuid: string): void {
  db.prepare("UPDATE players SET crawled_at = ? WHERE puuid = ?").run(
    Date.now(),
    puuid,
  );
}

export function matchesForPatch(
  db: DatabaseSync,
  patch: string,
): CompactMatch[] {
  const rows = db
    .prepare("SELECT data FROM matches WHERE patch = ?")
    .all(patch) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as CompactMatch);
}

export function patchCounts(
  db: DatabaseSync,
): { patch: string; games: number }[] {
  return db
    .prepare("SELECT patch, COUNT(*) AS games FROM matches GROUP BY patch")
    .all() as { patch: string; games: number }[];
}

export function prune(db: DatabaseSync, keepPatches: string[]): void {
  if (keepPatches.length === 0) return;
  const marks = keepPatches.map(() => "?").join(",");
  db.prepare(`DELETE FROM matches WHERE patch NOT IN (${marks})`).run(
    ...keepPatches,
  );
}
