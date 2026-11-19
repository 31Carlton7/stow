import { describe, expect, it } from "vitest";
import { fieldOf, firstProse, readFrontmatter } from "./frontmatter";

describe("readFrontmatter", () => {
  it("reads both layouts Claude has written a fact's type in", () => {
    const nested = readFrontmatter("---\nname: deploy-steps\ndescription: \"How it ships: sign, then notarize\"\nmetadata:\n  type: project\n  originSessionId: abc\n---\n\nBody\n");
    expect(fieldOf(nested.fields, "type", "metadata.type")).toBe("project");
    expect(fieldOf(nested.fields, "description")).toBe("How it ships: sign, then notarize");
    expect(nested.body).toBe("Body\n");
    const flat = readFrontmatter("---\nname: deploy-steps\ntype: feedback\noriginSessionId: abc\n---\nBody\n");
    expect(fieldOf(flat.fields, "type", "metadata.type")).toBe("feedback");
    expect(fieldOf(flat.fields, "originSessionId", "metadata.originSessionId")).toBe("abc");
  });

  it("leaves a file with no block, or one never closed, whole", () => {
    expect(readFrontmatter("# Title\n")).toEqual({ fields: [], body: "# Title\n" });
    expect(readFrontmatter("---\nname: x\n# Title\n")).toEqual({ fields: [], body: "---\nname: x\n# Title\n" });
  });
});

describe("firstProse", () => {
  it("is the first line that is not a heading, a rule, a comment or inside a fence", () => {
    expect(firstProse("# Title\n\n<!-- note -->\n---\n```\ncode\n```\n- See [the doc](x.md) and [[team]] for **why**\n")).toBe("See the doc and team for why");
    expect(firstProse("# Only a heading\n")).toBeNull();
  });
});
