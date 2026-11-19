import { describe, expect, it } from "vitest";
import { secretShapeIn } from "./secret-shapes";

// Built at run time so no line of this file is itself a token shape.
const filler = (n: number, ch = "a"): string => ch.repeat(n);

describe("secretShapeIn", () => {
  it.each([
    [`sk-${filler(24)}`, "an API key"],
    [`sk-ant-api03-${filler(30)}`, "an API key"],
    [`ghp_${filler(36)}`, "a GitHub token"],
    [`github_pat_${filler(40)}`, "a GitHub token"],
    [`xoxb-${filler(12, "1")}`, "a Slack token"],
    [`AKIA${filler(16, "A")}`, "an AWS access key"],
    [`-----BEGIN OPENSSH PRIVATE KEY-----`, "a private key"],
    [`AIza${filler(35)}`, "a Google API key"],
    [`eyJ${filler(12)}.${filler(12)}.${filler(12)}`, "a JSON web token"],
  ])("names the shape in %s", (token, what) => {
    expect(secretShapeIn(`export KEY=${token}\n`)).toBe(what);
  });

  it("passes prose that only talks about keys", () => {
    expect(secretShapeIn("Keep the API key in the keychain, never in sk- prefixed plain text.")).toBeNull();
    expect(secretShapeIn("ghp_short and AKIA alone are not tokens")).toBeNull();
    expect(secretShapeIn("")).toBeNull();
  });
});
