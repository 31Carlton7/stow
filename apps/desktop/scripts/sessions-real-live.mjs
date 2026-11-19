/**
 * Numbers from the REAL home's sessions (run with: pnpm build && node apps/desktop/scripts/sessions-real-live.mjs)
 *
 * Boots the BUILT app on a scratch data folder, reading the person's own home, and prints how many
 * sessions the index found and how long the window waited for them. Read-only: it presses nothing
 * that writes, opens no session, prints no title, folder or project name, and saves no picture.
 */
import { launchLiveApp, until, windowTools } from "./lib/live-app.mjs";

const app = await launchLiveApp({ name: "sessions-real", timeoutMs: 60_000 });
const { page } = app;
const { click, texts } = windowTools(app, "");
const count = (label) => Number((label.match(/([\d,]+)$/)?.[1] ?? "0").replaceAll(",", ""));
try {
  await until(() => page.eval(`document.querySelector(".dest") !== null`), 30_000, "the sidebar");
  const started = Date.now();
  await click(".dest .lib-nav-row", "Sessions");
  await until(() => page.eval(`document.querySelectorAll(".col-list .lib-row").length > 0`), 180_000, "the first sessions in the list");
  console.log(`the list had rows ${((Date.now() - started) / 1000).toFixed(1)} s after the section was opened`);
  await until(async () => !(await texts(".ses-status")).join().startsWith("Listing"), 180_000, "the first look to finish");
  console.log(`the first look at every file was over ${((Date.now() - started) / 1000).toFixed(1)} s after the section was opened`);
  const nav = await page.eval(`[...document.querySelectorAll('nav[aria-label="Sessions"] .lib-nav-list')].map((list) => [...list.querySelectorAll(".lib-nav-row")].map((row) => row.textContent))`);
  const [top = [], agents = [], projects = []] = nav;
  console.log(`conversations a person had: ${count(top[0] ?? "")}`);
  for (const row of agents) console.log(`  ${row.replace(/[\d,]+$/, "")}: ${count(row)}`);
  console.log(`projects with a conversation: ${projects.length}`);
  for (const row of await texts(".ses-show")) console.log(`${row.replace(/[\d,]+$/, "")}: ${count(row)}`);
  console.log(`rows drawn: ${await page.eval(`document.querySelectorAll(".col-list .lib-row").length`)}`);
  console.log(`index: ${(await texts(".ses-status")).join() || "idle"}`);
} finally {
  await app.stop();
}
