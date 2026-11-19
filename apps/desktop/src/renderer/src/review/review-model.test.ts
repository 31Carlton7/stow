import { describe, expect, it } from "vitest";
import type { Finding } from "@amc/contracts";
import { bySeverity, isReady, keptBy, kindsOf, offerOf, passTokens, tokensSaid, usdSaid } from "./review-model";

const finding = (over: Partial<Finding>): Finding => ({
  fingerprint: "0000000000000000", type: "broken-link", severity: "medium", title: "t", detail: "d", subjects: [], fix: null, judgedBy: null, needsDraft: false, ...over,
});
const FOUND = [
  finding({ fingerprint: "a", type: "broken-link", severity: "medium", fix: "Remove 1 line from the index." }),
  finding({ fingerprint: "b", type: "mcp-conflict", severity: "medium" }),
  finding({ fingerprint: "c", type: "merge", severity: "low", fix: "Have the stronger model write the one memory.", needsDraft: true }),
  finding({ fingerprint: "d", type: "dead-copy", severity: "low", fix: "Move 3 files to the Trash." }),
  finding({ fingerprint: "e", type: "dead-copy", severity: "low", fix: "Move 1 file to the Trash." }),
];

describe("the review list", () => {
  it("counts a fix as ready only when it can be approved as it stands", () => {
    expect(FOUND.filter(isReady).map((f) => f.fingerprint)).toEqual(["a", "d", "e"]);
    expect(FOUND.map(offerOf)).toEqual(["Fix ready", "For you to decide", "Fix can be written", "Fix ready", "Fix ready"]);
  });

  it("filters by what the sidebar's row says", () => {
    expect(keptBy({ kind: "all" }, FOUND)).toHaveLength(5);
    expect(keptBy({ kind: "ready" }, FOUND).map((f) => f.fingerprint)).toEqual(["a", "d", "e"]);
    expect(keptBy({ kind: "type", type: "dead-copy" }, FOUND).map((f) => f.fingerprint)).toEqual(["d", "e"]);
  });

  it("lists each kind once with its count, and groups findings by how serious they are", () => {
    expect(kindsOf(FOUND)).toEqual([
      { type: "broken-link", label: "Link to a missing file", count: 1 }, { type: "mcp-conflict", label: "MCP server defined two ways", count: 1 },
      { type: "merge", label: "Could be one memory", count: 1 }, { type: "dead-copy", label: "Copies nobody reads", count: 2 },
    ]);
    expect(bySeverity(FOUND).map((g) => [g.severity, g.findings.length])).toEqual([["medium", 2], ["low", 3]]);
  });
});

describe("what a reading costs", () => {
  it("is said in tokens, rounded the way a person would say them", () => {
    expect(passTokens({ sources: [], files: 751, chars: 1_596_510, calls: 37, withheld: 0 })).toBe(591_475);
    expect(tokensSaid(591_475)).toBe("591,000");
    expect(tokensSaid(2_040_000)).toBe("about 2 million");
  });

  it("says dollars in cents, and under a cent as that", () => {
    expect(usdSaid(0)).toBe("$0.00");
    expect(usdSaid(0.0022)).toBe("under a cent");
    expect(usdSaid(0.084)).toBe("$0.08");
  });
});
