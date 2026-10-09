import { useEffect, useState } from "react";
import type { ClientStatus } from "../../lib/bindings/ClientStatus";
import type { LiveGame } from "../../lib/bindings/LiveGame";
import type { LivePlayer } from "../../lib/bindings/LivePlayer";
import { PlayerBadges } from "../../components/Badges";
import { ChampionIcon } from "../../components/ChampionIcon";
import {
  KeystonePair,
  kdaText,
  RankCrest,
  RecentStrip,
  SpellsByName,
} from "../../components/GameBits";
import { Empty, Panel } from "../../components/ui";
import { positionLabel } from "../../lib/data";
import { championName, useCatalog } from "../../lib/ddragon";
import { queueLabel } from "../../lib/format";
import { api } from "../../lib/ipc";
import { absolute, fromAbsolute, rankLabel } from "../../lib/rank";
import { ChampSelectView } from "./ChampSelectView";
import { RoleSplit, Today, TopChampions } from "../../components/PlayerPool";
import { InGamePanel, TimedSpells, type SpellTimers } from "./InGamePanel";
import { AugmentRanking } from "../../components/AugmentRanking";
import { Spells } from "../../components/GameIcons";
import type { InGame } from "../../lib/bindings/InGame";

export const IN_GAME = ["GameStart", "InProgress", "Reconnect"];

export function LivePage({ status }: { status: ClientStatus | null }) {
  const phase = status?.state === "connected" ? status.phase : null;
  if (phase === "ChampSelect") return <ChampSelectView />;
  if (phase !== null && IN_GAME.includes(phase)) return <LiveGameView />;
  return (
    <Panel>
      <Empty
        title="Waiting for your next game"
        body="This page switches to champion select and then to the live game automatically. Teeto looks up every player through your League client."
      />
    </Panel>
  );
}

function LiveGameView() {
  const [game, setGame] = useState<LiveGame | null>(null);
  const [inGame, setInGame] = useState<InGame | null>(null);
  const [spellTimers, setSpellTimers] = useState<SpellTimers>({});
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .liveGame()
        .then((g) => alive && (setGame(g), setError(null)))
        .catch((e: unknown) => alive && setError(String(e)))
        .finally(() => alive && setLoaded(true));
    const loadInGame = () => api.inGame().then((g) => alive && setInGame(g));
    load();
    loadInGame();
    const timer = setInterval(load, 10_000);
    const fast = setInterval(loadInGame, 2_000);
    return () => {
      alive = false;
      clearInterval(timer);
      clearInterval(fast);
    };
  }, []);

  if (!loaded) return <Panel className="h-48 animate-pulse" />;
  if (error && !game)
    return (
      <Panel>
        <Empty title="Couldn't scout this game" body={error} />
      </Panel>
    );
  if (!game)
    return (
      <Panel>
        <Empty
          title="No players found yet"
          body="The client hasn't shared the players for this game. Trying again shortly."
        />
      </Panel>
    );

  const me = game.players.find((p) => p.isMe);
  const myTeam = me?.teamId ?? 100;
  const meTag = me ? `${me.gameName}#${me.tagLine}`.toLowerCase() : "";
  const inGameTeam = inGame?.players.find((p) => p.riotId.toLowerCase() === meTag)?.teamId ?? myTeam;
  const startTimer = (key: string) =>
    inGame &&
    setSpellTimers((t) => {
      const next = { ...t };
      if (next[key] !== undefined && inGame.gameTime - (next[key] ?? 0) < 5) delete next[key];
      else next[key] = inGame.gameTime;
      return next;
    });
  const teams = [myTeam, myTeam === 100 ? 200 : 100];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <h1 className="text-[15px] font-medium">Live game</h1>
        <span className="text-muted">{queueLabel(game.queueId)}</span>
      </div>
      {inGame && <InGamePanel game={inGame} myTeam={inGameTeam} />}
      {game.queueId === 2400 && me && <AugmentRanking championId={me.championId} limit={10} />}
      {teams.map((team) => (
        <TeamTable
          key={team}
          players={game.players.filter((p) => p.teamId === team)}
          ally={team === myTeam}
          spells={{ gameTime: inGame?.gameTime ?? null, timers: spellTimers, onStart: startTimer }}
        />
      ))}
    </div>
  );
}

const COLS =
  "grid-cols-[150px_minmax(160px,1.2fr)_minmax(170px,1fr)_minmax(150px,1fr)_minmax(150px,0.9fr)_minmax(250px,1.2fr)]";

interface SpellControls {
  gameTime: number | null;
  timers: SpellTimers;
  onStart: (key: string) => void;
}

