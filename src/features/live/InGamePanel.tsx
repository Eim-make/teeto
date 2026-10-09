import type { InGame } from "../../lib/bindings/InGame";
import type { InGamePlayer } from "../../lib/bindings/InGamePlayer";
import { Panel } from "../../components/ui";
import { spellIcon, useCatalog } from "../../lib/ddragon";

export const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const OBJECTIVE_LABEL: Record<string, string> = {
  dragon: "Dragon",
  baron: "Baron",
  inhibitor: "Inhibitor",
};

export function InGamePanel({
  game,
  myTeam,
}: {
  game: InGame;
  myTeam: number;
}) {
  const team = (id: number) => game.players.filter((p) => p.teamId === id);
  const ours = team(myTeam);
  const theirs = team(myTeam === 100 ? 200 : 100);
  const sum = (ps: InGamePlayer[], f: (p: InGamePlayer) => number) =>
    ps.reduce((s, p) => s + f(p), 0);
  const ourGold = sum(ours, (p) => p.gold);
  const theirGold = sum(theirs, (p) => p.gold);
  const diff = ourGold - theirGold;
  const share = ourGold + theirGold > 0 ? ourGold / (ourGold + theirGold) : 0.5;

  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <div className="tabular text-2xl font-medium">
          {clock(game.gameTime)}
        </div>
        <div className="tabular flex items-baseline gap-2 text-lg">
          <span className="text-win">{sum(ours, (p) => p.kills)}</span>
          <span className="text-faint">kills</span>
          <span className="text-crimson-bright">
            {sum(theirs, (p) => p.kills)}
          </span>
        </div>
        <div className="min-w-[220px] flex-1">
          <div className="tabular mb-1 flex justify-between text-[11px] text-muted">
            <span>{(ourGold / 1000).toFixed(1)}k item gold</span>
            <span className={diff >= 0 ? "text-win" : "text-crimson-bright"}>
              {diff >= 0 ? "+" : "−"}
              {(Math.abs(diff) / 1000).toFixed(1)}k
            </span>
            <span>{(theirGold / 1000).toFixed(1)}k</span>
          </div>
          <div className="flex h-1.5 overflow-hidden rounded-full">
            <div className="bg-win" style={{ width: `${share * 100}%` }} />
            <div
              className="bg-crimson"
              style={{ width: `${(1 - share) * 100}%` }}
            />
          </div>
        </div>
        {game.timers.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {game.timers.map((t, i) => {
              const left = t.respawnAt - game.gameTime;
              const tone =
                t.teamId === 0
                  ? "border-line-strong"
                  : t.teamId === myTeam
                    ? "border-win/50"
                    : "border-crimson/60";
              return (
                <div
                  key={i}
                  className={`tabular rounded-md border px-2.5 py-1 ${tone}`}
                  title={t.label}
                >
                  <span className="text-muted">
                    {t.kind === "inhibitor"
                      ? t.label
                      : OBJECTIVE_LABEL[t.kind]}{" "}
                  </span>
                  <span className={left <= 0 ? "text-win" : "text-fg"}>
                    {left <= 0 ? "up" : clock(left)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </Panel>
  );
}

const COOLDOWNS: Record<number, number> = {
  1: 240,
  3: 240,
  4: 300,
  6: 240,
  7: 240,
  11: 90,
  12: 360,
  13: 240,
  14: 180,
  21: 180,
  32: 80,
};

export type SpellTimers = Record<string, number>;

export function TimedSpells({
  puuid,
  spellIds,
  gameTime,
  timers,
  onStart,
}: {
  puuid: string;
  spellIds: number[];
  gameTime: number | null;
  timers: SpellTimers;
  onStart: (key: string) => void;
}) {
  const catalog = useCatalog();
  return (
    <div className="flex flex-col gap-0.5">
      {[0, 1].map((slot) => {
        const id = spellIds[slot] ?? 0;
        const src = id ? spellIcon(catalog, id) : null;
        const key = `${puuid}:${slot}`;
        const started = timers[key];
        const left =
          started !== undefined && gameTime !== null
            ? (COOLDOWNS[id] ?? 300) - (gameTime - started)
            : 0;
        const active = left > 0;
        return (
          <button
            key={slot}
            disabled={gameTime === null}
            onClick={() => onStart(key)}
            title={
              gameTime === null
                ? catalog?.spells[String(id)]?.name
                : `Click when ${catalog?.spells[String(id)]?.name ?? "this spell"} is used`
            }
            className="relative h-[22px] w-[22px] cursor-pointer overflow-hidden rounded bg-ink-800 disabled:cursor-default"
          >
            {src && (
              <img
                src={src}
                alt=""
                className={`h-full w-full ${active ? "opacity-30 grayscale" : ""}`}
                draggable={false}
              />
            )}
            {active && (
              <span className="tabular absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-fg">
                {left >= 60 ? `${Math.ceil(left / 60)}m` : Math.ceil(left)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
