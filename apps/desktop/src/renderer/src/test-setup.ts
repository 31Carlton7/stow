import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
afterEach(cleanup);

// jsdom implements Range but not its geometry: `getBoundingClientRect` is simply absent, so an editor
// that measures its selection throws here rather than reading a zero. The zero rect is the honest
// stand-in: jsdom lays nothing out, so there is no rect to report.
// Guarded on `Range` existing at all, not only on the method: this setup file also runs for the
// main-process suites, which declare the `node` environment and have no DOM globals whatsoever.
if ("Range" in globalThis && !Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
  Range.prototype.getClientRects = (() => Object.assign([], { item: () => null })) as unknown as Range["getClientRects"];
}
