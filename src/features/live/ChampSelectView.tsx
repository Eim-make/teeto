import { useEffect, useMemo, useRef, useState } from "react";
import type { ChampSelect } from "../../lib/bindings/ChampSelect";
import type { SelectSlot } from "../../lib/bindings/SelectSlot";
import { PlayerBadges } from "../../components/Badges";
import { RoleSplit, Today, TopChampions } from "../../components/PlayerPool";
import { ChampionIcon } from "../../components/ChampionIcon";
import {
  AugmentIcon,
  RankCrest,
  useAugmentName,
} from "../../components/GameBits";
import { Items } from "../../components/GameIcons";
import { Empty, Panel, PanelTitle } from "../../components/ui";
import {
  dataFile,
  pct,
  positionLabel,
  type ChampionBuilds,
  type DataIndex,
  type RoleBuild,
} from "../../lib/data";
import {
  championName,
  runeIcon,
  spellIcon,
  useCatalog,
  type Catalog,
} from "../../lib/ddragon";
import { queueLabel } from "../../lib/format";
import { useMayhemGlobal } from "../../lib/mayhemData";
import { useResource } from "../../lib/hooks";
import { api } from "../../lib/ipc";
import { rankLabel } from "../../lib/rank";

const PHASES: Record<string, string> = {
  PLANNING: "Declare your pick",
  BAN_PICK: "Bans and picks",
  FINALIZATION: "Finalizing",
  GAME_STARTING: "Game starting",
};
const ARAM_QUEUES = [450, 2400];
const FLASH = 4;

function readPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }
}

export function ChampSelectView() {
  const [cs, setCs] = useState<ChampSelect | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const fetchedAt = useRef(Date.now());

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const next = await api.champSelect();
        if (!alive) return;
        fetchedAt.current = Date.now();
        setCs(next);
        setError(null);
      } catch (e: unknown) {
        if (alive) setError(String(e));
      }
      if (alive) timer = setTimeout(load, 1500);
    };
    load();
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, []);

  if (!cs)
    return error ? (
      <Panel>
        <Empty title="Couldn't read champion select" body={error} />
      </Panel>
    ) : (
      <Panel className="h-48 animate-pulse" />
    );

  const me = cs.myTeam.find((s) => s.isMe);
  const left = Math.max(
    0,
    Math.ceil((cs.timeLeftMs - (now - fetchedAt.current)) / 1000),
  );
  const aram = ARAM_QUEUES.includes(cs.queueId);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-3">
        <h1 className="text-[15px] font-medium">Champion select</h1>
        <span className="text-muted">
          {queueLabel(cs.queueId)} · {PHASES[cs.phase] ?? cs.phase}
        </span>
        <div className="flex-1" />
        <span
          className={`tabular text-xl font-medium ${left <= 10 ? "text-crimson-bright" : "text-fg"}`}
        >
          {left}s
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel className="pb-1">
          <PanelTitle aside={<TeamDamage slots={cs.myTeam} />}>
            Your team
          </PanelTitle>
          {cs.myTeam.map((s, i) => (
            <AllySlot key={s.cellId} slot={s} index={i} />
          ))}
        </Panel>
        <div className="flex flex-col gap-3">
          <Panel className="pb-1">
            <PanelTitle aside={<TeamDamage slots={cs.theirTeam} />}>
              Enemy team
            </PanelTitle>
            {cs.theirTeam.length === 0 ? (
              <div className="pb-3 text-muted">
                Enemy picks show up here once they lock in.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 pb-3">
                {cs.theirTeam.map((s) => (
                  <ChampSlotIcon
                    key={s.cellId}
                    id={s.championId}
                    locked={s.locked}
                  />
                ))}
              </div>
            )}
          </Panel>
          {(cs.myBans.length > 0 || cs.theirBans.length > 0) && (
            <Panel>
              <PanelTitle>Bans</PanelTitle>
              <BanRow label="Yours" ids={cs.myBans} />
              <BanRow label="Theirs" ids={cs.theirBans} />
            </Panel>
          )}
          {aram && cs.bench.length > 0 && (
            <Panel>
              <PanelTitle>Bench</PanelTitle>
              <div className="flex flex-wrap gap-2">
                {cs.bench.map((id) => (
                  <BenchChampion key={id} id={id} />
                ))}
              </div>
            </Panel>
          )}
        </div>
      </div>

      {!aram && cs.theirTeam.some((t) => t.championId > 0) && (
        <CountersPanel enemies={cs.theirTeam.map((t) => t.championId).filter((id) => id > 0)} position={me?.position ?? ""} />
      )}
      {me && me.championId > 0 ? (
        aram ? (
          <MayhemPanel
            championId={me.championId}
            mayhem={cs.queueId === 2400}
          />
        ) : (
          <BuildPanel
            me={me}
            enemies={cs.theirTeam
              .map((s) => s.championId)
              .filter((id) => id > 0)}
          />
        )
      ) : (
        <Panel>
          <Empty
            title="Pick or hover a champion"
            body="Its build, runes and matchups show up here."
          />
        </Panel>
      )}
    </div>
  );
}

