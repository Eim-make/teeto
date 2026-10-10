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
import type { WidgetConfig } from "./lib/bindings/WidgetConfig";
import { api } from "./lib/ipc";
import { demo } from "./lib/demo";
import {
  EDIT_SHORTCUT,
  resetLayout,
  useWidgetEditing,
  useWidgetSettings,
  widgetApi,
  WIDGET_INFO,
} from "./lib/widgets";
import { WidgetView } from "./features/widgets/WidgetViews";

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

type Drag = {
  kind: WidgetConfig["kind"];
  dx: number;
  dy: number;
  w: number;
  h: number;
};

const clamp = (v: number, max: number) =>
  Math.min(Math.max(v, 0), Math.max(max, 0));

function Toolbar({
  widget,
  below,
  onChange,
}: {
  widget: WidgetConfig;
  below: boolean;
  onChange: (patch: Partial<WidgetConfig>) => void;
}) {
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      className={`absolute left-0 flex items-center gap-2 rounded-md border border-line-strong bg-ink-900 px-2 py-1 text-[11px] whitespace-nowrap text-soft ${
        below ? "top-full mt-1" : "bottom-full mb-1"
      }`}
    >
      <span className="font-medium">{WIDGET_INFO[widget.kind].name}</span>
      <input
        type="range"
        min={20}
        max={100}
        value={Math.round(widget.opacity * 100)}
        onChange={(e) => onChange({ opacity: Number(e.target.value) / 100 })}
        title="Opacity"
        className="w-20 accent-crimson"
      />
      <button
        onClick={() => onChange({ locked: !widget.locked })}
        className={`cursor-pointer ${widget.locked ? "text-crimson-bright" : "text-muted hover:text-fg"}`}
      >
        {widget.locked ? "Locked" : "Lock"}
      </button>
      <button
        onClick={() => onChange({ visible: !widget.visible })}
        className="cursor-pointer text-muted hover:text-fg"
      >
        {widget.visible ? "Hide" : "Show"}
      </button>
    </div>
  );
}

function Widgets() {
  const { settings, save, update, setLocal } = useWidgetSettings();
  const editing = useWidgetEditing();
  const live = useLiveGame();
  const drag = useRef<Drag | null>(null);
  const game = live ?? (editing ? demo.inGame : null);

  if (!settings || !game) return null;
  if (!settings.enabled && !editing) return null;

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const x = clamp(
      (e.clientX - d.dx) / window.innerWidth,
      1 - d.w / window.innerWidth,
    );
    const y = clamp(
      (e.clientY - d.dy) / window.innerHeight,
      1 - d.h / window.innerHeight,
    );
    setLocal({
      ...settings,
      widgets: settings.widgets.map((w) =>
        w.kind === d.kind ? { ...w, x, y } : w,
      ),
    });
  };

  const start = (e: PointerEvent<HTMLDivElement>, widget: WidgetConfig) => {
    if (!editing || widget.locked) return;
    const rect = e.currentTarget.getBoundingClientRect();
    drag.current = {
      kind: widget.kind,
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
    save(settings);
  };

  return (
    <div
      className={`fixed inset-0 ${editing ? "bg-black/35" : "pointer-events-none"}`}
    >
      {editing && (
        <div className="absolute top-[38%] left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-line-strong bg-ink-900 px-3 py-2 text-[12px] text-soft shadow-lg">
          <span className="h-2 w-2 rounded-full bg-crimson" />
          <span>
            Drag widgets to move them. {!live && "Showing sample data. "}
            <span className="text-muted">{EDIT_SHORTCUT} to finish.</span>
          </span>
          <button
            onClick={() => save(resetLayout(settings))}
            className="cursor-pointer text-muted hover:text-fg"
          >
            Reset layout
          </button>
          <button
            onClick={() => void widgetApi.setEditing(false)}
            className="cursor-pointer rounded bg-crimson px-2.5 py-1 text-white hover:bg-crimson-bright"
          >
            Done
          </button>
        </div>
      )}
      {settings.widgets.map((widget) => {
        if (!widget.visible && !editing) return null;
        return (
          <div
            key={widget.kind}
            onPointerDown={(e) => start(e, widget)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            className={`absolute ${
              editing
                ? `rounded-lg outline-1 outline-offset-2 ${widget.locked ? "outline-line-strong" : "cursor-move outline-dashed outline-crimson/70"}`
                : ""
            }`}
            style={{ left: `${widget.x * 100}%`, top: `${widget.y * 100}%` }}
          >
            {editing && (
              <Toolbar
                widget={widget}
                below={widget.y < 0.08}
                onChange={(patch) => update(widget.kind, patch)}
              />
            )}
            <div style={{ opacity: widget.visible ? widget.opacity : 0.25 }}>
              <WidgetView kind={widget.kind} game={game} editing={editing} />
            </div>
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
      <Widgets />
    </StrictMode>,
  );
