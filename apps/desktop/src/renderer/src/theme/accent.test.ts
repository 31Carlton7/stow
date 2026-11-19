import { describe, expect, it } from "vitest";
import { ACCENTS, accentColour, accentLabel } from "./accent";

describe("the accent's one colour", () => {
  it("is the Mac's own until another is chosen", () => {
    expect(accentColour("system", "#30D158")).toBe("#30d158");
    // A Mac that would not say (or a page with no bridge) gets the Mac's blue.
    expect(accentColour("system", "")).toBe("#007aff");
  });

  it("is one of the Mac's eight by its name", () => {
    expect(ACCENTS.map((a) => a.id)).toEqual(["blue", "purple", "pink", "red", "orange", "yellow", "green", "graphite"]);
    expect(accentColour("green", "#007aff")).toBe("#34c759");
  });

  it("is the person's own colour as they gave it", () => {
    expect(accentColour("#7B3FE4", "#007aff")).toBe("#7b3fe4");
  });

  it("falls back to the Mac's for a choice it does not know", () => {
    // THE MUTANT: a kept file's string handed to the stylesheet as it is.
    expect(accentColour("teal", "#ff9500")).toBe("#ff9500");
    expect(accentColour("red; background: url(x)", "#ff9500")).toBe("#ff9500");
  });

  it("names the choice", () => {
    expect(accentLabel("system")).toBe("Matches the Mac");
    expect(accentLabel("graphite")).toBe("Graphite");
    expect(accentLabel("#7B3FE4")).toBe("Your own, #7b3fe4");
  });
});
