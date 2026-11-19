/**
 * Lays out apps/desktop/.pack-stage/, which electron-builder copies into Contents/Resources: the
 * server's bundle with the packages it imports at run time (ws and zod; tsup leaves them outside the
 * bundle). Run by `pnpm dist` after the build.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(desktop, "..", "..");
const stage = join(desktop, ".pack-stage");
const staged = join(stage, "server");

if (!existsSync(join(root, "apps/server/dist/main.js"))) {
  console.error("[stage-pack] apps/server/dist/main.js is missing: run `pnpm build` first, or `pnpm dist` at the root");
  process.exit(1);
}

rmSync(stage, { recursive: true, force: true });
// `--legacy` because this workspace does not inject its dependencies.
execFileSync("pnpm", ["--filter", "@amc/server", "deploy", "--legacy", "--prod", staged], { cwd: root, stdio: "inherit" });

// The deploy leaves a link from the server's packages back to apps/server. Copied into the app it
// points at nothing, and codesign refuses a bundle with a dangling link.
rmSync(join(staged, "node_modules/.pnpm/node_modules/@amc/server"), { force: true });
// The deploy copies the whole package; the app runs dist/ against node_modules/ and reads package.json.
for (const name of readdirSync(staged)) {
  if (!["dist", "node_modules", "package.json"].includes(name)) rmSync(join(staged, name), { recursive: true, force: true });
}
for (const name of readdirSync(join(staged, "dist"))) {
  if (name.endsWith(".map")) rmSync(join(staged, "dist", name));
}
console.log(`[stage-pack] staged ${staged}`);
