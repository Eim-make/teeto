import { useMemo } from "react";
import type { MatchDetail } from "../../lib/bindings/MatchDetail";
import type { MatchEvent } from "../../lib/bindings/MatchEvent";
import type { PlayerDetail } from "../../lib/bindings/PlayerDetail";
import type { TeamDetail } from "../../lib/bindings/TeamDetail";
import { ChampionIcon } from "../../components/ChampionIcon";
import { MatchBadges } from "../../components/Badges";
import { AugmentIcon } from "../../components/GameBits";
import { Items, Runes, Spells } from "../../components/GameIcons";
import { Empty, Panel, PanelTitle } from "../../components/ui";
import { championName, useCatalog } from "../../lib/ddragon";
import { duration, queueLabel } from "../../lib/format";
import { useResource } from "../../lib/hooks";
import { api } from "../../lib/ipc";
import { GoldChart } from "./GoldChart";

export function MatchDetailPage({
  gameId,
  puuid,
  onBack,
}: {
  gameId: number;
  puuid: string | null;
  onBack: () => void;
}) {
  const detail = useResource(() => api.matchDetail(gameId), [gameId]);

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={onBack}
        className="flex w-fit cursor-pointer items-center gap-1.5 text-muted hover:text-fg"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M10 3 5 8l5 5" />
        </svg>
        Back
      </button>
      {detail.state === "loading" && <Panel className="h-40 animate-pulse" />}
      {detail.state === "error" && (
        <Panel>
          <Empty title="Couldn't open this match" body={detail.message} />
        </Panel>
      )}
      {detail.state === "ready" && <Detail match={detail.data} puuid={puuid} />}
    </div>
  );
}

