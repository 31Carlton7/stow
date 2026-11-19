import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { hasHugeiconsPro, hugeiconsAlias } from "../../packages/ui/src/hugeicons-pack";

/** The glyphs are the Hugeicons Pro pack's where the registry token installed it, and the free pack's,
 *  under the same names, everywhere else (packages/ui/src/hugeicons.ts). The build says which, because
 *  a token that has lapsed fails nothing: pnpm skips a pack it can no longer fetch. */
if (!hasHugeiconsPro()) console.warn("[hugeicons] the Pro pack is not installed; drawing the free pack");
export default defineConfig({
  main: {},
  preload: {},
  // host 127.0.0.1 so the dev server's HMR socket matches the renderer CSP (connect-src 127.0.0.1 only).
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: { alias: hugeiconsAlias() },
    server: { host: "127.0.0.1" },
    build: { minify: "esbuild" },
  },
});
