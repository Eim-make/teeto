import { useMemo } from "react";
import { MatchBadges } from "../../components/Badges";
import { ChampionIcon } from "../../components/ChampionIcon";
import { Empty, Panel, PanelTitle } from "../../components/ui";
import { championName, useCatalog } from "../../lib/ddragon";
import { useResource } from "../../lib/hooks";
import { api } from "../../lib/ipc";

export function ChampionPool({
  onOpenMatch,
  onSeeAll,
}: {
  onOpenMatch: (id: number) => void;
  onSeeAll: () => void;
}) {
  const catalog = useCatalog();
  const matches = useResource(
    () => api.matches("all", 100),
    [],
    ["matches-changed"],
  );
  const list =
    matches.state === "ready" ? matches.data.filter((m) => !m.remake) : [];

  const pool = useMemo(() => {
    const byChamp = new Map<
      number,
      { games: number; wins: number; k: number; d: number; a: number }
    >();
    for (const m of list) {
      const c = byChamp.get(m.championId) ?? {
        games: 0,
        wins: 0,
        k: 0,
        d: 0,
        a: 0,
      };
      c.games++;
      c.wins += m.win ? 1 : 0;
      c.k += m.kills;
      c.d += m.deaths;
      c.a += m.assists;
      byChamp.set(m.championId, c);
    }
    return [...byChamp.entries()]
      .sort((a, b) => b[1].games - a[1].games)
      .slice(0, 6);
  }, [list]);

  const last = list[0];

  return (
    <>
      {last && (
        <Panel>
          <PanelTitle
            aside={
              <button
                onClick={onSeeAll}
                className="cursor-pointer text-muted hover:text-fg"
              >
                All matches
              </button>
            }
          >
            Last game
          </PanelTitle>
          <button
            onClick={() => onOpenMatch(last.gameId)}
            className="flex w-full cursor-pointer items-center gap-3 text-left"
          >
            <ChampionIcon id={last.championId} size={44} />
            <div className="min-w-0 flex-1">
              <div>
                <span className={last.win ? "text-win" : "text-crimson-bright"}>
                  {last.win ? "Victory" : "Defeat"}
                </span>
                <span className="text-muted">
                  {" "}
                  · {championName(catalog, last.championId)}
                </span>
              </div>
              <div className="tabular text-muted">
                {last.kills} / {last.deaths} / {last.assists} ·{" "}
                {last.killParticipation}% KP
              </div>
              <div className="mt-1">
                <MatchBadges badges={last.badges} max={4} />
              </div>
            </div>
          </button>
        </Panel>
      )}
      <Panel>
        <PanelTitle
          aside={<span className="text-muted">Last {list.length} games</span>}
        >
          Your champions
        </PanelTitle>
        {pool.length === 0 ? (
          <Empty
            title="No games saved yet"
            body="Open the League client and your recent games show up here."
          />
        ) : (
          pool.map(([id, c]) => {
            const wr = Math.round((c.wins / c.games) * 100);
            const kda = c.d === 0 ? "Perfect" : ((c.k + c.a) / c.d).toFixed(2);
            return (
              <div
                key={id}
                className="flex items-center gap-3 border-t border-line py-2 first:border-t-0"
              >
                <ChampionIcon id={id} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{championName(catalog, id)}</div>
                  <div className="tabular text-muted">{kda} KDA</div>
                </div>
                <div className="tabular text-right">
                  <div
                    className={wr >= 50 ? "text-win" : "text-crimson-bright"}
                  >
                    {wr}%
                  </div>
                  <div className="text-faint">
                    {c.games} {c.games === 1 ? "game" : "games"}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </Panel>
    </>
  );
}