function ChampSlotIcon({ id, locked }: { id: number; locked: boolean }) {
  if (id <= 0)
    return (
      <div className="h-11 w-11 rounded-lg border border-dashed border-line-strong" />
    );
  return (
    <div className={locked ? "" : "opacity-45"}>
      <ChampionIcon id={id} size={44} />
    </div>
  );
}

function BanRow({ label, ids }: { label: string; ids: number[] }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="w-12 text-faint">{label}</span>
      {ids.map((id, i) => (
        <div key={i} className="opacity-70 grayscale">
          <ChampionIcon id={id} size={28} />
        </div>
      ))}
    </div>
  );
}

function damageSplit(
  catalog: Catalog | null,
  ids: number[],
): { ad: number; ap: number } | null {
  if (!catalog) return null;
  let ad = 0;
  let ap = 0;
  for (const id of ids) {
    const c = catalog.champions[String(id)];
    if (!c) continue;
    ad += c.attack;
    ap += c.magic;
  }
  return ad + ap > 0 ? { ad: ad / (ad + ap), ap: ap / (ad + ap) } : null;
}

function TeamDamage({ slots }: { slots: SelectSlot[] }) {
  const catalog = useCatalog();
  const split = damageSplit(
    catalog,
    slots.map((s) => s.championId).filter((id) => id > 0),
  );
  if (!split) return null;
  return (
    <div
      className="flex items-center gap-2 text-[11px] text-muted"
      title="Rough physical vs magic damage split"
    >
      <span>AD {Math.round(split.ad * 100)}%</span>
      <div className="flex h-1.5 w-28 overflow-hidden rounded-full">
        <div className="bg-soft" style={{ width: `${split.ad * 100}%` }} />
        <div className="bg-crimson" style={{ width: `${split.ap * 100}%` }} />
      </div>
      <span>AP {Math.round(split.ap * 100)}%</span>
    </div>
  );
}

