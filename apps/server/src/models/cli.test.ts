import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tempDir } from "@amc/test-utils";
import { askCli, envWithout, findExecutable, runCli, withToolFolders } from "./cli";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const node = (script: string, o: { stdin?: string; signal?: AbortSignal; timeoutMs?: number } = {}) =>
  runCli({ command: process.execPath, args: ["-e", script], env: process.env, timeoutMs: 10_000, ...o });

describe("askCli", () => {
  // A stand-in that answers each line it is given and never exits of its own accord.
  const ECHO = `require("readline").createInterface({ input: process.stdin }).on("line", (l) => console.log("heard " + l)); setInterval(() => {}, 1000);`;
  const ask = <T>(script: string, opening: string[], onLine: (line: string, say: (line: string) => void) => T | undefined, timeoutMs = 10_000) =>
    askCli({ command: process.execPath, args: ["-e", script], env: process.env, timeoutMs, opening, onLine });

  it("writes its opening lines, goes on writing as it hears, and stops the child at the answer", async () => {
    const heard: string[] = [];
    const answer = await ask(ECHO, ["one"], (line, say) => {
      heard.push(line);
      if (line === "heard one") { say("two"); return undefined; }
      return line === "heard two" ? heard.length : undefined;
    });
    expect(answer).toBe(2);
    expect(heard).toEqual(["heard one", "heard two"]);
  });

  it("answers nothing for a binary that is not there, one that exits first, and one that takes too long", async () => {
    expect(await askCli({ command: "/nonexistent/amc-no-such-cli", args: [], env: {}, timeoutMs: 1_000, opening: [], onLine: () => "never" })).toBeNull();
    expect(await ask(`console.log("bye")`, [], () => undefined)).toBeNull();
    expect(await ask(ECHO, ["one"], () => undefined, 150)).toBeNull();
  });
});

describe("runCli", () => {
  it("feeds stdin and collects both streams and the exit code", async () => {
    const exit = await node(`process.stdin.on("data", (d) => { process.stdout.write("out:" + d); process.stderr.write("err"); process.exitCode = 3; })`, { stdin: "hello" });
    expect(exit).toEqual({ code: 3, stdout: "out:hello", stderr: "err", missing: false, aborted: false, timedOut: false });
  });

  it("reports a binary that is not there as missing", async () => {
    const exit = await runCli({ command: "/nonexistent/amc-no-such-cli", args: [], env: {}, timeoutMs: 1_000 });
    expect(exit).toMatchObject({ code: null, missing: true });
  });

  it("stops the child when the signal fires, and when it runs out of time", async () => {
    const stop = new AbortController();
    const running = node(`setTimeout(() => {}, 60000)`, { signal: stop.signal });
    setTimeout(() => stop.abort(), 100);
    expect(await running).toMatchObject({ code: null, aborted: true, timedOut: false });
    expect(await node(`setTimeout(() => {}, 60000)`, { timeoutMs: 100 })).toMatchObject({ code: null, aborted: false, timedOut: true });
  });

  it("starts nothing for a signal that already fired", async () => {
    expect(await node(`process.stdout.write("ran")`, { signal: AbortSignal.abort() })).toMatchObject({ stdout: "", aborted: true });
  });
});

describe("findExecutable", () => {
  it("looks on PATH, then where the CLIs install themselves", () => {
    const home = tempDir("amc-bin-");
    dirs.push(home);
    const onPath = join(home, "on-path"), local = join(home, ".local", "bin");
    for (const [folder, name] of [[onPath, "codex"], [local, "claude"]] as const) {
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, name), "#!/bin/sh\n", { mode: 0o755 });
    }
    expect(findExecutable("codex", { PATH: onPath, HOME: home })).toBe(join(onPath, "codex"));
    expect(findExecutable("claude", { PATH: onPath, HOME: home })).toBe(join(local, "claude"));
    expect(findExecutable("amc-no-such-cli", { PATH: onPath, HOME: home })).toBeNull();
  });
});

describe("envWithout", () => {
  it("drops the named variables and leaves the server's own environment alone", () => {
    const env = { PATH: "/usr/bin", ANTHROPIC_API_KEY: "key" };
    expect(envWithout(env, ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"])).toEqual({ PATH: "/usr/bin" });
    expect(env.ANTHROPIC_API_KEY).toBe("key");
  });
});

describe("withToolFolders", () => {
  it("adds the folders the CLIs install into to a short PATH, once each, keeping what was there first", () => {
    const env = withToolFolders({ HOME: "/Users/sam", PATH: "/usr/bin:/bin:/opt/homebrew/bin" });
    expect(env.PATH).toBe("/usr/bin:/bin:/opt/homebrew/bin:/Users/sam/.local/bin:/usr/local/bin");
    expect(env.HOME).toBe("/Users/sam");
  });
});
