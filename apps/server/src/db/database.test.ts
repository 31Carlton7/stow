import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@amc/test-utils";
import { openDatabase, schemaVersion } from "./database";
import { migrations } from "./migrations";

describe("openDatabase", () => {
  it("applies every migration once, and opening again applies none", () => {
    const path = join(tempDir("amc-db-"), "index.db");
    const first = openDatabase(path);
    expect(schemaVersion(first)).toBe(migrations.length);
    first.close();
    const again = openDatabase(path);
    expect(schemaVersion(again)).toBe(migrations.length);
    expect((again.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe("wal");
    again.close();
  });
});
