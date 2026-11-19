import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { hugeiconsAlias } from "../../packages/ui/src/hugeicons-pack";
export default defineConfig({
  plugins: [react()],
  resolve: { alias: hugeiconsAlias() },
  test: { name: "desktop", environment: "jsdom", include: ["src/renderer/**/*.test.{ts,tsx}", "src/main/**/*.test.ts"], setupFiles: ["src/renderer/src/test-setup.ts"] },
});
