import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { LIBRARY_EXTERNAL_UNCONFIRMED, libraryId, type LibraryFile } from "@amc/contracts";
import type { HandedOut } from "../components/hand-out";
import { clearToasts } from "../toasts";
import { fakeFile, fakeLibraryServer, fakeSource, type FakeLibraryServer } from "./library.test-fakes";
import { linkOf, linkWikiLinks, tagsTyped, withoutTitle } from "./library-model";

const window_ = vi.hoisted(() => ({ server: null as null | { call: (method: string, params: unknown) => Promise<unknown> } }));
vi.mock("../rpc/client", async (original) => ({
  ...(await original<typeof import("../rpc/client")>()),
  server: { call: (method: string, params: unknown) => window_.server!.call(method, params) },
}));

import { App } from "../App";
import { RpcError } from "../rpc/client";

/* The reader and the editors are split out of the window's chunk; their first import is a transform
   of ProseMirror and CodeMirror. Taken once, so each test times the library. */
beforeAll(async () => {
  await Promise.all([import("../editors/CodeEditor"), import("../editors/RichTextEditor")]);
}, 60_000);
afterEach(() => { act(() => { clearToasts(); }); localStorage.clear(); });

const REPO = "realm-repo-profile-p1";
const ATLAS = "project-atlas";
const DEPLOY_TEXT = "---\nname: deploy-steps\ndescription: How Atlas ships\n---\n\nSign the build, notarize it, then publish. See [[team]] and [[missing-note]].\n";

const SOURCES = [
  fakeSource({ id: REPO, group: "realm", kind: "memory", label: "Sam's memory", folders: [{ rel: "", label: "Shared by every space" }, { rel: "spaces/atlas", label: "Atlas" }] }),
  fakeSource({ id: "realm-imported", group: "realm", kind: "imported", label: "Imported copies" }),
  fakeSource({ id: "claude-user", group: "claude", kind: "instructions", label: "User instructions" }),
  fakeSource({ id: "claude-projects", group: "claude", kind: "project-memory", label: "Project memory", path: "/home/.claude/projects", folders: [{ rel: "-atlas/memory", label: "atlas" }] }),
  fakeSource({ id: "codex-user", group: "codex", kind: "instructions", label: "User instructions" }),
  fakeSource({ id: "codex-project-beacon", group: "codex", kind: "project-instructions", label: "beacon" }),
];
const DEPLOY = libraryId(REPO, "spaces/atlas/deploy-steps.md");
const CLAUDES_DEPLOY = libraryId("claude-projects", "-atlas/memory/deploy-steps.md");
const USER_INSTRUCTIONS = libraryId("claude-user", "CLAUDE.md");

const files = (): LibraryFile[] => [
  fakeFile({
    sourceId: REPO, group: "realm", kind: "memory", rel: "spaces/atlas/deploy-steps.md", title: "deploy-steps", description: "How Atlas ships", type: "project",
    folder: "Atlas", projectId: ATLAS, copies: 3, text: DEPLOY_TEXT, body: "Sign the build, notarize it, then publish. See [[team]] and [[missing-note]].\n",
    frontmatter: [{ key: "name", value: "deploy-steps" }, { key: "description", value: "How Atlas ships" }, { key: "metadata.type", value: "project" }, { key: "metadata.originSessionId", value: "session-a" }],
    links: [{ target: "team", id: libraryId(REPO, "team.md") }, { target: "missing-note", id: null }],
    otherCopies: [
      { id: libraryId("realm-imported", "s1/-atlas/deploy-steps.md"), where: "Realm · Atlas · atlas", displayPath: "~/Realm/memory/imported/s1/-atlas/deploy-steps.md", same: true },
      { id: CLAUDES_DEPLOY, where: "Claude · atlas", displayPath: "~/.claude/projects/-atlas/memory/deploy-steps.md", same: false },
    ],
    readBy: "Realm starts each session with its MEMORY.md.", updatedAt: Date.now() - 60_000,
  }),
  fakeFile({ sourceId: REPO, group: "realm", kind: "memory", rel: "team.md", title: "Team", description: "Riley approves releases.", body: "Riley approves releases.\n", updatedAt: Date.now() - 120_000 }),
  fakeFile({ sourceId: REPO, group: "realm", kind: "memory", rel: "MEMORY.md", title: "Index", description: "2 memories", index: true, deletable: false, body: "- [[team]]\n", updatedAt: Date.now() - 180_000 }),
  fakeFile({ sourceId: "realm-imported", group: "realm", kind: "imported", rel: "s1/-atlas/deploy-steps.md", title: "deploy-steps", copies: 3, canonical: false, body: "Sign the build.\n" }),
  fakeFile({ sourceId: "claude-projects", group: "claude", kind: "project-memory", rel: "-atlas/memory/deploy-steps.md", title: "deploy-steps", description: "How Atlas ships",
    folder: "atlas", projectId: ATLAS, copies: 3, canonical: false, body: "Sign the build.\n" }),
  fakeFile({ sourceId: "claude-user", group: "claude", kind: "instructions", rel: "CLAUDE.md", title: "CLAUDE", description: "Prefer small commits.", path: "/home/.claude/CLAUDE.md",
    displayPath: "~/.claude/CLAUDE.md", text: "Prefer small commits.\n", body: "Prefer small commits.\n", readBy: "Claude Code loads it in every session.", updatedAt: Date.now() - 240_000 }),
  fakeFile({ sourceId: "codex-user", group: "codex", kind: "instructions", rel: "AGENTS.md", title: "AGENTS", size: 0, text: "", body: "", readBy: "Codex loads it in every session.", updatedAt: Date.now() - 300_000 }),
  fakeFile({ sourceId: "codex-project-beacon", group: "codex", kind: "project-instructions", rel: "AGENTS.md", title: "Beacon rules", body: "Beacon's rules.\n",
    writable: false, deletable: false, note: "Realm writes this file from the space's memory. Edit it in Realm instead.", updatedAt: Date.now() - 360_000 }),
];