function TeamTable({ players, ally, spells }: { players: LivePlayer[]; ally: boolean; spells: SpellControls }) {
  const ranked = players
    .map((p) => (p.rank ? absolute(p.rank) : null))
    .filter((v): v is number => v !== null);
  const avg = ranked.length
    ? fromAbsolute(
        Math.round(ranked.reduce((a, b) => a + b, 0) / ranked.length),
      )
    : null;
  const games = players.reduce((s, p) => s + p.recentGames, 0);
  const wins = players.reduce((s, p) => s + p.recentWins, 0);

  return (
    <Panel className="overflow-x-auto pb-1">
      <div className="mb-2 flex items-center gap-4">
        <span
          className={`font-medium ${ally ? "text-win" : "text-crimson-bright"}`}
        >
          {ally ? "Your team" : "Enemy team"}
        </span>
        {avg && (
          <span className="flex items-center gap-1.5 text-muted">
            <RankCrest standing={{ ...avg, wins: 0, losses: 0 }} size={18} />
            Average {rankLabel(avg)}
          </span>
        )}
        {games > 0 && (
          <span className="text-muted">
            Recent win rate {Math.round((wins / games) * 100)}%
          </span>
        )}
      </div>
      <div
        className={`grid ${COLS} min-w-[1100px] gap-4 border-t border-line pt-1.5 pb-1 text-[11px] text-faint`}
      >
        <span>Champion</span>
        <span>Player</span>
        <span>Rank</span>
        <span>On this champion</span>
        <span>Plays</span>
        <span>Last 10 games</span>
      </div>
      {players.map((p) => (
        <Row key={p.puuid} p={p} spells={ally ? spells : null} />
      ))}
    </Panel>
  );
}

function Row({ p, spells }: { p: LivePlayer; spells: SpellControls | null }) {
  const catalog = useCatalog();
  const seasonGames = p.rank ? p.rank.wins + p.rank.losses : 0;
  const seasonWr = seasonGames
    ? Math.round(((p.rank?.wins ?? 0) / seasonGames) * 100)
    : null;
  const champWr = p.championGames
    ? Math.round((p.championWins / p.championGames) * 100)
    : null;
  const recentWr = p.recentGames
    ? Math.round((p.recentWins / p.recentGames) * 100)
    : null;
  const [ck = 0, cd = 0, ca = 0] = p.championKda;
  const [rk = 0, rd = 0, ra = 0] = p.recentKda;

  return (
    <div
      className={`grid ${COLS} min-w-[1100px] items-center gap-4 border-t border-line py-2.5 ${p.isMe ? "bg-ink-800/60" : ""}`}
    >
      <div className="flex items-center gap-1.5">
        <ChampionIcon id={p.championId} size={48} />
        {spells && p.spellIds.length ? (
          <TimedSpells
            puuid={p.puuid}
            spellIds={p.spellIds}
            gameTime={spells.gameTime}
            timers={spells.timers}
            onStart={spells.onStart}
          />
        ) : p.spellIds.length ? (
          <Spells spells={p.spellIds} size={22} />
        ) : (
          <SpellsByName spells={p.spells} size={22} />
        )}
        <KeystonePair keystone={p.keystone} subStyle={p.subStyle} size={22} />
      </div>

      <div className="min-w-0">
        <div className="flex items-baseline gap-1">
          <span
            className={`truncate font-medium ${p.isMe ? "text-fg" : "text-soft"}`}
          >
            {p.gameName || "Unknown"}
          </span>
          <span className="shrink-0 text-faint">#{p.tagLine}</span>
        </div>
        <div className="text-[11px] text-muted">
          {championName(catalog, p.championId)} · level {p.level}
          {p.mainRole && ` · mains ${positionLabel(p.mainRole).toLowerCase()}`}
        </div>
        <div className="mt-1">
          <PlayerBadges badges={p.badges} />
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <RankCrest standing={p.rank} size={36} />
        <div className="min-w-0">
          <div className="text-soft">
            {p.rank ? `${rankLabel(p.rank)} · ${p.rank.lp} LP` : "Unranked"}
          </div>
          {seasonWr !== null && p.rank && (
            <div className="tabular text-[11px] text-muted">
              <span
                className={seasonWr >= 50 ? "text-win" : "text-crimson-bright"}
              >
                {seasonWr}%
              </span>{" "}
              · {p.rank.wins}W {p.rank.losses}L
            </div>
          )}
          {(p.peak || p.lastSeason) && (
            <div className="text-[11px] text-faint">
              {p.peak && `Peak ${rankLabel(p.peak)}`}
              {p.peak && p.lastSeason && " · "}
              {p.lastSeason && `Last season ${rankLabel(p.lastSeason)}`}
            </div>
          )}
        </div>
      </div>

      <div className="tabular min-w-0">
        <div className="text-soft">
          {p.masteryPoints > 0
            ? `Mastery ${p.masteryLevel} · ${formatPoints(p.masteryPoints)}`
            : "No mastery"}
        </div>
        <div className="text-[11px] text-muted">
          {champWr !== null ? (
            <>
              <span
                className={champWr >= 50 ? "text-win" : "text-crimson-bright"}
              >
                {champWr}%
              </span>{" "}
              in {p.championGames} recent · {kdaText(ck, cd, ca)} KDA
            </>
          ) : (
            "Not in recent games"
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <TopChampions p={p} />
        <RoleSplit p={p} />
        <Today p={p} />
      </div>

      <div className="min-w-0">
        <RecentStrip games={p.recent} />
        {recentWr !== null && (
          <div className="tabular mt-1 text-[11px] text-muted">
            <span
              className={recentWr >= 50 ? "text-win" : "text-crimson-bright"}
            >
              {recentWr}%
            </span>{" "}
            of last {p.recentGames} · {kdaText(rk, rd, ra)} KDA
            {p.streak >= 2 && (
              <span className="text-win"> · {p.streak}W streak</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatPoints(points: number): string {
  return points >= 1000 ? `${Math.round(points / 1000)}k` : String(points);
}
