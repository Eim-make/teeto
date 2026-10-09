import { useMemo, useState } from "react";
import { overallAugments, rankAugments, TIER_STYLE } from "../lib/augmentRank";
import { useAugments } from "../lib/cdragon";
import { useResource } from "../lib/hooks";
import { api } from "../lib/ipc";
import {
  augmentKey,
  MAYHEM_ATTRIBUTION,
  useMayhemGlobal,
} from "../lib/mayhemData";
import { AugmentIcon } from "./GameBits";
import { ExternalLink } from "./ExternalLink";
import { Panel, PanelTitle, Segmented } from "./ui";

type Rarity = "all" | "silver" | "gold" | "prismatic";

export function AugmentRanking({
  championId,
  limit = 20,
}: {
  championId?: number;
  limit?: number;
}) {
  const augments = useAugments();
  const global = useMayhemGlobal();
  const stats = useResource(
    () => api.mayhemAugments(),
    [],
    ["matches-changed"],
  );
  const [rarity, setRarity] = useState<Rarity>("all");
  const [query, setQuery] = useState("");

  const idByName = useMemo(() => {
    const map = new Map<string, number>();
    for (const [id, a] of Object.entries(augments ?? {}))
      map.set(augmentKey(a.name), Number(id));
    return map;
  }, [augments]);

  const personal = useMemo(() => {
    const data = stats.state === "ready" ? stats.data : [];
    const mine = championId
      ? data.find((c) => c.championId === championId)?.augments
      : undefined;
    const ranked = rankAugments(
      mine && mine.length ? mine : overallAugments(data),
    );
    return new Map(ranked.map((r) => [r.id, r]));
  }, [stats, championId]);

  const list = useMemo(
    () =>
      Object.values(global?.augments ?? {})
        .filter((a) => rarity === "all" || a.rarity === rarity)
        .sort((a, b) => b.pickRate - a.pickRate),
    [global, rarity],
  );

  const terms = query
    .toLowerCase()
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const visible = terms.length
    ? list.filter((a) => terms.some((t) => a.name.toLowerCase().includes(t)))
    : list.slice(0, limit);

  return (
    <Panel>
      <PanelTitle
        aside={
          <Segmented
            options={[
              { value: "all", label: "All" },
              { value: "silver", label: "Silver" },
              { value: "gold", label: "Gold" },
              { value: "prismatic", label: "Prismatic" },
            ]}
            value={rarity}
            onChange={setRarity}
          />
        }
      >
        Mayhem augments
      </PanelTitle>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Compare your options, e.g. tank engine, magic missile, adapt"
        className="mb-2 w-full rounded-lg border border-line-strong bg-ink-900 px-3 py-1.5 outline-none focus:border-crimson"
      />
      {!global ? (
        <div className="text-muted">Loading global augment data…</div>
      ) : (
        <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
          {visible.map((a) => {
            const id = idByName.get(augmentKey(a.name));
            const mine = id !== undefined ? personal.get(id) : undefined;
            return (
              <div
                key={a.name}
                className="flex items-center gap-2 border-t border-line py-1.5"
              >
                <span
                  className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-semibold ${TIER_STYLE[a.tier]}`}
                >
                  {a.tier}
                </span>
                {id !== undefined && <AugmentIcon id={id} size={24} />}
                <span className="min-w-0 flex-1 truncate text-soft">
                  {a.name}
                </span>
                {mine && mine.games >= 3 && (
                  <span
                    className="tabular text-[11px] text-muted"
                    title="Your games"
                  >
                    you {Math.round((mine.wins / mine.games) * 100)}%
                  </span>
                )}
                <span className="tabular w-16 text-right text-[11px] text-muted">
                  <span className="text-fg">{a.pickRate.toFixed(1)}%</span>
                  {a.change !== null && Math.abs(a.change) >= 1 && (
                    <span
                      className={
                        a.change > 0 ? "text-win" : "text-crimson-bright"
                      }
                    >
                      {a.change > 0 ? " ▲" : " ▼"}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-2 text-[11px] text-faint">
        Tiers rank pick rate within each rarity, patch {global?.patch ?? "?"},
        China servers.{" "}
        <ExternalLink href={MAYHEM_ATTRIBUTION.url}>{MAYHEM_ATTRIBUTION.label}</ExternalLink>
        , CC BY 4.0.
      </div>
    </Panel>
  );
}