async function mount(): Promise<FakeLibraryServer> {
  const server = fakeLibraryServer({ sources: SOURCES, files: files(), projects: [{ id: ATLAS, name: "atlas", root: "/home/work/atlas", count: 0 }] });
  window_.server = server.rpc as unknown as typeof window_.server;
  render(<App />);
  await screen.findByRole("heading", { name: "deploy-steps", level: 2 });
  return server;
}

const sidebar = () => screen.getByRole("navigation", { name: "Library" });
const list = () => screen.getByRole("region", { name: "Files" });
const reader = () => screen.getByRole("region", { name: "Reader" });
const rows = () => within(list()).queryAllByRole("option");
const titles = () => rows().map((r) => r.querySelector(".lib-row-title")!.textContent);
const rowTitled = (title: string) => rows().find((r) => r.querySelector(".lib-row-title")!.textContent === title)!;
const navRow = (name: RegExp) => within(sidebar()).getByRole("button", { name });
const read = async (title: string) => {
  fireEvent.click(rowTitled(title));
  await within(reader()).findByRole("heading", { name: title, level: 2 });
};
/** The source editor's view, once it has mounted. Edits are dispatched through it: jsdom lays nothing
 *  out, and a `contenteditable` there takes no typed text. */
const sourceEditor = async () => {
  fireEvent.click(within(reader()).getByRole("radio", { name: "Source" }));
  return waitFor(() => {
    const el = reader().querySelector<HTMLElement>(".cm-editor");
    const view = el && EditorView.findFromDOM(el);
    if (!view) throw new Error("no source editor yet");
    return view;
  });
};
const typeAtEnd = (view: EditorView, text: string) => act(() => { view.dispatch({ changes: { from: view.state.doc.length, insert: text } }); });

