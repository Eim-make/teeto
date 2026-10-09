import { useMemo, useState } from "react";
import { Empty, Panel, Segmented } from "../../components/ui";
import {
  dataFile,
  type Change,
  type ChangeEntry,
  type PatchNotes,
  type PatchSummary,
  type Verdict,
} from "../../lib/data";
import { championIcon, championName, useCatalog } from "../../lib/ddragon";
import { useAugments } from "../../lib/cdragon";
import { useRemembered, useResource } from "../../lib/hooks";
import { api } from "../../lib/ipc";

type Filter = "all" | "yours" | "buff" | "nerf" | "items" | "other";

const VERDICT: Record<
  Verdict,
  { label: string; className: string; ring: string }
> = {
  buff: {
    label: "Buffed",
    className: "border-win/50 text-win",
    ring: "ring-win",
  },
  nerf: {
    label: "Nerfed",
    className: "border-crimson/60 text-crimson-bright",
    ring: "ring-crimson",
  },
  adjusted: {
    label: "Adjusted",
    className: "border-line-strong text-soft",
    ring: "ring-ink-700",
  },
};

export function VerdictTag({ verdict }: { verdict: Verdict }) {
  const v = VERDICT[verdict];
  return (
    <span className={`rounded border px-1.5 py-px text-[11px] ${v.className}`}>
      {v.label}
    </span>
  );
}

export function PatchNotesPage() {
  const index = useResource(
    () => dataFile<PatchSummary[]>("patches/index.json"),
    [],
  );
  const [selected, setSelected] = useRemembered<string | null>(
    "patches.selected",
    null,
  );

  if (index.state === "loading")
    return <Panel className="h-40 animate-pulse" />;
  if (index.state === "error" || index.data.length === 0)
    return (
      <Panel>
        <Empty
          title="Patch notes aren't available"
          body="Couldn't load patch notes right now. Check your internet connection and try again in a bit."
        />
      </Panel>
    );

  const patch = selected ?? index.data[0]?.patch ?? "";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center">
        <h1 className="text-[15px] font-medium">Patch notes</h1>
        <div className="flex-1" />
        <Segmented
          options={index.data.map((p) => ({ value: p.patch, label: p.patch }))}
          value={patch}
          onChange={setSelected}
        />
      </div>
      <Notes key={patch} patch={patch} />
    </div>
  );
}

function usePlayedChampions(): Set<string> {
  const catalog = useCatalog();
  const matches = useResource(() => api.matches("all", 100), []);
  return useMemo(() => {
    if (matches.state !== "ready") return new Set();
    return new Set(
      matches.data.map((m) => championName(catalog, m.championId)),
    );
  }, [matches, catalog]);
}

