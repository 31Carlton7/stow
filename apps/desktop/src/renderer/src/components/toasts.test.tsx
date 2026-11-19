import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { clearToasts, toast, toastStore } from "../toasts";
import { TOAST_EXIT_MS, Toasts } from "./Toasts";

function mount() {
  render(<Toasts />);
  return { stack: () => document.querySelector<HTMLElement>(".toasts")! };
}
/** One step of the clock. The exit's own timer is armed by the render the first one causes, so a toast's
 *  time and its fade are always advanced as two steps. */
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const cards = () => [...document.querySelectorAll<HTMLElement>(".toast")];

/** jsdom lays nothing out, so every toast would measure 0px and nothing would stack or lift. A
 *  one-line toast's height is what they measure here instead. */
const LINE = 42;
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true, get() { return (this as HTMLElement).classList.contains("toast-body") ? LINE : 0; },
  });
});
afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetHeight);
  act(() => { clearToasts(); });
});

describe("a toast", () => {
  it("is an alert at the window's foot when it is an error, its words selectable content", () => {
    mount();
    act(() => { toast({ tone: "error", text: "~/.claude/CLAUDE.md is Claude's own file. Writing it needs your yes first." }); });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("is Claude's own file");
    expect(alert.querySelector("p.toast-text")).not.toBeNull();
  });

  it("lets its words be selected to copy and not its buttons, and a press on the words leaves it and its action alone", () => {
    mount();
    const run = vi.fn();
    act(() => { toast({ tone: "error", text: "~/work/atlas is not a git repository", action: { label: "Undo", run } }); });
    const card = cards()[0]!;
    const words = card.querySelector<HTMLElement>(".toast-text")!;
    // THE MUTANT: the words left as chrome — the window's `user-select: none` takes them, and an
    // error's wording can't be copied.
    expect(words).toHaveAttribute("data-selectable");
    // The opt-in is the words', never the card's: a drag over Undo or Dismiss is still a press.
    for (const b of within(card).getAllByRole("button")) expect(b.closest("[data-selectable]")).toBeNull();
    // A press, a double-click or a drag across the words selects them and does nothing else.
    fireEvent.pointerDown(words); fireEvent.mouseDown(words); fireEvent.mouseUp(words); fireEvent.click(words); fireEvent.doubleClick(words);
    advance(TOAST_EXIT_MS);
    expect(run).not.toHaveBeenCalled();
    expect(card).not.toHaveAttribute("data-leaving");
    expect(toastStore.read()).toHaveLength(1);
  });

  it("is a status for anything that is not an error", () => {
    mount();
    act(() => { toast({ tone: "success", text: "old-flag.md is in the Trash." }); });
    expect(screen.getByRole("status")).toHaveTextContent("old-flag.md is in the Trash.");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("leaves on its own once its time is up", () => {
    // THE mutant: no clock, and a toast is the banner again — up until someone closes it.
    mount();
    act(() => { toast({ text: "Saved", life: 1000 }); });
    advance(990);
    expect(toastStore.read()).toHaveLength(1);
    advance(10);
    expect(cards()[0]).toHaveAttribute("data-leaving"); // fading…
    advance(TOAST_EXIT_MS);
    expect(toastStore.read()).toEqual([]);
    expect(cards()).toHaveLength(0);
  });

  it("waits while the pointer is on the stack, and goes on from where it was when it leaves", () => {
    // THE mutant: a clock that ignores the pointer, which takes the toast away from someone reading it.
    const { stack } = mount();
    act(() => { toast({ text: "Saved", life: 1000 }); });
    advance(500);
    fireEvent.pointerEnter(stack());
    expect(stack()).toHaveAttribute("data-expanded");
    expect(cards()[0]).toHaveAttribute("data-paused"); // …and the line across its foot stops with it
    advance(60_000);
    advance(TOAST_EXIT_MS);
    expect(toastStore.read()).toHaveLength(1);
    expect(cards()[0]).not.toHaveAttribute("data-leaving");
    fireEvent.pointerLeave(stack());
    expect(cards()[0]).not.toHaveAttribute("data-paused");
    advance(1000); advance(TOAST_EXIT_MS);
    expect(toastStore.read()).toEqual([]);
  });

  it("waits while the keyboard is in it", () => {
    mount();
    act(() => { toast({ text: "Saved", life: 1000 }); });
    const close = screen.getByRole("button", { name: "Dismiss" });
    act(() => { close.focus(); });
    advance(10_000);
    advance(TOAST_EXIT_MS);
    expect(toastStore.read()).toHaveLength(1);
    expect(cards()[0]).not.toHaveAttribute("data-leaving");
    act(() => { close.blur(); });
    advance(1000); advance(TOAST_EXIT_MS);
    expect(toastStore.read()).toEqual([]);
  });

  it("waits while the window does not have the keyboard — a notice that came while you were away is still there", () => {
    mount();
    act(() => { window.dispatchEvent(new Event("blur")); });
    act(() => { toast({ text: "Finished", life: 1000 }); });
    advance(10_000);
    advance(TOAST_EXIT_MS);
    expect(toastStore.read()).toHaveLength(1);
    expect(cards()[0]).not.toHaveAttribute("data-leaving");
    act(() => { window.dispatchEvent(new Event("focus")); });
    advance(1000); advance(TOAST_EXIT_MS);
    expect(toastStore.read()).toEqual([]);
  });

  it("is dismissed by its button and by Escape", () => {
    mount();
    act(() => { toast({ text: "one" }); toast({ text: "two" }); });
    fireEvent.click(within(cards()[0]!).getByRole("button", { name: "Dismiss" }));
    advance(TOAST_EXIT_MS);
    expect(toastStore.read().map((t) => t.text)).toEqual(["one"]);
    fireEvent.keyDown(screen.getByRole("button", { name: "Dismiss" }), { key: "Escape" });
    advance(TOAST_EXIT_MS);
    expect(toastStore.read()).toEqual([]);
  });

  it("offers its action as a button beside the words, and goes once it is taken — and only then runs it", () => {
    /* THE mutants: an action drawn and not run, or a toast that stays up offering an Undo already
       done — a second press would undo nothing, or something else. */
    mount();
    const run = vi.fn();
    act(() => { toast({ text: "Removed the tag release.", action: { label: "Undo", run } }); });
    const undo = within(cards()[0]!).getByRole("button", { name: "Undo" });
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(undo);
    expect(run).toHaveBeenCalledTimes(1);
    expect(cards()[0]).toHaveAttribute("data-leaving");
    advance(TOAST_EXIT_MS);
    expect(toastStore.read()).toEqual([]);
    // A toast with nothing to offer draws no such button.
    act(() => { toast({ text: "Saved" }); });
    expect(within(cards()[0]!).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual(["Dismiss"]);
  });

  it("hands the keyboard to the next toast when one is dismissed by it", () => {
    mount();
    act(() => { toast({ text: "one" }); toast({ text: "two" }); });
    const [front, behind] = cards();
    const close = within(front!).getByRole("button", { name: "Dismiss" });
    act(() => { close.focus(); });
    fireEvent.keyDown(close, { key: "Escape" });
    expect(document.activeElement).toBe(within(behind!).getByRole("button", { name: "Dismiss" }));
  });
});

describe("the stack", () => {
  it("puts the newest in front and tucks the others behind it, fanning them out under the pointer", () => {
    const { stack } = mount();
    act(() => { for (const text of ["one", "two", "three"]) toast({ text }); });
    const [front, second, third] = cards();
    expect(front).toHaveTextContent("three");
    expect(front).toHaveAttribute("data-front");
    expect(second).not.toHaveAttribute("data-front");
    // Collapsed: a peek apart, a step smaller each.
    expect([front, second, third].map((c) => c!.style.getPropertyValue("--toast-y"))).toEqual(["0px", "-10px", "-20px"]);
    expect(Number(third!.style.getPropertyValue("--toast-scale"))).toBeLessThan(Number(second!.style.getPropertyValue("--toast-scale")));
    expect(Number(front!.style.zIndex)).toBeGreaterThan(Number(third!.style.zIndex));
    fireEvent.pointerEnter(stack());
    // Fanned out: whole, and each standing on the one in front of it, a gap apart.
    expect([front, second, third].map((c) => c!.style.getPropertyValue("--toast-y"))).toEqual(["0px", `-${LINE + 8}px`, `-${2 * (LINE + 8)}px`]);
    expect(parseFloat(stack().style.height)).toBe(3 * LINE + 2 * 8); // the whole fan is one target
    expect(third!.style.getPropertyValue("--toast-scale")).toBe("1");
  });
});
