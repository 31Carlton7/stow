import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hookFavoriteKey, type Hook, type McpAgent, type McpDefinition, type McpHealth, type McpServer, type Skill, type SkillDetail, type SkillIssue } from "@amc/contracts";
import { useFavorites } from "../favorites/use-favorites";
import { said, type RpcClient } from "../rpc/client";
import { toast } from "../toasts";
import { agentsOf, skillsInScope, skillsKept, type SetupTab, type SkillScope } from "./setup-model";

export type SetupRpc = Pick<RpcClient, "call">;

/** How long the window waits before asking again about servers still being checked. */
export const HEALTH_POLL_MS = 2000;

/** The one sheet that is up over the section. A removal carries what it would take away, to name it. */
export type SetupSheet =
  | { kind: "add-server" }
  | { kind: "add-skills" }
  | { kind: "remove-server"; name: string; place: McpDefinition; agent: McpAgent; refusal: string | null }
  | { kind: "remove-skill"; skill: Skill; refusal: string | null };

/**
 * The state of the Skills, MCP servers and Hooks sections: what is found on this Mac, which of the
 * three is listed, the one being read, what is known of each server's health and each skill's, and
 * the sheet that is up. Every change is sent, then the lists are read again from the server.
 */
export function useSetup(rpc: SetupRpc) {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [hooks, setHooks] = useState<Hook[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<SetupTab>("skills");
  const [query, setQuery] = useState("");
  const [skillId, setSkillId] = useState<string | null>(null);
  const [serverName, setServerName] = useState<string | null>(null);
  const [hookAt, setHookAt] = useState<number | null>(null);
  const [skill, setSkill] = useState<SkillDetail | null>(null);
  const [skillError, setSkillError] = useState<string | null>(null);
  const [health, setHealth] = useState<McpHealth[]>([]);
  const [checking, setChecking] = useState<string[]>([]);
  const [icons, setIcons] = useState<Record<string, string | null>>({});
  const iconsAsked = useRef(new Set<string>());
  const [issues, setIssues] = useState<ReadonlyMap<string, SkillIssue[]>>(new Map());
  const [agent, setAgent] = useState<string | null>(null);
  const [skillScope, setSkillScope] = useState<SkillScope>({ kind: "all" });
  /** The servers and the hooks each narrowed to what is starred, or not. */
  const [starredOnly, setStarredOnly] = useState({ mcp: false, hooks: false });
  const favorites = useFavorites();
  const [sheet, setSheet] = useState<SetupSheet | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [s, m, h] = await Promise.all([rpc.call("setup.skills", {}), rpc.call("setup.mcp", {}), rpc.call("setup.hooks", {})]);
      setSkills(s.skills);
      setServers(m.servers);
      setHooks(h.hooks);
      // A hook has no name of its own, so the one being read is its place in the list, which a new list need not keep.
      setHookAt(null);
      setError(null);
    } catch (e) {
      setError(said(e));
    } finally {
      setLoading(false);
    }
  }, [rpc]);

  /* Health is read apart from the lists and its failure is kept quiet: a server that cannot say how
     its MCP servers are still lists them, each as not checked. Asking for a check says why it failed. */
  const readHealth = useCallback(async (check = false, name?: string): Promise<void> => {
    const known = await rpc.call("mcp.health", name === undefined ? { check } : { check, name });
    setHealth(known.health);
    setChecking(known.checking);
  }, [rpc]);
  const readSkillHealth = useCallback(async (): Promise<void> => {
    try {
      const known = await rpc.call("skills.health", {});
      setIssues(new Map(known.skills.filter((s) => s.issues.length > 0).map((s) => [s.id, s.issues])));
    } catch {
      setIssues(new Map());
    }
  }, [rpc]);

  const loadAll = useCallback(async (): Promise<void> => {
    await Promise.all([load(), readHealth().catch(() => {}), readSkillHealth()]);
  }, [load, readHealth, readSkillHealth]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  useEffect(() => {
    if (checking.length === 0) return;
    const timer = setTimeout(() => { readHealth().catch(() => setChecking([])); }, HEALTH_POLL_MS);
    return () => clearTimeout(timer);
  }, [checking, readHealth]);

  const check = (name?: string): void => {
    readHealth(true, name).catch((e: unknown) => toast({ tone: "error", text: said(e) }));
  };

  useEffect(() => {
    setSkill(null);
    setSkillError(null);
    if (skillId === null) return;
    let live = true;
    rpc.call("setup.skill", { id: skillId }).then(
      (detail) => { if (live) setSkill(detail); },
      (e: unknown) => { if (live) setSkillError(said(e)); },
    );
    return () => { live = false; };
  }, [rpc, skillId]);

  const shownSkills = useMemo(
    () => (skills === null ? null : skillsKept(query, skillsInScope(skillScope, skills, issues, (id) => favorites.has("skill", id)))),
    [skills, query, skillScope, issues, favorites],
  );
  const shownServers = useMemo(() => {
    if (servers === null) return null;
    if (starredOnly.mcp) return servers.filter((s) => favorites.has("mcp", s.name));
    return agent === null ? servers : servers.filter((s) => agentsOf(s).includes(agent));
  }, [servers, agent, starredOnly.mcp, favorites]);
  // Each hook keeps its place in the whole list, which is what the one being read is known by.
  const shownHooks = useMemo(() => {
    if (hooks === null) return null;
    const placed = hooks.map((hook, at) => ({ hook, at }));
    return starredOnly.hooks ? placed.filter(({ hook }) => favorites.has("hook", hookFavoriteKey(hook))) : placed;
  }, [hooks, starredOnly.hooks, favorites]);

  return {
    skills, servers, hooks, error, loading, tab, query, skillId, skill, skillError,
    shownSkills, shownServers, shownHooks, starredOnly,
    server: servers?.find((s) => s.name === serverName) ?? null,
    hookAt,
    hook: hookAt === null ? null : hooks?.[hookAt] ?? null,
    health, checking, icons, issues, agent, skillScope, sheet, removing,

    load: loadAll, setTab, setQuery, setSkillScope,
    setAgent(to: string | null): void { setAgent(to); setStarredOnly((held) => ({ ...held, mcp: false })); },
    showStarred(of: "mcp" | "hooks", only: boolean): void { setStarredOnly((held) => ({ ...held, [of]: only })); },
    pickSkill: setSkillId,
    pickServer: setServerName,
    pickHook: setHookAt,
    reveal(path: string): void { void window.amc?.reveal(path); },

    checkAll: () => check(),
    checkServer: (name: string) => check(name),
    /** Asked once for each name, by the row that shows it. A server with no icon to be had keeps the plain glyph. */
    wantIcon(name: string): void {
      if (iconsAsked.current.has(name)) return;
      iconsAsked.current.add(name);
      rpc.call("mcp.icon", { name }).then((answered) => setIcons((held) => ({ ...held, [name]: answered.icon })), () => {});
    },
    async signIn(name: string, to: McpAgent): Promise<void> {
      try {
        const answered = await rpc.call("mcp.signIn", { name, agent: to });
        toast(answered.started
          ? { tone: "info", text: answered.detail ?? `The sign-in for ${name} is open in your browser. Check again once you have signed in.` }
          : { tone: "error", text: answered.detail ?? `The sign-in for ${name} could not be started.` });
      } catch (e) {
        toast({ tone: "error", text: said(e) });
      }
    },

    open: (kind: "add-server" | "add-skills") => setSheet({ kind }),
    askRemoveServer: (name: string, place: McpDefinition, from: McpAgent) => setSheet({ kind: "remove-server", name, place, agent: from, refusal: null }),
    askRemoveSkill: (from: Skill) => setSheet({ kind: "remove-skill", skill: from, refusal: null }),
    closeSheet: () => setSheet(null),
    /** Take away what the sheet names. A refusal stays in the sheet, under what was asked. */
    async remove(place?: string): Promise<void> {
      if (sheet === null || removing || (sheet.kind !== "remove-server" && sheet.kind !== "remove-skill")) return;
      setRemoving(true);
      try {
        if (sheet.kind === "remove-server") {
          const outcome = await rpc.call("mcp.remove", { name: sheet.name, agent: sheet.agent, projectId: sheet.place.projectId });
          if (!outcome.ok) { setSheet({ ...sheet, refusal: outcome.detail ?? "The agent's tool refused, and did not say why." }); return; }
          toast({ tone: "success", text: `${sheet.name} was removed from ${sheet.place.agent}.` });
        } else {
          await rpc.call("skills.remove", place === undefined ? { id: sheet.skill.id } : { id: sheet.skill.id, place });
          toast({ tone: "success", text: `${sheet.skill.name} was moved to the Trash.` });
          if (place === undefined || sheet.skill.places.length === 1) setSkillId(null);
        }
        setSheet(null);
        await loadAll();
      } catch (e) {
        setSheet({ ...sheet, refusal: said(e) });
      } finally {
        setRemoving(false);
      }
    },
  };
}

export type Setup = ReturnType<typeof useSetup>;
