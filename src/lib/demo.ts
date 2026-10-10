import type { ChampSelect } from "./bindings/ChampSelect";
import type { ClientStatus } from "./bindings/ClientStatus";
import type { InGame } from "./bindings/InGame";
import type { LiveGame } from "./bindings/LiveGame";
import type { LpEntry } from "./bindings/LpEntry";
import type { MatchDetail } from "./bindings/MatchDetail";
import type { MatchFilter } from "./bindings/MatchFilter";
import type { MatchSummary } from "./bindings/MatchSummary";
import type { PlayerDetail } from "./bindings/PlayerDetail";
import type { RankEntry } from "./bindings/RankEntry";
import { fromAbsolute } from "./rank";

const NAMES = ["Shroomlord", "Vexed Owl", "midgap", "Rinne", "ward pls", "Kaido", "Toplane Tyrant", "Nyx", "OneTrick", "sup diff"];
const POOL = [17, 64, 103, 222, 412, 86, 121, 238, 51, 117];
const HOUR = 3_600_000;
const SESSION_FROM = 17;
const now = Date.now();
const champions = [
  17, 157, 17, 86, 17, 238, 17, 103, 17, 54, 17, 17, 157, 17, 24, 17, 17, 86,
  17, 17, 157, 17,
];
const deltas = [
  22, -18, 24, 21, -17, 23, 25, -19, 22, 24, -16, 23, 21, 24, -18, 22, 25, 23,
  -17, 24, 22, 23,
];

function build(): LpEntry[] {
  let abs = 5 * 400 + 100 + 30;
  return deltas.map((delta, i) => {
    abs += delta;
    const champion = champions[i] ?? 17;
    const win = delta > 0;
    return {
      id: i + 1,
      queue: "solo",
      kind: "game",
      gameId: 7_000_000_000 + i,
      championId: champion,
      win,
      delta,
      after: { ...fromAbsolute(abs), wins: 0, losses: 0 },
      kills: win ? 7 + (i % 5) : 3 + (i % 3),
      deaths: win ? 2 + (i % 3) : 6 + (i % 2),
      assists: 6 + (i % 7),
      recordedAt:
        i >= SESSION_FROM
          ? now - (deltas.length - i) * 0.6 * HOUR
          : now - (deltas.length - i) * 7 * HOUR,
    };
  });
}

const history = build();
const last = history[history.length - 1];

