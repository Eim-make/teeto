import type { RecentGame } from "../lib/bindings/RecentGame";
import type { Standing } from "../lib/bindings/Standing";
import { rankCrest, useAugments } from "../lib/cdragon";
import { championIcon, championName, runeIcon, spellByName, spellIcon, useCatalog } from "../lib/ddragon";
import { rankLabel } from "../lib/rank";

export function RankCrest({ standing, size = 28 }: { standing: Standing | null; size?: number }) {
  if (!standing) return <div className="shrink-0 rounded-full bg-ink-800" style={{ width: size, height: size }} />;
  return (
    <img
      src={rankCrest(standing.tier)}
      alt={rankLabel(standing)}
      title={rankLabel(standing)}
      className="shrink-0"
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}

export function SpellsByName({ spells, size = 18 }: { spells: string[]; size?: number }) {
  const catalog = useCatalog();
  return (
    <div className="flex flex-col gap-0.5">
      {[0, 1].map((i) => {
        const spell = spells[i] ? spellByName(catalog, spells[i] ?? "") : null;
        const src = spell ? spellIcon(catalog, spell.key) : null;
        return (
          <div key={i} className="overflow-hidden rounded bg-ink-800" style={{ width: size, height: size }} title={spell?.name}>
            {src && <img src={src} alt="" className="h-full w-full" draggable={false} />}
          </div>
        );
      })}
    </div>
  );
}

export function KeystonePair({ keystone, subStyle, size = 18 }: { keystone: number; subStyle: number; size?: number }) {
  const catalog = useCatalog();
  const k = keystone ? runeIcon(catalog, keystone) : null;
  const s = subStyle ? runeIcon(catalog, subStyle) : null;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="overflow-hidden rounded-full bg-ink-800" style={{ width: size, height: size }} title={catalog?.runes[String(keystone)]?.name}>
        {k && <img src={k} alt="" className="h-full w-full" draggable={false} />}
      </div>
      <div className="overflow-hidden rounded-full bg-ink-800 p-[2px]" style={{ width: size, height: size }} title={catalog?.runes[String(subStyle)]?.name}>
        {s && <img src={s} alt="" className="h-full w-full" draggable={false} />}
      </div>
    </div>
  );
}

export function RecentStrip({ games }: { games: RecentGame[] }) {
  const catalog = useCatalog();
  if (!games.length) return <span className="text-faint">No recent games</span>;
  return (
    <div className="flex gap-[3px]">
      {games.map((g, i) => {
        const src = championIcon(catalog, g.championId);
        return (
          <div
            key={i}
            title={`${g.win ? "Win" : "Loss"} · ${championName(catalog, g.championId)} · ${g.kills}/${g.deaths}/${g.assists}`}
            className={`relative h-5 w-5 overflow-hidden rounded-sm border-b-2 ${g.win ? "border-win" : "border-crimson"}`}
          >
            {src && <img src={src} alt="" className="h-full w-full opacity-80" draggable={false} />}
          </div>
        );
      })}
    </div>
  );
}

const RARITY: Record<string, string> = {
  prismatic: "ring-fuchsia-300/70",
  gold: "ring-amber-300/70",
  silver: "ring-zinc-300/60",
  other: "ring-ink-700",
};

export function AugmentIcon({ id, size = 26 }: { id: number; size?: number }) {
  const augments = useAugments();
  const a = augments?.[String(id)];
  return (
    <div
      title={a?.name ?? `Augment ${id}`}
      className={`shrink-0 overflow-hidden rounded-md bg-ink-900 ring-1 ${RARITY[a?.rarity ?? "other"]}`}
      style={{ width: size, height: size }}
    >
      {a && <img src={a.icon} alt="" className="h-full w-full" draggable={false} />}
    </div>
  );
}

export function useAugmentName(): (id: number) => string {
  const augments = useAugments();
  return (id: number) => augments?.[String(id)]?.name ?? `Augment ${id}`;
}

export const kdaText = (k: number, d: number, a: number) => (d === 0 ? (k + a > 0 ? "Perfect" : "0.00") : ((k + a) / d).toFixed(2));
