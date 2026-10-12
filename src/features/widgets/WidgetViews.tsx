import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { InGame } from "../../lib/bindings/InGame";
import type { InGamePlayer } from "../../lib/bindings/InGamePlayer";
import type { SegmentKind } from "../../lib/bindings/SegmentKind";
import { ChampionIcon } from "../../components/ChampionIcon";
import { championKeyById, itemIcon, useCatalog } from "../../lib/ddragon";
import {
  dataFile,
  type ChampionBuilds,
  type DataIndex,
  type RoleBuild,
} from "../../lib/data";
import { clock } from "../live/InGamePanel";

const costCache = new Map<string, Promise<Record<string, number>>>();

function useItemCosts(): Record<string, number> {
  const catalog = useCatalog();
  const [costs, setCosts] = useState<Record<string, number>>({});
  const version = catalog?.version;
  useEffect(() => {
    if (!version) return;
    let pending = costCache.get(version);
    if (!pending) {
      pending = fetch(
        `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/item.json`,
      )
        .then(
          (r) =>
            r.json() as Promise<{
              data: Record<string, { gold: { total: number } }>;
            }>,
        )
        .then((json) =>
          Object.fromEntries(
            Object.entries(json.data).map(([id, item]) => [
              id,
              item.gold.total,
            ]),
          ),
        );
      pending.catch(() => costCache.delete(version));
      costCache.set(version, pending);
    }
    let alive = true;
    pending.then((c) => alive && setCosts(c)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [version]);
  return costs;
}

export function findMe(game: InGame): InGamePlayer | undefined {
  const me = game.me.toLowerCase();
  const name = me.split("#")[0];
  return (
    game.players.find((p) => p.riotId.toLowerCase() === me) ??
    game.players.find((p) => p.riotId.toLowerCase().split("#")[0] === name)
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <span className="flex items-center gap-1 text-[9px] leading-none font-medium tracking-[0.12em] whitespace-nowrap text-muted uppercase">
      {children}
    </span>
  );
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col justify-center gap-1 px-3.5">
      <div className="tabular flex items-baseline gap-1.5 text-[14px] leading-none font-semibold whitespace-nowrap text-fg">
        {children}
      </div>
      <Label>{label}</Label>
    </div>
  );
}

const k = (gold: number) => `${(Math.abs(gold) / 1000).toFixed(1)}k`;

function Champion({ me }: { me: InGamePlayer | undefined }) {
  const catalog = useCatalog();
  const id = me ? championKeyById(catalog, me.champion) : null;
  return (
    <div className="flex items-center px-2">
      <div className="relative">
        <ChampionIcon id={id} size={30} />
        {me && (
          <span className="tabular absolute -right-1.5 -bottom-1 min-w-4 rounded-sm bg-crimson px-0.5 text-center text-[9px] leading-[14px] font-semibold text-white">
            {me.level}
          </span>
        )}
      </div>
    </div>
  );
}

function Kda({ me }: { me: InGamePlayer | undefined }) {
  const kills = me?.kills ?? 0;
  const deaths = me?.deaths ?? 0;
  const assists = me?.assists ?? 0;
  const ratio = deaths ? ((kills + assists) / deaths).toFixed(1) : "perfect";
  return (
    <Cell label={`KDA ${ratio}`}>
      <span>{kills}</span>
      <span className="text-faint">/</span>
      <span className="text-crimson-bright">{deaths}</span>
      <span className="text-faint">/</span>
      <span>{assists}</span>
    </Cell>
  );
}

function GoldLead({
  game,
  me,
}: {
  game: InGame;
  me: InGamePlayer | undefined;
}) {
  const myTeam = me?.teamId ?? 100;
  const gold = (team: number) =>
    game.players
      .filter((p) => p.teamId === team)
      .reduce((s, p) => s + p.gold, 0);
  const ours = gold(myTeam);
  const theirs = gold(myTeam === 100 ? 200 : 100);
  const diff = ours - theirs;
  const share = ours + theirs > 0 ? ours / (ours + theirs) : 0.5;
  return (
    <Cell label="Gold lead">
      <span className={diff >= 0 ? "text-win" : "text-crimson-bright"}>
        {diff >= 0 ? "+" : "−"}
        {k(diff)}
      </span>
      <span className="flex h-1 w-12 self-center overflow-hidden rounded-full">
        <span className="bg-win" style={{ width: `${share * 100}%` }} />
        <span className="flex-1 bg-crimson" />
      </span>
    </Cell>
  );
}

function Farm({ game, me }: { game: InGame; me: InGamePlayer | undefined }) {
  const minutes = game.gameTime / 60;
  const cs = me?.cs ?? 0;
  return (
    <Cell label="CS · per min">
      <span>{cs}</span>
      <span className="text-[12px] font-medium text-soft">
        {minutes >= 1 ? (cs / minutes).toFixed(1) : "—"}
      </span>
    </Cell>
  );
}

const OBJECTIVE: Record<string, string> = { dragon: "Dragon", baron: "Baron" };

function Objectives({
  game,
  me,
  editing,
}: {
  game: InGame;
  me: InGamePlayer | undefined;
  editing: boolean;
}) {
  const myTeam = me?.teamId ?? 100;
  if (!game.timers.length)
    return editing ? (
      <Cell label="Objectives">
        <span className="text-[12px] font-medium text-muted">
          Summoner's Rift only
        </span>
      </Cell>
    ) : null;
  return (
    <div className="flex items-center gap-4 px-3.5">
      {game.timers.map((t, i) => {
        const left = t.respawnAt - game.gameTime;
        const tone =
          t.teamId === 0
            ? "bg-faint"
            : t.teamId === myTeam
              ? "bg-win"
              : "bg-crimson";
        return (
          <div key={i} className="flex flex-col justify-center gap-1">
            <span
              className={`tabular text-[14px] leading-none font-semibold ${left <= 0 ? "text-win" : "text-fg"}`}
            >
              {left <= 0 ? "Up" : clock(left)}
            </span>
            <Label>
              <span className={`h-1.5 w-1.5 rounded-full ${tone}`} />
              {t.kind === "inhibitor"
                ? t.label
                : (OBJECTIVE[t.kind] ?? t.label)}
            </Label>
          </div>
        );
      })}
    </div>
  );
}

function useRoleBuild(
  championId: number | null,
  position: string,
): RoleBuild | null {
  const [role, setRole] = useState<RoleBuild | null>(null);
  useEffect(() => {
    if (championId === null) return;
    let alive = true;
    dataFile<DataIndex>("index.json")
      .then((index) =>
        dataFile<ChampionBuilds>(`${index.patch}/champions/${championId}.json`),
      )
      .then((builds) => {
        const byGames = [...builds.roles].sort((a, b) => b.games - a.games);
        if (alive)
          setRole(
            builds.roles.find((r) => r.position === position) ??
              byGames[0] ??
              null,
          );
      })
      .catch(() => alive && setRole(null));
    return () => {
      alive = false;
    };
  }, [championId, position]);
  return role;
}

function CoreItems({
  game,
  me,
}: {
  game: InGame;
  me: InGamePlayer | undefined;
}) {
  const catalog = useCatalog();
  const costs = useItemCosts();
  const championId = me ? championKeyById(catalog, me.champion) : null;
  const role = useRoleBuild(championId, me?.position ?? "");
  const items = useMemo(() => {
    if (!role) return [];
    const core = (role.buildOrder?.[0] ?? role.core[0])?.value ?? [];
    const boots = role.boots[0]?.value;
    return [...(boots && !core.includes(boots) ? [boots] : []), ...core].slice(
      0,
      5,
    );
  }, [role]);
  const owned = new Set(me?.items ?? []);
  const next = items.find((id) => !owned.has(id));
  const cost = next !== undefined ? (costs[String(next)] ?? 0) : 0;

  if (!items.length)
    return (
      <Cell label="Core items">
        <span className="text-[12px] font-medium text-muted">
          {me ? "No build data yet" : "Waiting for the game"}
        </span>
      </Cell>
    );

  return (
    <div className="flex flex-col justify-center gap-1 px-3">
      <div className="flex gap-1">
        {items.map((id) => {
          const src = itemIcon(catalog, id);
          const has = owned.has(id);
          return (
            <div
              key={id}
              title={catalog?.items[String(id)]}
              className={`relative h-6 w-6 overflow-hidden rounded-sm bg-ink-800 ${id === next ? "ring-1 ring-crimson-bright" : ""}`}
            >
              {src && (
                <img
                  src={src}
                  alt=""
                  draggable={false}
                  className={`h-full w-full ${has ? "opacity-30 grayscale" : ""}`}
                />
              )}
              {has && (
                <span className="absolute inset-0 flex items-center justify-center text-[11px] text-fg">
                  ✓
                </span>
              )}
            </div>
          );
        })}
      </div>
      {next !== undefined && cost > 0 && (
        <div
          className="h-0.5 overflow-hidden rounded-full bg-ink-700"
          title={`${catalog?.items[String(next)] ?? "Next item"} · ${game.myGold}/${cost}g`}
        >
          <div
            className={`h-full ${game.myGold >= cost ? "bg-win" : "bg-crimson"}`}
            style={{ width: `${Math.min(100, (game.myGold / cost) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function SegmentView({
  kind,
  game,
  me,
  editing,
}: {
  kind: SegmentKind;
  game: InGame;
  me: InGamePlayer | undefined;
  editing: boolean;
}) {
  switch (kind) {
    case "champion":
      return <Champion me={me} />;
    case "kda":
      return <Kda me={me} />;
    case "farm":
      return <Farm game={game} me={me} />;
    case "goldLead":
      return <GoldLead game={game} me={me} />;
    case "objectives":
      return <Objectives game={game} me={me} editing={editing} />;
    case "coreItems":
      return <CoreItems game={game} me={me} />;
  }
}

export function StatsBar({
  segments,
  game,
  editing,
}: {
  segments: SegmentKind[];
  game: InGame;
  editing: boolean;
}) {
  const me = findMe(game);
  return (
    <div className="flex h-12 items-stretch overflow-hidden rounded-lg border border-line-strong bg-ink-950/90 shadow-[0_6px_20px_rgb(0_0_0/0.45)]">
      <div className="w-[3px] shrink-0 bg-crimson" />
      <div className="flex items-stretch divide-x divide-line-strong py-2 pr-1">
        {segments.map((kind) => (
          <SegmentView
            key={kind}
            kind={kind}
            game={game}
            me={me}
            editing={editing}
          />
        ))}
      </div>
    </div>
  );
}
