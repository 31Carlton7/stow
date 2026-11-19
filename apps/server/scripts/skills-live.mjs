/**
 * Live check for importing and checking skills (run with: pnpm --filter @amc/server build && node apps/server/scripts/skills-live.mjs)
 *
 * Boots the BUILT server on the fixture home and asks over the real socket what the window asks:
 *
 *   1. The libraries it offers are https repositories.
 *   2. Looking at a local folder of two skills lists both, and installs and runs nothing.
 *   3. Installing one into the fixture's Claude folder puts it there, and `setup.skills` shows it.
 *   4. Its health names what its files show is wrong with it, and the fixture's own skills' faults.
 *   5. A second install is refused; with replace the first goes to the fixture's Trash.
 *   6. Removing it takes it out of `setup.skills` again, and the fixture's own skills are as they were.
 *
 * It fetches nothing from the network, makes no model call and reads nothing of the person's own home.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checks } from "../../../fixtures/checks.mjs";
import { buildFixtureHome } from "../../../fixtures/home.mjs";
import { startLiveServer } from "./lib/live-server.mjs";

const { check, finish } = checks();
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amc-skills-fixture-"));
const fixture = buildFixtureHome(fixtureRoot);
const shelf = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amc-skills-shelf-")));

const write = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(shelf, rel)), { recursive: true });
  fs.writeFileSync(path.join(shelf, rel), text);
};
const ranMarker = path.join(shelf, "ran");
write("changelog/SKILL.md", "---\nname: changelog\ndescription: Write a changelog from merged pull requests\n---\n\nRead [the tone](reference/tone.md) and [the template](reference/template.md), then call `mcp__ledger__list_entries`.\n");
write("changelog/reference/tone.md", "Plain words.\n");
write("changelog/scripts/collect.sh", `#!/bin/sh\ntouch ${ranMarker}\n`);
fs.chmodSync(path.join(shelf, "changelog/scripts/collect.sh"), 0o755);
write("standup/SKILL.md", "---\nname: standup\ndescription: Draft a standup note\n---\n\nThree lines.\n");

const server = await startLiveServer({ name: "skills", sourceHome: fixture.home });
const named = async (name) => (await server.result("setup.skills")).skills.filter((skill) => skill.name === name);
const claudeSkills = path.join(fixture.home, ".claude/skills");

try {
  const { libraries } = await server.result("skills.libraries");
  for (const library of libraries) console.log(`     ${library.name}: ${library.url}`);
  check("the libraries offered are https repositories", libraries.length > 0 && libraries.every((library) => library.url.startsWith("https://") && library.about.length > 0));

  const before = (await server.result("setup.skills")).skills;
  const source = await server.result("skills.inspect", { from: shelf });
  for (const offer of source.offers) console.log(`     ${offer.path}: ${offer.name}, ${offer.files} files, runnable ${offer.runnable.join() || "none"}, installed ${offer.installed}`);
  check("looking at the folder lists its two skills", source.offers.map((offer) => offer.name).join() === "changelog,standup" && source.version === null);
  check("it says which file could be run", source.offers[0].runnable.join() === "scripts/collect.sh" && source.offers[1].runnable.length === 0);
  check("neither is installed yet", source.offers.every((offer) => offer.installed === "no"));
  check("looking installs nothing", (await server.result("setup.skills")).skills.length === before.length && !fs.existsSync(path.join(claudeSkills, "changelog")));

  const preview = await server.result("skills.preview", { token: source.token, path: "changelog" });
  check("a preview is the skill's own text and its file names", preview.text.includes("name: changelog") && preview.files.length === 3);
  const outside = await server.call("skills.preview", { token: source.token, path: "../.." });
  check("a path that was not offered is refused", !outside.ok && outside.error.code === "SKILLS_UNSAFE");
  for (const from of ["http://example.com/skills", "git@github.com:example/skills.git", "file:///etc"]) {
    const refused = await server.call("skills.inspect", { from });
    check(`${from.split(":")[0]} is refused`, !refused.ok && refused.error.code === "SKILLS_SOURCE");
  }

  const { installed } = await server.result("skills.install", { token: source.token, paths: ["changelog"], into: "claude" });
  check("installing one puts it in the fixture's Claude folder", installed[0].ok && fs.existsSync(path.join(claudeSkills, "changelog/SKILL.md")) && !fs.existsSync(path.join(claudeSkills, "standup")));
  const [shown] = await named("changelog");
  console.log(`     setup.skills: ${shown?.name} at ${shown?.places.map((place) => place.displayPath).join()}`);
  check("`setup.skills` shows it, under the id the install answered with", shown?.id === installed[0].id && shown.places[0].displayPath === "~/.claude/skills/changelog" && shown.valid);
  check("its script kept its run bit and was not run", (fs.statSync(path.join(claudeSkills, "changelog/scripts/collect.sh")).mode & 0o111) !== 0 && !fs.existsSync(ranMarker));
  check("looking again says it is installed and the same", (await server.result("skills.inspect", { from: shelf })).offers.map((offer) => offer.installed).join() === "same,no");

  const health = (await server.result("skills.health")).skills;
  const issues = health.find((entry) => entry.id === shown.id).issues;
  for (const issue of issues) console.log(`     ${issue.kind}: ${issue.detail}`);
  check("its health names the file it points at that is missing", issues.some((issue) => issue.kind === "missing-file" && issue.detail.includes("reference/template.md")) && !issues.some((issue) => issue.detail.includes("tone.md")));
  check("and the server Claude Code has no definition for", issues.some((issue) => issue.kind === "missing-server" && issue.detail.includes("ledger") && issue.detail.includes("Claude Code")));
  const byName = (name) => health.filter((entry) => before.some((skill) => skill.id === entry.id && skill.name === name)).flatMap((entry) => entry.issues.map((issue) => issue.kind));
  check("the fixture's skill with no frontmatter will not be picked", byName("scratch").join() === "not-picked");
  check("the fixture's two different release-notes that Codex loads clash", byName("release-notes").filter((kind) => kind === "name-clash").length === 2);
  check("a healthy skill has nothing against it", byName("tone").length === 0 && byName("ship").length === 0);

  const again = await server.result("skills.install", { token: source.token, paths: ["changelog"], into: "claude" });
  check("installing it again is refused", again.installed[0].ok === false && /already a changelog there/.test(again.installed[0].detail));
  const replaced = await server.result("skills.install", { token: source.token, paths: ["changelog"], into: "claude", replace: true });
  check("with replace, the one that was there goes to the fixture's Trash", replaced.installed[0].ok && fs.existsSync(path.join(fixture.home, ".Trash/changelog/SKILL.md")));

  await server.result("skills.remove", { id: shown.id, place: "~/.claude/skills/changelog" });
  check("removing it takes it out of `setup.skills`", (await named("changelog")).length === 0 && !fs.existsSync(path.join(claudeSkills, "changelog")));
  check("and it is in the fixture's Trash", fs.existsSync(path.join(fixture.home, ".Trash/changelog 2/SKILL.md")));

  const linked = (await named("release-notes")).find((skill) => skill.places.length === 2);
  await server.result("skills.remove", { id: linked.id, place: "~/.claude/skills/release-notes" });
  check("removing a link leaves the folder it led to", !fs.existsSync(path.join(claudeSkills, "release-notes")) && fs.existsSync(path.join(fixture.home, ".agents/skills/release-notes/reference/tone.md")));
  const after = (await server.result("setup.skills")).skills;
  check("the fixture's own skills are all still there", after.length === before.length && after.map((skill) => skill.id).sort().join() === before.map((skill) => skill.id).sort().join());
  check("the folder that was looked at is as it was", fs.readdirSync(shelf).sort().join() === "changelog,standup");
} finally {
  await server.stop();
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fs.rmSync(shelf, { recursive: true, force: true });
}
finish();
