/**
 * Live check for the library (run with: pnpm build && node apps/desktop/scripts/library-live.mjs)
 *
 * Boots the BUILT app on a scratch data folder, pointed at a fixture home with every agent's layout
 * (fixtures/home.mjs), drives the real window with real pointer and key events, and holds what the
 * window shows and does against the DISK:
 *
 *   1. The sidebar's counts are the files in each agent's folders, and "All memories" counts a
 *      memory kept in three places once.
 *   2. A file opens, with its links: one that names a file opens it, one that names none reads as dead.
 *   3. Search finds the files that hold a word.
 *   4. By project lists the repositories, a worktree under the one it is a worktree of.
 *   5. An edit to a file in Realm's memory repository is one commit by the app, of that file alone.
 *   6. An edit to Claude's own CLAUDE.md asks first, then changes the file and leaves a backup.
 *   7. A file Realm manages offers no Edit.
 *   8. A new memory is a file with its line in the folder's index.
 *   9. A deleted file of Claude's is in the fixture home's Trash.
 *  10. A file still opens after the window's connection to its server has dropped.
 *  10. A tag is kept beside the library, and the file is not touched.
 *  11. The grid holds a card for each row of the list, opens one across the panel, and comes back
 *      to where it was scrolled to. The choice of grid or list outlives the page.
 *
 * Pictures of both faces go to LIVE_DIR (default: a folder under the system temp directory). They
 * are page captures over a stand-in colour: the real material and the traffic lights are not in them.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PROFILE_ID, buildFixtureHome, claudeSlug } from "../../../fixtures/home.mjs";
import { checks, launchLiveApp, sleep, until, windowTools } from "./lib/live-app.mjs";

const outDir = process.env.LIVE_DIR ?? path.join(os.tmpdir(), "amc-live", "library");
const at = buildFixtureHome(fs.mkdtempSync(path.join(os.tmpdir(), "amc-library-home-")));
const { check, finish } = checks();

// ─── What is on the disk ────────────────────────────────────────────────────────────────────────

const home = (rel) => path.join(at.home, rel);
const read = (file) => fs.readFileSync(file, "utf8");
/** The files under `dir` whose names end in one of `exts`, to `depth` folders down. */
function filesUnder(dir, exts, depth = 40) {
  const out = [];
  const visit = (folder, left) => {
    for (const e of fs.existsSync(folder) ? fs.readdirSync(folder, { withFileTypes: true }) : []) {
      if (e.name === ".git") continue;
      const abs = path.join(folder, e.name);
      if (e.isDirectory()) { if (left > 0) visit(abs, left - 1); }
      else if (exts.some((ext) => e.name.endsWith(ext))) out.push(abs);
    }
  };
  visit(dir, depth);
  return out;
}
const present = (rels) => rels.map(home).filter((file) => fs.existsSync(file));
/** How many memories a set of files is: files with the same text are one, and empty files are each their own. */
const memories = (files) => new Set(files.map((file) => (read(file).trim() === "" ? file : createHash("sha1").update(read(file)).digest("hex")))).size;

const claudeMemory = path.relative(at.home, at.claudeMemory);
/** Each agent's rows as the sidebar should show them: the label, and the files behind the count. */
const onDisk = () => ({
  Realm: {
    Memory: filesUnder(at.repo, [".md"]),
    "Memory documents": filesUnder(home("Realm/memory"), [".md"], 0),
    "Imported copies": filesUnder(home("Realm/memory/imported"), [".md"]),
  },
  Claude: {
    "Project memory": filesUnder(home(".claude/projects"), [".md"]).filter((file) => path.basename(path.dirname(file)) === "memory"),
    Instructions: present([".claude/CLAUDE.md"]),
    "Project instructions": present(["work/atlas/CLAUDE.md"]),
  },
  Codex: {
    Memory: filesUnder(home(".codex/automations"), [".md"]),
    Instructions: present([".codex/AGENTS.md"]),
    "Project instructions": present(["work/atlas/AGENTS.md", "work/beacon/AGENTS.md"]),
  },
  Cursor: { Rules: filesUnder(home(".cursor/rules"), [".md", ".mdc"]), "Project rules": filesUnder(home("work/atlas/.cursor/rules"), [".md", ".mdc"]) },
  Gemini: { Instructions: present([".gemini/GEMINI.md"]) },
  opencode: { Instructions: present([".config/opencode/AGENTS.md"]) },
  Hermes: { Instructions: present([".hermes/SOUL.md"]) },
  OpenClaw: { Instructions: filesUnder(home(".openclaw/workspace"), [".md"], 0) },
});
const everyFile = () => Object.values(onDisk()).flatMap((kinds) => Object.values(kinds).flat());
const git = (...args) => execFileSync("git", args, { cwd: at.repo, encoding: "utf8" }).trim();