function AllySlot({ slot: s, index }: { slot: SelectSlot; index: number }) {
  const catalog = useCatalog();
  const p = s.scout;
  const champWr =
    p && p.championGames
      ? Math.round((p.championWins / p.championGames) * 100)
      : null;
  return (
    <div
      className={`flex items-center gap-3 border-t border-line py-2 first:border-t-0 ${s.isMe ? "bg-ink-800/60" : ""}`}
    >
      <ChampSlotIcon id={s.championId} locked={s.locked} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span
            className={`truncate font-medium ${s.isMe ? "text-fg" : "text-soft"}`}
          >
            {s.isMe ? "You" : s.hidden ? `Ally ${index + 1}` : s.gameName}
          </span>
          {!s.hidden && !s.isMe && (
            <span className="text-faint">#{s.tagLine}</span>
          )}
          <span className="ml-auto shrink-0 text-[11px] text-muted">
            {s.championId > 0 ? championName(catalog, s.championId) : "Picking"}
            {s.position && ` · ${positionLabel(s.position)}`}
          </span>
        </div>
        {p ? (
          <>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
            <span className="flex items-center gap-1">
              <RankCrest standing={p.rank} size={16} />
              {p.rank ? `${rankLabel(p.rank)} ${p.rank.lp} LP` : "Unranked"}
            </span>
            {p.masteryPoints > 0 && <span>Mastery {p.masteryLevel}</span>}
            {champWr !== null && (
              <span>
                <span
                  className={champWr >= 50 ? "text-win" : "text-crimson-bright"}
                >
                  {champWr}%
                </span>{" "}
                in {p.championGames} recent
              </span>
            )}
            <PlayerBadges badges={p.badges} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <TopChampions p={p} size={18} />
            <RoleSplit p={p} />
            <Today p={p} />
          </div>
          </>
        ) : (
          s.hidden &&
          !s.isMe && (
            <div className="text-[11px] text-faint">
              Names are hidden in ranked champion select
            </div>
          )
        )}
      </div>
    </div>
  );
}

