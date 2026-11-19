import { describe, expect, it } from "vitest";
import { wikiLinkFor, wikiLinkTarget, withIndexLink, withoutIndexLink } from "./memory-index";

describe("cross-links", () => {
  it("resolves [[path]] from the repo root, adding .md only where there is no extension", () => {
    expect(wikiLinkTarget("[[projects/payments]]")).toBe("projects/payments.md");
    // THE MUTANT: always append `.md`, and a `.sql` link then points at a file that is not there.
    expect(wikiLinkTarget("[[metrics/autocomplete_keep_rate.sql]]")).toBe("metrics/autocomplete_keep_rate.sql");
    expect(wikiLinkTarget("team_structure")).toBe("team_structure.md");
    expect(wikiLinkTarget("[[]]")).toBeNull();
    expect(wikiLinkFor("projects/payments.md")).toBe("[[projects/payments]]");
    expect(wikiLinkFor("metrics/x.sql")).toBe("[[metrics/x.sql]]");
  });

  it("adds an index link under ## Index once", () => {
    const once = withIndexLink("# Memory\n\n- a fact\n\n## Index\n- [[team]]\n", "projects/payments.md");
    expect(once).toBe("# Memory\n\n- a fact\n\n## Index\n- [[team]]\n- [[projects/payments]]\n");
    expect(withIndexLink(once, "projects/payments.md")).toBe(once);
    expect(withIndexLink("# Memory\n", "a.md")).toBe("# Memory\n\n## Index\n- [[a]]\n");
  });

  it("drops the index line that links a file, and only that one", () => {
    const index = "# Memory\n\n- a fact about [[team]]\n\n## Index\n- [[team]]\n- [[projects/payments]] — how we bill\n- [[projects/payments-old]]\n";
    // THE MUTANT: drop every line that mentions the link, and the fact above the index goes with it.
    expect(withoutIndexLink(index, "team.md")).toBe("# Memory\n\n- a fact about [[team]]\n\n## Index\n- [[projects/payments]] — how we bill\n- [[projects/payments-old]]\n");
    expect(withoutIndexLink(index, "projects/payments.md")).toBe("# Memory\n\n- a fact about [[team]]\n\n## Index\n- [[team]]\n- [[projects/payments-old]]\n");
    expect(withoutIndexLink(index, "nowhere.md")).toBe(index);
  });
});
