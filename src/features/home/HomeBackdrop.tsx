import { useMemo, useState } from "react";
import { championSplash, useCatalog } from "../../lib/ddragon";
import { useResource } from "../../lib/hooks";
import { api } from "../../lib/ipc";

export function HomeBackdrop() {
  const catalog = useCatalog();
  const [loaded, setLoaded] = useState<string | null>(null);
  const matches = useResource(() => api.matches("all", 100), [], ["matches-changed"]);

  const favourite = useMemo(() => {
    if (matches.state !== "ready") return null;
    const games = new Map<number, number>();
    for (const m of matches.data) if (!m.remake) games.set(m.championId, (games.get(m.championId) ?? 0) + 1);
    let best: number | null = null;
    for (const [id, n] of games) if (best === null || n > (games.get(best) ?? 0)) best = id;
    return best;
  }, [matches]);

  const src = championSplash(catalog, favourite);
  if (!src) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-[560px] overflow-hidden [mask-image:linear-gradient(to_bottom,black_25%,transparent)]">
      <img
        src={src}
        alt=""
        draggable={false}
        onLoad={() => setLoaded(src)}
        className={`h-full w-full object-cover object-[center_20%] saturate-[0.7] transition-opacity duration-700 ${
          loaded === src ? "opacity-25" : "opacity-0"
        }`}
      />
      <div className="absolute inset-0 bg-gradient-to-r from-ink-950/70 via-transparent to-ink-950/40" />
    </div>
  );
}
