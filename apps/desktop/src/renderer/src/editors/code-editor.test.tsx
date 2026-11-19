import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { redo, undo } from "@codemirror/commands";
import { CodeEditor } from "./CodeEditor";

/** The live view behind the rendered DOM. Edits are dispatched through it rather than typed, because
 *  jsdom lays nothing out and a `contenteditable` there does not accept synthetic text input. */
function viewOf(container: HTMLElement): EditorView {
  const el = container.querySelector<HTMLElement>(".cm-editor");
  const view = el && EditorView.findFromDOM(el);
  if (!view) throw new Error("no CodeMirror view mounted");
  return view;
}

const docOf = (container: HTMLElement) => viewOf(container).state.doc.toString();

/** A user edit: a real transaction, so it lands on the undo history exactly as typing would. */
function type(container: HTMLElement, at: number, insert: string) {
  const view = viewOf(container);
  act(() => { view.dispatch({ changes: { from: at, insert } }); });
}

/**
 * CodeMirror resolves `Mod-` against the platform at runtime: Cmd on macOS, Ctrl everywhere else.
 * jsdom reports neither a Mac userAgent nor a Mac platform, so under test `Mod-s` is **Ctrl-s** even
 * though the shipped app — macOS only — always sees Cmd-s. Pressing Ctrl here is therefore testing
 * the same binding the user presses, not a different one; hard-coding `metaKey` would test a chord
 * CodeMirror has not bound in this environment and fail for a reason that says nothing about the app.
 */
const MOD = { ctrlKey: true } as const;

describe("CodeEditor", () => {

  it("reports the whole document on an edit, not the change", () => {
    const onChange = vi.fn();
    const { container } = render(<CodeEditor path="notes/a.md" text="const x = 1;" onChange={onChange} />);
    type(container, 12, "\n");
    expect(onChange).toHaveBeenCalledWith("const x = 1;\n");
  });

  it("ignores its own value coming back as a prop", () => {
    // The echo. Without the guard, every keystroke round-trips through the caller's state and comes
    // back as a "new" document: the editor replaces itself, the cursor collapses to the start, and
    // typing becomes impossible.
    const onChange = vi.fn();
    const { container, rerender } = render(<CodeEditor path="notes/a.md" text="ab" onChange={onChange} />);
    const view = viewOf(container);
    act(() => { view.dispatch({ changes: { from: 2, insert: "c" }, selection: { anchor: 3 } }); });
    rerender(<CodeEditor path="notes/a.md" text="abc" onChange={onChange} />);
    expect(view.state.selection.main.anchor).toBe(3);
    expect(docOf(container)).toBe("abc");
  });

  it("adopts text that came from outside it", () => {
    const { container, rerender } = render(<CodeEditor path="notes/a.md" text="mine" onChange={() => {}} />);
    rerender(<CodeEditor path="notes/a.md" text="theirs, written by an agent" onChange={() => {}} />);
    expect(docOf(container)).toBe("theirs, written by an agent");
  });

  it("does not let undo reach behind text that came from outside it", () => {
    // ⌘Z after the rich editor's text arrived would bring back a version neither editor is showing.
    const { container, rerender } = render(<CodeEditor path="notes/a.md" text="mine" onChange={() => {}} />);
    rerender(<CodeEditor path="notes/a.md" text="theirs" onChange={() => {}} />);
    const view = viewOf(container);
    act(() => { undo(view); });
    expect(view.state.doc.toString()).toBe("theirs");
  });

  it("undoes and redoes the user's own edits", () => {
    const { container } = render(<CodeEditor path="notes/a.md" text="one" onChange={() => {}} />);
    type(container, 3, " two");
    const view = viewOf(container);
    expect(view.state.doc.toString()).toBe("one two");
    act(() => { undo(view); });
    expect(view.state.doc.toString()).toBe("one");
    act(() => { redo(view); });
    expect(view.state.doc.toString()).toBe("one two");
  });

  it("keeps the selection inside a file that got shorter", () => {
    const { container, rerender } = render(<CodeEditor path="notes/a.md" text="a long line of text" onChange={() => {}} />);
    const view = viewOf(container);
    act(() => { view.dispatch({ selection: { anchor: 18 } }); });
    rerender(<CodeEditor path="notes/a.md" text="short" onChange={() => {}} />);
    expect(view.state.selection.main.anchor).toBeLessThanOrEqual(5);
  });

  it("claims Cmd-S, whether or not anyone is listening", () => {
    const onSave = vi.fn();
    const { container } = render(<CodeEditor path="notes/a.md" text="x" onChange={() => {}} onSave={onSave} />);
    const handled = !fireEvent.keyDown(viewOf(container).contentDOM, { key: "s", ...MOD });
    expect(onSave).toHaveBeenCalledTimes(1);
    // Unclaimed, this is the browser's own save-page dialog inside a packaged app.
    expect(handled).toBe(true);
  });

  it("opens find on Cmd-F", () => {
    const { container } = render(<CodeEditor path="notes/a.md" text="alpha beta" onChange={() => {}} />);
    fireEvent.keyDown(viewOf(container).contentDOM, { key: "f", ...MOD });
    expect(container.querySelector(".cm-panel.cm-search")).not.toBeNull();
  });

  it("names the file on the editing surface, where a reader will hear it", async () => {
    const { container } = render(<CodeEditor path="~/.claude/CLAUDE.md" text="" onChange={() => {}} />);
    await waitFor(() => {
      expect(container.querySelector(".cm-content")).toHaveAttribute("aria-label", "Edit CLAUDE.md");
    });
  });
});

describe("wrapping", () => {
  /** CodeMirror marks a wrapping editor's content with `cm-lineWrapping`. The grammar's arrival is a
   *  promise, so the class lands a tick after mount. */
  const wraps = (container: HTMLElement) => container.querySelector(".cm-content")?.classList.contains("cm-lineWrapping");

  it("wraps Markdown source, which is prose", async () => {
    const { container } = render(<CodeEditor path="post.md" text={"word ".repeat(200)} onChange={() => {}} />);
    await waitFor(() => expect(wraps(container)).toBe(true));
  });
});
