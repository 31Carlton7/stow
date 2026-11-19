import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Favorite, FavoriteKind, Skill } from "@amc/contracts";
import { LibraryList } from "../library/LibraryList";
import { LibraryReader } from "../library/LibraryReader";
import { LibrarySidebar } from "../library/LibrarySidebar";
import { fakeFile, fakeLibraryServer, fakeSource } from "../library/library.test-fakes";
import { useLibrary, type LibraryRpc } from "../library/use-library";
import { SetupDetail } from "../setup/SetupDetail";
import { SetupList } from "../setup/SetupList";
import { SkillsSidebar } from "../setup/SetupSidebar";
import { useSetup, type SetupRpc } from "../setup/use-setup";
import { FavoritesPage } from "./FavoritesPage";
import { FavoritesSidebar, type FavoritesShown } from "./FavoritesSidebar";
import { useFavoriteItems, type FavoriteItem } from "./use-favorite-items";
import { FavoritesProvider, type FavoritesRpc } from "./use-favorites";

type Answer = (method: string, params: Record<string, unknown>) => Promise<unknown>;

/** A server that keeps what is starred, and hands every other method to the section's own fake. */
function withFavorites(rest: Answer) {
  let favorites: Favorite[] = [];
  const call: Answer = async (method, params) => {
    if (method === "favorites.list") return { favorites };
    if (method !== "favorites.set") return rest(method, params);
    const { kind, key, on } = params as { kind: FavoriteKind; key: string; on: boolean };
    favorites = favorites.filter((f) => !(f.kind === kind && f.key === key));
    if (on) favorites = [{ kind, key, at: Date.now() }, ...favorites];
    return { favorites };
  };
  return { call } as unknown as FavoritesRpc & SetupRpc & LibraryRpc;
}

const skill = (id: string, name: string, description: string): Skill => ({
  id, name, description, path: `/home/skills/${name}/SKILL.md`, places: [{ label: "Claude", displayPath: `~/.claude/skills/${name}`, linked: false }],
  copies: 1, variants: 0, valid: true, updatedAt: Date.now() - 60_000,
});
const SKILLS = [skill("s-release", "release", "Ship a release"), skill("s-lint", "lint", "Run the linters"), skill("s-notes", "release-notes", "Write what changed")];

const setupAnswers: Answer = async (method, params) => {
  if (method === "setup.skills") return { skills: SKILLS };
  if (method === "setup.mcp") return { servers: [] };
  if (method === "setup.hooks") return { hooks: [] };
  if (method === "setup.skill") return { ...SKILLS.find((s) => s.id === params.id)!, body: "", files: [] };
  throw new Error(`no answer for ${method}`);
};

function SkillsSection({ rpc }: { rpc: SetupRpc }) {
  const setup = useSetup(rpc);
  return <><SkillsSidebar setup={setup} /><SetupList setup={setup} /><SetupDetail setup={setup} /></>;
}

async function mountSkills() {
  const rpc = withFavorites(setupAnswers);
  render(<FavoritesProvider rpc={rpc}><SkillsSection rpc={rpc} /></FavoritesProvider>);
  await screen.findByRole("option", { name: /lint/ });
}

const row = (name: RegExp) => screen.getByRole("option", { name });
const starOf = (name: RegExp) => within(row(name)).getByRole("button", { name: /Favorites/ });
const sidebarCount = (nav: string) => within(screen.getByRole("navigation", { name: nav })).getByRole("button", { name: /^Favorites/ }).textContent;

describe("a star", () => {
  it("pressed in a row shows in the reader's bar and the sidebar's count", async () => {
    await mountSkills();
    fireEvent.click(row(/lint/));
    const reader = screen.getByRole("region", { name: "Reader" });
    const inBar = await within(reader).findByRole("button", { name: "Add to Favorites" });
    expect(inBar.getAttribute("aria-pressed")).toBe("false");
    expect(sidebarCount("Skills")).toBe("Favorites0");

    fireEvent.click(starOf(/lint/));
    expect(within(reader).getByRole("button", { name: "Remove from Favorites" }).getAttribute("aria-pressed")).toBe("true");
    expect(starOf(/lint/).getAttribute("aria-pressed")).toBe("true");
    expect(sidebarCount("Skills")).toBe("Favorites1");

    fireEvent.click(within(reader).getByRole("button", { name: "Remove from Favorites" }));
    await waitFor(() => expect(starOf(/lint/).getAttribute("aria-pressed")).toBe("false"));
    expect(sidebarCount("Skills")).toBe("Favorites0");
  });

  it("does not open the row it is on", async () => {
    await mountSkills();
    fireEvent.click(starOf(/lint/));
    expect(row(/lint/).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByText("Pick a skill")).toBeTruthy();
  });
});

