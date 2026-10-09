import type { Queue } from "../../lib/bindings/Queue";
import type { LpEntry } from "../../lib/bindings/LpEntry";
import { ChampionIcon } from "../../components/ChampionIcon";
import { Empty, Panel, PanelTitle, Segmented, Stat } from "../../components/ui";
import { championName, useCatalog } from "../../lib/ddragon";
import { ago, QUEUE_OPTIONS } from "../../lib/format";
import { rankLabel } from "../../lib/rank";
import { formatDelta, LpChart } from "./LpChart";
import { useLp } from "./useLp";

export function LpPage({
  queue,
  onQueue,
}: {
  queue: Queue;
  onQueue: (q: Queue) => void;
}) {
  const { entries, stats } = useLp(queue);
  const games = entries.filter((e) => e.kind === "game");
  const best = games.reduce<number | null>(
    (m, e) => (e.delta !== null && (m === null || e.delta > m) ? e.delta : m),
    null,
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center">
        <h1 className="text-[15px] font-medium">LP history</h1>
        <div className="flex-1" />
        <Segmented options={QUEUE_OPTIONS} value={queue} onChange={onQueue} />
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Stat
          label="Net tracked"
          value={formatDelta(entries.length ? stats.net : null)}
          sub={`${entries.length} changes`}
        />
        <Stat
          label="Games tracked"
          value={games.length}
          sub={`${games.filter((g) => g.win).length} won`}
        />
        <Stat
          label="Avg gain / loss"
          value={`${stats.avgGain !== null ? `+${Math.round(stats.avgGain)}` : "—"} / ${
            stats.avgLoss !== null ? `−${Math.round(stats.avgLoss)}` : "—"
          }`}
          sub="Last 20 games"
        />
        <Stat
          label="Biggest gain"
          value={best !== null ? formatDelta(best) : "—"}
          sub="Single game"
        />
      </div>

      <Panel>
        <PanelTitle>All tracked changes</PanelTitle>
        {entries.length ? (
          <LpChart entries={entries} />
        ) : (
          <Empty
            title="No LP changes yet"
            body="Teeto starts tracking from the first ranked game you play with it open. Older games can't be backfilled from the client."
          />
        )}
      </Panel>

      {entries.length > 0 && (
        <Panel className="pb-1">
          <PanelTitle>Log</PanelTitle>
          {[...entries].reverse().map((e) => (
            <Row key={e.id} entry={e} />
          ))}
        </Panel>
      )}
    </div>
  );
}

function Row({ entry: e }: { entry: LpEntry }) {
  const catalog = useCatalog();
  const title =
    e.kind === "game"
      ? <>
          <span className={e.win === null ? "" : e.win ? "text-win" : "text-crimson-bright"}>
            {e.win === null ? "Game" : e.win ? "Victory" : "Defeat"}
          </span>{" "}
          · {championName(catalog, e.championId)}
        </>
      : e.kind === "adjustment"
        ? "LP adjustment"
        : "Games played without Teeto";

  return (
    <div className="grid grid-cols-[34px_minmax(0,1fr)_140px_80px_70px] items-center gap-3 border-t border-line py-2">
      {e.kind === "game" ? (
        <ChampionIcon id={e.championId} />
      ) : (
        <div className="h-[34px] w-[34px] rounded-lg border border-dashed border-line-strong" />
      )}
      <div className="min-w-0">
        <div className="truncate">{title}</div>
        <div className="tabular truncate text-muted">
          {e.kills !== null
            ? `${e.kills} / ${e.deaths ?? 0} / ${e.assists ?? 0}`
            : "No game details"}
        </div>
      </div>
      <div className="text-muted">
        {rankLabel(e.after)} · {e.after.lp} LP
      </div>
      <div className="text-muted">{ago(e.recordedAt)}</div>
      <div
        className={`tabular text-right ${
          e.delta === null
            ? "text-faint"
            : e.delta >= 0
              ? "text-win"
              : "text-crimson-bright"
        }`}
      >
        {formatDelta(e.delta)}
      </div>
    </div>
  );
}
