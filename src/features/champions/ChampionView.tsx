import { useState } from "react";
import { ChampionIcon } from "../../components/ChampionIcon";
import { Items } from "../../components/GameIcons";
import { Empty, Panel, PanelTitle, Segmented } from "../../components/ui";
import {
  dataFile,
  pct,
  positionLabel,
  type BuildOption,
  type ChampionBuilds,
  type Matchup,
  type RoleBuild,
  type RunePage,
} from "../../lib/data";
import {
  championName,
  runeIcon,
  spellIcon,
  useAbilities,
  useCatalog,
  type Ability,
} from "../../lib/ddragon";
import { useRemembered, useResource } from "../../lib/hooks";
import { api } from "../../lib/ipc";
import { TierBadge } from "./ChampionsPage";

const SHARDS: Record<number, string> = {
  5001: "Health scaling",
  5005: "Attack speed",
  5007: "Ability haste",
  5008: "Adaptive force",
  5010: "Move speed",
  5011: "Health",
  5013: "Tenacity",
};

export function ChampionView({
  patch,
  championId,
  position,
  onBack,
}: {
  patch: string;
  championId: number;
  position: string;
  onBack: () => void;
}) {
  const builds = useResource(
    () => dataFile<ChampionBuilds>(`${patch}/champions/${championId}.json`),
    [patch, championId],
  );
  const [role, setRole] = useRemembered(
    `champion.${championId}.role`,
    position,
  );
  const catalog = useCatalog();
  const abilities = useAbilities(championId);
  const roles = builds.state === "ready" ? builds.data.roles : [];
  const current = roles.find((r) => r.position === role) ?? roles[0];

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={onBack}
        className="flex w-fit cursor-pointer items-center gap-1.5 text-muted hover:text-fg"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M10 3 5 8l5 5" />
        </svg>
        Champions
      </button>

      <Panel>
        <div className="flex flex-wrap items-center gap-4">
          <ChampionIcon id={championId} size={64} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xl font-medium">
              {championName(catalog, championId)}
              {current && <TierBadge tier={current.tier} />}
            </div>
            {current && (
              <div className="tabular mt-1 flex flex-wrap gap-x-4 text-muted">
                <span>
                  <span
                    className={
                      current.winRate >= 0.5
                        ? "text-win"
                        : "text-crimson-bright"
                    }
                  >
                    {pct(current.winRate)}
                  </span>{" "}
                  win rate
                </span>
                <span>
                  <span className="text-fg">{pct(current.pickRate)}</span> pick
                </span>
                <span>
                  <span className="text-fg">{pct(current.banRate)}</span> ban
                </span>
                <span>
                  {current.games.toLocaleString()} games · patch {patch}
                </span>
              </div>
            )}
            {abilities && (
              <div className="mt-2 flex gap-1.5">
                {abilities.map((a) => (
                  <AbilityIcon key={a.key} ability={a} size={30} />
                ))}
              </div>
            )}
          </div>
          <div className="flex-1" />
          {roles.length > 1 && (
            <Segmented
              options={roles.map((r) => ({
                value: r.position,
                label: positionLabel(r.position),
              }))}
              value={current?.position ?? role}
              onChange={setRole}
            />
          )}
        </div>
      </Panel>

      {builds.state === "error" && (
        <Panel>
          <Empty title="No build data" body={builds.message} />
        </Panel>
      )}
      {current && (
        <Builds
          role={current}
          abilities={abilities}
          name={championName(catalog, championId)}
        />
      )}
    </div>
  );
}

function AbilityIcon({ ability, size }: { ability: Ability; size: number }) {
  return (
    <div
      className="relative"
      title={`${ability.key === "P" ? "Passive" : ability.key} · ${ability.name}`}
    >
      <img
        src={ability.icon}
        alt=""
        className="rounded"
        style={{ width: size, height: size }}
        draggable={false}
      />
      <span className="absolute -right-1 -bottom-1 rounded bg-ink-950 px-1 text-[10px] font-medium text-soft">
        {ability.key}
      </span>
    </div>
  );
}

function Rate({
  option,
}: {
  option: { winRate: number; pickRate: number; games: number };
}) {
  return (
    <div className="tabular shrink-0 text-right text-xs">
      <div
        className={option.winRate >= 0.5 ? "text-win" : "text-crimson-bright"}
      >
        {pct(option.winRate)} win
      </div>
      <div className="text-faint">
        {pct(option.pickRate, 0)} pick · {option.games}
      </div>
    </div>
  );
}