describe("the sidebar", () => {
  it("counts every memory once, then each agent's files by kind", async () => {
    await mount();
    // Six of the eight files: the two other copies of deploy-steps are the same memory.
    expect(navRow(/^All memories/)).toHaveTextContent("All memories6");
    expect(navRow(/^All memories/)).toHaveAttribute("aria-current", "true");
    const realm = within(sidebar()).getByRole("list", { name: "Realm" });
    expect(within(realm).getAllByRole("button").map((b) => b.textContent)).toEqual(["Realm4", "Memory3", "Imported copies1"]);
    const claude = within(sidebar()).getByRole("list", { name: "Claude" });
    expect(within(claude).getAllByRole("button").map((b) => b.textContent)).toEqual(["Claude2", "Project memory1", "Instructions1"]);
    const codex = within(sidebar()).getByRole("list", { name: "Codex" });
    expect(within(codex).getAllByRole("button").map((b) => b.textContent)).toEqual(["Codex2", "Instructions1", "Project instructions1"]);
    // An agent with no files has no row.
    expect(within(sidebar()).queryByRole("list", { name: "Gemini" })).toBeNull();
    expect(screen.getByRole("heading", { name: "All memories", level: 1 })).toBeInTheDocument();
  });

  it("narrows the list to an agent, and to one kind of its files", async () => {
    const server = await mount();
    fireEvent.click(navRow(/^Claude/));
    await waitFor(() => expect(titles()).toEqual(["CLAUDE", "deploy-steps"]));
    expect(server.callsTo("library.list").at(-1)).toEqual({ group: "claude" });
    expect(screen.getByRole("heading", { name: "Claude", level: 1 })).toBeInTheDocument();
    fireEvent.click(navRow(/^Project memory/));
    await waitFor(() => expect(titles()).toEqual(["deploy-steps"]));
    expect(server.callsTo("library.list").at(-1)).toEqual({ group: "claude", kind: "project-memory" });
    expect(navRow(/^Project memory/)).toHaveAttribute("aria-current", "true");
    expect(navRow(/^Claude/)).not.toHaveAttribute("aria-current");
    // The list is one agent's, so a row no longer says whose it is.
    expect(rowTitled("deploy-steps").querySelector(".lib-row-place")!.textContent).toBe("atlas");
    // The head: the agent's mark, its name, then the kind in its own quieter span, and no dot.
    const heading = within(list()).getByRole("heading", { level: 1 });
    expect([...heading.children].map((part) => part.getAttribute("data-brand") ?? `${part.className}: ${part.textContent}`))
      .toEqual(["claude", "lib-list-name: Claude", "lib-list-kind: Project memory"]);
    expect(within(list()).getByRole("listbox")).toHaveAccessibleName("Claude Project memory");
    fireEvent.click(navRow(/^Claude/));
    await waitFor(() => expect(heading.querySelector(".lib-list-kind")).toBeNull());
    expect(heading.textContent).toBe("Claude");
    fireEvent.click(navRow(/^All memories/));
    await waitFor(() => expect(heading.querySelector("svg")).toBeNull());
    expect(heading.textContent).toBe("All memories");
  });

  it("lists by project instead, and by tag once there is one", async () => {
    const server = await mount();
    fireEvent.click(screen.getByRole("radio", { name: "By project" }));
    const projects = within(sidebar()).getByRole("list", { name: "Projects" });
    expect(within(projects).getAllByRole("button").map((b) => b.textContent)).toEqual(["atlas1"]);
    expect(within(sidebar()).queryByRole("list", { name: "Claude" })).toBeNull();
    fireEvent.click(within(projects).getByRole("button", { name: /atlas/ }));
    await waitFor(() => expect(server.callsTo("library.list").at(-1)).toEqual({ projectId: ATLAS }));
    await waitFor(() => expect(titles()).toEqual(["deploy-steps"]));

    expect(within(sidebar()).queryByRole("list", { name: "Tags" })).toBeNull();
    fireEvent.change(within(reader()).getByRole("textbox", { name: "Add a tag" }), { target: { value: "Release ops" } });
    fireEvent.submit(within(reader()).getByRole("textbox", { name: "Add a tag" }));
    await waitFor(() => expect(server.callsTo("library.setTags")).toEqual([{ id: DEPLOY, tags: ["Release", "ops"] }]));
    const tags = await within(sidebar()).findByRole("list", { name: "Tags" });
    expect(within(tags).getAllByRole("button").map((b) => b.textContent)).toEqual(["ops1", "release1"]);
    fireEvent.click(within(tags).getByRole("button", { name: /release/ }));
    await waitFor(() => expect(server.callsTo("library.list").at(-1)).toEqual({ tag: "release" }));
    fireEvent.click(await within(reader()).findByRole("button", { name: "Remove the tag ops" }));
    await waitFor(() => expect(server.callsTo("library.setTags").at(-1)).toEqual({ id: DEPLOY, tags: ["release"] }));
  });
});