export const demo = {
  status: {
    state: "connected",
    summoner: {
      puuid: "demo",
      gameName: "Shroomlord",
      tagLine: "EUW",
      level: 312,
      profileIconId: 4568,
    },
    phase: new URLSearchParams(globalThis.location?.search ?? "").get("phase") ?? "Lobby",
  } satisfies ClientStatus as ClientStatus,
  history,
  ranks: [
    {
      queue: "solo",
      standing: {
        ...(last?.after ?? fromAbsolute(2000)),
        wins: 48,
        losses: 33,
      },
      capturedAt: now,
    },
    {
      queue: "flex",
      standing: { tier: "PLATINUM", division: "I", lp: 12, wins: 9, losses: 7 },
      capturedAt: now,
    },
  ] satisfies RankEntry[] as RankEntry[],
  live: {
    gameId: 1,
    queueId: 2400,
    players: NAMES.map((name, i) => ({
      puuid: i === 0 ? "demo" : `p${i}`,
      teamId: i < 5 ? 100 : 200,
      championId: POOL[i] ?? 17,
      gameName: name,
      tagLine: "EUW",
      level: [312, 41, 188, 520, 77, 260, 33, 145, 402, 98][i] ?? 100,
      position: "",
      rank: i % 3 === 2 ? null : { tier: ["EMERALD", "PLATINUM", "DIAMOND"][i % 3] ?? "GOLD", division: "II", lp: 40 + i * 5, wins: 60 + i * 9, losses: 50 + i * 4 },
      recentGames: 20,
      recentWins: 8 + (i % 7),
      championGames: [12, 0, 3, 15, 1, 6, 0, 9, 2, 4][i] ?? 0,
      championWins: [8, 0, 1, 10, 1, 3, 0, 6, 1, 2][i] ?? 0,
      mainRole: ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"][i % 5] ?? "",
      streak: [4, -3, 1, -1, 2, 3, -4, 1, 2, -2][i] ?? 0,
      badges: (
        [
          ["hotStreak", "main"],
          ["veteran"],
          [],
          ["main", "expert"],
          [],
          ["hotStreak"],
          ["veteran"],
          ["highWinRate"],
          ["veteran"],
          [],
        ] as const
      )[i]?.slice() ?? [],
      isMe: i === 0,
      peak: i % 3 === 2 ? null : { tier: "DIAMOND", division: "IV", lp: 0, wins: 0, losses: 0 },
      lastSeason: i % 2 ? { tier: "PLATINUM", division: "I", lp: 0, wins: 0, losses: 0 } : null,
      masteryLevel: [24, 2, 9, 41, 5, 12, 1, 18, 7, 10][i] ?? 5,
      masteryPoints: [268000, 4000, 61000, 512000, 22000, 98000, 900, 154000, 41000, 77000][i] ?? 0,
      recentKda: [92, 61, 140],
      championKda: [40, 22, 51],
      recent: Array.from({ length: 10 }, (_, n) => ({
        championId: POOL[(i + n) % POOL.length] ?? 17,
        win: (i + n) % 3 !== 0,
        kills: 5 + (n % 4),
        deaths: 3 + (n % 3),
        assists: 7 + (n % 5),
        queueId: 2400,
        createdAt: Date.now() - n * 3_600_000,
      })),
      spells: i % 2 ? ["SummonerFlash", "SummonerSnowball"] : ["SummonerFlash", "SummonerHaste"],
      spellIds: i % 2 ? [4, 32] : [4, 6],
      keystone: [8010, 8112, 8214, 9923, 8437][i % 5] ?? 8010,
      roles: [
        { role: ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"][i % 5] ?? "TOP", games: 12 },
        { role: "MIDDLE", games: 5 },
      ],
      topChampions: [0, 1, 2].map((n) => ({ championId: POOL[(i + n * 3) % POOL.length] ?? 17, games: 9 - n * 3, wins: 5 - n })),
      dayGames: i % 4,
      dayWins: Math.floor((i % 4) / 2),
      subStyle: [8200, 8000, 8300, 8100, 8400][i % 5] ?? 8200,
    })),
  } as LiveGame,
  inGame: {
    gameTime: 754,
    mode: "KIWI",
    map: 12,
    me: `${NAMES[0]}#EUW`,
    myGold: 1350,
    players: NAMES.map((name, i) => ({
      riotId: `${name}#EUW`,
      position: ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"][i % 5] ?? "",
      champion: ["Teemo", "LeeSin", "Ahri", "Jinx", "Thresh", "Garen", "Khazix", "Zed", "Caitlyn", "Lulu"][i] ?? "Teemo",
      teamId: i < 5 ? 100 : 200,
      level: 9 + (i % 4),
      items: [3020, 3115, 4645, 1058, 0, 0, 3340].map((it, n) => (n < 2 + (i % 4) || n === 6 ? it : 0)),
      gold: 4200 + i * 430,
      kills: (i * 3) % 9,
      deaths: (i * 2) % 6,
      assists: (i * 5) % 11,
      cs: 40 + i * 6,
      wardScore: 0,
      dead: i === 7,
      respawnIn: i === 7 ? 18 : 0,
      keystone: 8010,
      subStyle: 8200,
      spells: ["SummonerFlash", "SummonerSnowball"],
    })),
    timers: [{ kind: "inhibitor", label: "Mid inhibitor", teamId: 200, respawnAt: 900 }],
  } as InGame,
  champSelect: {
    queueId: 2400,
    phase: "BAN_PICK",
    timeLeftMs: 42000,
    myTeam: NAMES.slice(0, 5).map((name, i) => ({
      cellId: i,
      championId: POOL[i] ?? 17,
      locked: i < 3,
      position: "",
      gameName: name,
      tagLine: "EUW",
      hidden: false,
      isMe: i === 0,
      spells: [4, 14],
      scout: null,
    })),
    theirTeam: [],
    myBans: [],
    theirBans: [],
    bench: [64, 103, 222, 51],
  } as ChampSelect,
  matchList(filter: MatchFilter, limit: number, before?: number): MatchSummary[] {
    return details
      .filter((d) => (filter === "all" || d.queueId === 420) && d.createdAt < (before ?? Infinity))
      .slice(0, limit)
      .map(summarize);
  },
  detail(gameId: number): MatchDetail {
    const found = details.find((d) => d.gameId === gameId) ?? details[0];
    if (!found) throw new Error("no demo match");
    return found;
  },
};

const ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
const BUILD = [3020, 3115, 4645, 3089, 3135, 3165, 3340];

function makeDetail(gameId: number, queueId: number, createdAt: number, myChamp: number, win: boolean): MatchDetail {
  const durationSec = 1500 + (gameId % 700);
  const seed = (n: number) => ((gameId * 9301 + n * 49297) % 233280) / 233280;
  const players: PlayerDetail[] = NAMES.map((name, i) => {
    const team = i < 5 ? 100 : 200;
    const won = team === 100 ? win : !win;
    const k = Math.round(seed(i) * (won ? 11 : 7));
    return {
      participantId: i + 1,
      teamId: team,
      puuid: i === 0 ? "demo" : `p${i}`,
      gameName: name,
      tagLine: "EUW",
      championId: i === 0 ? myChamp : (POOL[i] ?? 1),
      champLevel: 13 + Math.round(seed(i + 20) * 5),
      position: ROLES[i % 5] ?? "",
      spells: i % 5 === 1 ? [11, 4] : [4, 14],
      items: BUILD.map((it, n) => (seed(i + n) > 0.25 || n === 6 ? it : 0)),
      primaryStyle: 8000,
      subStyle: 8200,
      perks: [8010, 9111, 9104, 8299, 8226, 8237],
      kills: k,
      deaths: Math.round(seed(i + 40) * (won ? 5 : 9)),
      assists: Math.round(seed(i + 60) * 14),
      cs: i % 5 === 4 ? 30 : 140 + Math.round(seed(i + 80) * 110),
      gold: 9000 + Math.round(seed(i + 100) * 6000),
      damageToChampions: 9000 + Math.round(seed(i + 120) * 26000),
      damageTaken: 12000 + Math.round(seed(i + 140) * 20000),
      visionScore: i % 5 === 4 ? 60 : 15 + Math.round(seed(i + 160) * 20),
      wardsPlaced: 8 + Math.round(seed(i + 180) * 12),
      controlWards: 1 + Math.round(seed(i + 200) * 4),
      win: won,
      largestMultiKill: i === 0 && seed(7) > 0.7 ? 4 : 1,
      firstBlood: i === (gameId % 10),
      badges: i === 0 ? (win ? ["mvp", "topDamage"] : ["ace"]) : i === 4 ? ["vision"] : [],      augments: queueId === 2400 ? [1243, 1204, 1353, 1063].slice(0, 2 + (i % 3)) : [],

    };
  });
  const minutes = Math.floor(durationSec / 60);
  let gold = 0;
  const goldDiff = Array.from({ length: minutes + 1 }, (_, m) => {
    gold += Math.round((seed(m + 300) - (win ? 0.38 : 0.62)) * 700);
    return m === 0 ? 0 : gold;
  });
  return {
    gameId,
    queueId,
    createdAt,
    durationSec,
    patch: "16.20",
    teams: [
      { teamId: 100, win, bans: [25, 111, 11, 805, 117], towers: win ? 9 : 3, dragons: win ? 3 : 1, barons: win ? 1 : 0, heralds: 1, grubs: 3, inhibitors: win ? 2 : 0 },
      { teamId: 200, win: !win, bans: [157, 238, 64, 412, 89], towers: win ? 3 : 8, dragons: win ? 1 : 4, barons: win ? 0 : 1, heralds: 0, grubs: 3, inhibitors: win ? 0 : 2 },
    ],
    players,
    goldDiff,
    events: Array.from({ length: 24 }, (_, n) => ({
      atMs: Math.round(((n + 1) / 25) * durationSec * 1000),
      kind: n % 7 === 3 ? "dragon" : n % 9 === 5 ? "tower" : "kill",
      teamId: seed(n + 400) < (win ? 0.62 : 0.38) ? 100 : 200,
      killer: 1 + (n % 5),
      victim: 6 + (n % 5),
      assists: [],
      detail: "",
    })),
  };
}

const details: MatchDetail[] = [...history]
  .reverse()
  .flatMap((e, i): MatchDetail[] => {
    const ranked = makeDetail(e.gameId ?? i, 420, e.recordedAt - 1_800_000, e.championId ?? 17, e.win ?? false);
    if (i % 3 !== 1) return [ranked];
    return [ranked, makeDetail((e.gameId ?? i) + 500, 2400, e.recordedAt - 3_000_000, 222, i % 2 === 0)];
  });

const deltaByGame = new Map(history.map((e) => [e.gameId, e.delta]));

function summarize(d: MatchDetail): MatchSummary {
  const me = d.players.find((p) => p.puuid === "demo") ?? d.players[0];
  if (!me) throw new Error("no demo player");
  const teamKills = d.players.filter((p) => p.teamId === me.teamId).reduce((a, p) => a + p.kills, 0);
  return {
    gameId: d.gameId,
    queueId: d.queueId,
    championId: me.championId,
    champLevel: me.champLevel,
    position: me.position,
    win: me.win,
    remake: false,
    kills: me.kills,
    deaths: me.deaths,
    assists: me.assists,
    killParticipation: teamKills ? Math.floor(((me.kills + me.assists) * 100) / teamKills) : 0,
    cs: me.cs,
    items: me.items,
    spells: me.spells,
    keystone: me.perks[0] ?? 0,
    subStyle: me.subStyle,
    durationSec: d.durationSec,
    createdAt: d.createdAt,
    lpDelta: deltaByGame.get(d.gameId) ?? null,
    badges: me.badges,
  };
}
