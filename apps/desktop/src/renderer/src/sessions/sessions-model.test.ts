import { describe, expect, it } from "vitest";
import type { Session, SessionFacets, SessionIndexStatus, SessionMetrics } from "@amc/contracts";
import { calledWith, cutNotice, listFilter, metricsLine, originsShown, ranFor, sidebarCounts, sizeOf, statusLine, turnsLine, whoseLine } from "./sessions-model";

const OFF = { oneShot: false, subAgents: false };
const status = (over: Partial<SessionIndexStatus>): SessionIndexStatus => ({ state: "idle", files: 4115, listed: 4115, measured: 4115, pausedWhy: null, ...over });
const METRICS: SessionMetrics = { userTurns: 1, assistantTurns: 3, toolCalls: 1, toolErrors: 0, inputTokens: null, outputTokens: null, costUsd: null };

describe("the sessions model", () => {
  it("lists the conversations a person had until a switch adds to them", () => {
    expect(originsShown(OFF)).toEqual(["person", "app"]);
    expect(originsShown({ oneShot: true, subAgents: false })).toEqual(["person", "app", "one-shot"]);
    expect(originsShown({ oneShot: false, subAgents: true })).toEqual(["person", "app", "sub-agent"]);
    expect(originsShown({ oneShot: true, subAgents: true })).toEqual(["person", "app", "one-shot", "sub-agent"]);
  });

  it("builds the filter from the sidebar, the switches and the search", () => {
    expect(listFilter({}, OFF, "", null)).toEqual({ origins: ["person", "app"] });
    expect(listFilter({ agent: "codex" }, OFF, "  deploy script ", null)).toEqual({ agent: "codex", origins: ["person", "app"], query: "deploy script" });
    expect(listFilter({ projectId: "p-atlas" }, { oneShot: true, subAgents: false }, "", null)).toEqual({ projectId: "p-atlas", origins: ["person", "app", "one-shot"] });
  });

  it("asks for a session's sub-agents alone, whatever else is chosen", () => {
    expect(listFilter({ agent: "codex" }, OFF, "deploy", "s-deploy")).toEqual({ parentId: "s-deploy", origins: ["sub-agent"] });
  });

  it("counts the sidebar's rows from the origins", () => {
    const facets: SessionFacets = { total: 4115, agents: [], projects: [], origins: [
      { origin: "person", count: 210 }, { origin: "app", count: 94 }, { origin: "one-shot", count: 3700 },
    ] };
    expect(sidebarCounts(facets)).toEqual({ conversations: 304, oneShot: 3700, subAgents: 0 });
  });

  it("says how far the index has got, and nothing once it is idle", () => {
    expect(statusLine(status({ state: "listing", listed: 1204 }))).toBe("Listing 1,204 of 4,115");
    expect(statusLine(status({ state: "measuring", measured: 300 }))).toBe("Measuring 300 of 4,115");
    expect(statusLine(status({ state: "paused", pausedWhy: "on battery" }))).toBe("Paused: on battery");
    expect(statusLine(status({ state: "paused" }))).toBe("Paused");
    expect(statusLine(status({}))).toBeNull();
  });

  it("names the project, the agent and the app that drove it", () => {
    const of = (over: Partial<Session>) => whoseLine({ agent: "claude", drivenBy: null, projectName: "atlas", cwd: "~/work/atlas", ...over } as Session);
    expect(of({})).toBe("atlas · Claude");
    expect(of({ agent: "codex", drivenBy: "Claude Desktop" })).toBe("atlas · Codex in Claude Desktop");
    expect(of({ projectName: null })).toBe("~/work/atlas · Claude");
    expect(of({ projectName: null, cwd: null })).toBe("No project · Claude");
  });

  it("says what was measured, with tokens and cost only where the agent recorded them", () => {
    expect(turnsLine(METRICS)).toBe("1 turn · 1 tool call");
    expect(metricsLine(METRICS)).toBe("1 turn · 1 tool call");
    expect(metricsLine({ ...METRICS, userTurns: 12, toolCalls: 48, toolErrors: 2, inputTokens: 1_240_000, outputTokens: 812, costUsd: 3.5 }))
      .toBe("12 turns · 48 tool calls · 2 failed · 1.2M tokens in · 812 out · $3.50");
  });

  it("says how long a session ran and how big its file is", () => {
    const MINUTE = 60_000;
    expect(ranFor(0, 20_000)).toBe("under a minute");
    expect(ranFor(0, 42 * MINUTE)).toBe("42 min");
    expect(ranFor(0, 184 * MINUTE)).toBe("3h 4m");
    expect(ranFor(0, 51 * 60 * MINUTE)).toBe("2d 3h");
    expect([sizeOf(812), sizeOf(14_200), sizeOf(2_340_000)]).toEqual(["812 B", "14 KB", "2.3 MB"]);
  });

  it("says how much of a text was left out", () => {
    expect(cutNotice(12_400)).toBe("12,400 more characters are not shown.");
    expect(cutNotice(1)).toBe("1 more character is not shown.");
  });

  it("takes the first line with anything on it as what a tool was called with", () => {
    expect(calledWith("\n  pnpm build \n--filter web")).toBe("pnpm build");
    expect(calledWith("")).toBe("");
    expect(calledWith("x".repeat(500))).toHaveLength(200);
  });
});
