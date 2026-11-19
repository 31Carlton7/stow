import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

/** The release this server ships in: the desktop app's version. */
const appVersion = (JSON.parse(readFileSync(new URL("../desktop/package.json", import.meta.url), "utf8")) as { version: string }).version;

export default defineConfig({
  entry: ["src/main.ts"], format: ["esm"], target: "node22", platform: "node",
  outDir: "dist", clean: true, sourcemap: true, noExternal: ["@amc/contracts"],
  // node:sqlite has no unprefixed alias; keep the node: protocol on builtin imports.
  removeNodeProtocol: false,
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
});
