import { useMemo } from "react";
import { ChampionIcon } from "../../components/ChampionIcon";
import { Empty, Panel, Segmented } from "../../components/ui";
import {
  dataFile,
  pct,
  POSITIONS,
  positionLabel,
  type DataIndex,
  type TierRow,
} from "../../lib/data";
import { championName, useCatalog } from "../../lib/ddragon";
import { ago } from "../../lib/format";
import { useRemembered, useResource } from "../../lib/hooks";
import { ChampionView } from "./ChampionView";
import { AugmentRanking } from "../../components/AugmentRanking";
import { AugmentIcon, useAugmentName } from "../../components/GameBits";
import { api } from "../../lib/ipc";

type SortKey = "tier" | "winRate" | "pickRate" | "banRate" | "games";
const TIER_ORDER: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4 };
const ROLE_OPTIONS = [{ value: "ALL", label: "All" }, ...POSITIONS];

export function TierBadge({ tier }: { tier: string }) {
  const style =
    tier === "S"
      ? "bg-crimson text-white"
      : tier === "A"
        ? "bg-soft text-ink-950"
        : tier === "B"
          ? "bg-ink-700 text-fg"
          : "bg-ink-800 text-muted";
  return (
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-semibold ${style}`}
    >
      {tier}
    </span>
  );
}

export function ChampionsPage({
  open,
  onOpen,
  onBack,
}: {
  open: { id: number; position: string } | null;
  onOpen: (championId: number, position: string) => void;
  onBack: () => void;
}) {
  const index = useResource(() => dataFile<DataIndex>("index.json"), []);
  const [mode, setMode] = useRemembered<"ranked" | "mayhem">("champions.mode", "ranked");

  if (!open && mode === "mayhem")
    return (
      <div className="flex flex-col gap-3">
        <ModeSwitch mode={mode} onChange={setMode} />
        <MayhemAugments />
      </div>
    );

  if (index.state === "loading") return <Panel className="h-40 animate-pulse" />;
  if (index.state === "error")
    return (
      <Panel>
        <Empty
          title="Champion stats aren't available"
          body="Couldn't load champion stats right now. Check your internet connection and try again in a bit."
        />
      </Panel>
    );

  if (open)
    return <ChampionView patch={index.data.patch} championId={open.id} position={open.position} onBack={onBack} />;
  return (
    <div className="flex flex-col gap-3">
      <ModeSwitch mode={mode} onChange={setMode} />
      <TierList index={index.data} onOpen={onOpen} />
    </div>
  );
}

function TierList({
  index,
  onOpen,
}: {
  index: DataIndex;
  onOpen: (championId: number, position: string) => void;
}) {
  const rows = useResource(
    () => dataFile<TierRow[]>(`${index.patch}/tierlist.json`),
    [index.patch],
  );
  const catalog = useCatalog();
  const [role, setRole] = useRemembered<string>("tier.role", "ALL");
  const [query, setQuery] = useRemembered("tier.query", "");
  const [sort, setSort] = useRemembered<SortKey>("tier.sort", "tier");

  const visible = useMemo(() => {
    if (rows.state !== "ready") return [];
    const q = query.trim().toLowerCase();
    return rows.data
      .filter((r) => role === "ALL" || r.position === role)
      .filter(
        (r) =>
          !q || championName(catalog, r.championId).toLowerCase().includes(q),
      )
      .sort((a, b) =>
        sort === "tier"
          ? (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9) ||
            b.winRate - a.winRate
          : b[sort] - a[sort],
      );
  }, [rows, role, query, sort, catalog]);

  const header = (key: SortKey, label: string) => (
    <button
      onClick={() => setSort(key)}
      className={`cursor-pointer text-right ${sort === key ? "text-fg" : "text-faint hover:text-soft"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-3">
        <div>
          <h1 className="text-[15px] font-medium">Champions</h1>
          <div className="text-muted">
            Patch {index.patch} · {index.games.toLocaleString()} ranked games
            {index.previousGames ? ` (+${index.previousGames.toLocaleString()} from ${index.mergedPatches[1]} where needed)` : ""}{" "}
            · updated {ago(index.updatedAt)}
          </div>
        </div>
        <div className="flex-1" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search champion"
          className="w-48 rounded-lg border border-line-strong bg-ink-900 px-3 py-1.5 outline-none focus:border-crimson"
        />
      </div>
      {rows.state === "ready" && <TopPicks rows={rows.data} onOpen={onOpen} />}
      <Segmented options={ROLE_OPTIONS} value={role} onChange={setRole} />
      <Panel className="pb-1">
        <div className="grid grid-cols-[40px_minmax(0,1fr)_80px_80px_80px_80px_80px] items-center gap-3 pb-2 text-[11px]">
          {header("tier", "Tier")}
          <span className="text-faint">Champion</span>
          <span className="text-faint">Role</span>
          {header("winRate", "Win rate")}
          {header("pickRate", "Pick rate")}
          {header("banRate", "Ban rate")}
          {header("games", "Games")}
        </div>
        {rows.state === "error" && (
          <Empty title="Couldn't load the tier list" body={rows.message} />
        )}
        {rows.state === "ready" && visible.length === 0 && (
          <Empty
            title="No champions here yet"
            body="The sample is still small for this role. Check back later."
          />
        )}
        {visible.map((r) => (
          <button
            key={`${r.championId}-${r.position}`}
            onClick={() => onOpen(r.championId, r.position)}
            className="grid w-full cursor-pointer grid-cols-[40px_minmax(0,1fr)_80px_80px_80px_80px_80px] items-center gap-3 border-t border-line py-1.5 text-left transition-colors hover:bg-ink-800/60"
          >
            <TierBadge tier={r.tier} />
            <div className="flex min-w-0 items-center gap-2.5">
              <ChampionIcon id={r.championId} size={30} />
              <span className="truncate">{championName(catalog, r.championId)}</span>
              {r.blended && (
                <span className="shrink-0 text-[10px] text-faint" title="Not enough games on this patch yet, includes last patch">
                  + last patch
                </span>
              )}
            </div>
            <span className="text-muted">{positionLabel(r.position)}</span>
            <span
              className={`tabular text-right ${r.winRate >= 0.5 ? "text-win" : "text-crimson-bright"}`}
            >
              {pct(r.winRate)}
            </span>
            <span className="tabular text-right text-soft">
              {pct(r.pickRate)}
            </span>
            <span className="tabular text-right text-soft">
              {pct(r.banRate)}
            </span>
            <span className="tabular text-right text-muted">
              {r.games.toLocaleString()}
            </span>
          </button>
        ))}
      </Panel>
    </div>
  );
}

function ModeSwitch({ mode, onChange }: { mode: "ranked" | "mayhem"; onChange: (m: "ranked" | "mayhem") => void }) {
  return (
    <Segmented
      options={[
        { value: "ranked", label: "Ranked" },
        { value: "mayhem", label: "ARAM Mayhem augments" },
      ]}
      value={mode}
      onChange={onChange}
    />
  );
}

function MayhemAugments() {
  const catalog = useCatalog();
  const name = useAugmentName();
  const stats = useResource(() => api.mayhemAugments(), [], ["matches-changed"]);
  const [query, setQuery] = useRemembered("mayhem.query", "");
  const list = stats.state === "ready" ? stats.data : [];
  const q = query.trim().toLowerCase();
  const visible = list.filter((c) => !q || championName(catalog, c.championId).toLowerCase().includes(q));
  const games = list.reduce((s, c) => s + c.games, 0) / 10;

  return (
    <>
      <div className="flex items-end gap-3">
        <div>
          <h1 className="text-[15px] font-medium">ARAM Mayhem augments</h1>
          <div className="text-muted">
            Global pick rates per augment, plus what your own {Math.round(games)} saved Mayhem games show for each
            champion further down.
          </div>
        </div>
        <div className="flex-1" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search champion"
          className="w-48 rounded-lg border border-line-strong bg-ink-900 px-3 py-1.5 outline-none focus:border-crimson"
        />
      </div>
      <AugmentRanking limit={30} />
      <h2 className="mt-2 text-[13px] font-medium text-soft">From your games</h2>
      {stats.state === "ready" && list.length === 0 ? (
        <Panel>
          <Empty title="No Mayhem games saved yet" body="Play an ARAM Mayhem game with Teeto open and the augments show up here." />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3">
          {visible.map((c) => (
            <Panel key={c.championId}>
              <div className="mb-2 flex items-center gap-2.5">
                <ChampionIcon id={c.championId} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{championName(catalog, c.championId)}</div>
                  <div className="tabular text-[11px] text-muted">
                    {c.games} {c.games === 1 ? "game" : "games"} ·{" "}
                    <span className={c.wins * 2 >= c.games ? "text-win" : "text-crimson-bright"}>
                      {Math.round((c.wins / c.games) * 100)}% wins
                    </span>
                  </div>
                </div>
              </div>
              {c.augments.slice(0, 6).map((a) => (
                <div key={a.id} className="flex items-center gap-2 border-t border-line py-1">
                  <AugmentIcon id={a.id} size={22} />
                  <span className="flex-1 truncate text-soft">{name(a.id)}</span>
                  <span className="tabular text-[11px] text-muted">
                    {a.games}× · {Math.round((a.wins / a.games) * 100)}%
                  </span>
                </div>
              ))}
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}

const TOP_PICK_ORDER: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4 };

function TopPicks({ rows, onOpen }: { rows: TierRow[]; onOpen: (championId: number, position: string) => void }) {
  const catalog = useCatalog();
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {POSITIONS.map((p) => {
        const best = rows
          .filter((r) => r.position === p.value)
          .sort((a, b) => (TOP_PICK_ORDER[a.tier] ?? 9) - (TOP_PICK_ORDER[b.tier] ?? 9) || b.winRate - a.winRate)
          .slice(0, 5);
        return (
          <Panel key={p.value} className="min-w-0">
            <div className="mb-2 text-[11px] text-muted">Top {p.label.toLowerCase()} picks</div>
            {best.map((r) => (
              <button
                key={r.championId}
                onClick={() => onOpen(r.championId, r.position)}
                className="flex w-full cursor-pointer items-center gap-2 rounded py-1 text-left hover:bg-ink-800/60"
              >
                <ChampionIcon id={r.championId} size={24} />
                <span className="min-w-0 flex-1 truncate">{championName(catalog, r.championId)}</span>
                <span className={`tabular text-[11px] ${r.winRate >= 0.5 ? "text-win" : "text-crimson-bright"}`}>
                  {pct(r.winRate)}
                </span>
              </button>
            ))}
          </Panel>
        );
      })}
    </div>
  );
}