describe("the list", () => {
  it("shows what a file is, where it is kept, its type and how many copies there are", async () => {
    await mount();
    expect(titles()).toEqual(["deploy-steps", "Team", "Index", "CLAUDE", "AGENTS", "Beacon rules"]);
    const deploy = rowTitled("deploy-steps");
    expect(deploy).toHaveAttribute("aria-selected", "true");
    expect(deploy.querySelector(".lib-row-line")!.textContent).toBe("How Atlas ships");
    expect(deploy.querySelector(".lib-row-place")!.textContent).toBe("Realm · Atlas");
    expect(deploy.querySelector(".lib-chip")!.textContent).toBe("Project");
    // Each row wears the mark of the agent its file is, before the title.
    const markOf = (title: string) => rowTitled(title).querySelector(".lib-row-head > svg[data-brand]:first-child")?.getAttribute("data-brand");
    expect(markOf("deploy-steps")).toBe("realm");
    expect(markOf("CLAUDE")).toBe("claude");
    // THE MUTANT: a badge on every row, or the count of files rather than of copies.
    expect(deploy.querySelector(".lib-row-copies")!.textContent).toBe("3 copies");
    expect(rowTitled("Team").querySelector(".lib-row-copies")).toBeNull();
    expect(rowTitled("Index")).toHaveAttribute("data-index");
    // An index's folder is in its title already, so the row says which memory it is the index of.
    expect(rowTitled("Index").querySelector(".lib-row-place")!.textContent).toBe("Realm · Sam's memory");
    expect(rowTitled("AGENTS").querySelector(".lib-row-line")!.textContent).toBe("Empty");
  });

  it("keeps the list on screen while a search is on its way, then shows the line that matched", async () => {
    const server = await mount();
    const release = server.holdLists();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search the library" }), { target: { value: "notarize" } });
    await waitFor(() => expect(server.callsTo("library.list").at(-1)).toEqual({ query: "notarize" }));
    // THE MUTANT: clear the list when the query changes, and it blinks empty between letters.
    expect(titles()).toHaveLength(6);
    expect(within(list()).queryByText("Reading the library")).toBeNull();
    await act(async () => { release(); });
    await waitFor(() => expect(titles()).toEqual(["deploy-steps"]));
    expect(rowTitled("deploy-steps").querySelector(".lib-row-line")!.textContent).toContain("notarize it");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search the library" }), { target: { value: "zzz" } });
    expect(await within(list()).findByText("Nothing matches")).toBeInTheDocument();
  });

  it("moves the selection with the arrows, and Enter goes to the file", async () => {
    await mount();
    const box = within(list()).getByRole("listbox");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    await within(reader()).findByRole("heading", { name: "Team", level: 2 });
    expect(rowTitled("Team")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(box, { key: "ArrowUp" });
    fireEvent.keyDown(box, { key: "ArrowUp" });
    await within(reader()).findByRole("heading", { name: "deploy-steps", level: 2 });
    // From the search field too: type, arrow down to the row, Enter.
    // THE MUTANT: Enter taken from everything in the column, and the New memory button cannot be pressed with it.
    fireEvent.keyDown(within(list()).getByRole("button", { name: "New memory" }), { key: "Enter" });
    expect(document.activeElement).not.toBe(reader());
    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Search the library" }), { key: "Enter" });
    expect(document.activeElement).toBe(reader());
  });

  it("reads the disk again when the window gets the keyboard back", async () => {
    const server = await mount();
    server.add(fakeFile({ sourceId: "claude-user", group: "claude", kind: "instructions", rel: "notes.md", title: "Written by an agent", body: "x\n", updatedAt: Date.now() }));
    act(() => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(titles()).toContain("Written by an agent"));
    expect(navRow(/^All memories/)).toHaveTextContent("All memories7");
  });
});

describe("the grid", () => {
  const cards = () => within(list()).queryAllByRole("button").filter((b) => b.classList.contains("lib-card"));
  const cardTitles = () => cards().map((c) => c.querySelector(".lib-card-title")!.textContent);
  const cardTitled = (title: string) => cards().find((c) => c.querySelector(".lib-card-title")!.textContent === title)!;
  const showAs = (layout: "List" | "Grid") => fireEvent.click(screen.getByRole("radio", { name: layout }));
  const search = (words: string) => fireEvent.change(screen.getByRole("searchbox", { name: "Search the library" }), { target: { value: words } });

  it("is chosen in the list's head, kept, and there again in a window opened later", async () => {
    await mount();
    expect(screen.getByRole("radio", { name: "List" })).toBeChecked();
    showAs("Grid");
    await waitFor(() => expect(cards()).toHaveLength(6));
    expect(screen.queryByRole("region", { name: "Reader" })).toBeNull();
    expect(rows()).toHaveLength(0);
    cleanup();
    window_.server = fakeLibraryServer({ sources: SOURCES, files: files() }).rpc as unknown as typeof window_.server;
    render(<App />);
    await waitFor(() => expect(cards()).toHaveLength(6));
    expect(screen.getByRole("radio", { name: "Grid" })).toBeChecked();
    showAs("List");
    await within(reader()).findByRole("heading", { name: "deploy-steps", level: 2 });
    expect(cards()).toHaveLength(0);
    cleanup();
    render(<App />);
    await waitFor(() => expect(rows()).toHaveLength(6));
  });

  it("holds a card for each row of the list, whatever the sidebar and the search narrow it to", async () => {
    await mount();
    const everything = titles();
    fireEvent.click(navRow(/^Claude/));
    await waitFor(() => expect(titles()).toEqual(["CLAUDE", "deploy-steps"]));
    const claudes = titles();
    fireEvent.click(navRow(/^All memories/));
    search("notarize");
    await waitFor(() => expect(titles()).toEqual(["deploy-steps"]));
    const found = titles();
    search("");
    await waitFor(() => expect(titles()).toEqual(everything));

    showAs("Grid");
    await waitFor(() => expect(cardTitles()).toEqual(everything));
    // What a card says: whose the file is and its kind, its line, where it is, its type and its copies.
    const deploy = cardTitled("deploy-steps");
    expect(deploy.querySelector(".lib-card-kind")!.textContent).toBe("Memory");
    expect(deploy.querySelector(".lib-card-line")!.textContent).toBe("How Atlas ships");
    expect(deploy.querySelector(".lib-row-place")!.textContent).toBe("Realm · Atlas");
    expect(within(deploy).getByText("Project")).toBeInTheDocument();
    expect(within(deploy).getByText("3 copies")).toBeInTheDocument();
    expect(cardTitled("Index")).toHaveAttribute("data-index");
    expect(cardTitled("AGENTS").querySelector(".lib-card-line")).toHaveAttribute("data-empty");

    fireEvent.click(navRow(/^Claude/));
    await waitFor(() => expect(cardTitles()).toEqual(claudes));
    expect(within(list()).getByRole("heading", { name: "Claude", level: 1 })).toBeInTheDocument();
    fireEvent.click(navRow(/^All memories/));
    search("notarize");
    await waitFor(() => expect(cardTitles()).toEqual(found));
    expect(cardTitled("deploy-steps").querySelector(".lib-card-line")!.textContent).toContain("notarize it");
    search("zzz");
    expect(await within(list()).findByText("Nothing matches")).toBeInTheDocument();
  });

  it("opens a card's file across the panel, and Back or Escape returns to the cards", async () => {
    await mount();
    showAs("Grid");
    await waitFor(() => expect(cards()).toHaveLength(6));
    fireEvent.click(cardTitled("Team"));
    await within(reader()).findByRole("heading", { name: "Team", level: 2 });
    expect(screen.queryByRole("region", { name: "Files" })).toBeNull();
    fireEvent.click(within(reader()).getByRole("button", { name: "Back" }));
    await waitFor(() => expect(cards()).toHaveLength(6));
    expect(document.activeElement).toBe(cardTitled("Team"));

    fireEvent.click(cardTitled("CLAUDE"));
    await within(reader()).findByRole("heading", { name: "CLAUDE", level: 2 });
    // THE MUTANT: Escape taken while the file is being edited, and the edit is left without a word.
    fireEvent.click(within(reader()).getByRole("button", { name: "Edit" }));
    await within(reader()).findByRole("button", { name: "Save" });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(within(reader()).getByRole("button", { name: "Save" })).toBeInTheDocument();
    fireEvent.click(within(reader()).getByRole("button", { name: "Cancel" }));
    await within(reader()).findByRole("heading", { name: "CLAUDE", level: 2 });
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(cards()).toHaveLength(6));
  });

  it("reads a memory made from it, and goes back to the cards from one deleted", async () => {
    const server = await mount();
    showAs("Grid");
    await waitFor(() => expect(cards()).toHaveLength(6));
    fireEvent.click(within(list()).getByRole("button", { name: "New memory" }));
    const sheet = await screen.findByRole("dialog", { name: "New memory" });
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Name" }), { target: { value: "Staging URL" } });
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Description" }), { target: { value: "Where staging lives" } });
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Text" }), { target: { value: "https://staging.example" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Save memory" }));
    await screen.findByRole("heading", { name: "Staging URL", level: 2 });
    fireEvent.click(within(reader()).getByRole("button", { name: "Delete Staging URL" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /Delete|Remove/ }));
    await waitFor(() => expect(cards()).toHaveLength(6));
    expect(server.callsTo("library.delete")).toHaveLength(1);
  });
});