function Builds({
  role,
  abilities,
  name,
}: {
  role: RoleBuild;
  abilities: Ability[] | null;
  name: string;
}) {
  const order = role.buildOrder?.length ? role.buildOrder : role.core;
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3">
      <RunesPanel role={role} name={name} />

      <div className="flex flex-col gap-3">
        <SpellsPanel role={role} />
        {role.skillOrder && abilities && (
          <SkillOrder
            order={role.skillOrder}
            priority={role.skillPriority?.value ?? null}
            abilities={abilities}
          />
        )}
      </div>

      <Panel>
        <PanelTitle>Items</PanelTitle>
        {role.start?.[0] && (
          <ItemRow
            label="Start"
            items={role.start[0].value}
            option={role.start[0]}
          />
        )}
        {role.boots[0] && (
          <ItemRow
            label="Boots"
            items={[role.boots[0].value]}
            option={role.boots[0]}
          />
        )}
        {order.map((c, i) => (
          <ItemRow
            key={i}
            label={i === 0 ? "Build" : ""}
            items={c.value}
            option={c}
            arrows={!!role.buildOrder?.length}
          />
        ))}
      </Panel>

      <MatchupPanel title="Best against" list={role.best} />
      <MatchupPanel title="Struggles against" list={role.worst} />
    </div>
  );
}

