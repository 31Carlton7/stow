import { useEffect, useState } from "react";

/** How long ago, in a list row's few characters: "now", "12m", "3h", "2d", "5mo", "2y". */
export function age(ts: number, now = Date.now()): string {
  const m = Math.floor((now - ts) / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30); if (mo < 12) return `${mo}mo`;
  return `${Math.floor(d / 365)}y`;
}

/** How long ago, as a phrase: "just now", "12m ago" — never "now ago". */
export function ago(ts: number, now = Date.now()): string {
  const a = age(ts, now);
  return a === "now" ? "just now" : `${a} ago`;
}

/** The moment in full, for the tooltip: weekday, date, year and the clock to the second. The short
 *  label drops all of that by design, and this is where a reader who needs it finds it. */
export function stampTitle(ts: number): string {
  return dateFormat({ dateStyle: "full", timeStyle: "medium" }).format(ts);
}

const formats = new Map<string, Intl.DateTimeFormat>();
/** One formatter per set of options, made once: `toLocaleString` with options builds a new formatter
 *  on every call, and a list asks for a tooltip per row on every redraw. */
function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let f = formats.get(key);
  if (!f) { f = new Intl.DateTimeFormat(undefined, options); formats.set(key, f); }
  return f;
}

/**
 * The reader's "now", for every age on screen — and a re-render at the next local midnight.
 *
 * State rather than a `Date.now()` read in the render: every label on screen is chosen against the
 * SAME moment, so two rows a pixel apart can never disagree about how long ago it is.
 */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    // A second past, so the re-render lands on the new day rather than on the last tick of the old.
    const timer = setTimeout(() => setNow(Date.now()), midnight.getTime() - Date.now() + 1000);
    return () => clearTimeout(timer);
  }, [now]);
  return now;
}
