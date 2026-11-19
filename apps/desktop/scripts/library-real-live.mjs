/**
 * Read-only check of the library against the person's own home
 * (run with: pnpm build && node apps/desktop/scripts/library-real-live.mjs)
 *
 * Boots the BUILT app on a scratch data folder with no fixture, so it reads the real home, and
 * prints what the sidebar counts for each agent and kind of file, to hold against an inventory
 * taken by hand.
 *
 * It reads the page and presses nothing: no Edit, no Delete, no New memory, no tag. It prints
 * counts and never a file's name or text, and it saves no picture, because the library on screen
 * holds personal notes.
 */
import { launchLiveApp, until } from "./lib/live-app.mjs";

const app = await launchLiveApp({ name: "library-real" });
try {
  const started = Date.now();
  await until(() => app.page.eval(`document.querySelectorAll(".lib-nav-row").length > 0 || document.querySelector(".col-list .empty-state:not(.is-late)") !== null`), 120_000, "the library");
  const failed = await app.page.eval(`document.querySelector(".col-list .empty-state .empty-state-title")?.textContent ?? null`);
  if (failed === "The library could not be read") throw new Error(await app.page.eval(`document.querySelector(".col-list .empty-state").textContent`));
  const lists = await app.page.eval(`[...document.querySelectorAll(".lib-nav-list")].map((list) => ({ group: list.getAttribute("aria-label"), rows: [...list.querySelectorAll(".lib-nav-row")].map((r) => ({ name: r.querySelector(".lib-nav-name").textContent, count: Number(r.querySelector(".lib-nav-count").textContent), nested: r.hasAttribute("data-nested") })) }))`);
  console.log(`The real home (listed in ${((Date.now() - started) / 1000).toFixed(1)}s)\n`);
  let files = 0;
  for (const list of lists) {
    if (list.group === "Tags") { console.log(`${list.rows.length} tags`); continue; }
    for (const row of list.rows) {
      if (row.nested) { console.log(`    ${row.name.padEnd(24)}${String(row.count).padStart(6)}`); continue; }
      console.log(`${row.name.padEnd(28)}${String(row.count).padStart(6)}`);
      if (list.group !== null) files += row.count;
    }
  }
  console.log(`\n${files} files in all, counted by agent. "All memories" counts each memory once, however many files hold its text.`);
} finally {
  await app.stop();
}
