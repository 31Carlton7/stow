import { describe, expect, it } from "vitest";
import { barSegments, bytesSaid } from "./chart-model";

describe("a stacked bar's segments", () => {
  it("lays them end to end with the gap taken from the later one", () => {
    expect(barSegments([50, 25, 25], 100, 400)).toEqual([{ x: 0, width: 200 }, { x: 202, width: 98 }, { x: 302, width: 98 }]);
  });

  it("draws a value too small for its gap at one pixel, and nothing for zero", () => {
    // THE MUTANT: the gap is subtracted from a sliver and its width goes negative, which draws as nothing.
    expect(barSegments([999, 1, 0], 1000, 400).map((s) => s.width)).toEqual([399.6, 1, 0]);
  });

  it("draws nothing when there is nothing to scale to", () => {
    expect(barSegments([0, 0], 0, 400)).toEqual([{ x: 0, width: 0 }, { x: 0, width: 0 }]);
  });
});

describe("a size on disk", () => {
  it("is said in megabytes until it is a gigabyte", () => {
    expect(bytesSaid(13.2 * 1024 ** 3)).toBe("13.2 GB");
    expect(bytesSaid(1.5 * 1024 ** 3)).toBe("1.50 GB");
    expect(bytesSaid(4.25 * 1024 ** 2)).toBe("4.3 MB");
    expect(bytesSaid(200 * 1024)).toBe("0.2 MB");
    expect(bytesSaid(12 * 1024)).toBe("12 KB");
    expect(bytesSaid(900)).toBe("900 bytes");
  });
});
