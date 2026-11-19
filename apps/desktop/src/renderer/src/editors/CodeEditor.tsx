import { useEffect, useRef } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput, indentUnit } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, Transaction, type Extension } from "@codemirror/state";
import {
  EditorView, drawSelection, dropCursor, highlightActiveLine, highlightActiveLineGutter,
  highlightSpecialChars, keymap, lineNumbers, rectangularSelection,
} from "@codemirror/view";
import { codeTheme } from "./code-theme";

/**
 * The source editor for a Markdown file (CodeMirror 6).
 *
 * **What this component is and is not.** It is text in, text out — the same contract as
 * `RichTextEditor`, and deliberately so. Dirty state and the save belong to whoever mounts it.
 *
 * **Why a textarea was not enough.** Not the colours. A `<textarea>` has no undo that survives a
 * programmatic value change, no find, no bracket matching, no indentation, and a fixed tab that
 * inserts a character instead of a level.
 */
export function CodeEditor({ path, text, onChange, onSave }: {
  /** The file's path. Names the editor for a screen reader. */
  path: string;
  text: string;
  onChange: (text: string) => void;
  /** ⌘S. The binding is claimed either way, so the key never reaches the browser's own save. */
  onSave?: () => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  /** Everything about the file that changes when the file changes: grammar, wrapping, accessible
   *  name. One compartment rather than three, because they are reconfigured by one event. */
  const perFile = useRef(new Compartment());
  /** The handlers, read through a ref so a new `onChange` identity never rebuilds the editor —
   *  rebuilding would throw away the undo history and the cursor on every keystroke. */
  const handlers = useRef({ onChange, onSave });
  handlers.current = { onChange, onSave };
  /** The last document this editor produced, to recognise its own value arriving back as a prop. */
  const lastEmitted = useRef<string | null>(null);
  /** What the caller currently holds. Read when a view is BUILT — which is usually mount, but is also
   *  any later rebuild, and a rebuild that seeded itself from the first render's text would quietly
   *  revert the file. */
  const currentText = useRef(text);
  currentText.current = text;
  /** The grammar and wrapping this file resolved to. Held outside the view so a rebuilt view is not
   *  left with no grammar until the path happens to change again. */
  const perFileConfig = useRef<Extension>([]);

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const v = new EditorView({
      parent,
      state: EditorState.create({
        doc: currentText.current,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          dropCursor(),
          rectangularSelection(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          bracketMatching(),
          // Two spaces, because the alternative is guessing. Reading the file's own indentation would
          // be right more often and wrong invisibly — a file whose first indented line is inside a
          // string literal teaches the editor a width nobody can see, and every subsequent line
          // disagrees with the rest of the repo.
          indentUnit.of("  "),
          highlightSelectionMatches(),
          // Above the code rather than below it. The panel is chrome for the file, and the thing a
          // person looks at while typing a query is the first match — which is at the top far more
          // often than it is at the bottom.
          search({ top: true }),
          /* Order is precedence. Save first so nothing can claim ⌘S; then find, then history, then
             Tab, then the defaults — `defaultKeymap` is last because it is the broadest and would
             otherwise shadow the specific bindings above it. */
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              // Handled even with no `onSave`, on purpose: an unclaimed ⌘S in a packaged Electron app
              // is the browser's own save-page, which is never what a person meant here.
              run: () => { handlers.current.onSave?.(); return true; },
            },
            ...searchKeymap,
            ...historyKeymap,
            /* Tab indents. CodeMirror leaves this unbound by default because it takes Tab away from
               keyboard traversal, and that trade is made knowingly here: a source editor whose Tab key
               moves focus is not a source editor, and Escape then Tab still leaves it. */
            indentWithTab,
            ...defaultKeymap,
          ]),
          perFile.current.of(perFileConfig.current),
          codeTheme(),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            const next = u.state.doc.toString();
            lastEmitted.current = next;
            handlers.current.onChange(next);
          }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
      lastEmitted.current = null;
    };
  }, []);

  // ---- the grammar, fetched when the editor is first opened ---------------------------------------
  useEffect(() => {
    let cancelled = false;
    void import("@codemirror/lang-markdown")
      .then(({ markdown }) => {
        if (cancelled) return;
        perFileConfig.current = [
          markdown(),
          // Prose wraps: an unwrapped paragraph of Markdown runs off the screen.
          EditorView.lineWrapping,
          // The editing surface is a `contenteditable`, so its accessible name has to be set on it
          // rather than on the box around it, and it names the FILE — "Edit" alone is every file.
          EditorView.contentAttributes.of({ "aria-label": `Edit ${path.split("/").pop() ?? path}` }),
        ];
        view.current?.dispatch({ effects: perFile.current.reconfigure(perFileConfig.current) });
      })
      // A grammar chunk that fails to load (an interrupted update) leaves an editor with no colours,
      // which still edits.
      .catch(() => {});
    return () => { cancelled = true; };
  }, [path]);

  // ---- the text changed under us ------------------------------------------------------------------
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    // Our own emission echoing back through the caller's state. Replacing the document with itself
    // would collapse the selection and put an identical change on the undo stack, once per keystroke.
    if (text === lastEmitted.current) return;
    const current = v.state.doc.toString();
    if (text === current) return;
    const { anchor, head } = v.state.selection.main;
    v.dispatch({
      changes: { from: 0, to: current.length, insert: text },
      // Clamped rather than reset: a shorter text must not leave the selection past the end.
      selection: { anchor: Math.min(anchor, text.length), head: Math.min(head, text.length) },
      /* Not undoable. ⌘Z after text arrived from the other editor would otherwise bring back a
         version neither editor is showing. */
      annotations: Transaction.addToHistory.of(false),
    });
  }, [text]);

  return <div className="documents-code" ref={host} />;
}
