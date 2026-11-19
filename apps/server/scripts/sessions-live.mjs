/**
 * Live check for the sessions index (run with: pnpm --filter @amc/server build && node apps/server/scripts/sessions-live.mjs)
 *
 * Boots the BUILT server on the fixture home and asks over the real socket what the window asks:
 *
 *   1. The index finds all six fixture transcripts and comes to rest with each one measured.
 *   2. The list holds the conversations a person had, newest first, with Realm's names joined in.
 *   3. The facets count every session by origin, and the conversations a person had by agent.
 *   4. A transcript reads the same in one stretch as in several, each tool with what came back.
 *   5. A Claude session's context is what it recorded; a Codex session's is worked out and says so.
 *   6. Nothing was written under the home the transcripts are in.
 *
 * It makes no model call and reads nothing of the person's own home.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checks } from "../../../fixtures/checks.mjs";
import { buildFixtureHome, SESSIONS } from "../../../fixtures/home.mjs";
import { startLiveServer } from "./lib/live-server.mjs";

const { check, finish } = checks();
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amc-sessions-fixture-"));
const fixture = buildFixtureHome(fixtureRoot);

/** Every file under the home with its size and the time it was written, to show nothing changed. */
const snapshot = () => fs.readdirSync(fixture.home, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => { const file = path.join(entry.parentPath, entry.name); const stat = fs.statSync(file); return `${file} ${stat.size} ${stat.mtimeMs}`; })
  .sort().join("\n");
const before = snapshot();

const server = await startLiveServer({ name: "sessions", sourceHome: fixture.home });
const { call, result } = server;

try {
  let status = await result("sessions.status");
  for (let waited = 0; status.state !== "paused" && (status.state !== "idle" || status.measured < status.files || status.files === 0) && waited < 100; waited++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    status = await result("sessions.status");
  }
  console.log(`     status: ${JSON.stringify(status)}`);
  check("the index finds the six transcripts", status.files === 6 && status.listed === 6, `${status.files} files, ${status.listed} listed`);
  // On battery or on a busy Mac the second look waits, which is what it is for; the checks of its numbers are then skipped.
  const measured = status.measured === 6;
  if (!measured) console.log(`     the second look is waiting (${status.pausedWhy ?? status.state}): its checks are skipped`);
  else check("the index comes to rest with every file measured", status.state === "idle");

  const { sessions, matched } = await result("sessions.list", {});
  for (const s of sessions) console.log(`     ${s.agent} ${s.origin} by=${s.drivenBy} "${s.title}" ${s.projectName} ${s.cwd} ${s.sizeBytes}B children=${s.children}`);
  check("the list is the conversations a person had, newest first", matched === 3 && sessions.map((s) => s.id).join() === [SESSIONS.realm, SESSIONS.codex, SESSIONS.typed].join());
  const realm = sessions.find((s) => s.id === SESSIONS.realm);
  check("a session Realm drove carries Realm's names", realm?.drivenBy === "Realm" && realm.realm?.space === "Atlas" && realm.realm?.teammate === "Release captain", JSON.stringify(realm?.realm));
  check("a session typed at a terminal is a person's, with its project", sessions.find((s) => s.id === SESSIONS.typed)?.origin === "person" && sessions.find((s) => s.id === SESSIONS.typed)?.projectName === "atlas");
  const subAgents = await result("sessions.list", { filter: { parentId: SESSIONS.typed } });
  check("a session's sub-agents are found by their parent", subAgents.matched === 1 && subAgents.sessions[0].id === SESSIONS.subAgent && subAgents.sessions[0].origin === "sub-agent");
  const searched = await result("sessions.list", { filter: { query: "beacon dark" } });
  check("the search reads the title", searched.matched === 1 && searched.sessions[0].id === SESSIONS.codex);

  const facets = await result("sessions.facets");
  console.log(`     facets: ${JSON.stringify(facets)}`);
  check("the facets count the three conversations by agent, of six sessions in all", facets.total === 6 && facets.agents.find((a) => a.agent === "claude").count === 2 && facets.agents.find((a) => a.agent === "codex").count === 1);
  check("and by origin", ["app:1", "one-shot:1", "person:2", "sub-agent:2"].join() === facets.origins.map((o) => `${o.origin}:${o.count}`).join());
  check("the projects are the ones a person talked in", facets.projects.map((p) => `${p.name}:${p.count}`).join() === "atlas:2,beacon:1");

  const typed = await result("sessions.get", { id: SESSIONS.typed });
  if (measured) check("the second look counted the session's turns, tools and cost", typed.metrics?.userTurns === 2 && typed.metrics.toolCalls === 3 && typed.metrics.toolErrors === 1 && typed.metrics.costUsd === 0.42, JSON.stringify(typed.metrics));
  const missing = await call("sessions.get", { id: "no-such-session" });
  check("a session the index does not hold is refused by name", !missing.ok && missing.error.code === "SESSION_NOT_FOUND");

  const whole = await result("sessions.read", { id: SESSIONS.typed });
  console.log(`     transcript: ${whole.blocks.map((b) => b.kind).join(" ")}`);
  check("a transcript reads to its end in one stretch", whole.next === null && whole.blocks.length === 10);
  const failed = whole.blocks.find((b) => b.kind === "tool" && b.failed);
  check("a failed tool carries what it said", failed?.output === "fatal: could not read from remote repository");
  check("text a harness injected is a note, not the person's words", whole.blocks.some((b) => b.kind === "note" && b.label === "Task notification") && whole.blocks.filter((b) => b.kind === "user").length === 2);
  const pieced = [];
  for (let cursor, calls = 0; calls < 10; calls++) {
    const stretch = await result("sessions.read", { id: SESSIONS.typed, limit: 4, ...(cursor ? { cursor } : {}) });
    pieced.push(...stretch.blocks);
    if (stretch.next === null) break;
    cursor = stretch.next;
  }
  check("three stretches of four read the same blocks as one", JSON.stringify(pieced) === JSON.stringify(whole.blocks));
  const codex = await result("sessions.read", { id: SESSIONS.codex });
  check("a Codex transcript reads in the same shape", codex.blocks.map((b) => b.kind).join() === "note,note,user,thinking,tool,tool,assistant" && codex.blocks[5].failed === true);
  const badCursor = await call("sessions.read", { id: SESSIONS.typed, cursor: "page-2" });
  check("a cursor the server did not give is refused", !badCursor.ok && badCursor.error.code === "SESSION_CURSOR");

  const context = await result("sessions.context", { id: SESSIONS.typed });
  for (const f of context.files) console.log(`     ${f.role}: ${f.displayPath} ${f.chars} chars library=${f.libraryId !== null} changed=${f.changedSince}`);
  check("a Claude session's context is what it recorded", context.recorded === true && context.files.length === 6 && context.chars === 387);
  check("an instruction file edited since is marked", context.files.find((f) => f.displayPath === "~/work/atlas/CLAUDE.md")?.changedSince === true && context.files.find((f) => f.displayPath === "~/.claude/CLAUDE.md")?.changedSince === false);
  check("a loaded file is tied to the library's copy", context.files.find((f) => f.displayPath === "~/.claude/CLAUDE.md")?.libraryId !== null);
  const codexContext = await result("sessions.context", { id: SESSIONS.codex });
  check("a Codex session's context is worked out from its folder, and says so", codexContext.recorded === false && codexContext.files.map((f) => f.displayPath).join() === "~/work/beacon/AGENTS.md");

  check("nothing under the home was written", snapshot() === before);
} finally {
  await server.stop();
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
finish();
