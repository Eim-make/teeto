import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LpEntry } from "../../lib/bindings/LpEntry";
import { championName, useCatalog } from "../../lib/ddragon";
import { absolute, boundaryLabel, rankLabel } from "../../lib/rank";

const HEIGHT = 200;
const PAD = { left: 76, right: 20, top: 18, bottom: 8 };
const BARS = 34;
const GAP = 14;

interface Point {
  x: number;
  y: number;
  abs: number;
  entry: LpEntry | null;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(
      ([e]) => e && setWidth(e.contentRect.width),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function LpChart({ entries }: { entries: LpEntry[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const catalog = useCatalog();

  const chart = useMemo(() => {
    const ranked = entries.filter((e) => absolute(e.after) !== null);
    const first = ranked[0];
    if (!first || width === 0) return null;
    const firstAbs = absolute(first.after) ?? 0;
    const values = [
      firstAbs - (first.delta ?? 0),
      ...ranked.map((e) => absolute(e.after) ?? 0),
    ];
    const min = Math.min(...values) - 12;
    const max = Math.max(...values) + 12;
    const lineBottom = HEIGHT - PAD.bottom - BARS - GAP;
    const innerW = width - PAD.left - PAD.right;
    const step = values.length > 1 ? innerW / (values.length - 1) : 0;
    const y = (v: number) =>
      PAD.top + ((max - v) / (max - min || 1)) * (lineBottom - PAD.top);

    const points: Point[] = values.map((abs, i) => ({
      x: PAD.left + i * step,
      y: y(abs),
      abs,
      entry: i === 0 ? null : (ranked[i - 1] ?? null),
    }));

    const span = max - min;
    const every = span > 700 ? 400 : 100;
    const lines: { y: number; label: string }[] = [];
    for (let v = Math.ceil(min / every) * every; v <= max; v += every) {
      lines.push({ y: y(v), label: boundaryLabel(v) });
    }

    const maxDelta = Math.max(1, ...ranked.map((e) => Math.abs(e.delta ?? 0)));
    const barW = Math.max(3, Math.min(14, step * 0.45));
    return { points, lines, maxDelta, barW, lineBottom };
  }, [entries, width]);

  const active = hover !== null ? chart?.points[hover] : undefined;

  return (
    <div ref={ref} className="relative w-full" style={{ height: HEIGHT }}>
      {chart && (
        <svg
          width={width}
          height={HEIGHT}
          className="block"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
            let best = 0;
            chart.points.forEach((p, i) => {
              if (
                Math.abs(p.x - x) < Math.abs((chart.points[best]?.x ?? 0) - x)
              )
                best = i;
            });
            setHover(best);
          }}
        >
          {chart.lines.map((l) => (
            <g key={l.label + l.y}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={l.y}
                y2={l.y}
                stroke="#262626"
                strokeDasharray="3 5"
              />
              <text x={8} y={l.y + 4} fill="#5c5c5c" fontSize={11}>
                {l.label}
              </text>
            </g>
          ))}

          {chart.points.map((p, i) => {
            const delta = p.entry?.delta;
            if (!p.entry || delta === null || delta === undefined) return null;
            const h = Math.max(2, (Math.abs(delta) / chart.maxDelta) * BARS);
            const fill =
              p.entry.kind !== "game"
                ? "#5c5c5c"
                : delta >= 0
                  ? "#3fa36b"
                  : "#b3202a";
            return (
              <rect
                key={p.entry.id}
                x={p.x - chart.barW / 2}
                y={HEIGHT - PAD.bottom - h}
                width={chart.barW}
                height={h}
                rx={2}
                fill={fill}
                opacity={hover === null || hover === i ? 1 : 0.45}
              />
            );
          })}

          {active && (
            <line
              x1={active.x}
              x2={active.x}
              y1={PAD.top}
              y2={HEIGHT - PAD.bottom}
              stroke="#3a3a3a"
            />
          )}

          <polyline
            fill="none"
            stroke="#f2f2f2"
            strokeWidth={1.5}
            strokeLinejoin="round"
            points={chart.points.map((p) => `${p.x},${p.y}`).join(" ")}
          />

          {chart.points.map((p, i) =>
            i === chart.points.length - 1 || hover === i ? (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={4}
                fill="#0a0a0a"
                stroke="#f2f2f2"
                strokeWidth={1.5}
              />
            ) : null,
          )}
        </svg>
      )}

      {active?.entry && (
        <div
          className="pointer-events-none absolute top-1 rounded-lg border border-line-strong bg-ink-800 px-3 py-2 text-xs whitespace-nowrap"
          style={{
            left: Math.min(
              Math.max(active.x - 90, 0),
              Math.max(0, width - 190),
            ),
          }}
        >
          <div className="flex items-center gap-2">
            <span
              className={
                (active.entry.delta ?? 0) >= 0
                  ? "text-win"
                  : "text-crimson-bright"
              }
            >
              {formatDelta(active.entry.delta)}
            </span>
            <span className="text-muted">
              {active.entry.kind === "game"
                ? championName(catalog, active.entry.championId)
                : active.entry.kind === "adjustment"
                  ? "Adjustment"
                  : "Games played elsewhere"}
            </span>
          </div>
          <div className="mt-0.5 text-muted">
            {rankLabel(active.entry.after)} · {active.entry.after.lp} LP ·{" "}
            {new Date(active.entry.recordedAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function formatDelta(delta: number | null | undefined): string {
  if (delta === null || delta === undefined) return "—";
  return `${delta >= 0 ? "+" : "−"}${Math.abs(delta)} LP`;
}
