import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { AppearanceChoice } from "../theme/accent";
import { applyKeptAccent, useAppearance } from "../theme/useTheme";
import { AppearancePage } from "./AppearancePage";

/** The preload bridge in memory: what was kept, what is chosen, and the Mac changing its accent. */
function fakeBridge(choice: AppearanceChoice = { appearance: "system", accent: "system" }, systemAccent = "#ff9500") {
  const chosen: AppearanceChoice[] = [];
  let heard: ((colour: string) => void) | null = null;
  window.amc = {
    port: 0, token: "", reveal: vi.fn(async () => {}), dragOut: vi.fn(), share: vi.fn(async () => {}),
    appearance: { choice, systemAccent },
    chooseAppearance: async (next) => { chosen.push(next); },
    onSystemAccent: (listener) => { heard = listener; return () => { heard = null; }; },
  };
  return { chosen, macChangesAccentTo: (colour: string) => act(() => heard!(colour)) };
}

function Page() {
  return <AppearancePage appearance={useAppearance()} />;
}
const painted = () => document.documentElement.style.getPropertyValue("--accent-base");
const accent = (name: string) => within(screen.getByRole("radiogroup", { name: "Accent colour" })).getByRole("radio", { name }) as HTMLInputElement;

afterEach(() => {
  delete window.amc;
  document.documentElement.style.removeProperty("--accent-base");
});

describe("Appearance", () => {
  it("starts on the Mac's own accent and follows it when it changes", () => {
    const bridge = fakeBridge();
    render(<Page />);
    expect(accent("Match the Mac").checked).toBe(true);
    expect(painted()).toBe("#ff9500");
    expect(screen.getByRole("status")).toHaveTextContent("Matches the Mac");
    bridge.macChangesAccentTo("#34c759");
    expect(painted()).toBe("#34c759");
  });

  it("paints one of the Mac's eight at once, keeps it, and no longer follows the Mac", () => {
    const bridge = fakeBridge();
    render(<Page />);
    fireEvent.click(accent("Green"));
    expect(painted()).toBe("#34c759");
    expect(bridge.chosen).toEqual([{ appearance: "system", accent: "green" }]);
    expect(accent("Green").checked).toBe(true);
    // THE MUTANT: the Mac's colour painted over the one chosen.
    bridge.macChangesAccentTo("#af52de");
    expect(painted()).toBe("#34c759");
  });

  it("takes any colour of the person's own from the well", () => {
    const bridge = fakeBridge();
    render(<Page />);
    fireEvent.change(screen.getByLabelText("A colour of your own"), { target: { value: "#7b3fe4" } });
    expect(painted()).toBe("#7b3fe4");
    expect(bridge.chosen).toEqual([{ appearance: "system", accent: "#7b3fe4" }]);
    expect(screen.getByRole("status")).toHaveTextContent("Your own, #7b3fe4");
    expect(accent("Match the Mac").checked).toBe(false);
  });

  it("chooses light or dark and leaves the accent as it was", () => {
    const bridge = fakeBridge({ appearance: "system", accent: "pink" });
    render(<Page />);
    expect((screen.getByRole("radio", { name: "Match the Mac", checked: true }) as HTMLInputElement).name).toBe("appearance");
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(bridge.chosen).toEqual([{ appearance: "dark", accent: "pink" }]);
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
  });

  it("wears the kept choice before anything is rendered", () => {
    fakeBridge({ appearance: "dark", accent: "red" });
    applyKeptAccent();
    expect(painted()).toBe("#ff3b30");
  });
});