describe("the Favorites row of a section", () => {
  it("narrows the skills to the starred, and the filter narrows those", async () => {
    await mountSkills();
    fireEvent.click(starOf(/^release(?!-)/));
    fireEvent.click(starOf(/lint/));
    fireEvent.click(within(screen.getByRole("navigation", { name: "Skills" })).getByRole("button", { name: /^Favorites/ }));
    expect(screen.getAllByRole("option").map((o) => within(o).getByText(/./, { selector: ".lib-row-title" }).textContent)).toEqual(["release", "lint"]);

    fireEvent.change(screen.getByRole("searchbox", { name: "Filter the skills" }), { target: { value: "release" } });
    // "release-notes" matches the words and is not starred.
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(row(/release/).textContent).toContain("Ship a release");

    fireEvent.click(starOf(/release/));
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("narrows the library's files to the starred, under the search", async () => {
    const source = fakeSource({ id: "repo", group: "realm", kind: "memory", label: "Sam's memory" });
    const file = (rel: string, title: string, body: string, minutes: number) =>
      fakeFile({ sourceId: "repo", group: "realm", kind: "memory", rel, title, text: body, body, updatedAt: Date.now() - minutes * 60_000 });
    const library = fakeLibraryServer({ sources: [source], files: [
      file("deploy.md", "Deploy", "Sign the build.", 1), file("team.md", "Team", "Riley signs releases.", 2), file("style.md", "Style", "Prefer small commits.", 3),
    ] });
    const rpc = withFavorites((method, params) => library.rpc.call(method as never, params as never));
    function LibrarySection() {
      const held = useLibrary(rpc);
      return <><LibrarySidebar library={held} /><LibraryList library={held} /><LibraryReader library={held} /></>;
    }
    render(<FavoritesProvider rpc={rpc}><LibrarySection /></FavoritesProvider>);
    await screen.findByRole("option", { name: /Style/ });

    fireEvent.click(starOf(/Deploy/));
    fireEvent.click(starOf(/Style/));
    expect(sidebarCount("Library")).toBe("Favorites2");
    fireEvent.click(within(screen.getByRole("navigation", { name: "Library" })).getByRole("button", { name: /^Favorites/ }));
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    expect(screen.queryByRole("option", { name: /Team/ })).toBeNull();

    // "sign" is in Deploy and in Team; only Deploy is starred.
    fireEvent.change(screen.getByRole("searchbox", { name: "Search the library" }), { target: { value: "sign" } });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
    expect(row(/Deploy/)).toBeTruthy();
  });
});

describe("the Favorites section", () => {
  it("lists what is starred under its kind, counts each kind, and hands a card's thing to be opened", async () => {
    const source = fakeSource({ id: "repo", group: "realm", kind: "memory", label: "Sam's memory" });
    const deploy = fakeFile({ sourceId: "repo", group: "realm", kind: "memory", rel: "deploy.md", title: "Deploy", description: "How it ships" });
    const library = fakeLibraryServer({ sources: [source], files: [deploy] });
    const rpc = withFavorites((method, params) => (method.startsWith("library.") ? library.rpc.call(method as never, params as never) : setupAnswers(method, params)));
    await rpc.call("favorites.set", { kind: "file", key: deploy.id, on: true });
    await rpc.call("favorites.set", { kind: "skill", key: "s-lint", on: true });
    // Its file is gone: it is kept, and not listed.
    await rpc.call("favorites.set", { kind: "file", key: "repo:gone.md", on: true });
    const opened: FavoriteItem[] = [];
    function Section() {
      const [shown, show] = useState<FavoritesShown>("all");
      const items = useFavoriteItems(rpc, useSetup(rpc), true);
      return <><FavoritesSidebar items={items} shown={shown} show={show} /><FavoritesPage items={items} shown={shown} onOpen={(item) => opened.push(item)} /></>;
    }
    render(<FavoritesProvider rpc={rpc}><Section /></FavoritesProvider>);

    const memories = await screen.findByRole("list", { name: "Memories" });
    expect(within(memories).getByRole("button", { name: /Deploy/ }).textContent).toContain("How it ships");
    await within(screen.getByRole("list", { name: "Skills" })).findByRole("button", { name: /lint/ });
    const nav = screen.getByRole("navigation", { name: "Favorites" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["All2", "Memories1", "Skills1", "MCP servers0", "Hooks0", "Sessions0"]);

    fireEvent.click(within(nav).getByRole("button", { name: /^Skills/ }));
    expect(screen.queryByRole("list", { name: "Memories" })).toBeNull();
    fireEvent.click(within(screen.getByRole("list", { name: "Skills" })).getByRole("button", { name: /lint/ }));
    expect(opened).toMatchObject([{ kind: "skill", key: "s-lint" }]);

    fireEvent.click(screen.getByRole("button", { name: "Remove from Favorites" }));
    expect(await screen.findByText("No favorites")).toBeTruthy();
    expect(opened).toHaveLength(1);
  });
});
