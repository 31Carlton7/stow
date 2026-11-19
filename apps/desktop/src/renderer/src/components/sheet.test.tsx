import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Sheet } from "./Sheet";

describe("Sheet", () => {
  it("is centred by its backdrop: only the width is inline", () => {
    render(<Sheet title="Plain" onClose={() => {}} width={420}>x</Sheet>);
    const panel = screen.getByRole("dialog");
    expect(panel.style.width).toBe("420px");
    expect(panel.style.position).toBe("");
  });
});

/** jsdom has no layout, so the geometry is unobservable here; what IS observable, and what the
 *  geometry depends on entirely, is that the backdrop is not a descendant of the column that opened
 *  it. Drop the `createPortal` in Sheet.tsx and both of these fail. */
describe("Sheet escapes its opener's containment", () => {
  it("MUTANT: the backdrop mounts on document.body, not inside the pane that rendered it", () => {
    const { container } = render(
      <div className="panel">
        <div className="page">
          <Sheet title="New memory" onClose={() => {}} width={560}>x</Sheet>
        </div>
      </div>);
    const backdrop = document.querySelector(".sheet-backdrop")!;
    expect(backdrop).not.toBeNull();
    expect(backdrop.parentElement).toBe(document.body);
    expect(container.querySelector(".sheet-backdrop")).toBeNull();
    expect(container.querySelector(".page")!.contains(backdrop)).toBe(false);
  });

  it("the panel still rides inside that portalled backdrop", () => {
    render(
      <div className="panel">
        <Sheet title="Nested" onClose={() => {}} width={420}>x</Sheet>
      </div>);
    const panel = screen.getByRole("dialog");
    expect(panel.closest(".sheet-backdrop")).not.toBeNull();
    expect(panel.closest(".panel")).toBeNull(); // the whole point: no containment ancestor above it
  });
});

/** A popover a control in the panel opens is portalled to the body, outside the panel, and answers
 *  its own Escape. Both listen on window and the sheet was registered first, so the key that closed
 *  the popover closed the sheet under it too. */
describe("Escape, with a popover open over the sheet", () => {
  function Picker() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)}>Change icon</button>
        {open && createPortal(<div role="dialog" aria-label="Choose an icon"><input aria-label="Search icons" /></div>, document.body)}
      </>
    );
  }

  it("MUTANT: while a control's popup is open the key is the popup's — from the popup or from the control — and after, the sheet's", () => {
    const closed: string[] = [];
    render(<Sheet title="New memory" onClose={() => closed.push("sheet")}><input aria-label="Name" /><Picker /></Sheet>);
    const search = screen.getByRole("textbox", { name: "Search icons" });
    expect(screen.getByRole("dialog", { name: "New memory" }).contains(search)).toBe(false);
    search.focus();
    fireEvent.keyDown(search, { key: "Escape" });
    // Outside jsdom the picker's field may not have the keyboard yet; the trigger still says it is open.
    const trigger = screen.getByRole("button", { name: "Change icon" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Escape" });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(closed).toEqual([]);
    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog", { name: "Choose an icon" })).toBeNull();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(closed).toEqual(["sheet"]);
  });
});

describe("closing a sheet gives the keyboard back", () => {
  const outside = (tag: "button" | "textarea") => document.body.appendChild(document.createElement(tag));

  it("to the control that opened it, when the sheet still had it", () => {
    const opener = outside("button"); opener.focus();
    const { unmount } = render(<Sheet title="New memory" onClose={() => {}}><input aria-label="Name" /></Sheet>);
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Name" }));
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("MUTANT: but not away from something outside it that took the keyboard since", () => {
    const opener = outside("button"); opener.focus();
    const field = outside("textarea");
    const { unmount } = render(<Sheet title="New memory" onClose={() => {}}><input aria-label="Name" /></Sheet>);
    field.focus();
    unmount();
    expect(document.activeElement).toBe(field);
    opener.remove(); field.remove();
  });
});

describe("a sheet with a form in it", () => {
  it("MUTANT: leaves the keyboard in the field being typed in when its opener passes a new onClose each render", () => {
    // Keyed on `onClose`, the focus effect ran again on every keystroke and gave the first field the keyboard.
    function Form() {
      const [description, setDescription] = useState("");
      return (
        <Sheet title="New memory" onClose={() => {}}>
          <input aria-label="Name" />
          <input aria-label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Sheet>
      );
    }
    render(<Form />);
    const second = screen.getByRole("textbox", { name: "Description" });
    second.focus();
    fireEvent.change(second, { target: { value: "Where staging lives" } });
    expect(document.activeElement).toBe(second);
  });
});

describe("a close is the close icon, never a typed glyph", () => {
  it("draws the Sheet's close as the Icon, with its tooltip", () => {
    render(<Sheet title="New memory" onClose={() => {}}>x</Sheet>);
    const close = screen.getByRole("button", { name: "Close" });
    expect(close.querySelector("svg")).not.toBeNull();
    expect(close.textContent).toBe("");
    expect(close.getAttribute("title")).toBe("Close (Esc)");
  });

  it("no button in the renderer is a typed ✕ or ×", () => {
    // Vite rewrites `import.meta.url` under jsdom, so the renderer is found from the cwd.
    const rel = "apps/desktop/src/renderer/src";
    let dir = process.cwd();
    while (!existsSync(join(dir, rel))) dir = dirname(dir);
    const root = join(dir, rel);
    const files = (readdirSync(root, { recursive: true }) as string[]).filter((f) => f.endsWith(".tsx") && !f.includes(".test."));
    const typed = files.filter((f) => />\s*[✕×]\s*<\/button>/u.test(readFileSync(join(root, f), "utf8")));
    expect(typed).toEqual([]);
  });
});
