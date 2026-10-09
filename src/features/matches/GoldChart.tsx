import { useLayoutEffect, useRef, useState } from "react";
import type { MatchEvent } from "../../lib/bindings/MatchEvent";

const HEIGHT = 180;
const PAD = { left: 48, right: 12, top: 12, bottom: 22 };

export function GoldChart({
  diff,
  events,
  myTeam,
}: {
  diff: number[];
  events: MatchEvent[];
  myTeam: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(
      ([e]) => e && setWidth(e.contentRect.width),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const peak = Math.max(1000, ...diff.map(Math.abs));
  const innerW = Math.max(1, width - PAD.left - PAD.right);
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) =>
    PAD.left + (i / Math.max(1, diff.length - 1)) * innerW;
  const y = (v: number) => PAD.top + innerH / 2 - (v / peak) * (innerH / 2);
  const zero = y(0);
  const line = diff.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const area = `${x(0)},${zero} ${line} ${x(diff.length - 1)},${zero}`;
  const kills = events.filter((e) => e.kind === "kill");
  const step = diff.length > 30 ? 10 : 5;
  const active = hover !== null ? diff[hover] : undefined;

  return (
    <div ref={ref} className="relative" style={{ height: HEIGHT }}>
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
            const i = Math.round(
              ((px - PAD.left) / innerW) * (diff.length - 1),
            );
            setHover(Math.min(diff.length - 1, Math.max(0, i)));
          }}
        >
          <defs>
            <clipPath id="gold-up">
              <rect x={0} y={0} width={width} height={zero} />
            </clipPath>
            <clipPath id="gold-down">
              <rect x={0} y={zero} width={width} height={HEIGHT - zero} />
            </clipPath>
          </defs>
          {[peak, peak / 2, 0, -peak / 2, -peak].map((v) => (
            <g key={v}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(v)}
                y2={y(v)}
                stroke={v === 0 ? "#3a3a3a" : "#1f1f1f"}
              />
              <text
                x={PAD.left - 8}
                y={y(v) + 4}
                fill="#5c5c5c"
                fontSize={11}
                textAnchor="end"
              >
                {v === 0
                  ? "0"
                  : `${v > 0 ? "+" : "−"}${(Math.abs(v) / 1000).toFixed(1)}k`}
              </text>
            </g>
          ))}
          {Array.from(
            { length: Math.floor((diff.length - 1) / step) + 1 },
            (_, n) => n * step,
          ).map((m) => (
            <text
              key={m}
              x={x(m)}
              y={HEIGHT - 6}
              fill="#5c5c5c"
              fontSize={11}
              textAnchor="middle"
            >
              {m}m
            </text>
          ))}
          <polygon
            points={area}
            fill="#3fa36b"
            opacity={0.18}
            clipPath="url(#gold-up)"
          />
          <polygon
            points={area}
            fill="#b3202a"
            opacity={0.22}
            clipPath="url(#gold-down)"
          />
          <polyline
            points={line}
            fill="none"
            stroke="#f2f2f2"
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
          {kills.map((k, i) => {
            const minute = k.atMs / 60000;
            return (
              <circle
                key={i}
                cx={x(minute)}
                cy={k.teamId === myTeam ? PAD.top + 2 : HEIGHT - PAD.bottom - 2}
                r={2}
                fill={k.teamId === myTeam ? "#3fa36b" : "#b3202a"}
                opacity={0.8}
              />
            );
          })}
          {hover !== null && active !== undefined && (
            <>
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={HEIGHT - PAD.bottom}
                stroke="#3a3a3a"
              />
              <circle
                cx={x(hover)}
                cy={y(active)}
                r={3.5}
                fill="#0a0a0a"
                stroke="#f2f2f2"
                strokeWidth={1.5}
              />
            </>
          )}
        </svg>
      )}
      {hover !== null && active !== undefined && (
        <div
          className="tabular pointer-events-none absolute top-0 rounded-md border border-line-strong bg-ink-800 px-2 py-1 text-xs"
          style={{
            left: Math.min(
              Math.max(x(hover) - 50, 0),
              Math.max(0, width - 110),
            ),
          }}
        >
          <span className="text-muted">{hover}m </span>
          <span className={active >= 0 ? "text-win" : "text-crimson-bright"}>
            {active >= 0 ? "+" : "−"}
            {Math.abs(active).toLocaleString()} gold
          </span>
        </div>
      )}
    </div>
  );
}
