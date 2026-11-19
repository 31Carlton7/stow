import { describe, expect, it } from "vitest";
import { maskArgs, maskCommandLine, maskUrl } from "./mask";

describe("masking what a config file may show", () => {
  it("keeps an ordinary command line whole", () => {
    expect(maskArgs(["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/notes"])).toEqual(["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/notes"]);
  });

  it("masks the value after a flag that names a credential, and a name=value that does", () => {
    expect(maskArgs(["--api-key", "hunter2", "--port", "8080"])).toEqual(["--api-key", "••••", "--port", "8080"]);
    expect(maskArgs(["TOKEN=hunter2", "MODE=fast"])).toEqual(["TOKEN=••••", "MODE=fast"]);
    // A flag that takes no value is followed by another flag, which stays.
    expect(maskArgs(["--auth", "--verbose"])).toEqual(["--auth", "--verbose"]);
  });

  it("masks a value shaped like a token wherever it stands", () => {
    expect(maskArgs(["run", "sk-abcdefghijklmnopqrstuvwxyz012345"])).toEqual(["run", "••••"]);
    expect(maskArgs(["9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a"])).toEqual(["••••"]);
  });

  it("keeps a URL's address and loses its password and query values", () => {
    expect(maskUrl("https://user:pw@mcp.example.com/sse?api_key=abc&v=2")).toBe("https://user:••••@mcp.example.com/sse?api_key=••••&v=••••");
    expect(maskUrl("https://mcp.example.com/mcp")).toBe("https://mcp.example.com/mcp");
    expect(maskUrl("not a url")).toBe("not a url");
  });

  it("masks a hook's one-line command word by word, spacing kept", () => {
    expect(maskCommandLine("curl  -H 'x' --token abc123 https://hooks.example.com/run?key=zzz")).toBe("curl  -H 'x' --token •••• https://hooks.example.com/run?key=••••");
  });
});