function RunesPanel({ role, name }: { role: RoleBuild; name: string }) {
  const catalog = useCatalog();
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const option = role.runes[selected];
  if (!option) return null;
  const page: RunePage = option.value;
  const [keystone, ...rest] = page.perks;
  const runeName = (id: number) => catalog?.runes[String(id)]?.name ?? "";

  const importPage = () => {
    setStatus(null);
    api
      .importRunes({
        name,
        primaryStyle: page.primaryStyle,
        subStyle: page.subStyle,
        perks: page.perks,
        shards: page.shards,
      })
      .then(() => setStatus({ ok: true, text: "Rune page set in your client" }))
      .catch((e: unknown) => setStatus({ ok: false, text: String(e) }));
  };

  return (
    <Panel>
      <PanelTitle
        aside={
          <button
            onClick={importPage}
            className="cursor-pointer rounded-md bg-crimson px-3 py-1 text-[12px] font-medium text-white transition-colors hover:bg-crimson-bright"
          >
            Import runes
          </button>
        }
      >
        Runes
      </PanelTitle>
      {role.runes.length > 1 && (
        <div className="mb-3 flex gap-1.5">
          {role.runes.map((r, i) => (
            <button
              key={i}
              onClick={() => setSelected(i)}
              className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                i === selected
                  ? "border-crimson text-fg"
                  : "border-line-strong text-muted hover:text-soft"
              }`}
            >
              {r.value.perks[0] && runeIcon(catalog, r.value.perks[0]) && (
                <img
                  src={runeIcon(catalog, r.value.perks[0]) ?? ""}
                  alt=""
                  className="h-4 w-4"
                />
              )}
              {pct(r.pickRate, 0)}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3">
        {keystone && runeIcon(catalog, keystone) && (
          <img
            src={runeIcon(catalog, keystone) ?? ""}
            alt=""
            className="h-12 w-12 rounded-full bg-ink-900"
            draggable={false}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="font-medium">
            {keystone ? runeName(keystone) : ""}
          </div>
          <div className="text-muted">
            {catalog?.runes[String(page.primaryStyle)]?.name} ·{" "}
            {catalog?.runes[String(page.subStyle)]?.name}
          </div>
        </div>
        <Rate option={option} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4">
        {[
          { style: page.primaryStyle, ids: rest.slice(0, 3) },
          { style: page.subStyle, ids: rest.slice(3, 5) },
        ].map((tree) => (
          <div key={tree.style} className="flex min-w-0 flex-col gap-1.5">
            <div className="text-[11px] text-faint">{catalog?.runes[String(tree.style)]?.name}</div>
            {tree.ids.map((id) => {
              const src = runeIcon(catalog, id);
              return (
                <div key={id} className="flex items-center gap-2">
                  {src && <img src={src} alt="" className="h-6 w-6 rounded-full bg-ink-900" draggable={false} />}
                  <span className="truncate text-soft">{runeName(id)}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {page.shards.length === 3 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {page.shards.map((s, i) => (
            <span
              key={i}
              className="rounded border border-line-strong px-1.5 py-px text-[11px] text-soft"
            >
              {SHARDS[s] ?? s}
            </span>
          ))}
        </div>
      )}
      {status && (
        <div
          className={`mt-3 ${status.ok ? "text-win" : "text-crimson-bright"}`}
        >
          {status.text}
        </div>
      )}
    </Panel>
  );
}

function SpellsPanel({ role }: { role: RoleBuild }) {
  const catalog = useCatalog();
  return (
    <Panel>
      <PanelTitle>Summoner spells</PanelTitle>
      {role.spells.map((s, i) => (
        <div
          key={i}
          className="flex items-center gap-2 border-t border-line py-2 first:border-t-0"
        >
          {s.value.map((id) => {
            const src = spellIcon(catalog, id);
            return (
              <div key={id} className="flex items-center gap-1.5">
                <div className="h-7 w-7 overflow-hidden rounded bg-ink-800">
                  {src && (
                    <img
                      src={src}
                      alt=""
                      className="h-full w-full"
                      draggable={false}
                    />
                  )}
                </div>
                <span className="text-soft">
                  {catalog?.spells[String(id)]?.name}
                </span>
              </div>
            );
          })}
          <div className="flex-1" />
          <Rate option={s} />
        </div>
      ))}
    </Panel>
  );
}

function SkillOrder({
  order,
  priority,
  abilities,
}: {
  order: number[];
  priority: number[] | null;
  abilities: Ability[];
}) {
  const spells = abilities.filter((a) => a.key !== "P");
  return (
    <Panel>
      <PanelTitle>Skill order</PanelTitle>
      {priority && (
        <div className="mb-3 flex items-center gap-2">
          {priority.map((slot, i) => {
            const a = spells[slot - 1];
            return (
              <div key={slot} className="flex items-center gap-2">
                {a && <AbilityIcon ability={a} size={32} />}
                {i < priority.length - 1 && (
                  <span className="text-muted">›</span>
                )}
              </div>
            );
          })}
          <span className="ml-2 text-muted">max order</span>
        </div>
      )}
      <div className="overflow-x-auto">
        <div className="grid min-w-max grid-cols-[28px_repeat(15,22px)] gap-[3px]">
          {spells.map((a, row) => (
            <div key={a.key} className="contents">
              <div className="flex h-[22px] items-center text-[11px] font-medium text-muted">
                {a.key}
              </div>
              {Array.from({ length: 15 }, (_, lvl) => {
                const on = order[lvl] === row + 1;
                return (
                  <div
                    key={lvl}
                    className={`flex h-[22px] items-center justify-center rounded text-[10px] ${
                      on
                        ? a.key === "R"
                          ? "bg-crimson text-white"
                          : "bg-soft text-ink-950"
                        : "bg-ink-800 text-transparent"
                    }`}
                  >
                    {lvl + 1}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function ItemRow({
  label,
  items,
  option,
  arrows,
}: {
  label: string;
  items: number[];
  option: BuildOption<unknown>;
  arrows?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 border-t border-line py-2 first:border-t-0">
      <span className="w-10 shrink-0 text-faint">{label}</span>
      {arrows ? (
        <div className="flex items-center gap-1">
          {items.map((id, i) => (
            <div key={i} className="flex items-center gap-1">
              <Items items={[id]} size={30} />
              {i < items.length - 1 && <span className="text-muted">›</span>}
            </div>
          ))}
        </div>
      ) : (
        <Items items={items} size={30} />
      )}
      <div className="flex-1" />
      <Rate option={option} />
    </div>
  );
}

function MatchupPanel({ title, list }: { title: string; list: Matchup[] }) {
  const catalog = useCatalog();
  return (
    <Panel>
      <PanelTitle>{title}</PanelTitle>
      {list.length === 0 ? (
        <div className="text-muted">Not enough games yet.</div>
      ) : (
        list.map((m) => (
          <div
            key={m.championId}
            className="flex items-center gap-2.5 border-t border-line py-1.5 first:border-t-0"
          >
            <ChampionIcon id={m.championId} size={26} />
            <span className="flex-1 truncate">
              {championName(catalog, m.championId)}
            </span>
            <span
              className={`tabular ${m.winRate >= 0.5 ? "text-win" : "text-crimson-bright"}`}
            >
              {pct(m.winRate)}
            </span>
            <span className="tabular w-20 shrink-0 text-right text-faint">
              {m.games} games
            </span>
          </div>
        ))
      )}
    </Panel>
  );
}