// ─── The window ─────────────────────────────────────────────────────────────────────────────────

const app = await launchLiveApp({ name: "library", sourceHome: at.home });
const { page } = app;
const js = (value) => JSON.stringify(value);
/** The page-side lookups every step uses, by what a person reads rather than by position. */
const LOOKUPS = `
  const all = (selector) => [...document.querySelectorAll(selector)];
  const navRow = (group, name) => all(group ? '.lib-nav-list[aria-label="' + group + '"] .lib-nav-row' : ".lib-nav-row").find((r) => r.querySelector(".lib-nav-name").textContent === name);
  const listRow = (title, place) => all(".lib-row").find((r) => r.querySelector(".lib-row-title").textContent === title && (!place || r.querySelector(".lib-row-place").textContent === place));
  const button = (scope, name) => all(scope + " button").find((b) => (b.getAttribute("aria-label") ?? b.textContent.trim()) === name);
  const segment = (name) => all(".seg-opt").find((o) => o.textContent.trim() === name);
`;
const ask = (expression) => page.eval(`(() => { ${LOOKUPS} return ${expression}; })()`);
/** A real press and release at the middle of what `expression` finds. */
async function press(expression, what) {
  const spot = await until(() => ask(`(() => { const el = ${expression}; if (!el) return null; el.scrollIntoView({ block: "nearest" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`), 8_000, what);
  for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, x: spot.x, y: spot.y, button: "left", clickCount: 1 });
}
const KEY_CODES = { Enter: 13, ArrowDown: 40, ArrowUp: 38, Escape: 27, Backspace: 8 };
const key = async (name, { meta = false } = {}) => {
  const event = { key: name, code: name, windowsVirtualKeyCode: KEY_CODES[name], modifiers: meta ? 4 : 0 };
  // Enter carries its character, which is what makes a form take it as its submit.
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", ...event, ...(name === "Enter" ? { text: "\r" } : {}) });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...event });
};
const typeText = (text) => page.send("Input.insertText", { text });
/** Put the caret after the last character of an editing surface, as a click there does. */
const caretToEnd = (selector) => page.eval(`(() => {
  const el = document.querySelector(${js(selector)});
  el.focus();
  const texts = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let last = null;
  while (texts.nextNode()) last = texts.currentNode;
  const range = document.createRange();
  range.setStart(last, last.length);
  range.collapse(true);
  getSelection().removeAllRanges();
  getSelection().addRange(range);
})()`);
const readerTitle = () => page.eval(`document.querySelector(".lib-reader-title")?.textContent ?? null`);
const opened = (title) => until(async () => (await readerTitle()) === title, 8_000, `${title} in the reader`);
const listTitles = () => page.eval(`[...document.querySelectorAll(".lib-row-title")].map((t) => t.textContent)`);
const dialog = () => page.eval(`(() => { const d = document.querySelector('[role="dialog"]'); return d ? { title: d.getAttribute("aria-label"), text: d.textContent } : null; })()`);
const toasts = () => page.eval(`[...document.querySelectorAll(".toast-text")].map((t) => t.textContent)`);
const sidebarRows = () => page.eval(`[...document.querySelectorAll(".lib-nav-list")].map((list) => ({ group: list.getAttribute("aria-label"), rows: [...list.querySelectorAll(".lib-nav-row")].map((r) => ({ name: r.querySelector(".lib-nav-name").textContent, count: Number(r.querySelector(".lib-nav-count").textContent), nested: r.hasAttribute("data-nested") })) }))`);

const { shots: picture, unreachable } = windowTools(app, outDir);
async function shots(name) {
  await sleep(250);
  await picture(name);
}

