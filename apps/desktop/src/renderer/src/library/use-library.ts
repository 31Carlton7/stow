import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LIBRARY_EXTERNAL_UNCONFIRMED,
  type LibraryEntry, type LibraryFile, type LibraryProject, type LibrarySource, type MemoryType,
} from "@amc/contracts";
import { said, type RpcClient } from "../rpc/client";
import { useFavorites } from "../favorites/use-favorites";
import { toast } from "../toasts";
import { askedOf, type Scope } from "./library-model";

export type LibraryRpc = Pick<RpcClient, "call">;

export type SidebarView = "agent" | "project";
export type Layout = "list" | "grid";
export type EditorSurface = "rich" | "source";
export type Editing = { draft: string; surface: EditorSurface; saving: boolean };
export type NewMemoryDraft = { sourceId: string; folder: string; name: string; description: string; type: MemoryType; body: string };

/** What the sidebar lists: every source, the projects and tags their files have, how many
 *  memories a list of everything holds, and how many of those are starred. */
export type LibraryIndex = { sources: LibrarySource[]; projects: LibraryProject[]; tags: { tag: string; count: number }[]; total: number; starred: number };

/** A question that stays on screen until it is answered. */
export type Question =
  | { kind: "write-external"; file: LibraryFile }
  | { kind: "create-external"; source: LibrarySource; folder: string }
  | { kind: "delete"; file: LibraryFile }
  | { kind: "discard"; file: LibraryFile; leave: () => void };

/* Kept by the window itself: which way the files are laid out is not something the server acts on. */
const LAYOUT_KEY = "stow.library.layout";
const keptLayout = (): Layout => (localStorage.getItem(LAYOUT_KEY) === "grid" ? "grid" : "list");

const codeOf = (e: unknown): string | null => (e instanceof Error && "code" in e && typeof e.code === "string" ? e.code : null);
/** A refusal or a failure, in the server's own words. */
const say = (e: unknown): void => { toast({ tone: "error", text: said(e) }); };

/**
 * The library's state: what the sidebar narrows the list to, the list, the file being read or
 * edited, and the questions a change asks first.
 *
 * Everything is read again when the window gets the keyboard back, because an agent may have written
 * a file meanwhile, and after every change made here.
 */
