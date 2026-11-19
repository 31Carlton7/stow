/**
 * One bar's segments as x/width pairs along `width`, left to right, with a gap of surface between
 * them. The gap comes out of the segment after the join, so the bar still starts on its baseline. A
 * segment too short to survive its gap is drawn at a 1px minimum: a small value is not an absent one.
 */
export function barSegments(values: readonly number[], max: number, width: number, gap = 2): { x: number; width: number }[] {
  const out: { x: number; width: number }[] = [];
  let acc = 0;
  for (const v of values) {
    const raw = max > 0 ? (Math.max(0, v) / max) * width : 0;
    const joined = acc > 0 ? gap : 0;
    out.push({ x: max > 0 ? (acc / max) * width + joined : 0, width: raw <= 0 ? 0 : Math.max(1, raw - joined) });
    acc += Math.max(0, v);
  }
  return out;
}

/** A size on disk in the unit a person would say it in: megabytes until it reaches a gigabyte. */
export function bytesSaid(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(bytes >= 10 * 1024 ** 3 ? 1 : 2)} GB`;
  if (bytes >= 1024 ** 2 / 10) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

export const countSaid = (n: number): string => n.toLocaleString("en-US");