const anchor = (name: string) =>
  `change-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

function Notes({ patch }: { patch: string }) {
  const notes = useResource(
    () => dataFile<PatchNotes>(`patches/${patch}.json`),
    [patch],
  );
  const played = usePlayedChampions();
  const [filter, setFilter] = useRemembered<Filter>("patches.filter", "all");

  if (notes.state === "loading")
    return <Panel className="h-40 animate-pulse" />;
  if (notes.state === "error")
    return (
      <Panel>
        <Empty title="Couldn't load this patch" body={notes.message} />
      </Panel>
    );

  const n = notes.data;
  const champions =
    n.sections.find((s) => s.title === "Champions")?.entries ?? [];
  const counts = {
    buff: champions.filter((e) => e.verdict === "buff").length,
    nerf: champions.filter((e) => e.verdict === "nerf").length,
    adjusted: champions.filter((e) => e.verdict === "adjusted").length,
  };
  const yours = champions.filter((e) => played.has(e.name));

  const sections = n.sections
    .map((s) => {
      const isChampions = s.title === "Champions";
      const isItems = s.title === "Items";
      const entries = s.entries.filter((e) => {
        switch (filter) {
          case "all":
            return true;
          case "yours":
            return isChampions && played.has(e.name);
          case "buff":
          case "nerf":
            return (isChampions || isItems) && e.verdict === filter;
          case "items":
            return isItems;
          case "other":
            return !isChampions && !isItems;
        }
      });
      return { title: s.title, entries };
    })
    .filter((s) => s.entries.length > 0);

  return (
    <>
      <Panel>
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-medium">{n.title}</div>
            <div className="mt-0.5 text-muted">
              {n.publishedAt &&
                new Date(n.publishedAt).toLocaleDateString(undefined, {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              {" · "}game version {n.gameVersion}
            </div>
            {n.description && (
              <p className="mt-2 max-w-3xl leading-relaxed text-soft">
                {n.description}
              </p>
            )}
          </div>
          <div className="tabular flex gap-4 text-muted">
            <span>
              <span className="text-win">{counts.buff}</span> buffed
            </span>
            <span>
              <span className="text-crimson-bright">{counts.nerf}</span> nerfed
            </span>
            <span>
              <span className="text-soft">{counts.adjusted}</span> adjusted
            </span>
          </div>
        </div>
        {champions.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {champions.map((e) => (
              <button
                key={e.name}
                title={`${e.name} · ${VERDICT[e.verdict].label}`}
                onClick={() => {
                  setFilter("all");
                  requestAnimationFrame(() =>
                    document
                      .getElementById(anchor(e.name))
                      ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                  );
                }}
                className={`relative h-10 w-10 cursor-pointer overflow-hidden rounded-lg ring-2 ring-offset-2 ring-offset-ink-850 transition-transform hover:scale-105 ${VERDICT[e.verdict].ring}`}
              >
                {e.image && (
                  <img
                    src={e.image}
                    alt={e.name}
                    className="h-full w-full"
                    draggable={false}
                  />
                )}
                {played.has(e.name) && (
                  <span
                    className="absolute right-0 bottom-0 h-2.5 w-2.5 rounded-tl bg-fg"
                    title="You play this"
                  />
                )}
              </button>
            ))}
          </div>
        )}
      </Panel>

      <Segmented
        options={[
          { value: "all", label: "All" },
          {
            value: "yours",
            label: `Your champions${yours.length ? ` (${yours.length})` : ""}`,
          },
          { value: "buff", label: "Buffs" },
          { value: "nerf", label: "Nerfs" },
          { value: "items", label: "Items" },
          { value: "other", label: "Modes and fixes" },
        ]}
        value={filter}
        onChange={setFilter}
      />

      {sections.length === 0 && (
        <Panel>
          <Empty
            title="Nothing here"
            body={
              filter === "yours"
                ? "None of the champions you've played recently were changed this patch."
                : "No changes match this filter."
            }
          />
        </Panel>
      )}

      {sections.map((s) => (
        <section key={s.title} className="flex flex-col gap-2">
          <h2 className="mt-2 text-[13px] font-medium text-soft">{s.title}</h2>
          {s.entries
            .filter((e) => !e.name && e.groups.length === 0 && e.context)
            .map((e, i) => (
              <p key={`intro-${i}`} className="max-w-4xl leading-relaxed text-muted">
                {e.context}
              </p>
            ))}
          <div
            className={`grid grid-cols-1 items-start gap-3 ${
              s.entries.filter((e) => e.name || e.groups.length).length > 1 ? "xl:grid-cols-2" : ""
            }`}
          >
            {s.entries
              .filter((e) => e.name || e.groups.length)
              .map((e, i) => (
                <Entry
                  key={`${e.name}-${i}`}
                  entry={e}
                  yours={played.has(e.name)}
                  rated={s.title === "Champions" || s.title === "Items"}
                />
              ))}
          </div>
        </section>
      ))}
    </>
  );
}

function isNameList(changes: Change[]): boolean {
  return changes.length >= 6 && changes.every((c) => !c.after && !c.label && c.text.length <= 32);
}

function ChangeRow({ change }: { change: Change }) {
  if (!change.after)
    return (
      <div className="flex gap-2.5 py-1 leading-relaxed text-soft">
        <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-faint" />
        <span>
          {change.label ? (
            <>
              <span className="font-medium text-fg">{change.label}</span>
              <span className="text-faint"> · </span>
              {change.before}
            </>
          ) : (
            change.text
          )}
        </span>
      </div>
    );
  const tone =
    change.better === null
      ? "text-fg"
      : change.better
        ? "text-win"
        : "text-crimson-bright";
  return (
    <div className="grid grid-cols-[minmax(120px,190px)_minmax(0,1fr)] gap-3 border-t border-line/60 py-1.5 leading-relaxed first:border-t-0">
      <span className="text-muted">{change.label || "Change"}</span>
      <span>
        <span className="text-faint">{change.before}</span>
        <span className="mx-1.5 text-muted">→</span>
        <span className={tone}>{change.after}</span>
      </span>
    </div>
  );
}

function fallbackImage(
  e: ChangeEntry,
  catalog: ReturnType<typeof useCatalog>,
  augments: ReturnType<typeof useAugments>,
): string | null {
  if (!e.name) return null;
  const name = e.name.toLowerCase();
  if (e.kind?.toLowerCase().startsWith("augment") && augments) {
    const found = Object.values(augments).find((a) => a.name.toLowerCase() === name);
    if (found) return found.icon;
  }
  const key = catalog && Object.entries(catalog.champions).find(([, c]) => name.startsWith(c.name.toLowerCase()))?.[0];
  return key ? championIcon(catalog, Number(key)) : null;
}

function Entry({
  entry: e,
  yours,
  rated,
}: {
  entry: ChangeEntry;
  yours: boolean;
  rated: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const catalog = useCatalog();
  const augments = useAugments();
  const longContext = e.context.length > 220;
  const image = e.image ?? fallbackImage(e, catalog, augments);
  return (
    <div id={e.name ? anchor(e.name) : undefined} className="scroll-mt-4">
      <Panel className="min-w-0">
        {(e.name || image) && (
          <div className="mb-3 flex items-center gap-3">
            {image && (
              <img
                src={image}
                alt=""
                className="h-11 w-11 rounded-lg"
                draggable={false}
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium">{e.name}</div>
              {e.kind && !yours && <div className="text-[11px] text-faint">{e.kind}</div>}
              {yours && (
                <div className="text-[11px] text-muted">
                  You've played this recently
                </div>
              )}
            </div>
            {e.tag && (
              <span className="rounded border border-win/50 px-1.5 py-px text-[11px] text-win">{e.tag}</span>
            )}
            {rated && <VerdictTag verdict={e.verdict} />}
          </div>
        )}
        {e.context && (
          <div className="mb-3 rounded-lg bg-ink-900 px-3 py-2 leading-relaxed text-muted">
            <p className={expanded || !longContext ? "" : "line-clamp-3"}>
              {e.context}
            </p>
            {longContext && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="mt-1 cursor-pointer text-soft hover:text-fg"
              >
                {expanded ? "Show less" : "Read more"}
              </button>
            )}
          </div>
        )}
        <div className="flex flex-col gap-3">
          {e.groups.map((g, i) => (
            <div key={i}>
              {g.title && (
                <div className="mb-1 flex items-center gap-2">
                  {g.icon && (
                    <img
                      src={g.icon}
                      alt=""
                      className="h-7 w-7 rounded"
                      draggable={false}
                    />
                  )}
                  <span className="font-medium text-fg">{g.title}</span>
                </div>
              )}
              {isNameList(g.changes) ? (
                <div className={`flex flex-wrap gap-1.5 ${g.icon ? "pl-9" : ""}`}>
                  {g.changes.map((c, j) => (
                    <span key={j} className="rounded-md border border-line-strong px-2 py-0.5 text-soft">
                      {c.text}
                    </span>
                  ))}
                </div>
              ) : (
                <div className={g.icon ? "pl-9" : ""}>
                  {g.changes.map((c, j) => (
                    <ChangeRow key={j} change={c} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