function Detail({
  match,
  puuid,
}: {
  match: MatchDetail;
  puuid: string | null;
}) {
  const me = match.players.find((p) => p.puuid === puuid);
  const myTeam = me?.teamId ?? 100;
  const teams = [...match.teams].sort((a, b) =>
    a.teamId === myTeam ? -1 : b.teamId === myTeam ? 1 : 0,
  );
  const maxDamage = Math.max(
    1,
    ...match.players.map((p) => p.damageToChampions),
  );
  const remake = match.durationSec < 300;
  const won =
    me?.win ?? match.teams.find((t) => t.teamId === 100)?.win ?? false;

  return (
    <>
      <div className="flex items-end gap-4">
        <div>
          <div
            className={`text-xl font-medium ${remake ? "text-muted" : won ? "text-win" : "text-crimson-bright"}`}
          >
            {remake ? "Remake" : won ? "Victory" : "Defeat"}
          </div>
          <div className="text-muted">
            {queueLabel(match.queueId)} · {duration(match.durationSec)} · Patch{" "}
            {match.patch} ·{" "}
            {new Date(match.createdAt).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        </div>
      </div>

      {teams.map((team) => (
        <TeamTable
          key={team.teamId}
          team={team}
          players={match.players.filter((p) => p.teamId === team.teamId)}
          maxDamage={maxDamage}
          me={puuid}
          ally={team.teamId === myTeam}
        />
      ))}

      {match.goldDiff.length > 1 && (
        <Panel>
          <PanelTitle
            aside={<span className="text-muted">Your team vs enemy team</span>}
          >
            Gold lead
          </PanelTitle>
          <GoldChart
            diff={
              myTeam === 100 ? match.goldDiff : match.goldDiff.map((g) => -g)
            }
            events={match.events}
            myTeam={myTeam}
          />
        </Panel>
      )}

      {match.events.length > 0 && <Timeline match={match} myTeam={myTeam} />}
    </>
  );
}

function TeamTable({
  team,
  players,
  maxDamage,
  me,
  ally,
}: {
  team: TeamDetail;
  players: PlayerDetail[];
  maxDamage: number;
  me: string | null;
  ally: boolean;
}) {
  const kills = players.reduce((s, p) => s + p.kills, 0);
  const gold = players.reduce((s, p) => s + p.gold, 0);
  const objectives: [string, number][] = [
    ["Towers", team.towers],
    ["Dragons", team.dragons],
    ["Barons", team.barons],
    ["Grubs", team.grubs],
    ["Heralds", team.heralds],
    ["Inhibs", team.inhibitors],
  ];

  return (
    <Panel className="pb-1">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span
          className={`font-medium ${team.win ? "text-win" : "text-crimson-bright"}`}
        >
          {team.win ? "Victory" : "Defeat"}
        </span>
        <span className="text-muted">{ally ? "Your team" : "Enemy team"}</span>
        <span className="tabular text-muted">
          {kills} kills · {(gold / 1000).toFixed(1)}k gold
        </span>
        <div className="flex-1" />
        {objectives.map(([label, n]) => (
          <span key={label} className="tabular text-muted">
            {label} <span className="text-fg">{n}</span>
          </span>
        ))}
      </div>
      <div className="grid grid-cols-[minmax(0,1.4fr)_92px_minmax(0,1fr)_56px_56px_44px_152px] items-center gap-3 border-t border-line py-1.5 text-[11px] text-faint">
        <span>Player</span>
        <span>KDA</span>
        <span>Damage to champions</span>
        <span className="text-right">Gold</span>
        <span className="text-right">CS</span>
        <span className="text-right">Vision</span>
        <span>Items</span>
      </div>
      {players.map((p) => (
        <PlayerRow
          key={p.participantId}
          p={p}
          teamKills={kills}
          maxDamage={maxDamage}
          highlight={p.puuid === me}
        />
      ))}
    </Panel>
  );
}

function PlayerRow({
  p,
  teamKills,
  maxDamage,
  highlight,
}: {
  p: PlayerDetail;
  teamKills: number;
  maxDamage: number;
  highlight: boolean;
}) {
  const kp = teamKills
    ? Math.round(((p.kills + p.assists) / teamKills) * 100)
    : 0;
  return (
    <div
      className={`grid grid-cols-[minmax(0,1.4fr)_92px_minmax(0,1fr)_56px_56px_44px_152px] items-center gap-3 border-t border-line py-1.5 ${
        highlight ? "bg-ink-800/70" : ""
      }`}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <div className="relative">
          <ChampionIcon id={p.championId} size={32} />
          <span className="tabular absolute -right-1 -bottom-1 rounded bg-ink-950 px-1 text-[10px] text-soft">
            {p.champLevel}
          </span>
        </div>
        <Spells spells={p.spells} size={15} />
        <Runes keystone={p.perks[0] ?? 0} sub={p.subStyle} size={15} />
        <div className="ml-1 min-w-0">
          <div className={`truncate ${highlight ? "text-fg" : "text-soft"}`}>
            {p.gameName || "Unknown"}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[11px] text-faint">#{p.tagLine}</span>
            <MatchBadges badges={p.badges} max={2} />
          </div>
        </div>
      </div>
      <div className="tabular">
        <div>
          {p.kills} / <span className="text-crimson-bright">{p.deaths}</span> /{" "}
          {p.assists}
        </div>
        <div className="text-[11px] text-faint">{kp}% KP</div>
      </div>
      <div>
        <div className="tabular text-[11px] text-muted">
          {p.damageToChampions.toLocaleString()}
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-700">
          <div
            className={`h-full ${p.win ? "bg-win" : "bg-crimson"}`}
            style={{ width: `${(p.damageToChampions / maxDamage) * 100}%` }}
          />
        </div>
      </div>
      <div className="tabular text-right text-muted">
        {(p.gold / 1000).toFixed(1)}k
      </div>
      <div className="tabular text-right text-muted">{p.cs}</div>
      <div className="tabular text-right text-muted">{p.visionScore}</div>
      <div className="flex flex-col gap-1">
        <Items items={p.items} size={20} />
        {p.augments.length > 0 && (
          <div className="flex gap-0.5">
            {p.augments.map((id) => (
              <AugmentIcon key={id} id={id} size={20} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const EVENT_LABEL: Record<MatchEvent["kind"], string> = {
  kill: "Kill",
  tower: "Tower",
  inhibitor: "Inhibitor",
  dragon: "Dragon",
  baron: "Baron",
  herald: "Herald",
  grubs: "Voidgrub",
  atakhan: "Atakhan",
};

function Timeline({ match, myTeam }: { match: MatchDetail; myTeam: number }) {
  const catalog = useCatalog();
  const byId = useMemo(
    () => new Map(match.players.map((p) => [p.participantId, p])),
    [match.players],
  );
  const objectives = match.events.filter((e) => e.kind !== "kill");

  return (
    <Panel>
      <PanelTitle>Objectives</PanelTitle>
      {objectives.length === 0 ? (
        <div className="text-muted">No objective events in this game.</div>
      ) : (
        <div className="grid grid-cols-2 gap-x-6">
          {objectives.map((e, i) => {
            const killer = byId.get(e.killer);
            const ours = e.teamId === myTeam;
            return (
              <div
                key={i}
                className="flex items-center gap-3 border-t border-line py-1.5"
              >
                <span className="tabular w-10 text-faint">
                  {duration(Math.floor(e.atMs / 1000))}
                </span>
                <span
                  className={`h-1.5 w-1.5 rounded-full ${ours ? "bg-win" : "bg-crimson"}`}
                />
                <span className="min-w-0 flex-1 truncate">
                  {EVENT_LABEL[e.kind]}
                  {e.detail && (
                    <span className="text-muted"> · {prettify(e.detail)}</span>
                  )}
                </span>
                {killer && (
                  <span className="truncate text-muted">
                    {championName(catalog, killer.championId)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function prettify(detail: string): string {
  return detail
    .replace(/_DRAGON$|_LANE$/, "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}
