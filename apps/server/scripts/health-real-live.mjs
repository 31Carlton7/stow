/**
 * The Health numbers of the person's own home (run with: pnpm build && node apps/server/scripts/health-real-live.mjs)
 *
 * Read-only: the built server reads the real home and keeps its index in a scratch folder. It
 * prints counts and sizes only, never a file's name, a title or any text.
 */
import { startLiveServer } from "./lib/live-server.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const server = await startLiveServer({ name: "health-real" });
try {
  const started = Date.now();
  for (let index = await server.result("sessions.status"); index.state === "listing" || index.files === 0; index = await server.result("sessions.status")) await sleep(500);
  console.log(`transcripts listed after ${((Date.now() - started) / 1000).toFixed(1)} s`);
  for (let pass = await server.result("health.status"); pass.state !== "idle"; pass = await server.result("health.status")) {
    if (pass.state === "paused") { console.log(`reading paused: ${pass.pausedWhy} (${pass.read} of ${pass.sessions} read)`); break; }
    await sleep(500);
  }
  console.log(`recent sessions read after ${((Date.now() - started) / 1000).toFixed(1)} s`);
  const asked = Date.now();
  const summary = await server.result("health.summary");
  console.log(`the page's numbers took ${((Date.now() - asked) / 1000).toFixed(1)} s`);
  console.log(JSON.stringify({
    pass: summary.pass,
    carried: summary.carried,
    contributors: summary.contributors.map(({ agent, kind, chars, sessions }) => ({ agent, kind, chars, sessions })),
    reach: { ...summary.reach, widest: summary.reach.widest.map(({ type, sessions }) => ({ type, sessions })) },
    fixes: summary.fixes,
    storage: summary.storage,
  }, null, 1));
} finally {
  await server.stop();
}
