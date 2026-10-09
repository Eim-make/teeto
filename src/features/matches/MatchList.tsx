import { useEffect, useState } from "react";
import type { MatchFilter } from "../../lib/bindings/MatchFilter";
import type { MatchSummary } from "../../lib/bindings/MatchSummary";
import { ChampionIcon } from "../../components/ChampionIcon";
import { MatchBadges } from "../../components/Badges";
import { Items, Runes, Spells } from "../../components/GameIcons";
import { Empty, Panel, PanelTitle, Segmented } from "../../components/ui";
import { api, on } from "../../lib/ipc";
import { useRemembered } from "../../lib/hooks";
import { ago, duration, queueLabel } from "../../lib/format";
import { formatDelta } from "../lp/LpChart";

const FILTERS: { value: MatchFilter; label: string }[] = [
  { value: "ranked", label: "Ranked" },
  { value: "all", label: "All" },
];

export function MatchList({
  title,
  pageSize,
  paged,
  onOpen,
}: {
  title: string;
  pageSize: number;
  paged?: boolean;
  onOpen: (gameId: number) => void;
}) {
  const [filter, setFilter] = useRemembered<MatchFilter>(`matches.filter.${title}`, "ranked");
  const [matches, setMatches] = useState<MatchSummary[] | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .matches(filter, pageSize)
        .then((m) => {
          if (!alive) return;
          setMatches(m);
          setExhausted(m.length < pageSize);
          setError(null);
        })
        .catch((e: unknown) => alive && setError(String(e)));
    setMatches(null);
    load();
    const offs = [on("matches-changed", load), on("ranked-changed", load)];
    return () => {
      alive = false;
      offs.forEach((off) => off());
    };
  }, [filter, pageSize]);

  const loadMore = () => {
    const last = matches?.[matches.length - 1];
    if (!last) return;
    api.matches(filter, pageSize, last.createdAt).then((m) => {
      setMatches((prev) => [...(prev ?? []), ...m]);
      setExhausted(m.length < pageSize);
    });
  };


  return (
    <Panel className="pb-1">
      <PanelTitle
        aside={
          <Segmented options={FILTERS} value={filter} onChange={setFilter} />
        }
      >
        {title}
      </PanelTitle>
      {error ? (
        <Empty title="Couldn't load matches" body={error} />
      ) : !paged && matches && matches.length === 0 ? (
        <Empty
          title={
            filter === "ranked"
              ? "No ranked games saved yet"
              : "No games saved yet"
          }
          body="Teeto saves every game the League client shows it. Open the client and your recent games appear here."
        />
      ) : (
        <>
          {(matches ?? []).map((m) => (
            <MatchRow
              key={m.gameId}
              match={m}
              onOpen={() => onOpen(m.gameId)}
            />
          ))}
          {paged && matches && !exhausted && (
            <button
              onClick={loadMore}
              className="w-full cursor-pointer border-t border-line py-2.5 text-muted transition-colors hover:text-fg"
            >
              Load more
            </button>
          )}
        </>
      )}
    </Panel>
  );
}

function MatchRow({
  match: m,
  onOpen,
}: {
  match: MatchSummary;
  onOpen: () => void;
}) {
  const tone = m.remake
    ? "text-muted"
    : m.win
      ? "text-win"
      : "text-crimson-bright";
  const kda =
    m.deaths === 0 ? "Perfect" : ((m.kills + m.assists) / m.deaths).toFixed(2);
  return (
    <button
      onClick={onOpen}
      className="grid w-full cursor-pointer grid-cols-[3px_auto_minmax(0,1fr)_auto_76px_64px] items-center gap-3 border-t border-line py-2 text-left transition-colors hover:bg-ink-800/60"
    >
      <div
        className={`h-[38px] ${m.remake ? "bg-faint" : m.win ? "bg-win" : "bg-crimson"}`}
      />
      <div className="flex items-center gap-1">
        <div className="relative">
          <ChampionIcon id={m.championId} size={38} />
          <span className="tabular absolute -right-1 -bottom-1 rounded bg-ink-950 px-1 text-[10px] text-soft">
            {m.champLevel}
          </span>
        </div>
        <Spells spells={m.spells} />
        <Runes keystone={m.keystone} sub={m.subStyle} />
      </div>
      <div className="min-w-0">
        <div className="truncate">
          <span className={tone}>
            {m.remake ? "Remake" : m.win ? "Victory" : "Defeat"}
          </span>
          <span className="text-muted"> · {queueLabel(m.queueId)}</span>
          {m.badges.length > 0 && (
            <span className="ml-2 inline-flex align-middle">
              <MatchBadges badges={m.badges} max={3} />
            </span>
          )}
        </div>
        <div className="tabular truncate text-muted">
          <span className="text-soft">
            {m.kills} / <span className="text-crimson-bright">{m.deaths}</span>{" "}
            / {m.assists}
          </span>{" "}
          · {kda} KDA · {m.killParticipation}% KP · {m.cs} CS (
          {(m.cs / Math.max(1, m.durationSec / 60)).toFixed(1)})
        </div>
      </div>
      <Items items={m.items} />
      <div className="text-right text-muted">
        <div>{ago(m.createdAt + m.durationSec * 1000)}</div>
        <div className="tabular">{duration(m.durationSec)}</div>
      </div>
      <div
        className={`tabular text-right ${
          m.lpDelta === null
            ? "text-faint"
            : m.lpDelta >= 0
              ? "text-win"
              : "text-crimson-bright"
        }`}
      >
        {m.lpDelta === null ? "" : formatDelta(m.lpDelta)}
      </div>
    </button>
  );
}
