import type { LivePlayer } from "../lib/bindings/LivePlayer";
import { positionLabel } from "../lib/data";
import { championIcon, championName, useCatalog } from "../lib/ddragon";

export function TopChampions({ p, size = 22 }: { p: LivePlayer; size?: number }) {
  const catalog = useCatalog();
  if (!p.topChampions.length) return null;
  return (
    <div className="flex items-center gap-1.5">
      {p.topChampions.map((c) => {
        const src = championIcon(catalog, c.championId);
        const wr = Math.round((c.wins / c.games) * 100);
        return (
          <div
            key={c.championId}
            title={`${championName(catalog, c.championId)} · ${c.games} games · ${wr}%`}
            className="flex items-center gap-1"
          >
            <div className="overflow-hidden rounded" style={{ width: size, height: size }}>
              {src && <img src={src} alt="" className="h-full w-full" draggable={false} />}
            </div>
            <span className="tabular text-[11px] text-muted">{c.games}</span>
          </div>
        );
      })}
    </div>
  );
}

export function RoleSplit({ p }: { p: LivePlayer }) {
  const total = p.roles.reduce((s, r) => s + r.games, 0);
  if (!total) return null;
  return (
    <span className="text-[11px] text-muted">
      {p.roles
        .slice(0, 2)
        .map((r) => `${positionLabel(r.role)} ${Math.round((r.games / total) * 100)}%`)
        .join(" · ")}
    </span>
  );
}

export function Today({ p }: { p: LivePlayer }) {
  if (!p.dayGames) return <span className="text-[11px] text-faint">No games today</span>;
  const losses = p.dayGames - p.dayWins;
  return (
    <span className="tabular text-[11px] text-muted">
      Last 24h <span className="text-win">{p.dayWins}W</span> <span className="text-crimson-bright">{losses}L</span>
    </span>
  );
}
