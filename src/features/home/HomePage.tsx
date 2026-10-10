import { useMemo } from "react";
import { useRemembered } from "../../lib/hooks";
import type { ClientStatus } from "../../lib/bindings/ClientStatus";
import type { Queue } from "../../lib/bindings/Queue";
import { Empty, Panel, PanelTitle, Segmented, Stat } from "../../components/ui";
import { profileIcon, useCatalog } from "../../lib/ddragon";
import { DAY, phaseLabel, QUEUE_OPTIONS } from "../../lib/format";
import {
  absolute,
  boundaryLabel,
  isApex,
  rankLabel,
  sessionStart,
  winsToPromote,
  type MmrHint,
} from "../../lib/rank";
import type { Section } from "../../app/Sidebar";
import { formatDelta, LpChart } from "../lp/LpChart";
import { useLp } from "../lp/useLp";
import { ChampionPool } from "./ChampionPool";
import { HomeBackdrop } from "./HomeBackdrop";
import { PatchForYou } from "./PatchForYou";

type Range = "session" | "week" | "season";

const MMR_TEXT: Record<MmrHint, string> = {
  above: "Gaining more than losing",
  near: "Gains and losses even",
  below: "Losing more than gaining",
  unknown: "Needs a few more games",
};

export function HomePage({
  status,
  queue,
  onQueue,
  onOpenMatch,
  onNavigate,
}: {
  status: ClientStatus | null;
  queue: Queue;
  onQueue: (q: Queue) => void;
  onOpenMatch: (gameId: number) => void;
  onNavigate: (section: Section) => void;
}) {
  const [range, setRange] = useRemembered<Range>("home.range", "week");
  const { entries, rank, stats } = useLp(queue);

  const session = useMemo(() => {
    const last = entries[entries.length - 1];
    if (!last || Date.now() - last.recordedAt > 6 * 3_600_000) return null;
    const start = sessionStart(entries);
    return entries.filter((e) => e.recordedAt >= start);
  }, [entries]);

  const visible = useMemo(() => {
    if (range === "season") return entries;
    const since =
      range === "week" ? Date.now() - 7 * DAY : sessionStart(entries);
    return entries.filter((e) => e.recordedAt >= since);
  }, [entries, range]);

  const standing = rank?.standing;
  const games = standing ? standing.wins + standing.losses : 0;
  const toPromo = standing ? winsToPromote(standing, stats.avgGain) : null;
  const abs = standing ? absolute(standing) : null;
  const next =
    standing && abs !== null && !isApex(standing.tier)
      ? boundaryLabel(abs - standing.lp + 100)
      : null;
  const sessionNet = session?.reduce((s, e) => s + (e.delta ?? 0), 0) ?? null;

  return (
    <>
      <HomeBackdrop />
      <div className="home-glass relative flex flex-col gap-3">
        <Header status={status} sessionNet={sessionNet} />

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_380px] 2xl:grid-cols-[minmax(0,1fr)_440px]">
          <div className="flex min-w-0 flex-col gap-3">
            <Segmented
              options={QUEUE_OPTIONS}
              value={queue}
              onChange={onQueue}
            />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat
                label="Rank"
                value={standing ? rankLabel(standing) : "Unranked"}
                sub={
                  standing
                    ? `${standing.lp} LP · ${standing.wins}W ${standing.losses}L`
                    : "No ranked games yet"
                }
              />
              <Stat
                label="Avg gain / loss"
                value={
                  <>
                    <span className="text-win">
                      {stats.avgGain !== null
                        ? `+${Math.round(stats.avgGain)}`
                        : "—"}
                    </span>
                    <span className="text-faint"> / </span>
                    <span className="text-crimson-bright">
                      {stats.avgLoss !== null
                        ? `−${Math.round(stats.avgLoss)}`
                        : "—"}
                    </span>
                  </>
                }
                sub={MMR_TEXT[stats.mmr]}
              />
              <Stat
                label={`Last ${stats.wins + stats.losses || 20} tracked`}
                value={`${stats.wins}W ${stats.losses}L`}
                sub={
                  stats.streak && stats.streak.count > 1
                    ? `${stats.streak.count} ${stats.streak.win ? "wins" : "losses"} in a row`
                    : games
                      ? `${Math.round(((standing?.wins ?? 0) / games) * 100)}% season win rate`
                      : "—"
                }
              />
              <Stat
                label={next ? `Next: ${next}` : "Next division"}
                value={
                  !standing || absolute(standing) === null
                    ? "—"
                    : isApex(standing.tier)
                      ? `${standing.lp} LP`
                      : `${100 - standing.lp} LP to go`
                }
                sub={
                  standing && absolute(standing) !== null ? (
                    <div>
                      {!isApex(standing.tier) && (
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-700">
                          <div
                            className="h-full bg-crimson"
                            style={{ width: `${Math.min(100, standing.lp)}%` }}
                          />
                        </div>
                      )}
                      <div className="mt-1 text-muted">
                        {isApex(standing.tier)
                          ? "Apex tier, no divisions"
                          : toPromo
                            ? `About ${toPromo} ${toPromo === 1 ? "win" : "wins"} at your average gain`
                            : `${standing.lp} / 100 LP`}
                      </div>
                    </div>
                  ) : (
                    "Play ranked to get placed"
                  )
                }
              />
            </div>

            <Panel>
              <PanelTitle
                aside={
                  <Segmented
                    options={[
                      { value: "session", label: "Session" },
                      { value: "week", label: "7 days" },
                      { value: "season", label: "All" },
                    ]}
                    value={range}
                    onChange={setRange}
                  />
                }
              >
                LP history
              </PanelTitle>
              {visible.length ? (
                <LpChart entries={visible} />
              ) : (
                <Empty
                  title="Nothing tracked here yet"
                  body="Keep Teeto open while you play ranked. Every game's LP change lands here automatically."
                />
              )}
            </Panel>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <ChampionPool
              onOpenMatch={onOpenMatch}
              onSeeAll={() => onNavigate("matches")}
            />
            <PatchForYou onOpen={() => onNavigate("patches")} />
          </div>
        </div>
      </div>
    </>
  );
}

function Header({
  status,
  sessionNet,
}: {
  status: ClientStatus | null;
  sessionNet: number | null;
}) {
  const catalog = useCatalog();
  const summoner = status?.summoner ?? null;
  const icon = summoner ? profileIcon(catalog, summoner.profileIconId) : null;
  const connected = status?.state === "connected";

  return (
    <div className="flex items-center gap-3">
      <div className="h-10 w-10 overflow-hidden rounded-full border-[1.5px] border-crimson bg-ink-800">
        {icon && (
          <img
            src={icon}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
          />
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate text-[15px] font-medium">
          {summoner ? summoner.gameName : "Not signed in"}
          {summoner && <span className="text-muted"> #{summoner.tagLine}</span>}
        </div>
        <div className="flex items-center gap-1.5 text-muted">
          <span
            className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-win" : "bg-faint"}`}
          />
          {status?.state === "connected"
            ? `Client connected · ${phaseLabel(status.phase).toLowerCase()}`
            : "League client not running · showing saved data"}
        </div>
      </div>
      <div className="flex-1" />
      {sessionNet !== null && (
        <span className="tabular rounded-md border border-line-strong px-2.5 py-1">
          Session{" "}
          <span
            className={sessionNet >= 0 ? "text-win" : "text-crimson-bright"}
          >
            {formatDelta(sessionNet)}
          </span>
        </span>
      )}
    </div>
  );
}
