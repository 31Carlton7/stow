import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AboutPage } from "../settings/AboutPage";
import { Intro } from "./Intro";
import { useIntro } from "./use-intro";

const rpc = { call: async () => ({ version: "0.1.0", home: "/data", sourceHome: "/Users/sam", schemaVersion: 6 }) } as unknown as Parameters<typeof AboutPage>[0]["rpc"];

/** What main keeps: whether the welcome has been opened, as one launch after another reads it. */
function keptByMain() {
  let opened = false;
  return { launch: () => ({ firstLaunch: !opened, seen: vi.fn(async () => { opened = true; }) }) };
}

/** The window as the app wires it: the welcome over a page that can ask for it again. */
function Window({ kept }: { kept?: ReturnType<ReturnType<typeof keptByMain>["launch"]> }) {
  const intro = useIntro(kept);
  return (
    <>
      <AboutPage rpc={rpc} onShowWelcome={intro.showAgain} />
      {intro.phase !== "gone" && <Intro intro={intro} />}
    </>
  );
}
const welcome = () => screen.queryByRole("dialog", { name: "Welcome to Stow" });
/** The end of the welcome's lift, which jsdom does not animate. */
const lift = () => fireEvent.animationEnd(welcome()!);

afterEach(() => { vi.unstubAllGlobals(); });

describe("the welcome", () => {
  it("shows on a first launch and not on the one after it was opened", () => {
    const main = keptByMain();
    const first = render(<Window kept={main.launch()} />);
    expect(welcome()).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "hello" })).toBeInTheDocument();
    expect(screen.getByText("Everything your agents know, in one place.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Stow" }));
    first.unmount();

    render(<Window kept={main.launch()} />);
    expect(welcome()).not.toBeInTheDocument();
  });

  it("shows again at the next launch when it was never opened", () => {
    const main = keptByMain();
    render(<Window kept={main.launch()} />).unmount();
    render(<Window kept={main.launch()} />);
    expect(welcome()).toBeInTheDocument();
  });

  it("is not there when the window has nothing kept to ask", () => {
    render(<Window />);
    expect(welcome()).not.toBeInTheDocument();
  });

  it.each([
    ["the button", () => fireEvent.click(screen.getByRole("button", { name: "Open Stow" }))],
    ["Return", () => fireEvent.keyDown(window, { key: "Enter" })],
    ["Escape", () => fireEvent.keyDown(window, { key: "Escape" })],
  ])("opens the app on %s, once it has lifted away", (_how, press) => {
    const kept = keptByMain().launch();
    render(<Window kept={kept} />);
    press();
    expect(kept.seen).toHaveBeenCalled();
    expect(welcome()).toHaveAttribute("data-leaving");
    lift();
    expect(welcome()).not.toBeInTheDocument();
  });

  it("ends the writing on a press anywhere, and stays up", () => {
    const kept = keptByMain().launch();
    render(<Window kept={kept} />);
    expect(welcome()).not.toHaveAttribute("data-written");
    fireEvent.pointerDown(welcome()!);
    expect(welcome()).toHaveAttribute("data-written");
    expect(kept.seen).not.toHaveBeenCalled();
  });

  it("is gone at once when motion is reduced: nothing lifts", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("prefers-reduced-motion") }));
    render(<Window kept={keptByMain().launch()} />);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(welcome()).not.toBeInTheDocument();
  });

  it("is shown again from About", () => {
    const main = keptByMain();
    void main.launch().seen();
    render(<Window kept={main.launch()} />);
    expect(welcome()).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show the welcome again" }));
    expect(welcome()).toBeInTheDocument();
  });
});