describe("the reader", () => {
  it("shows the frontmatter as properties, who loads the file, where it is and its other copies", async () => {
    const reveal = vi.fn(async () => {});
    window.amc = { port: 0, token: "", reveal, dragOut: vi.fn(), share: vi.fn(async () => {}), appearance: { choice: { appearance: "system", accent: "system" }, systemAccent: "#007aff" }, chooseAppearance: async () => {}, onSystemAccent: () => () => {} };
    await mount();
    expect(within(reader()).getByText("How Atlas ships")).toHaveClass("lib-reader-desc");
    const props = reader().querySelector(".lib-props")!;
    expect(props.textContent).toContain("TypeProject");
    expect(props.textContent).toContain("Loaded byRealm starts each session with its MEMORY.md.");
    expect(props.textContent).toContain("originSessionIdsession-a");
    // THE MUTANT: the name and the description repeated as properties under the head that says them.
    expect([...props.querySelectorAll("dt")].map((dt) => dt.textContent)).toEqual(["Type", "Loaded by", "originSessionId", "File", "Copies", "Tags"]);
    const path = reader().querySelector(".lib-path")!;
    expect(path.textContent).toBe("~/spaces/atlas/deploy-steps.md");
    expect(path).toHaveAttribute("title", "/home/spaces/atlas/deploy-steps.md");
    expect(path.querySelector(".lib-path-name")!.textContent).toBe("deploy-steps.md");
    fireEvent.click(within(reader()).getByRole("button", { name: "Show in Finder" }));
    expect(reveal).toHaveBeenCalledWith("/home/spaces/atlas/deploy-steps.md");

    const copies = [...reader().querySelectorAll(".lib-copy")];
    expect(copies.map((c) => c.textContent)).toEqual(["Realm · Atlas · atlasSame text", "Claude · atlasHas changed since"]);
    fireEvent.click(copies[1]!);
    await waitFor(() => expect(reader().querySelector(".lib-path")!.textContent).toBe("~/-atlas/memory/deploy-steps.md"));
    delete window.amc;
  });

  it("opens the file a link names, and draws one that leads nowhere as dead", async () => {
    await mount();
    const links = await waitFor(() => {
      const found = [...reader().querySelectorAll<HTMLAnchorElement>(".documents-rich-surface a")];
      if (found.length < 2) throw new Error("the links are not drawn yet");
      return found;
    });
    const [live, dead] = links;
    expect(live!.textContent).toBe("team");
    expect(live).not.toHaveAttribute("data-dead");
    // THE MUTANT: every link drawn alike, and a click on a dead one that does nothing says nothing.
    expect(dead!.textContent).toBe("missing-note");
    expect(dead).toHaveAttribute("data-dead");
    expect(dead).toHaveAttribute("title", "This link leads to no file");
    fireEvent.click(dead!);
    expect(within(reader()).getByRole("heading", { level: 2 })).toHaveTextContent("deploy-steps");
    fireEvent.click(live!);
    expect(await within(reader()).findByRole("heading", { name: "Team", level: 2 })).toBeInTheDocument();
  });

  it("says a file with nothing in it is empty, and who still loads it", async () => {
    await mount();
    await read("AGENTS");
    const empty = within(reader()).getByRole("heading", { name: "This file is empty" }).closest(".empty-state")!;
    expect(empty).toHaveTextContent("Codex loads it in every session.");
  });

  it("offers no Edit and no Delete on a file its owner rewrites, and says why", async () => {
    await mount();
    await read("Beacon rules");
    expect(within(reader()).getByText("Realm writes this file from the space's memory. Edit it in Realm instead.")).toBeInTheDocument();
    // THE MUTANT: the buttons drawn anyway, each one a refusal waiting to happen.
    expect(within(reader()).queryByRole("button", { name: "Edit" })).toBeNull();
    expect(within(reader()).queryByRole("button", { name: /^Delete/ })).toBeNull();
    await read("Index");
    expect(within(reader()).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(within(reader()).queryByRole("button", { name: /^Delete/ })).toBeNull();
  });
});

describe("editing", () => {
  it("saves the whole file to a repository as one write, with no question", async () => {
    const server = await mount();
    fireEvent.click(within(reader()).getByRole("button", { name: "Edit" }));
    expect(within(reader()).getByRole("status")).toHaveTextContent("No changes · Saving makes one commit");
    expect(within(reader()).getByRole("button", { name: "Save" })).toBeDisabled();
    const view = await sourceEditor();
    expect(view.state.doc.toString()).toBe(DEPLOY_TEXT);
    typeAtEnd(view, "Tag the release.\n");
    expect(within(reader()).getByRole("status")).toHaveTextContent("Edited");
    fireEvent.click(within(reader()).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(server.callsTo("library.write")).toEqual([{ id: DEPLOY, text: `${DEPLOY_TEXT}Tag the release.\n` }]));
    await within(reader()).findByRole("button", { name: "Edit" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks before an agent's own file is changed, names it, and asks once for that place", async () => {
    const server = await mount();
    await read("CLAUDE");
    fireEvent.click(within(reader()).getByRole("button", { name: "Edit" }));
    expect(within(reader()).getByRole("status")).toHaveTextContent("Claude's own file");
    typeAtEnd(await sourceEditor(), "Squash before merging.\n");
    fireEvent.click(within(reader()).getByRole("button", { name: "Save" }));

    const ask = await screen.findByRole("dialog", { name: "Change Claude's own file?" });
    expect(ask).toHaveTextContent("~/.claude/CLAUDE.md");
    expect(ask).toHaveTextContent("CLAUDE.md is Claude's own file, with no history to go back to.");
    expect(ask).toHaveTextContent("kept in the app's backups before your change is written");
    // THE MUTANT: send the yes on the first try — Claude's own file changed with nobody asked.
    expect(server.callsTo("library.write")).toEqual([{ id: USER_INSTRUCTIONS, text: "Prefer small commits.\nSquash before merging.\n" }]);
    expect(server.file(USER_INSTRUCTIONS)!.text).toBe("Prefer small commits.\n");

    fireEvent.click(within(ask).getByRole("button", { name: "Change the file" }));
    await waitFor(() => expect(server.file(USER_INSTRUCTIONS)!.text).toBe("Prefer small commits.\nSquash before merging.\n"));
    expect(server.callsTo("library.write").at(-1)).toMatchObject({ confirmExternal: true });
    await within(reader()).findByRole("button", { name: "Edit" });

    // The same place again: the yes is remembered, so the change is written with no second question.
    fireEvent.click(within(reader()).getByRole("button", { name: "Edit" }));
    typeAtEnd(await sourceEditor(), "Rebase, never merge.\n");
    fireEvent.click(within(reader()).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(server.file(USER_INSTRUCTIONS)!.text).toContain("Rebase, never merge."));
    expect(server.callsTo("library.write")).toHaveLength(3);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("leaves the file as it was when the question is answered no", async () => {
    const server = await mount();
    await read("CLAUDE");
    fireEvent.click(within(reader()).getByRole("button", { name: "Edit" }));
    typeAtEnd(await sourceEditor(), "Squash.\n");
    fireEvent.click(within(reader()).getByRole("button", { name: "Save" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(server.file(USER_INSTRUCTIONS)!.text).toBe("Prefer small commits.\n");
    // Still editing, with what was typed.
    expect(within(reader()).getByRole("status")).toHaveTextContent("Edited");
  });

  it("asks before leaving a file with changes that are not saved", async () => {
    await mount();
    fireEvent.click(within(reader()).getByRole("button", { name: "Edit" }));
    typeAtEnd(await sourceEditor(), "Unsaved.\n");
    fireEvent.click(rowTitled("Team"));
    const ask = await screen.findByRole("dialog", { name: "Discard your changes?" });
    expect(ask).toHaveTextContent("What you changed in deploy-steps.md has not been saved");
    fireEvent.click(within(ask).getByRole("button", { name: "Keep editing" }));
    expect(within(reader()).getByRole("status")).toHaveTextContent("Edited");
    fireEvent.click(navRow(/^Claude/));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(titles()).toEqual(["CLAUDE", "deploy-steps"]));
    expect(within(reader()).queryByRole("status")).toBeNull();
  });

  it("says what the server refused, in the server's words", async () => {
    const server = await mount();
    const call = server.rpc.call;
    server.rpc.call = (async (method: string, params: unknown) => {
      if (method === "library.write") throw new RpcError("LIBRARY_REPO_BUSY", "spaces/atlas/deploy-steps.md has changes that are not committed. Try again when they are.");
      return (call as (m: string, p: unknown) => Promise<unknown>)(method, params);
    }) as typeof call;
    fireEvent.click(within(reader()).getByRole("button", { name: "Edit" }));
    typeAtEnd(await sourceEditor(), "x\n");
    fireEvent.click(within(reader()).getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("has changes that are not committed. Try again when they are.");
    // Nothing was lost: the editor is still up with the text.
    expect(within(reader()).getByRole("status")).toHaveTextContent("Edited");
  });
});

describe("deleting", () => {
  it("says where the file goes before it goes: a commit in a repository, the Trash anywhere else", async () => {
    const server = await mount();
    fireEvent.click(within(reader()).getByRole("button", { name: "Delete deploy-steps" }));
    const commit = await screen.findByRole("dialog", { name: "Delete deploy-steps.md?" });
    expect(commit).toHaveTextContent("removed from the memory repository with one commit");
    expect(server.callsTo("library.delete")).toEqual([]);
    fireEvent.click(within(commit).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(server.callsTo("library.delete")).toEqual([{ id: DEPLOY }]));
    expect(await screen.findByRole("status")).toHaveTextContent("deploy-steps.md was removed with one commit.");
    await waitFor(() => expect(titles()).not.toContain("deploy-steps"));

    await read("CLAUDE");
    fireEvent.click(within(reader()).getByRole("button", { name: "Delete CLAUDE" }));
    const trash = await screen.findByRole("dialog", { name: "Delete CLAUDE.md?" });
    expect(trash).toHaveTextContent("~/.claude/CLAUDE.md");
    expect(trash).toHaveTextContent("This is Claude's own file. It moves to the Trash, and a copy is kept in the app's backups first.");
    fireEvent.click(within(trash).getByRole("button", { name: "Cancel" }));
    expect(server.callsTo("library.delete")).toHaveLength(1);
    fireEvent.click(within(reader()).getByRole("button", { name: "Delete CLAUDE" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Move to Trash" }));
    await waitFor(() => expect(server.callsTo("library.delete").at(-1)).toEqual({ id: USER_INSTRUCTIONS, confirmExternal: true }));
    await waitFor(() => expect(titles()).not.toContain("CLAUDE"));
  });
});

describe("a new memory", () => {
  it("is made where the form says, and read once it is there", async () => {
    const server = await mount();
    fireEvent.click(within(list()).getByRole("button", { name: "New memory" }));
    const sheet = await screen.findByRole("dialog", { name: "New memory" });
    const place = within(sheet).getByRole("combobox", { name: "Kept in" });
    // Only a place with a memory folder is offered.
    expect([...place.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Realm · Sam's memory", "Claude · Project memory"]);
    expect([...within(sheet).getByRole("combobox", { name: "Folder" }).querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Shared by every space", "Atlas"]);
    expect([...within(sheet).getByRole("combobox", { name: "Type" }).querySelectorAll("option")].map((o) => o.textContent)).toEqual(["About you", "Feedback", "Project", "Reference"]);
    const save = within(sheet).getByRole("button", { name: "Save memory" });
    expect(save).toBeDisabled();
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Name" }), { target: { value: "Staging URL" } });
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Description" }), { target: { value: "Where staging lives" } });
    fireEvent.change(within(sheet).getByRole("combobox", { name: "Folder" }), { target: { value: "spaces/atlas" } });
    fireEvent.change(within(sheet).getByRole("combobox", { name: "Type" }), { target: { value: "reference" } });
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Text" }), { target: { value: "https://staging.example" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(server.callsTo("library.create")).toEqual([
      { sourceId: REPO, folder: "spaces/atlas", name: "Staging URL", description: "Where staging lives", type: "reference", body: "https://staging.example" },
    ]));
    expect(await within(reader()).findByRole("heading", { name: "Staging URL", level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(rowTitled("Staging URL")).toHaveAttribute("aria-selected", "true");
  });

  it("asks before it writes into an agent's own folder, and keeps the form if the answer is no", async () => {
    const server = await mount();
    fireEvent.click(within(list()).getByRole("button", { name: "New memory" }));
    const sheet = await screen.findByRole("dialog", { name: "New memory" });
    fireEvent.change(within(sheet).getByRole("combobox", { name: "Kept in" }), { target: { value: "claude-projects" } });
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Name" }), { target: { value: "Beta flag" } });
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Description" }), { target: { value: "The flag that turns beta on" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Save memory" }));

    const ask = await screen.findByRole("dialog", { name: "Write into Claude's own folder?" });
    expect(ask).toHaveTextContent("/home/.claude/projects/-atlas/memory");
    expect(ask).toHaveTextContent("with a line added to the MEMORY.md there");
    fireEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    const again = await screen.findByRole("dialog", { name: "New memory" });
    expect(within(again).getByRole("textbox", { name: "Name" })).toHaveValue("Beta flag");
    fireEvent.click(within(again).getByRole("button", { name: "Save memory" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Write into Claude's own folder?" })).getByRole("button", { name: "Save the memory" }));
    await waitFor(() => expect(server.callsTo("library.create").at(-1)).toMatchObject({ sourceId: "claude-projects", folder: "-atlas/memory", confirmExternal: true }));
    expect(await within(reader()).findByRole("heading", { name: "Beta flag", level: 2 })).toBeInTheDocument();
  });
});

describe("a server that cannot be reached", () => {
  it("is said where the list would have been", async () => {
    window_.server = { call: async () => { throw new RpcError("DISCONNECTED", "socket closed"); } };
    render(<App />);
    const failed = (await within(list()).findByRole("heading", { name: "The library could not be read" })).closest(".empty-state")!;
    expect(failed).toHaveTextContent("socket closed");
    expect(LIBRARY_EXTERNAL_UNCONFIRMED).not.toBe("DISCONNECTED");
  });
});

describe("withoutTitle", () => {
  it("leaves out the opening heading the head already shows, and only that", () => {
    expect(withoutTitle("# House rules\n\nPrefer small PRs.\n", "House rules")).toBe("Prefer small PRs.\n");
    expect(withoutTitle("# Other\n\nText\n", "House rules")).toBe("# Other\n\nText\n");
    expect(withoutTitle("Text first\n# House rules\n", "House rules")).toBe("Text first\n# House rules\n");
  });
});

describe("linkWikiLinks", () => {
  it("draws a [[link]] as a link to what was written, and leaves fenced code alone", () => {
    expect(linkWikiLinks("See [[projects/pay day]].\n```\n[[not a link]]\n```\n")).toBe("See [projects/pay day](<projects/pay day>).\n```\n[[not a link]]\n```\n");
  });
});

describe("linkOf", () => {
  it("finds a link by the href the reader drew it with, escaped or not", () => {
    const links = [{ target: "projects/pay day", id: "a:pay day.md" }, { target: "gone.md", id: null }];
    expect(linkOf(links, "projects/pay%20day")).toEqual(links[0]);
    expect(linkOf(links, "gone.md")).toEqual(links[1]);
    expect(linkOf(links, "https://example.com")).toBeNull();
  });
});

describe("tagsTyped", () => {
  it("reads one word per tag, however they were separated", () => {
    expect(tagsTyped(" #release, ops  beta ")).toEqual(["release", "ops", "beta"]);
    expect(tagsTyped("   ")).toEqual([]);
  });
});

/** The preload bridge with nothing behind it: what the window asked to drag out and to share is kept. */
function standInBridge() {
  const dragOut = vi.fn<(path: string) => void>();
  const share = vi.fn(async (_shared: HandedOut, _at: { x: number; y: number }) => {});
  window.amc = { port: 0, token: "", reveal: async () => {}, dragOut, share, appearance: { choice: { appearance: "system", accent: "system" }, systemAccent: "#007aff" }, chooseAppearance: async () => {}, onSystemAccent: () => () => {} };
  return { dragOut, share };
}
/** A drag's own carrier, as far as a row writes to it. */
const carrier = () => ({ setData: vi.fn<(type: string, text: string) => void>(), effectAllowed: "none" });

describe("handing a file to another app", () => {
  it("drags a row and a card out as the file itself, in place of the page's own drag", async () => {
    const { dragOut } = standInBridge();
    await mount();
    // fireEvent answers false when the page's own drag was cancelled.
    expect(fireEvent.dragStart(rowTitled("deploy-steps"), { dataTransfer: carrier() })).toBe(false);
    expect(dragOut.mock.calls).toEqual([["/home/spaces/atlas/deploy-steps.md"]]);

    fireEvent.click(screen.getByRole("radio", { name: "Grid" }));
    const card = await waitFor(() => document.querySelector<HTMLElement>(`.lib-card[data-id="${DEPLOY}"]`)!);
    expect(card).toHaveAttribute("draggable", "true");
    expect(fireEvent.dragStart(card, { dataTransfer: carrier() })).toBe(false);
    expect(dragOut).toHaveBeenCalledTimes(2);
    expect(dragOut).toHaveBeenLastCalledWith("/home/spaces/atlas/deploy-steps.md");
  });

  it("shares the file being read from the reader's bar", async () => {
    const { share } = standInBridge();
    await mount();
    await read("deploy-steps");
    fireEvent.click(within(reader()).getByRole("button", { name: "Share" }));
    expect(share).toHaveBeenCalledWith({ path: "/home/spaces/atlas/deploy-steps.md" }, { x: 0, y: 6 });
  });
});
