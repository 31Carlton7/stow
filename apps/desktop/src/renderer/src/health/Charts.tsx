import type { ReactNode } from "react";
import { barSegments } from "./chart-model";

/*
 * The Health page's charts, in SVG and CSS: the app ships no charting library.
 *
 * - Colour is by slot, never by rank: a kind keeps its colour whatever is beside it. The slots are
 *   the eight in `tokens.css`; nothing here makes a hue.
 * - No chart is the only place a number is: every bar has its value in text beside it, and a stack
 *   has its parts in the table under it.
 */

/** Slot n of the categorical palette, 0-indexed. Clamped rather than cycled: a ninth hue would read as the first. */
export const seriesColor = (i: number): string => `var(--series-${Math.min(8, Math.max(1, i + 1))})`;

const STACK_WIDTH = 1000;

export type StackRow = {
  key: string;
  label: ReactNode;
  /** The row's whole value, in words, beside the bar. */
  said: string;
  segments: { key: string; label: string; colorIndex: number; value: number; said: string }[];
};

/**
 * One horizontal stack per row, every row on the same scale, so the rows' lengths compare.
 * Horizontal because a row is named (an agent), and there are few of them.
 */
export function StackedBars({ rows, label }: { rows: StackRow[]; label: string }) {
  const max = Math.max(0, ...rows.map((row) => row.segments.reduce((sum, s) => sum + s.value, 0)));
  return (
    <ul className="hc-stacks" aria-label={label}>
      {rows.map((row) => {
        const placed = barSegments(row.segments.map((s) => s.value), max, STACK_WIDTH);
        return (
          <li className="hc-stack-row" key={row.key}>
            <span className="hc-stack-label">{row.label}</span>
            <svg className="hc-stack" viewBox={`0 0 ${STACK_WIDTH} 12`} preserveAspectRatio="none" role="img"
              aria-label={row.segments.map((s) => `${s.label} ${s.said}`).join(", ")}>
              {row.segments.map((s, n) => (
                <rect key={s.key} x={placed[n]!.x} y={0} width={placed[n]!.width} height={12} fill={seriesColor(s.colorIndex)}>
                  <title>{`${s.label}: ${s.said}`}</title>
                </rect>
              ))}
            </svg>
            <span className="hc-bar-value">{row.said}</span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A horizontal bar per row. One colour for every bar: the length already says the value, and the
 * name beside it says which it is.
 */
export function BreakdownBars({ rows, format, label, colorIndex = 0 }: {
  rows: { key: string; label: ReactNode; value: number; caption: string }[];
  format: (n: number) => string;
  label: string;
  colorIndex?: number;
}) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  return (
    <ul className="hc-bars" aria-label={label}>
      {rows.map((r) => (
        <li className="hc-bar-row" key={r.key}>
          <span className="hc-bar-label">{r.label}</span>
          <span className="hc-bar-track">
            <span className="hc-bar-fill" style={{ width: `${max > 0 ? (r.value / max) * 100 : 0}%`, background: seriesColor(colorIndex) }} />
          </span>
          <span className="hc-bar-value">{format(r.value)}</span>
          <span className="hc-bar-caption">{r.caption}</span>
        </li>
      ))}
    </ul>
  );
}

/** The legend, present whenever a chart has two or more series, each with its value in words when it has one. */
export function Legend({ series }: { series: { key: string; label: string; colorIndex: number }[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="hc-legend">
      {series.map((s) => (
        <li key={s.key}><span className="hc-legend-swatch" style={{ background: seriesColor(s.colorIndex) }} />{s.label}</li>
      ))}
    </ul>
  );
}