try {
  await until(() => page.eval(`document.querySelectorAll(".lib-nav-row").length > 1 && document.querySelector(".lib-reader-title") !== null`), 15_000, "the library");

  // 1. The sidebar's counts.
  const expected = onDisk();
  const shown = await sidebarRows();
  const all = shown.find((list) => list.group === null)?.rows[0];
  check("All memories counts each memory once", all?.name === "All memories" && all.count === memories(everyFile()),
    `${all?.count} shown, ${everyFile().length} files on disk holding ${memories(everyFile())} memories`);
  for (const [group, kinds] of Object.entries(expected)) {
    const rows = shown.find((list) => list.group === group)?.rows ?? [];
    const want = Object.entries(kinds).filter(([, files]) => files.length > 0).map(([name, files]) => `${name} ${files.length}`);
    const total = Object.values(kinds).flat().length;
    check(`${group}: ${total} files, by kind`, rows[0]?.name === group && rows[0].count === total && js(rows.slice(1).map((r) => `${r.name} ${r.count}`)) === js(want),
      rows.map((r) => `${r.name} ${r.count}`).join(", "));
  }
  check("no agent is listed that has no files", shown.filter((list) => list.group !== null).length === Object.keys(expected).length, shown.map((l) => l.group).join(", "));

  // The copies badge: the memory kept in three places is one row, and says so.
  const copies = everyFile().filter((file) => read(file) === read(path.join(at.repo, "spaces/atlas/deploy-steps.md"))).length;
  const badge = await ask(`listRow("deploy-steps")?.querySelector(".lib-row-copies")?.textContent ?? null`);
  check("the memory kept in three places is one row with a copies badge", badge === `${copies} copies` && (await listTitles()).filter((t) => t === "deploy-steps").length === 1, `${badge}; ${copies} files on disk hold its text`);
  const sizes = await page.eval(`(() => { const box = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return [Math.round(r.x), Math.round(r.width)]; }; return { sidebar: box(".sidebar"), list: box(".col-list"), reader: box(".col-reader"), head: Math.round(document.querySelector(".col-head").getBoundingClientRect().height) }; })()`);
  check("the three columns keep the shell's widths", js(sizes.sidebar) === "[0,280]" && js(sizes.list) === "[280,340]" && sizes.reader[0] === 620 && sizes.head === 44, js(sizes));
  await press(`listRow("deploy-steps")`, "the deploy-steps row");
  await opened("deploy-steps");
  await shots("list-copies");

  // 2. Selecting a file, and its links.
  await press(`listRow("Index", "Realm · Sam's memory")`, "the repository's index");
  await opened("Index");
  const links = await until(async () => {
    const found = await page.eval(`[...document.querySelectorAll(".lib-reader-body a")].map((a) => ({ text: a.textContent, dead: a.hasAttribute("data-dead"), title: a.getAttribute("title"), struck: getComputedStyle(a).textDecorationLine }))`);
    return found.length >= 3 ? found : null;
  }, 8_000, "the index's links");
  const linked = (name) => links.find((l) => l.text === name);
  check("a link to a file that is there is live", linked("team")?.dead === false && fs.existsSync(path.join(at.repo, "team.md")), js(linked("team")));
  check("a link to a file that is not there reads as dead", linked("missing-note")?.dead === true && linked("missing-note").title === "This link leads to no file"
    && linked("missing-note").struck === "line-through" && !fs.existsSync(path.join(at.repo, "missing-note.md")), js(linked("missing-note")));
  const shownPath = await page.eval(`(() => { const p = document.querySelector(".lib-path"); return { text: p.textContent, title: p.getAttribute("title") }; })()`);
  check("the reader shows the file's path from the home folder, the whole of it a hover away",
    shownPath.text === `~/Realm/memory/repos/profile-${PROFILE_ID}/MEMORY.md` && shownPath.title === path.join(at.repo, "MEMORY.md"), js(shownPath));
  await shots("reading");
  check("every control on screen takes a real press: none lies in a part that drags the window", (await unreachable()).length === 0, (await unreachable()).join(" | "));
  await press(`all(".lib-reader-body a").find((a) => a.textContent === "missing-note")`, "the dead link");
  await sleep(300);
  check("a press on a dead link goes nowhere", (await readerTitle()) === "Index");
  await press(`all(".lib-reader-body a").find((a) => a.textContent === "team")`, "the link to team");
  await opened("Team");
  const body = await until(() => page.eval(`document.querySelector(".lib-reader-body .documents-rich-surface")?.textContent || null`), 5_000, "the body of team.md");
  check("the linked file is read from the disk", read(path.join(at.repo, "team.md")).includes(body.trim()), body.trim());
  await press(`button(".lib-props-file", "Show in Finder")`, "Show in Finder");
  await until(async () => read(path.join(app.scratch, "electron.log")).includes(`show in folder ${js(path.join(at.repo, "team.md"))}`), 5_000, "the Finder being asked for team.md");
  check("Show in Finder asks the Finder for that file", true);

  // The keyboard: the arrows move the selection, Enter goes to the file.
  await page.eval(`void document.querySelector(".lib-rows").focus()`);
  const before = await listTitles();
  const from = await page.eval(`[...document.querySelectorAll(".lib-row")].findIndex((r) => r.getAttribute("aria-selected") === "true")`);
  await key("ArrowDown");
  await until(async () => (await page.eval(`[...document.querySelectorAll(".lib-row")].findIndex((r) => r.getAttribute("aria-selected") === "true")`)) === from + 1, 5_000, "the selection to move down");
  await opened(before[from + 1]);
  await key("Enter");
  check("the arrows move the selection and Enter goes to the file", await page.eval(`document.activeElement?.id === "library-reader"`), before[from + 1]);

  // 3. Search.
  await press(`document.querySelector(".lib-search input")`, "the search field");
  await typeText("notarize");
  const holding = everyFile().filter((file) => /notarize/i.test(read(file)));
  await until(async () => (await listTitles()).length === memories(holding), 8_000, `the ${memories(holding)} memories that hold the word`);
  const hits = await page.eval(`[...document.querySelectorAll(".lib-row")].map((r) => ({ title: r.querySelector(".lib-row-title").textContent, line: r.querySelector(".lib-row-line").textContent }))`);
  check("search lists the memories that hold the word, the best match first", hits[0]?.title === "deploy-steps" && /notarize/i.test(hits[0].line), js(hits));
  await page.eval(`(() => { document.querySelector(".lib-search input").select(); document.execCommand("delete"); })()`);
  await until(async () => (await listTitles()).length === memories(everyFile()), 8_000, "the whole list back");

  // 4. By project.
  await press(`segment("By project")`, "By project");
  const projects = await until(async () => (await sidebarRows()).find((list) => list.group === "Projects")?.rows ?? null, 5_000, "the projects");
  const atlasFiles = everyFile().filter((file) => file.startsWith(`${at.atlas}/`) || file.startsWith(`${at.claudeMemory}/`) || file.includes("/spaces/atlas/") || file.includes(claudeSlug(at.atlas)));
  check("By project lists each repository once, a worktree under its own", js(projects.map((p) => p.name)) === js(["atlas", "beacon"]) && fs.existsSync(path.join(at.worktree, "CLAUDE.md")), js(projects));
  check("a project's count is the memories that belong to it", projects[0].count === memories(atlasFiles) && projects[1].count === 1,
    `atlas ${projects[0].count} of ${memories(atlasFiles)} on disk, beacon ${projects[1].count}`);
  await press(`navRow("Projects", "atlas")`, "the atlas project");
  await until(async () => (await listTitles()).length === projects[0].count, 8_000, "atlas's files");
  check("the list is that project's files", await page.eval(`document.querySelector(".lib-list-title").textContent === "atlas"`));
  await shots("by-project");
  await press(`segment("By agent")`, "By agent");
  await until(async () => (await listTitles()).length === memories(everyFile()), 8_000, "everything again");

  // 5. Editing a file in the memory repository: one commit, of that file alone.
  const deploySteps = path.join(at.repo, "spaces/atlas/deploy-steps.md");
  const deployBefore = read(deploySteps);
  const commitsBefore = Number(git("rev-list", "--count", "HEAD"));
  await press(`listRow("deploy-steps")`, "the deploy-steps row");
  await opened("deploy-steps");
  await press(`button(".lib-reader-bar", "Edit")`, "Edit");
  await until(() => page.eval(`document.querySelector(".lib-editor-body .ProseMirror")?.textContent.includes("who approves") ?? false`), 10_000, "the rich editor");
  await caretToEnd(".lib-editor-body .ProseMirror");
  await typeText(" Tag the release.");
  await until(() => page.eval(`document.querySelector(".lib-editor-state").textContent.startsWith("Edited")`), 5_000, "the edit to register");
  await shots("editor");
  await press(`button(".lib-reader-bar", "Save")`, "Save");
  await until(() => ask(`button(".lib-reader-bar", "Edit") !== undefined`), 8_000, "the save");
  const deployAfter = read(deploySteps);
  check("the rich editor changed the one paragraph that was typed in, and left the rest byte for byte",
    deployAfter === deployBefore.replace("See [[team]] for who approves.", "See [[team]] for who approves. Tag the release."), js(deployAfter.slice(-70)));
  check("the edit is one new commit", Number(git("rev-list", "--count", "HEAD")) === commitsBefore + 1, git("log", "-1", "--format=%an|%s"));
  check("the commit is the app's, of that file alone", git("log", "-1", "--format=%an") === "Stow" && git("show", "--name-only", "--format=", "HEAD") === "spaces/atlas/deploy-steps.md",
    `${git("log", "-1", "--format=%an")}: ${git("show", "--name-only", "--format=", "HEAD")}`);
  check("no question was asked for a file with history", (await dialog()) === null);
  const apart = await until(async () => {
    const badges = await ask(`({ changed: listRow("deploy-steps", "Realm · Atlas")?.querySelector(".lib-row-copies")?.textContent ?? null, others: listRow("deploy-steps", "Claude · atlas")?.querySelector(".lib-row-copies")?.textContent ?? null })`);
    return badges.changed === null && badges.others !== null ? badges : null;
  }, 8_000, "the changed memory to stand apart from its copies");
  const states = await page.eval(`[...document.querySelectorAll(".lib-copy-state")].map((c) => c.textContent)`);
  check("the changed memory is no longer a copy of the other two, and the reader says they have changed since", apart.others === "2 copies" && js(states) === js(["Has changed since", "Has changed since"]), `${apart.others}; ${states.join(", ")}`);

  // 6. Editing Claude's own file: asked first, then written, with a backup.
  const userInstructions = home(".claude/CLAUDE.md");
  const instructionsBefore = read(userInstructions);
  const backups = path.join(app.scratch, "home", "backups");
  await press(`listRow("CLAUDE", "Claude · User instructions")`, "Claude's user instructions");
  await opened("CLAUDE");
  await press(`button(".lib-reader-bar", "Edit")`, "Edit");
  await press(`segment("Source")`, "Source");
  await until(() => page.eval(`document.querySelector(".lib-editor-body .cm-content")?.textContent.includes("Prefer small commits.") ?? false`), 10_000, "the source editor");
  await press(`document.querySelector(".lib-editor-body .cm-content")`, "the source editor");
  await key("ArrowDown", { meta: true });
  await typeText("Squash before merging.");
  await key("Enter");
  await until(() => page.eval(`document.querySelector(".lib-editor-state").textContent.startsWith("Edited")`), 5_000, "the edit to register");
  await press(`button(".lib-reader-bar", "Save")`, "Save");
  const question = await until(dialog, 8_000, "the question");
  check("a change to Claude's own file asks first, and names the file", question.title === "Change Claude's own file?" && question.text.includes("~/.claude/CLAUDE.md") && question.text.includes("backups"), question.title);
  check("nothing is written before the answer", read(userInstructions) === instructionsBefore && !fs.existsSync(backups));
  await shots("confirm");
  await press(`button(".sheet-foot", "Change the file")`, "Change the file");
  await until(() => ask(`button(".lib-reader-bar", "Edit") !== undefined`), 8_000, "the save");
  check("after the yes, the file holds the change", read(userInstructions) === `${instructionsBefore}Squash before merging.\n`, js(read(userInstructions)));
  const kept = filesUnder(backups, ["CLAUDE.md"]);
  check("and the file as it was is in the app's backups", kept.length === 1 && read(kept[0]) === instructionsBefore && kept[0].endsWith(userInstructions), kept.join(", "));

  // 7. A file Realm manages offers no Edit.
  await press(`navRow("Codex", "Project instructions")`, "Codex's project instructions");
  await press(`listRow("AGENTS", "beacon")`, "beacon's AGENTS.md");
  await until(async () => (await page.eval(`document.querySelector(".lib-path")?.getAttribute("title")`)) === path.join(at.beacon, "AGENTS.md"), 8_000, "beacon's AGENTS.md in the reader");
  const managed = await ask(`({ edit: button(".lib-reader-bar", "Edit") !== undefined, remove: all(".lib-reader-bar button").some((b) => b.textContent.startsWith("Delete")), note: document.querySelector(".lib-reader-note")?.textContent ?? null })`);
  check("a file Realm manages offers no Edit and no Delete, and says why", !managed.edit && !managed.remove && /Realm/.test(managed.note ?? "") && read(path.join(at.beacon, "AGENTS.md")).includes("Managed by Realm"), js(managed));

  // An empty file.
  await press(`navRow("Codex", "Instructions")`, "Codex's instructions");
  await until(async () => (await page.eval(`document.querySelector(".lib-path")?.getAttribute("title")`)) === home(".codex/AGENTS.md"), 8_000, "Codex's AGENTS.md in the reader");
  const empty = await page.eval(`document.querySelector(".lib-reader .empty-state")?.textContent ?? null`);
  check("a file with nothing in it says so, and who still loads it", fs.statSync(home(".codex/AGENTS.md")).size === 0 && empty !== null && empty.startsWith("This file is empty") && /Codex/.test(empty), empty);
  await shots("empty-file");

  // 8. A new memory.
  await press(`navRow(null, "All memories")`, "All memories");
  await press(`button(".lib-list-head", "New memory")`, "New memory");
  await until(async () => (await dialog())?.title === "New memory", 5_000, "the new memory sheet");
  await typeText("Staging URL");
  await press(`all(".lib-new input")[1]`, "the description field");
  await typeText("Where staging lives");
  await page.eval(`(() => { const set = (label, value) => { const select = [...document.querySelectorAll(".lib-new .field")].find((f) => f.querySelector("span").textContent === label).querySelector("select"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, value); select.dispatchEvent(new Event("change", { bubbles: true })); }; set("Folder", "spaces/atlas"); set("Type", "reference"); })()`);
  await press(`document.querySelector(".lib-new textarea")`, "the text field");
  await typeText("https://staging.example");
  await shots("new-memory");
  await press(`button(".sheet-foot", "Save memory")`, "Save memory");
  await opened("Staging URL");
  const made = path.join(at.repo, "spaces/atlas/staging-url.md");
  check("the new memory is a file where the form said, in the form Claude keeps one", fs.existsSync(made) && read(made).startsWith("---\nname: Staging URL\ndescription: Where staging lives\n") && read(made).includes("type: reference") && read(made).includes("https://staging.example"),
    fs.existsSync(made) ? js(read(made)) : "no file");
  check("with its line in the folder's index, as one commit", read(path.join(at.repo, "spaces/atlas/MEMORY.md")).includes("- [Staging URL](staging-url.md) — Where staging lives\n") && git("log", "-1", "--format=%an|%s") === "Stow|Remember Staging URL",
    git("log", "-1", "--format=%an|%s"));
  check("the new memory is the one being read, and is in the list", (await listTitles()).includes("Staging URL") && (await ask(`listRow("Staging URL").getAttribute("aria-selected")`)) === "true");

  // 10. A tag, on the new memory: kept beside the library, never in the file.
  const madeText = read(made);
  await press(`document.querySelector(".lib-tag-field")`, "the tag field");
  await typeText("release");
  await key("Enter");
  await until(async () => (await sidebarRows()).find((list) => list.group === "Tags")?.rows.some((r) => r.name === "release" && r.count === 1) ?? false, 8_000, "the tag in the sidebar");
  check("a tag is listed in the sidebar with its count, and the file is not touched", read(made) === madeText && git("status", "--porcelain") === "", js(await page.eval(`[...document.querySelectorAll(".lib-tag")].map((t) => t.textContent)`)));
  await press(`navRow("Tags", "release")`, "the release tag");
  await until(async () => js(await listTitles()) === js(["Staging URL"]), 8_000, "the tagged file alone");
  check("the tag's row lists the file that wears it", true);

  // 9. Deleting Claude's own file: to the fixture home's Trash.
  const oldFlag = path.join(at.claudeMemory, "old-flag.md");
  const oldFlagText = read(oldFlag);
  await press(`navRow("Claude", "Project memory")`, "Claude's project memory");
  await press(`listRow("old-flag")`, "the old-flag row");
  await opened("old-flag");
  await press(`all(".lib-reader-bar button").find((b) => b.textContent.startsWith("Delete"))`, "Delete");
  const going = await until(dialog, 5_000, "the delete question");
  check("Delete says where the file goes before it goes", going.title === "Delete old-flag.md?" && going.text.includes("moves to the Trash") && going.text.includes(`~/${claudeMemory}/old-flag.md`) && fs.existsSync(oldFlag), going.text);
  await press(`button(".sheet-foot", "Move to Trash")`, "Move to Trash");
  await until(async () => !fs.existsSync(oldFlag), 8_000, "the file to go");
  const trashed = home(".Trash/old-flag.md");
  check("the deleted file is in the fixture home's Trash", fs.existsSync(trashed) && read(trashed) === oldFlagText, trashed);
  // The server takes the line out of the index after the file has gone, so the index is waited for and not read at once.
  const indexLostIt = await until(async () => !read(path.join(at.claudeMemory, "MEMORY.md")).includes("old-flag"), 8_000, "the index to lose the file's line").then(() => true, () => false);
  check("its line left the index beside it, and a backup was kept", indexLostIt && filesUnder(backups, ["old-flag.md"]).length === 1);
  await until(async () => !(await listTitles()).includes("old-flag"), 8_000, "the row to go");
  check("the window says where it went", (await toasts()).includes("old-flag.md is in the Trash."), js(await toasts()));

  // What an agent writes while the app is open is there when the window gets the keyboard back.
  fs.writeFileSync(path.join(at.claudeMemory, "written-by-an-agent.md"), "---\nname: written-by-an-agent\ndescription: Written while the app was open\ntype: project\n---\n\nFound on the way back.\n");
  // The server reuses one listing of the disk for two seconds, and it has just made one.
  await sleep(2_100);
  await page.eval(`void window.dispatchEvent(new Event("focus"))`);
  await until(async () => (await listTitles()).includes("written-by-an-agent"), 8_000, "the file an agent wrote");
  check("a file written outside the app is listed when the window gets the keyboard back", true);

  const hit = await ask(`(() => { const under = (el, dy) => { el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2 + dy)); };
    const row = navRow(null, "All memories"), add = button(".lib-list-head", "New memory"), seg = segment("By project");
    return { row: under(row, 13) && under(row, -13), add: under(add, 13) && under(add, -13), seg: under(seg, 13) && under(seg, -13) }; })()`);
  check("a sidebar row, the New memory button and a segment each take a press 28px tall, a Mac control's height", hit.row && hit.add && hit.seg, js(hit));
  const smallest = await page.eval(`Math.min(...[...document.querySelectorAll("body *")].filter((el) => el.children.length === 0 && el.textContent.trim() !== "" && el.getClientRects().length > 0).map((el) => parseFloat(getComputedStyle(el).fontSize)))`);
  check("nothing on screen is set under 11px", smallest >= 11, `${smallest}px`);
  check("nothing in the fixture repository is left uncommitted", git("status", "--porcelain") === "", git("status", "--porcelain"));

  // 11. The grid.
  const cardTitles = () => page.eval(`[...document.querySelectorAll(".lib-card-title")].map((t) => t.textContent)`);
  const layoutOption = (name) => `all(".lib-layout .seg-opt").find((o) => o.title === ${js(name)})`;
  const sized = (width, height) => page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: false });
  await press(`navRow(null, "All memories")`, "All memories");
  await until(async () => (await listTitles()).includes("Team"), 8_000, "every memory in the list");
  const listed = await listTitles();
  await press(layoutOption("Grid"), "Grid");
  await until(async () => (await cardTitles()).length > 0, 8_000, "the cards");
  check("the grid holds a card for each row the list had, in the list's order", js(await cardTitles()) === js(listed), `${(await cardTitles()).length} cards, ${listed.length} rows`);
  const laidOut = await page.eval(`(() => {
    const box = (el) => el.getBoundingClientRect();
    const cards = [...document.querySelectorAll(".lib-card")];
    const rows = Map.groupBy(cards, (c) => Math.round(box(c).y));
    const scroller = document.querySelector(".lib-cards");
    return {
      columns: Math.max(...[...rows.values()].map((row) => row.length)),
      evenRows: [...rows.values()].every((row) => new Set(row.map((c) => Math.round(box(c).height))).size === 1),
      panel: Math.round(box(document.querySelector(".lib-grid")).width), main: Math.round(box(document.querySelector(".main")).width),
      reader: document.querySelector(".col-reader") !== null,
      radius: getComputedStyle(cards[0]).borderRadius, padding: getComputedStyle(cards[0]).padding,
      inside: cards.every((c) => box(c).x >= box(scroller).x + 16 && box(c).right <= box(scroller).right - 16 + 0.5),
    };
  })()`);
  check("the cards have the whole panel, several to a row, each row of one height", laidOut.columns >= 3 && laidOut.evenRows && laidOut.panel === laidOut.main && !laidOut.reader && laidOut.inside, js(laidOut));
  check("a card has a card's corner and 16px of padding", laidOut.radius === "18px" && laidOut.padding === "16px", `${laidOut.radius}, ${laidOut.padding}`);
  // The head's buttons arrive by growing into place: measured once they have.
  await sleep(400);
  const edges = await page.eval(`(() => { const x = (s) => document.querySelector(s).getBoundingClientRect(); const cards = [...document.querySelectorAll(".lib-card")].map((c) => c.getBoundingClientRect());
    return { title: x(".lib-grid-head .lib-list-title").x - Math.min(...cards.map((c) => c.x)), add: Math.max(...cards.map((c) => c.right)) - x(".lib-grid-head .icon-btn").right }; })()`);
  check("the head's title and its last button stand over the cards' two edges", Math.abs(edges.title) < 0.5 && Math.abs(edges.add) < 0.5, js(edges));
  await shots("grid");
  await sized(900, 600);
  await sleep(200);
  const narrow = await page.eval(`(() => { const cards = [...document.querySelectorAll(".lib-card")]; const head = document.querySelector(".lib-grid-head");
    return { columns: new Set(cards.map((c) => Math.round(c.getBoundingClientRect().x))).size, least: Math.min(...cards.map((c) => Math.round(c.getBoundingClientRect().width))),
      headFits: head.scrollWidth <= head.clientWidth, title: Math.round(document.querySelector(".lib-list-name").getBoundingClientRect().width) }; })()`);
  check("at the window's smallest the grid is two columns and its head still fits", narrow.columns === 2 && narrow.least >= 224 && narrow.headFits && narrow.title > 40, js(narrow));
  await shots("grid-narrow");
  await sized(1680, 1000);
  await shots("grid-wide");
  await sized(900, 600);
  await press(`navRow("Claude", "Claude")`, "Claude");
  await until(async () => { const titles = await cardTitles(); return titles.length > 0 && titles.length < listed.length; }, 8_000, "Claude's cards");
  const claudes = Object.values(onDisk().Claude).flat().length;
  check("the sidebar narrows the grid as it narrows the list", (await cardTitles()).length === claudes, `${(await cardTitles()).length} cards, ${claudes} files of Claude's on disk`);
  await press(`document.querySelector(".lib-grid-head .search-field")`, "the grid's search field");
  await typeText("notarize");
  await until(async () => (await cardTitles()).length < claudes, 8_000, "the cards that hold the word");
  check("the search narrows the grid to the files that hold the word, each with the line that holds it",
    (await cardTitles()).includes("deploy-steps") && (await ask(`all(".lib-card-line").every((line) => line.textContent.toLowerCase().includes("notarize"))`)), js(await cardTitles()));
  await shots("grid-search");
  await page.eval(`(() => { const field = document.querySelector(".lib-grid-head .search-field"); field.select(); })()`);
  await key("Backspace");
  await press(`navRow(null, "All memories")`, "All memories");
  await until(async () => (await cardTitles()).length === listed.length, 8_000, "every card again");

  // A card low in the grid, brought into view the way the press below would bring it.
  await ask(`void all(".lib-card").find((c) => c.querySelector(".lib-card-title").textContent === "Team").scrollIntoView({ block: "nearest" })`);
  const scrolledTo = await page.eval(`document.querySelector(".lib-cards").scrollTop`);
  await press(`all(".lib-card").find((c) => c.querySelector(".lib-card-title").textContent === "Team")`, "the Team card");
  await opened("Team");
  const alone = await page.eval(`(() => { const reader = document.querySelector(".col-reader").getBoundingClientRect(), main = document.querySelector(".main").getBoundingClientRect(), back = document.querySelector(".lib-reader-back .btn").getBoundingClientRect();
    return { whole: Math.round(reader.width) === Math.round(main.width), cards: document.querySelectorAll(".lib-card").length, back: Math.round(back.x - reader.x), glass: getComputedStyle(document.querySelector(".lib-reader-back .btn")).backdropFilter !== "none" }; })()`);
  check("a card's file has the whole panel, with a glass Back at the left of its bar", alone.whole && alone.cards === 0 && alone.back === 12 && alone.glass, js(alone));
  await sized(1280, 820);
  await shots("grid-reading");
  await sized(900, 600);
  await press(`button(".lib-reader-bar", "Back")`, "Back");
  await until(async () => (await cardTitles()).length === listed.length, 8_000, "the cards again");
  const back = await page.eval(`({ top: document.querySelector(".lib-cards").scrollTop, focused: document.activeElement?.querySelector(".lib-card-title")?.textContent ?? null })`);
  check("Back returns to the cards where they were scrolled to, on the card that was opened", scrolledTo > 0 && back.top === scrolledTo && back.focused === "Team", `${back.top} of ${scrolledTo}, on ${back.focused}`);
  await key("Enter");
  await opened("Team");
  await key("Escape");
  await until(async () => (await cardTitles()).length === listed.length, 8_000, "the cards after Escape");
  check("Escape returns to them too", (await page.eval(`document.querySelector(".lib-cards").scrollTop`)) === scrolledTo);
  await page.send("Emulation.clearDeviceMetricsOverride");
  await page.send("Page.reload");
  await until(async () => (await cardTitles()).length === listed.length, 15_000, "the grid after the page is loaded again");
  check("the grid is still chosen when the page is loaded again", (await ask(`${layoutOption("Grid")}.hasAttribute("data-selected")`)) === true);
  await press(layoutOption("List"), "List");
  await until(async () => (await listTitles()).length === listed.length, 8_000, "the list again");
  check("List puts the rows and the reader back", js(await listTitles()) === js(listed) && (await page.eval(`document.querySelector(".col-list") !== null && document.querySelector(".col-reader") !== null && document.querySelectorAll(".lib-card").length === 0`)));

  // A Mac that sleeps or changes network closes the window's socket under it, and the server is
  // still there. The window is loaded again with its sockets kept in reach, one is closed the way
  // the system would close it, and the next file asked for has to arrive all the same.
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { const Real = WebSocket; window.__sockets = []; window.WebSocket = class extends Real { constructor(...args) { super(...args); window.__sockets.push(this); } }; })()` });
  await page.send("Page.reload");
  await until(() => page.eval(`document.querySelectorAll(".lib-row").length > 0 && window.__sockets?.length === 1`), 15_000, "the library again, on one socket");
  await page.eval(`window.__sockets[0].close()`);
  await until(() => page.eval(`window.__sockets[0].readyState === 3`), 5_000, "the socket closed");
  await press(`listRow("Team")`, "the Team row, with no socket");
  await opened("Team");
  check("a file opens after the connection dropped, on a socket dialled for it", (await page.eval(`window.__sockets.length`)) === 2 && (await readerTitle()) === "Team", `${await page.eval(`window.__sockets.length`)} sockets`);
} finally {
  await app.stop();
  fs.rmSync(at.home, { recursive: true, force: true });
}
finish();
