import { describe, expect, it } from "vitest";
import { parseCutJson } from "./cut-json";

describe("the start of a JSON text that was cut", () => {
  it("reads a whole text as JSON.parse does", () => {
    const whole = { type: "user", n: -1.5e3, ok: true, none: null, list: [1, "two", { three: 3 }], text: 'a "quoted" \\ line\nbreak' };
    expect(parseCutJson(JSON.stringify(whole))).toEqual(whole);
  });

  it("keeps what there is of a string that was cut, and closes what was open", () => {
    expect(parseCutJson('{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Ship the rel'))
      .toEqual({ type: "user", message: { role: "user", content: [{ type: "text", text: "Ship the rel" }] } });
  });

  it("drops a key whose value never arrived and a number that may have lost digits", () => {
    expect(parseCutJson('{"a":1,"b":')).toEqual({ a: 1 });
    expect(parseCutJson('{"a":1,"b":12')).toEqual({ a: 1 });
    expect(parseCutJson('{"a":1,"b')).toEqual({ a: 1 });
  });

  it("drops an escape the cut landed inside", () => {
    expect(parseCutJson('{"text":"line\\nnext\\')).toEqual({ text: "line\nnext" });
    expect(parseCutJson('{"text":"caf\\u00e9 and \\u00')).toEqual({ text: "café and " });
  });

  it("does not take an escaped quote for the string's end", () => {
    expect(parseCutJson('{"text":"she said \\"go\\" and le')).toEqual({ text: 'she said "go" and le' });
  });

  it("answers null for no text at all", () => {
    expect(parseCutJson("")).toBeNull();
  });
});