export function useLibrary(rpc: LibraryRpc) {
  const [view, setViewNow] = useState<SidebarView>("agent");
  const [layout, setLayoutNow] = useState<Layout>(keptLayout);
  /** In the grid, whether a card is open: the reader then has the panel to itself. */
  const [reading, setReading] = useState(false);
  const [scope, setScopeNow] = useState<Scope>({});
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Omit<LibraryIndex, "starred"> & { ids: string[] } | null>(null);
  const [listed, setListed] = useState<LibraryEntry[] | null>(null);
  const favorites = useFavorites();
  const [listError, setListError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [file, setFile] = useState<LibraryFile | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [surface, setSurface] = useState<EditorSurface>("rich");
  const [newMemory, setNewMemory] = useState<NewMemoryDraft | null>(null);
  const [creating, setCreating] = useState(false);
  const [question, setQuestion] = useState<Question | null>(null);
  const [rev, setRev] = useState(0);
  /** The sources the person said yes to writing into, until the window closes: asked once each. */
  const confirmed = useRef(new Set<string>());
  const refresh = useCallback(() => setRev((n) => n + 1), []);

  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  useEffect(() => {
    let live = true;
    Promise.all([rpc.call("library.sources", {}), rpc.call("library.list", {})]).then(
      ([sources, everything]) => { if (live) setFound({ ...sources, total: everything.entries.length, ids: everything.entries.map((e) => e.id) }); },
      // Said by the list, which the same failure leaves with nothing to show.
      () => {},
    );
    return () => { live = false; };
  }, [rpc, rev]);

  /* The list is read again on every keystroke and kept on screen until the next answer lands, so the
     search narrows in place rather than blinking empty between letters. */
  useEffect(() => {
    let live = true;
    const words = query.trim();
    rpc.call("library.list", { ...askedOf(scope), ...(words ? { query: words } : {}) }).then(
      (answered) => { if (live) { setListed(answered.entries); setListError(null); } },
      (e: unknown) => { if (live) setListError(said(e)); },
    );
    return () => { live = false; };
  }, [rpc, scope, query, rev]);

  const index = useMemo((): LibraryIndex | null => {
    if (found === null) return null;
    const { ids, ...kept } = found;
    return { ...kept, starred: ids.filter((id) => favorites.has("file", id)).length };
  }, [found, favorites]);
  const entries = useMemo(
    () => (scope.favorites && listed !== null ? listed.filter((e) => favorites.has("file", e.id)) : listed),
    [listed, scope.favorites, favorites],
  );

  const shownId = picked ?? entries?.[0]?.id ?? null;
  const isEditing = editing !== null;
  useEffect(() => {
    if (isEditing) return;
    if (shownId === null) { setFile(null); setMissing(null); return; }
    let live = true;
    rpc.call("library.read", { id: shownId }).then(
      (read) => { if (live) { setFile(read); setMissing(null); } },
      (e: unknown) => {
        if (!live) return;
        setFile(null);
        // Deleted or moved since it was listed: the list's next read drops it.
        if (codeOf(e) === "LIBRARY_FILE_NOT_FOUND") setMissing(shownId);
        else say(e);
      },
    );
    return () => { live = false; };
  }, [rpc, shownId, rev, isEditing]);

  const dirty = editing !== null && file !== null && editing.draft !== file.text;
  /** Go somewhere else: at once, or after the person agrees to lose what they have typed. */
  const leaving = (leave: () => void): void => {
    if (dirty && file) { setQuestion({ kind: "discard", file, leave }); return; }
    setEditing(null);
    leave();
  };

  const write = async (target: LibraryFile, text: string, confirmExternal: boolean): Promise<void> => {
    setEditing((held) => (held ? { ...held, saving: true } : held));
    try {
      await rpc.call("library.write", { id: target.id, text, ...(confirmExternal ? { confirmExternal: true } : {}) });
      if (confirmExternal) confirmed.current.add(target.sourceId);
      setFile(await rpc.call("library.read", { id: target.id }));
      setEditing(null);
      refresh();
    } catch (e) {
      setEditing((held) => (held ? { ...held, saving: false } : held));
      if (codeOf(e) === LIBRARY_EXTERNAL_UNCONFIRMED) setQuestion({ kind: "write-external", file: target });
      else say(e);
    }
  };

  const make = async (draft: NewMemoryDraft, confirmExternal: boolean): Promise<void> => {
    setCreating(true);
    try {
      const made = await rpc.call("library.create", {
        ...draft, name: draft.name.trim(), description: draft.description.trim(), ...(confirmExternal ? { confirmExternal: true } : {}),
      });
      if (confirmExternal) confirmed.current.add(draft.sourceId);
      setNewMemory(null);
      setScopeNow({});
      setQuery("");
      setPicked(made.id);
      setReading(true);
      refresh();
    } catch (e) {
      const source = index?.sources.find((s) => s.id === draft.sourceId);
      if (codeOf(e) === LIBRARY_EXTERNAL_UNCONFIRMED && source) setQuestion({ kind: "create-external", source, folder: draft.folder });
      else say(e);
    } finally {
      setCreating(false);
    }
  };

  const remove = async (target: LibraryFile): Promise<void> => {
    const name = target.rel.split("/").at(-1)!;
    try {
      // The question that led here named the file and where it goes: that was the person's yes.
      const { trashed } = await rpc.call("library.delete", { id: target.id, ...(target.external ? { confirmExternal: true } : {}) });
      toast({ text: trashed ? `${name} is in the Trash.` : `${name} was removed with one commit.` });
      setListed((held) => held?.filter((e) => e.id !== target.id) ?? held);
      setPicked(null);
      setFile(null);
      setReading(false);
      refresh();
    } catch (e) {
      say(e);
    }
  };

  const sourceById = useMemo(() => new Map((index?.sources ?? []).map((s) => [s.id, s])), [index]);

  return {
    view, layout, reading, scope, query, index, entries, listError, shownId, file, missing, editing, dirty, newMemory, creating, question, sourceById,

    setQuery,
    setView(next: SidebarView): void {
      if (next === view) return;
      // Everything, and a tag, are listed the same way in both views.
      if (scope.group === undefined && scope.projectId === undefined) { setViewNow(next); return; }
      leaving(() => { setViewNow(next); setScopeNow({}); setPicked(null); setReading(false); });
    },
    setLayout(next: Layout): void {
      if (next === layout) return;
      leaving(() => {
        setLayoutNow(next);
        setReading(false);
        localStorage.setItem(LAYOUT_KEY, next);
      });
    },
    setScope(next: Scope): void { leaving(() => { setScopeNow(next); setPicked(null); setReading(false); }); },
    open(id: string): void { leaving(() => { setPicked(id); setReading(true); }); },
    /** Show one file whatever the list is narrowed to: where another section sends the person. */
    show(id: string): void { leaving(() => { setScopeNow({}); setPicked(id); setReading(true); }); },
    /** Back from a card's file to the grid. */
    closeReading(): void { leaving(() => setReading(false)); },
    /** Run `leave` once an unsaved edit has been settled; at once when there is none. */
    leaving,

    startEdit(): void {
      if (!file?.writable) return;
      // Pinned, so a list that changes under the editor cannot swap the file being edited.
      setPicked(file.id);
      setEditing({ draft: file.text, surface, saving: false });
    },
    changeDraft(draft: string): void { setEditing((held) => (held ? { ...held, draft } : held)); },
    chooseSurface(next: EditorSurface): void {
      setSurface(next);
      setEditing((held) => (held ? { ...held, surface: next } : held));
    },
    cancelEdit(): void { setEditing(null); },
    save(): void {
      if (!editing || !file || editing.saving) return;
      if (editing.draft === file.text) { setEditing(null); return; }
      void write(file, editing.draft, confirmed.current.has(file.sourceId));
    },

    askDelete(): void { if (file?.deletable) setQuestion({ kind: "delete", file }); },
    answer(yes: boolean): void {
      const asked = question;
      setQuestion(null);
      if (!asked || !yes) return;
      if (asked.kind === "write-external") { if (editing) void write(asked.file, editing.draft, true); }
      else if (asked.kind === "create-external") { if (newMemory) void make(newMemory, true); }
      else if (asked.kind === "delete") void remove(asked.file);
      else { setEditing(null); asked.leave(); }
    },

    startNew(): void {
      leaving(() => {
        const places = (index?.sources ?? []).filter((s) => s.folders.length > 0);
        // Where the list is looking, when a memory can be made there.
        const first = places.find((s) => s.group === scope.group && (scope.kind === undefined || s.kind === scope.kind)) ?? places[0];
        setNewMemory({ sourceId: first?.id ?? "", folder: first?.folders[0]?.rel ?? "", name: "", description: "", type: "project", body: "" });
      });
    },
    changeNew(change: Partial<NewMemoryDraft>): void { setNewMemory((held) => (held ? { ...held, ...change } : held)); },
    cancelNew(): void { setNewMemory(null); },
    create(): void { if (newMemory && !creating) void make(newMemory, confirmed.current.has(newMemory.sourceId)); },

    async setTags(tags: string[]): Promise<void> {
      if (!file) return;
      const id = file.id;
      try {
        const kept = await rpc.call("library.setTags", { id, tags });
        setFile((held) => (held && held.id === id ? { ...held, tags: kept.tags } : held));
        refresh();
      } catch (e) {
        say(e);
      }
    },
    reveal(path: string): void { void window.amc?.reveal(path); },
  };
}

export type Library = ReturnType<typeof useLibrary>;
