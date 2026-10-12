import {
  StrictMode,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "./styles/index.css";
import type { InGame } from "./lib/bindings/InGame";
import { api } from "./lib/ipc";
import { demo } from "./lib/demo";
import {
  EDIT_SHORTCUT,
  resetLayout,
  useWidgetEditing,
  useWidgetSettings,
  widgetApi,
} from "./lib/widgets";
import { StatsBar } from "./features/widgets/WidgetViews";

const POLL = 1000;

function useLiveGame(): InGame | null {
  const [game, setGame] = useState<InGame | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .inGame()
        .then((g) => alive && setGame(g))
        .catch(() => alive && setGame(null));
    load();
    const timer = setInterval(load, POLL);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return game;
}

type Drag = { dx: number; dy: number; w: number; h: number };

const clamp = (v: number, min: number, max: number) =>
  Math.min(Math.max(v, min), Math.max(max, min));

function Widgets() {
  const { settings, save, update, setLocal } = useWidgetSettings();
  const editing = useWidgetEditing();
  const live = useLiveGame();
  const drag = useRef<Drag | null>(null);
  const unsaved = useRef(false);
  const game = live ?? (editing ? demo.inGame : null);

  useEffect(() => {
    if (editing || !unsaved.current || !settings) return;
    drag.current = null;
    unsaved.current = false;
    save(settings);
  }, [editing, settings, save]);

  if (!settings || !game) return null;
  if (!settings.enabled && !editing) return null;

  const segments = settings.segments
    .filter((s) => s.visible)
    .map((s) => s.kind);

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (e.buttons === 0) return end();
    const W = window.innerWidth;
    const H = window.innerHeight;
    const x = clamp(
      (e.clientX - d.dx + d.w / 2) / W,
      d.w / 2 / W,
      1 - d.w / 2 / W,
    );
    const y = clamp((e.clientY - d.dy) / H, 0, 1 - d.h / H);
    unsaved.current = true;
    setLocal({ ...settings, x, y });
  };

  const start = (e: PointerEvent<HTMLDivElement>) => {
    if (!editing || settings.locked) return;
    const rect = e.currentTarget.getBoundingClientRect();
    drag.current = {
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
      w: rect.width,
      h: rect.height,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    unsaved.current = false;
    save(settings);
  };

  return (
    <div
      className={`fixed inset-0 ${editing ? "bg-black/35" : "pointer-events-none"}`}
    >
      {editing && (
        <div className="absolute top-[38%] left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-line-strong bg-ink-900 px-3 py-2 text-[12px] whitespace-nowrap text-soft shadow-lg">
          <span className="h-2 w-2 rounded-full bg-crimson" />
          <span>
            Drag the bar to move it. {!live && "Showing sample data. "}
            <span className="text-muted">{EDIT_SHORTCUT} to finish.</span>
          </span>
          <label className="tabular flex items-center gap-2 text-muted">
            <input
              type="range"
              min={20}
              max={100}
              value={Math.round(settings.opacity * 100)}
              onChange={(e) =>
                update({ opacity: Number(e.target.value) / 100 })
              }
              className="w-20 accent-crimson"
              aria-label="Bar opacity"
            />
            <span className="w-8 text-right">
              {Math.round(settings.opacity * 100)}%
            </span>
          </label>
          <button
            onClick={() => update({ locked: !settings.locked })}
            className={`cursor-pointer ${settings.locked ? "text-crimson-bright" : "text-muted hover:text-fg"}`}
          >
            {settings.locked ? "Locked" : "Lock"}
          </button>
          <button
            onClick={() => save(resetLayout(settings))}
            className="cursor-pointer text-muted hover:text-fg"
          >
            Reset
          </button>
          <button
            onClick={() => void widgetApi.setEditing(false)}
            className="cursor-pointer rounded bg-crimson px-2.5 py-1 text-white hover:bg-crimson-bright"
          >
            Done
          </button>
        </div>
      )}
      {segments.length > 0 && (
        <div
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onLostPointerCapture={end}
          className={`absolute -translate-x-1/2 ${
            editing
              ? `rounded-lg outline-1 outline-offset-2 ${settings.locked ? "outline-line-strong" : "cursor-move outline-dashed outline-crimson/70"}`
              : ""
          }`}
          style={{
            left: `${settings.x * 100}%`,
            top: `${settings.y * 100}%`,
            opacity: settings.opacity,
          }}
        >
          <StatsBar segments={segments} game={game} editing={editing} />
        </div>
      )}
    </div>
  );
}

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <Widgets />
    </StrictMode>,
  );
