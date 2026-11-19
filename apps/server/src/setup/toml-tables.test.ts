import { describe, expect, it } from "vitest";
import { readTomlTables } from "./toml-tables";

const CONFIG = `
model = "example"            # a comment
approval_policy = 'on-request'

[mcp_servers.notes]
command = "npx"
args = [
  "-y",
  "@example/notes-mcp",   # trailing comma follows
]
env = { NOTES_TOKEN = "s3cret", NOTES_DIR = "/Users/me/notes" }
enabled = false
startup_timeout_sec = 20

[mcp_servers."Figma Desktop"]
url = "http://127.0.0.1:3845/mcp"

[mcp_servers.search.env]
SEARCH_KEY = "k"

[projects."/Users/me/work/atlas"]
trust_level = "trusted"

[[hooks.Stop]]
command = "say \\"done\\""
`;

describe("readTomlTables", () => {
  const tables = readTomlTables(CONFIG);
  const table = (...path: string[]) => tables.find((t) => t.path.join("\n") === path.join("\n"))?.values;

  it("reads the keys before any header as the top table", () => {
    expect(table()).toEqual({ model: "example", approval_policy: "on-request" });
  });

  it("reads strings, arrays over several lines, inline tables, booleans and numbers", () => {
    expect(table("mcp_servers", "notes")).toEqual({
      command: "npx", args: ["-y", "@example/notes-mcp"],
      env: { NOTES_TOKEN: "s3cret", NOTES_DIR: "/Users/me/notes" }, enabled: false, startup_timeout_sec: 20,
    });
  });

  it("keeps a quoted header part whole, dots, slashes and spaces included", () => {
    expect(table("mcp_servers", "Figma Desktop")).toEqual({ url: "http://127.0.0.1:3845/mcp" });
    expect(table("projects", "/Users/me/work/atlas")).toEqual({ trust_level: "trusted" });
    expect(table("mcp_servers", "search", "env")).toEqual({ SEARCH_KEY: "k" });
  });

  it("reads an array of tables' entry and a string's escapes", () => {
    expect(table("hooks", "Stop")).toEqual({ command: 'say "done"' });
  });

  it("says where it stopped on text it cannot read", () => {
    expect(() => readTomlTables('a = "unterminated')).toThrowError(/unterminated string/);
    expect(() => readTomlTables("[broken")).toThrowError(/unterminated table header/);
  });
});
