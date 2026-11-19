import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("is a glyph, a title, one line and its actions, in that order", () => {
    const { container } = render(
      <EmptyState icon="clock" title="Nothing to review" actions={<button type="button" className="btn primary">Scan now</button>}>
        A scan lists what could be cleaned up.
      </EmptyState>,
    );
    const root = container.firstElementChild!;
    expect([...root.children].map((c) => c.getAttribute("class"))).toEqual([
      expect.stringContaining("empty-state-mark"), "empty-state-title", "empty-state-line", "empty-state-actions",
    ]);
    expect(screen.getByRole("heading", { level: 2, name: "Nothing to review" })).toBeInTheDocument();
  });

  it("draws nothing it was not given", () => {
    const { container } = render(<EmptyState role="status">Reading the files…</EmptyState>);
    expect(container.querySelectorAll(".empty-state > *")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Reading the files…");
  });
});
