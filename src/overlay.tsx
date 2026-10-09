import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import "@fontsource-variable/inter";
import "./styles/index.css";
import type { AugmentScan } from "./lib/bindings/AugmentScan";
import type { ChampionAugments } from "./lib/bindings/ChampionAugments";
import {
  overallAugments,
  rankAugments,
  TIER_STYLE,
  type RankedAugment,
} from "./lib/augmentRank";
import { useAugments, type Augment } from "./lib/cdragon";
import { augmentKey, MAYHEM_ATTRIBUTION, useMayhemGlobal, type GlobalAugment } from "./lib/mayhemData";
import { api } from "./lib/ipc";

const CARD_TOP = 0.17;
const GAP = 14;

type Lookup = (
  id: number,
) => { ranked: RankedAugment; scope: "champion" | "all" } | undefined;

function lookup(data: ChampionAugments[], championId: number): Lookup {
  const mine = data.find((c) => c.championId === championId);
  const champion = mine ? rankAugments(mine.augments) : [];
  const all = rankAugments(overallAugments(data));
  return (id) => {
    const own = champion.find((a) => a.id === id && a.games >= 2);
    if (own) return { ranked: own, scope: "champion" };
    const any = all.find((a) => a.id === id);
    return any ? { ranked: any, scope: "all" } : undefined;
  };
}

function Badge({
  id,
  find,
  augment,
  global,
}: {
  id: number;
  find: Lookup;
  augment?: Augment;
  global?: GlobalAugment;
}) {
  const mine = find(id);
  const personal = mine && mine.ranked.games >= 3 ? mine.ranked : null;
  const tier = global?.tier ?? personal?.tier ?? "?";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line-strong bg-ink-950/95 px-3 py-2 shadow-lg">
      <span
        className={`inline-flex h-11 w-11 items-center justify-center rounded-lg text-2xl font-bold ${TIER_STYLE[tier] ?? "bg-ink-800 text-faint"}`}
      >
        {tier}
      </span>
      <div className="leading-tight">
        {global ? (
          <div className="tabular text-lg font-semibold text-fg">
            {Math.round(global.pickRate)}%
            <span className="ml-1.5 text-[11px] font-normal text-muted">picked</span>
            {global.change !== null && Math.abs(global.change) >= 1 && (
              <span className={`ml-1.5 text-[11px] font-normal ${global.change > 0 ? "text-win" : "text-crimson-bright"}`}>
                {global.change > 0 ? "▲" : "▼"}
                {Math.abs(Math.round(global.change))}
              </span>
            )}
          </div>
        ) : (
          <div className="text-[13px] font-medium text-soft">{augment?.name ?? "Unknown augment"}</div>
        )}
        <div className="text-[11px] text-muted">
          {global ? `#${global.rarityRank} of ${global.rarityCount} ${global.rarity}` : "No global data yet"}
          {personal && (
            <span className={personal.wins * 2 >= personal.games ? "text-win" : "text-crimson-bright"}>
              {" "}
              · you {Math.round((personal.wins / personal.games) * 100)}% in {personal.games}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Overlay() {
  const [scan, setScan] = useState<AugmentScan | null>(null);
  const [stats, setStats] = useState<ChampionAugments[]>([]);
  const augments = useAugments();
  const global = useMayhemGlobal();

  useEffect(() => {
    const off = listen<AugmentScan>("augment-scan", (e) => {
      setScan(e.payload.cards.length || e.payload.message ? e.payload : null);
      if (e.payload.cards.length)
        api
          .mayhemAugments()
          .then(setStats)
          .catch(() => setStats([]));
    });
    return () => {
      void off.then((f) => f());
    };
  }, []);

  if (!scan) return null;
  const ratio = window.devicePixelRatio || 1;
  const find = lookup(stats, scan.championId);

  return (
    <div className="pointer-events-none fixed inset-0 bg-transparent">
      {scan.cards.length > 0 && global && (
        <div
          className="absolute -translate-x-1/2 rounded bg-ink-950/80 px-2 py-0.5 text-[10px] text-muted"
          style={{
            left: "50%",
            top: Math.max(4, Math.min(...scan.cards.map((c) => c.y / ratio - (c.size / ratio) * CARD_TOP)) - 110),
          }}
        >
          Pick rates: {MAYHEM_ATTRIBUTION.label.replace("Data: ", "")} (China servers, patch {global.patch})
        </div>
      )}
      {scan.message && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 rounded-lg border border-crimson/60 bg-ink-950/90 px-3 py-1.5 text-soft">
          {scan.message}
        </div>
      )}
      {scan.cards.map((card, i) => {
        const size = card.size / ratio;
        const left = card.x / ratio + size / 2;
        const top = card.y / ratio - size * CARD_TOP - GAP;
        return (
          <div
            key={i}
            className="absolute -translate-x-1/2 -translate-y-full"
            style={{ left, top }}
          >
            <Badge
              id={card.augmentId}
              find={find}
              augment={augments?.[String(card.augmentId)]}
              global={global?.augments[augmentKey(augments?.[String(card.augmentId)]?.name ?? "")]}
            />
          </div>
        );
      })}
    </div>
  );
}

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <Overlay />
    </StrictMode>,
  );
