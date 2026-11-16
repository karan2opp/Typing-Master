import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { TimelinePoint } from "@typing/engine";

const HEIGHT = 220;
const M = { top: 28, right: 14, bottom: 28, left: 40 };
/** Errors sit in their own strip above the plot rather than on a second axis. */
const ERROR_STRIP_Y = 12;

type SeriesKey = "wpm" | "raw" | "burst";

// Drawn back to front: wpm last so it sits on top.
const SERIES: { key: SeriesKey; label: string; color: string; dash?: string }[] = [
  { key: "burst", label: "burst", color: "var(--series-burst)" },
  { key: "raw", label: "raw", color: "var(--series-wpm)", dash: "6 5" },
  { key: "wpm", label: "wpm", color: "var(--series-wpm)" },
];

function niceScale(peak: number) {
  for (const step of [10, 20, 25, 50, 100, 200, 250, 500]) {
    if (peak / step <= 5) return { max: Math.max(step, Math.ceil(peak / step) * step), step };
  }
  return { max: Math.ceil(peak / 1000) * 1000, step: 1000 };
}

/** Smooth path that never overshoots the data (Fritsch–Carlson monotone cubic). */
function monotonePath(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n === 0) return "";
  if (n === 1) return `M${xs[0]},${ys[0]}`;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = xs[i + 1]! - xs[i]!;
    slope[i] = (ys[i + 1]! - ys[i]!) / dx[i]!;
  }
  const t: number[] = new Array(n);
  t[0] = slope[0]!;
  t[n - 1] = slope[n - 2]!;
  for (let i = 1; i < n - 1; i++) {
    t[i] = slope[i - 1]! * slope[i]! <= 0 ? 0 : (slope[i - 1]! + slope[i]!) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      t[i] = t[i + 1] = 0;
      continue;
    }
    const a = t[i]! / slope[i]!;
    const b = t[i + 1]! / slope[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * slope[i]!;
      t[i + 1] = k * b * slope[i]!;
    }
  }
  let d = `M${xs[0]},${ys[0]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i]! / 3;
    d += `C${xs[i]! + h},${ys[i]! + h * t[i]!} ${xs[i + 1]! - h},${ys[i + 1]! - h * t[i + 1]!} ${xs[i + 1]},${ys[i + 1]}`;
  }
  return d;
}

const secondLabel = (s: number) => (Number.isInteger(s) ? String(s) : s.toFixed(1));

export function WpmChart({ points }: { points: TimelinePoint[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => {
    if (width === 0 || points.length === 0) return null;
    const plotW = width - M.left - M.right;
    const plotH = HEIGHT - M.top - M.bottom;
    const { max, step } = niceScale(Math.max(...points.flatMap((p) => [p.wpm, p.raw, p.burst])));
    const first = points[0]!.second;
    const span = points[points.length - 1]!.second - first;
    const x = (s: number) => M.left + (span === 0 ? plotW / 2 : ((s - first) / span) * plotW);
    const y = (v: number) => M.top + plotH - (v / max) * plotH;
    const xs = points.map((p) => x(p.second));
    const ticks: number[] = [];
    for (let v = 0; v <= max; v += step) ticks.push(v);
    // Roughly one x label per 40px.
    const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotW / 40))));
    const paths = Object.fromEntries(
      SERIES.map((s) => [s.key, monotonePath(xs, points.map((p) => y(p[s.key])))]),
    ) as Record<SeriesKey, string>;
    return { plotH, y, xs, ticks, labelEvery, paths };
  }, [width, points]);

  const nearest = (clientX: number) => {
    if (!geo || !wrapRef.current) return null;
    const px = clientX - wrapRef.current.getBoundingClientRect().left;
    let best = 0;
    for (let i = 1; i < geo.xs.length; i++) {
      if (Math.abs(geo.xs[i]! - px) < Math.abs(geo.xs[best]! - px)) best = i;
    }
    return best;
  };

  const onPointerMove = (e: PointerEvent) => setActive(nearest(e.clientX));

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    setActive((i) => Math.min(points.length - 1, Math.max(0, (i ?? -dir) + dir)));
  };

  const p = active === null ? null : points[active];
  const ax = active === null || !geo ? 0 : geo.xs[active]!;

  return (
    <div className="chart">
      <ul className="legend">
        {SERIES.slice()
          .reverse()
          .map((s) => (
            <li key={s.key}>
              <svg width="18" height="8" aria-hidden="true">
                <line x1="1" y1="4" x2="17" y2="4" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} strokeLinecap="round" />
              </svg>
              {s.label}
            </li>
          ))}
        <li>
          <svg width="10" height="10" aria-hidden="true">
            <path d="M1,1 L9,9 M9,1 L1,9" stroke="var(--series-error)" strokeWidth="2" strokeLinecap="round" />
          </svg>
          errors
        </li>
      </ul>

      <div ref={wrapRef} className="chart-plot">
        {geo && (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`Words per minute for each second. Final ${Math.round(points[points.length - 1]!.wpm)} wpm. Use the left and right arrow keys to read each second.`}
            tabIndex={0}
            onPointerMove={onPointerMove}
            onPointerLeave={() => setActive(null)}
            onKeyDown={onKeyDown}
            onBlur={() => setActive(null)}
          >
            {geo.ticks.map((v) => (
              <g key={v}>
                <line x1={M.left} x2={width - M.right} y1={geo.y(v)} y2={geo.y(v)} className="grid" />
                <text x={M.left - 8} y={geo.y(v)} className="tick" textAnchor="end" dominantBaseline="middle">
                  {v}
                </text>
              </g>
            ))}
            {points.map((pt, i) =>
              i % geo.labelEvery === 0 || i === points.length - 1 ? (
                <text key={i} x={geo.xs[i]} y={HEIGHT - 8} className="tick" textAnchor="middle">
                  {secondLabel(pt.second)}
                </text>
              ) : null,
            )}
            <text x={12} y={M.top + geo.plotH / 2} className="axis-title" textAnchor="middle" transform={`rotate(-90 12 ${M.top + geo.plotH / 2})`}>
              wpm
            </text>

            {SERIES.map((s) => (
              <path
                key={s.key}
                d={geo.paths[s.key]}
                fill="none"
                stroke={s.color}
                strokeWidth="2"
                strokeDasharray={s.dash}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}

            {points.map((pt, i) =>
              pt.errors > 0 ? (
                <path
                  key={i}
                  d={`M${geo.xs[i]! - 4},${ERROR_STRIP_Y - 4} L${geo.xs[i]! + 4},${ERROR_STRIP_Y + 4} M${geo.xs[i]! + 4},${ERROR_STRIP_Y - 4} L${geo.xs[i]! - 4},${ERROR_STRIP_Y + 4}`}
                  stroke="var(--series-error)"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              ) : null,
            )}

            {p && (
              <g pointerEvents="none">
                <line x1={ax} x2={ax} y1={M.top} y2={M.top + geo.plotH} className="crosshair" />
                {SERIES.map((s) => (
                  <circle key={s.key} cx={ax} cy={geo.y(p[s.key])} r="4" fill={s.color} className="ring" />
                ))}
              </g>
            )}
          </svg>
        )}

        {p && (
          <div
            className="tooltip"
            style={ax > width - 170 ? { right: width - ax + 12 } : { left: ax + 12 }}
          >
            <div className="tooltip-head">{secondLabel(p.second)}s</div>
            {SERIES.slice()
              .reverse()
              .map((s) => (
                <div key={s.key} className="tooltip-row">
                  <svg width="14" height="8" aria-hidden="true">
                    <line x1="1" y1="4" x2="13" y2="4" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash ? "3 3" : undefined} />
                  </svg>
                  <strong>{Math.round(p[s.key])}</strong>
                  <span>{s.label}</span>
                </div>
              ))}
            <div className="tooltip-row">
              <svg width="14" height="8" aria-hidden="true">
                <path d="M3,0 L11,8 M11,0 L3,8" stroke="var(--series-error)" strokeWidth="2" />
              </svg>
              <strong>{p.errors}</strong>
              <span>errors</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
