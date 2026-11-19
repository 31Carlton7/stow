import { describe, expect, it } from "vitest";
import type { AskCli, CliAsk } from "./cli";
import { askClaude, askCodex, claudeOffered, codexOffered, keptFor } from "./offered";

// Rows as claude 2.1.322 and codex-cli 0.169.0 list them, cut down to the fields read here.
const CLAUDE_ROWS = [
  { value: "default", resolvedModel: "claude-opus-5-5", displayName: "Default (recommended)" },
  { value: "opus", resolvedModel: "claude-opus-5-5", displayName: "Opus 5.5" },
  { value: "opus[1m]", resolvedModel: "claude-opus-5-5[1m]", displayName: "Opus 5.5 (1M context)" },
  { value: "haiku", resolvedModel: "claude-haiku-5-5", displayName: "Haiku 5.5" },
  { value: "claude-haiku-4-5-20251001", resolvedModel: "claude-haiku-4-5-20251001", displayName: "Haiku 4.5" },
];
const CODEX_PAGE = {
  data: [
    { id: "gpt-6.1-sol", displayName: "GPT-6.1-Sol", hidden: false, isDefault: true },
    { id: "gpt-6-luna", displayName: "GPT-6-Luna", hidden: false },
    { id: "gpt-internal", displayName: "Internal", hidden: true },
  ],
  nextCursor: null,
};

/** An `askCli` that plays a CLI: it answers each line written to it with the lines `cli` gives for it. */
function playing(cli: (written: Record<string, unknown>) => unknown[]): { askCli: AskCli; asked: CliAsk<unknown>[] } {
  const asked: CliAsk<unknown>[] = [];
  const askCli: AskCli = async (ask) => {
    asked.push(ask as CliAsk<unknown>);
    const waiting = [...ask.opening];
    for (let written = waiting.shift(); written !== undefined; written = waiting.shift()) {
      for (const printed of cli(JSON.parse(written) as Record<string, unknown>)) {
        const answer = ask.onLine(JSON.stringify(printed), (line) => { waiting.push(line); });
        if (answer !== undefined) return answer;
      }
    }
    return null;
  };
  return { askCli, asked };
}
const where = { bin: "/bin/tool", cwd: "/tmp/empty", env: {}, timeoutMs: 1_000 };

describe("the models Claude Code offers", () => {
  it("are filed under the model each row resolves to, once, with the model's own name", () => {
    expect(claudeOffered(CLAUDE_ROWS)).toEqual([
      { id: "claude-opus-5-5", label: "Opus 5.5" },
      { id: "claude-haiku-5-5", label: "Haiku 5.5" },
      { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
    ]);
  });

  it("leave out a row that names no Claude model, and survive an answer that is not a list", () => {
    expect(claudeOffered([{ value: "opus", displayName: "Opus" }, null, { resolvedModel: "--flag" }, { value: "claude-sonnet-5" }])).toEqual([{ id: "claude-sonnet-5", label: "claude-sonnet-5" }]);
    expect(claudeOffered(undefined)).toEqual([]);
  });

  it("are read from the handshake's answer, with no prompt written", async () => {
    const { askCli, asked } = playing((written) => [
      { type: "system", subtype: "init" },
      { type: "control_response", response: { subtype: "success", request_id: (written as { request_id: string }).request_id, response: { models: CLAUDE_ROWS } } },
    ]);
    expect(await askClaude({ askCli, ...where })).toHaveLength(3);
    expect(asked[0]!.opening.map((line) => JSON.parse(line) as { type: string; request: { subtype: string } })).toEqual([expect.objectContaining({ type: "control_request", request: { subtype: "initialize" } })]);
    expect(asked[0]!.args).toEqual(expect.arrayContaining(["--no-session-persistence", "--strict-mcp-config", "--setting-sources"]));
  });

  it("are unknown when the answer lists none", async () => {
    const { askCli } = playing(() => [{ type: "control_response", response: { subtype: "error", error: "no" } }]);
    expect(await askClaude({ askCli, ...where })).toBeNull();
  });
});

describe("the models Codex offers", () => {
  it("are its list without the rows it hides", () => {
    expect(codexOffered(CODEX_PAGE)).toEqual({ models: [{ id: "gpt-6.1-sol", label: "GPT-6.1-Sol" }, { id: "gpt-6-luna", label: "GPT-6-Luna" }], nextCursor: null });
    expect(codexOffered(null)).toEqual({ models: [], nextCursor: null });
  });

  it("are asked for after the greeting, a page at a time", async () => {
    const methods: unknown[] = [];
    const { askCli } = playing((written) => {
      methods.push(written.method);
      if (written.method === "initialize") return [{ id: written.id, result: { userAgent: "codex" } }];
      if (written.method !== "model/list") return [];
      const second = (written.params as { cursor?: string }).cursor === "next";
      return [{ method: "account/updated", params: {} }, { id: written.id, result: second ? CODEX_PAGE : { data: [{ id: "gpt-6-astra", displayName: "GPT-6-Astra" }], nextCursor: "next" } }];
    });
    expect(await askCodex({ askCli, ...where })).toEqual([{ id: "gpt-6-astra", label: "GPT-6-Astra" }, { id: "gpt-6.1-sol", label: "GPT-6.1-Sol" }, { id: "gpt-6-luna", label: "GPT-6-Luna" }]);
    expect(methods).toEqual(["initialize", "initialized", "model/list", "model/list"]);
  });

  it("are unknown for a build with no such call", async () => {
    const { askCli } = playing((written) => (written.method === "initialize" ? [{ id: written.id, result: {} }]
      : written.method === "model/list" ? [{ id: written.id, error: { code: -32601, message: "Method not found" } }] : []));
    expect(await askCodex({ askCli, ...where })).toBeNull();
  });
});

describe("keptFor", () => {
  it("asks once in five minutes, and again at once after an answer of nothing", async () => {
    let clock = 0, asks = 0, answer: string[] | null = null;
    const kept = keptFor(async () => { asks += 1; return answer; }, () => clock);
    expect(await kept()).toBeNull();
    answer = ["a"];
    expect(await kept()).toEqual(["a"]);
    clock += 4 * 60_000;
    expect(await kept()).toEqual(["a"]);
    expect(asks).toBe(2);
    clock += 2 * 60_000;
    await kept();
    expect(asks).toBe(3);
  });
});