function BuildPanel({ me, enemies }: { me: SelectSlot; enemies: number[] }) {
  const catalog = useCatalog();
  const index = useResource(() => dataFile<DataIndex>("index.json"), []);
  const patch = index.state === "ready" ? index.data.patch : null;
  const builds = useResource(
    () =>
      patch
        ? dataFile<ChampionBuilds>(`${patch}/champions/${me.championId}.json`)
        : Promise.resolve(null),
    [patch, me.championId],
  );
  const [flashOn, setFlashOn] = useState(() => readPref("teeto.flash", "D"));
  const [auto, setAuto] = useState(
    () => readPref("teeto.autoImport", "on") === "on",
  );
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const imported = useRef<string | null>(null);

  const roles =
    builds.state === "ready" && builds.data ? builds.data.roles : [];
  const role: RoleBuild | undefined =
    roles.find((r) => r.position === me.position) ?? roles[0];
  const name = championName(catalog, me.championId);

  const orderedSpells = (spells: number[]) => {
    const flashFirst = flashOn === "D";
    if (!spells.includes(FLASH)) return spells;
    const other = spells.find((s) => s !== FLASH) ?? 0;
    return flashFirst ? [FLASH, other] : [other, FLASH];
  };

  const apply = async (what: "runes" | "spells" | "both") => {
    if (!role) return;
    setNote(null);
    try {
      const page = role.runes[0]?.value;
      if ((what === "runes" || what === "both") && page)
        await api.importRunes({
          name,
          primaryStyle: page.primaryStyle,
          subStyle: page.subStyle,
          perks: page.perks,
          shards: page.shards,
        });
      const spells = role.spells[0]?.value;
      if ((what === "spells" || what === "both") && spells?.length === 2) {
        const [a = 0, b = 0] = orderedSpells(spells);
        await api.setSpells(a, b);
      }
      setNote({
        ok: true,
        text:
          what === "both"
            ? "Runes and spells set"
            : what === "runes"
              ? "Runes set"
              : "Spells set",
      });
    } catch (e: unknown) {
      setNote({ ok: false, text: String(e) });
    }
  };

  useEffect(() => {
    const key = `${me.championId}:${role?.position}`;
    if (!auto || !me.locked || !role || imported.current === key) return;
    imported.current = key;
    void apply("both");
  }, [auto, me.locked, me.championId, role]);

  const vs = useMemo(
    () =>
      enemies
        .map((id) => ({
          id,
          m: role?.matchups?.find((m) => m.championId === id),
        }))
        .filter((x) => x.m !== undefined),
    [enemies, role],
  );

  if (builds.state === "error" || index.state === "error")
    return (
      <Panel>
        <Empty
          title="No build data"
          body="Couldn't load champion builds right now. Check your internet connection."
        />
      </Panel>
    );
  if (!role)
    return (
      <Panel>
        <Empty
          title={`No data for ${name} yet`}
          body="The sample for this champion is still too small."
        />
      </Panel>
    );

  const page = role.runes[0]?.value;
  return (
    <Panel>
      <PanelTitle
        aside={
          <div className="flex items-center gap-3">
            <label className="flex cursor-pointer items-center gap-1.5 text-muted">
              <input
                type="checkbox"
                checked={auto}
                onChange={(e) => {
                  setAuto(e.target.checked);
                  writePref(
                    "teeto.autoImport",
                    e.target.checked ? "on" : "off",
                  );
                }}
                className="accent-[#b3202a]"
              />
              Auto-import on lock-in
            </label>
            <span className="text-faint">Flash on</span>
            {["D", "F"].map((k) => (
              <button
                key={k}
                onClick={() => {
                  setFlashOn(k);
                  writePref("teeto.flash", k);
                }}
                className={`h-6 w-6 cursor-pointer rounded border text-xs ${flashOn === k ? "border-crimson text-fg" : "border-line-strong text-muted"}`}
              >
                {k}
              </button>
            ))}
            <button
              onClick={() => apply("both")}
              className="cursor-pointer rounded-md bg-crimson px-3 py-1 text-[12px] font-medium text-white hover:bg-crimson-bright"
            >
              Import runes and spells
            </button>
          </div>
        }
      >
        {name} · {positionLabel(role.position)}
        <span className="ml-2 font-normal text-muted">
          <span
            className={role.winRate >= 0.5 ? "text-win" : "text-crimson-bright"}
          >
            {pct(role.winRate)}
          </span>{" "}
          win rate
        </span>
      </PanelTitle>
      {note && (
        <div className={`mb-3 ${note.ok ? "text-win" : "text-crimson-bright"}`}>
          {note.text}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <div>
          <div className="mb-1.5 text-[11px] text-faint">Runes</div>
          {page && (
            <div className="flex flex-wrap items-center gap-1">
              {page.perks.map((id, i) => {
                const src = runeIcon(catalog, id);
                return src ? (
                  <img
                    key={i}
                    src={src}
                    title={catalog?.runes[String(id)]?.name}
                    alt=""
                    className={`rounded-full bg-ink-900 ${i === 0 ? "h-9 w-9" : "h-6 w-6"} ${i === 4 ? "ml-1.5" : ""}`}
                  />
                ) : null;
              })}
            </div>
          )}
          {page && (
            <div className="mt-1 text-muted">
              {catalog?.runes[String(page.perks[0] ?? 0)]?.name}
            </div>
          )}
        </div>
        <div>
          <div className="mb-1.5 text-[11px] text-faint">Spells</div>
          <div className="flex gap-1.5">
            {orderedSpells(role.spells[0]?.value ?? []).map((id) => {
              const src = spellIcon(catalog, id);
              return src ? (
                <img
                  key={id}
                  src={src}
                  alt=""
                  title={catalog?.spells[String(id)]?.name}
                  className="h-8 w-8 rounded"
                />
              ) : null;
            })}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-[11px] text-faint">Start and build</div>
          {role.start?.[0] && <Items items={role.start[0].value} size={26} />}
          <div className="mt-1">
            <Items
              items={(role.buildOrder?.[0] ?? role.core[0])?.value ?? []}
              size={26}
            />
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-[11px] text-faint">
            Against their picks
          </div>
          {vs.length === 0 ? (
            <div className="text-muted">No matchup data yet</div>
          ) : (
            vs.map(({ id, m }) => (
              <div key={id} className="flex items-center gap-2 py-0.5">
                <ChampionIcon id={id} size={22} />
                <span className="flex-1 truncate text-soft">
                  {championName(catalog, id)}
                </span>
                <span
                  className={`tabular ${(m?.winRate ?? 0) >= 0.5 ? "text-win" : "text-crimson-bright"}`}
                >
                  {pct(m?.winRate ?? 0)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </Panel>
  );
}

function MayhemPanel({
  championId,
  mayhem,
}: {
  championId: number;
  mayhem: boolean;
}) {
  const catalog = useCatalog();
  const name = useAugmentName();
  const stats = useResource(() => api.mayhemAugments(), []);
  const mine =
    stats.state === "ready"
      ? stats.data.find((c) => c.championId === championId)
      : undefined;

  return (
    <Panel>
      <PanelTitle
        aside={
          <span className="text-muted">From your own ARAM Mayhem games</span>
        }
      >
        {championName(catalog, championId)}
        {mayhem ? " augments" : ""}
      </PanelTitle>
      {!mayhem ? (
        <div className="text-muted">
          Global ARAM data isn't available through Riot's API, so builds here
          are based on ranked games only.
        </div>
      ) : !mine ? (
        <div className="text-muted">
          No saved Mayhem games with {championName(catalog, championId)} yet.
          Every Mayhem game you play adds all 10 players' augments to this view.
        </div>
      ) : (
        <>
          <div className="mb-2 text-muted">
            Seen in {mine.games} games ·{" "}
            <span
              className={
                mine.wins * 2 >= mine.games ? "text-win" : "text-crimson-bright"
              }
            >
              {Math.round((mine.wins / mine.games) * 100)}% wins
            </span>
          </div>
          <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
            {mine.augments.slice(0, 12).map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-2 border-t border-line py-1.5"
              >
                <AugmentIcon id={a.id} />
                <span className="flex-1 truncate text-soft">{name(a.id)}</span>
                <span className="tabular text-muted">
                  {a.games}× · {Math.round((a.wins / a.games) * 100)}%
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}

function CountersPanel({ enemies, position }: { enemies: number[]; position: string }) {
  const catalog = useCatalog();
  const index = useResource(() => dataFile<DataIndex>("index.json"), []);
  const patch = index.state === "ready" ? index.data.patch : null;
  const builds = useResource(
    () =>
      patch
        ? Promise.all(enemies.map((id) => dataFile<ChampionBuilds>(`${patch}/champions/${id}.json`).catch(() => null)))
        : Promise.resolve([]),
    [patch, enemies.join()],
  );
  if (builds.state !== "ready") return null;

  const rows = enemies
    .map((id, i) => {
      const data = builds.data[i];
      const role = data?.roles.find((r) => r.position === position) ?? data?.roles[0];
      return { id, role, counters: (role?.worst ?? []).slice(0, 4) };
    })
    .filter((r) => r.counters.length > 0);
  if (rows.length === 0) return null;

  return (
    <Panel>
      <PanelTitle aside={<span className="text-muted">Champions their picks lose to most</span>}>Counter picks</PanelTitle>
      <div className="grid grid-cols-1 gap-x-6 gap-y-2 lg:grid-cols-2">
        {rows.map(({ id, role, counters }) => (
          <div key={id} className="flex items-center gap-3 border-t border-line py-2 first:border-t-0">
            <div className="flex w-36 shrink-0 items-center gap-2">
              <ChampionIcon id={id} size={28} />
              <div className="min-w-0">
                <div className="truncate text-soft">{championName(catalog, id)}</div>
                {role && <div className="text-[11px] text-faint">{positionLabel(role.position)}</div>}
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              {counters.map((c) => (
                <div key={c.championId} className="flex items-center gap-1.5" title={`${championName(catalog, c.championId)} · ${c.games} games`}>
                  <ChampionIcon id={c.championId} size={24} />
                  <span className="tabular text-[11px] text-win">{pct(1 - c.winRate)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function BenchChampion({ id }: { id: number }) {
  const catalog = useCatalog();
  const global = useMayhemGlobal();
  const champ = catalog?.champions[String(id)];
  const g = champ ? global?.champions[champ.id.toLowerCase()] : undefined;
  return (
    <div className="flex flex-col items-center gap-0.5" title={g ? `${g.pickRate.toFixed(1)}% Mayhem pick rate` : undefined}>
      <ChampionIcon id={id} size={36} />
      {g && <span className="tabular text-[10px] text-muted">#{g.rank}</span>}
    </div>
  );
}
