import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { InGame } from "../../lib/bindings/InGame";
import type { InGamePlayer } from "../../lib/bindings/InGamePlayer";
import type { WidgetKind } from "../../lib/bindings/WidgetKind";
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

function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-line-strong bg-ink-950/85 px-3 py-2 text-fg shadow-lg ${className}`}
    >
      {children}
    </div>
  );
}

const k = (gold: number) => `${(Math.abs(gold) / 1000).toFixed(1)}k`;

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
    <Card className="w-[180px]">
      <div className="tabular flex items-baseline justify-between">
        <span className="text-[11px] text-muted">Gold lead</span>
        <span
          className={`text-[15px] font-semibold ${diff >= 0 ? "text-win" : "text-crimson-bright"}`}
        >
          {diff >= 0 ? "+" : "−"}
          {k(diff)}
        </span>
      </div>
      <div className="mt-1.5 flex h-1 overflow-hidden rounded-full">
        <div className="bg-win" style={{ width: `${share * 100}%` }} />
        <div
          className="bg-crimson"
          style={{ width: `${(1 - share) * 100}%` }}
        />
      </div>
      <div className="tabular mt-1 flex justify-between text-[10px] text-faint">
        <span>{k(ours)}</span>
        <span>{k(theirs)}</span>
      </div>
    </Card>
  );
}

function Farm({ game, me }: { game: InGame; me: InGamePlayer | undefined }) {
  const minutes = game.gameTime / 60;
  const cs = me?.cs ?? 0;
  return (
    <Card className="tabular flex items-baseline gap-3">
      <div>
        <span className="text-[15px] font-semibold">{cs}</span>
        <span className="ml-1 text-[11px] text-muted">CS</span>
      </div>
      <div>
        <span className="text-[15px] font-semibold">
          {minutes >= 1 ? (cs / minutes).toFixed(1) : "—"}
        </span>
        <span className="ml-1 text-[11px] text-muted">/ min</span>
      </div>
    </Card>
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
      <Card className="text-[11px] text-muted">
        Objective timers show on Summoner's Rift
      </Card>
    ) : null;
  return (
    <Card className="flex flex-col gap-1">
      {game.timers.map((t, i) => {
        const left = t.respawnAt - game.gameTime;
        const tone =
          t.teamId === 0
            ? "bg-faint"
            : t.teamId === myTeam
              ? "bg-win"
              : "bg-crimson";
        return (
          <div key={i} className="tabular flex items-center gap-2 text-[12px]">
            <span className={`h-1.5 w-1.5 rounded-full ${tone}`} />
            <span className="flex-1 text-soft">
              {t.kind === "inhibitor"
                ? t.label
                : (OBJECTIVE[t.kind] ?? t.label)}
            </span>
            <span className={`pl-3 ${left <= 0 ? "text-win" : "text-fg"}`}>
              {left <= 0 ? "up" : clock(left)}
            </span>
          </div>
        );
      })}
    </Card>
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
      <Card className="text-[11px] text-muted">
        {me ? "No build data for this champion yet" : "Waiting for the game"}
      </Card>
    );

  return (
    <Card>
      <div className="mb-1.5 text-[11px] text-muted">Core items</div>
      <div className="flex gap-1">
        {items.map((id) => {
          const src = itemIcon(catalog, id);
          const has = owned.has(id);
          return (
            <div
              key={id}
              title={catalog?.items[String(id)]}
              className={`relative h-8 w-8 overflow-hidden rounded bg-ink-800 ${id === next ? "ring-1 ring-crimson" : ""}`}
            >
              {src && (
                <img
                  src={src}
                  alt=""
                  draggable={false}
                  className={`h-full w-full ${has ? "opacity-35" : ""}`}
                />
              )}
              {has && (
                <span className="absolute inset-0 flex items-center justify-center text-[13px] text-fg">
                  ✓
                </span>
              )}
            </div>
          );
        })}
      </div>
      {next !== undefined && cost > 0 && (
        <div className="tabular mt-1.5 text-[11px] text-muted">
          <span className="text-soft">
            {catalog?.items[String(next)] ?? "Next item"}
          </span>{" "}
          · {game.myGold}/{cost}g
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-ink-700">
            <div
              className={`h-full ${game.myGold >= cost ? "bg-win" : "bg-crimson"}`}
              style={{ width: `${Math.min(100, (game.myGold / cost) * 100)}%` }}
            />
          </div>
        </div>
      )}
    </Card>
  );
}

export function WidgetView({
  kind,
  game,
  editing,
}: {
  kind: WidgetKind;
  game: InGame;
  editing: boolean;
}) {
  const me = findMe(game);
  switch (kind) {
    case "goldLead":
      return <GoldLead game={game} me={me} />;
    case "farm":
      return <Farm game={game} me={me} />;
    case "objectives":
      return <Objectives game={game} me={me} editing={editing} />;
    case "coreItems":
      return <CoreItems game={game} me={me} />;
  }
}
