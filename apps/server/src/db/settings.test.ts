import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tempDir } from "@amc/test-utils";
import { z } from "zod";
import { openDatabase } from "./database";
import { readSetting, writeSetting } from "./settings";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("settings", () => {
  it("answer with the fallback until written, then with what was written, across a reopen", () => {
    const dir = tempDir("amc-settings-");
    dirs.push(dir);
    const path = join(dir, "index.db");
    const db = openDatabase(path);
    expect(readSetting(db, "models.dailyCapUsd", z.number(), 1)).toBe(1);
    writeSetting(db, "models.dailyCapUsd", 2.5);
    writeSetting(db, "models.dailyCapUsd", 0.25);
    writeSetting(db, "models.claude.allowed", true);
    db.close();
    const again = openDatabase(path);
    expect(readSetting(again, "models.dailyCapUsd", z.number(), 1)).toBe(0.25);
    expect(readSetting(again, "models.claude.allowed", z.boolean(), false)).toBe(true);
    again.close();
  });

  it("fall back when what is stored no longer fits", () => {
    const dir = tempDir("amc-settings-");
    dirs.push(dir);
    const db = openDatabase(join(dir, "index.db"));
    writeSetting(db, "models.dailyCapUsd", "a lot");
    expect(readSetting(db, "models.dailyCapUsd", z.number(), 1)).toBe(1);
    db.prepare("UPDATE settings SET value_json = '{' WHERE key = 'models.dailyCapUsd'").run();
    expect(readSetting(db, "models.dailyCapUsd", z.number(), 1)).toBe(1);
    db.close();
  });
});
