import { useRef, type ReactNode } from "react";
import { hookFavoriteKey } from "@amc/contracts";
import { Icon } from "@amc/ui";
import { useFavorites } from "../favorites/use-favorites";
import { useDissolve } from "../components/ScrollFades";
import { AGENT_MARK, agentCounts, healthSummary, placeCounts, type SkillScope } from "./setup-model";
import type { Setup } from "./use-setup";

const sameScope = (a: SkillScope, b: SkillScope): boolean => a.kind === b.kind && (a.kind !== "place" || a.label === (b as typeof a).label);

function NavRow({ chosen, onPick, label, count, mark }: { chosen: boolean; onPick: () => void; label: string; count: number; mark: ReactNode }) {
  return (
    <li>
      <button type="button" className="lib-nav-row" data-selected={chosen || undefined} aria-current={chosen || undefined} onClick={onPick}>
        {mark}
        <span className="lib-nav-name">{label}</span>
        <span className="lib-nav-count">{count}</span>
      </button>
    </li>
  );
}

/** Under MCP servers: every server, then each agent's, then what the last check found. */
export function McpSidebar({ setup }: { setup: Setup }) {
  const { servers, agent, health } = setup;
  const favorites = useFavorites();
  const starred = setup.starredOnly.mcp;
  const scroller = useRef<HTMLElement>(null);
  useDissolve(scroller);
  const summary = servers === null ? null : healthSummary(health, servers);
  return (
    <nav className="sb-list lib-nav" aria-label="MCP servers" ref={scroller}>
      {servers !== null && (
        <>
          <ul className="lib-nav-list">
            <NavRow chosen={agent === null && !starred} onPick={() => setup.setAgent(null)} label="All servers" count={servers.length} mark={<Icon name="plug" size={16} className="lib-nav-mark" />} />
            <NavRow chosen={starred} onPick={() => setup.showStarred("mcp", true)} label="Favorites" count={servers.filter((s) => favorites.has("mcp", s.name)).length}
              mark={<Icon name="star" size={16} className="lib-nav-mark" />} />
          </ul>
          {servers.length > 0 && (
            <ul className="lib-nav-list" aria-label="Agents">
              {agentCounts(servers).map((a) => (
                <NavRow key={a.agent} chosen={agent === a.agent && !starred} onPick={() => setup.setAgent(a.agent)} label={a.agent} count={a.count}
                  mark={<Icon name={AGENT_MARK[a.agent] ?? "terminal"} size={16} className="lib-nav-mark" />} />
              ))}
            </ul>
          )}
          {summary !== null && <p className="setup-nav-health" role="status">{summary}</p>}
        </>
      )}
    </nav>
  );
}

/** Under Skills: every skill, then each place skills are reached from, then the ones with something wrong. */
export function SkillsSidebar({ setup }: { setup: Setup }) {
  const { skills, skillScope, issues } = setup;
  const favorites = useFavorites();
  const scroller = useRef<HTMLElement>(null);
  useDissolve(scroller);
  const row = (key: string, to: SkillScope, label: string, count: number, mark: ReactNode) => (
    <NavRow key={key} chosen={sameScope(skillScope, to)} onPick={() => setup.setSkillScope(to)} label={label} count={count} mark={mark} />
  );
  return (
    <nav className="sb-list lib-nav" aria-label="Skills" ref={scroller}>
      {skills !== null && (
        <>
          <ul className="lib-nav-list">
            {row("all", { kind: "all" }, "All skills", skills.length, <Icon name="book" size={16} className="lib-nav-mark" />)}
            {row("favorites", { kind: "favorites" }, "Favorites", skills.filter((s) => favorites.has("skill", s.id)).length, <Icon name="star" size={16} className="lib-nav-mark" />)}
          </ul>
          {skills.length > 0 && (
            <>
              <h2 className="sb-section">Reached from</h2>
              <ul className="lib-nav-list" aria-label="Reached from">
                {placeCounts(skills).map((p) => row(p.label, { kind: "place", label: p.label }, p.label, p.count, <Icon name="folder" size={16} className="lib-nav-mark" />))}
              </ul>
              <ul className="lib-nav-list">
                {row("issues", { kind: "issues" }, "Needs a look", skills.filter((s) => issues.has(s.id)).length, <Icon name="alert" size={16} className="lib-nav-mark" />)}
              </ul>
            </>
          )}
        </>
      )}
    </nav>
  );
}

/** Under Hooks: every hook, and the starred ones. */
export function HooksSidebar({ setup }: { setup: Setup }) {
  const { hooks } = setup;
  const favorites = useFavorites();
  const starred = setup.starredOnly.hooks;
  const scroller = useRef<HTMLElement>(null);
  useDissolve(scroller);
  return (
    <nav className="sb-list lib-nav" aria-label="Hooks" ref={scroller}>
      {hooks !== null && (
        <ul className="lib-nav-list">
          <NavRow chosen={!starred} onPick={() => setup.showStarred("hooks", false)} label="All hooks" count={hooks.length} mark={<Icon name="zap" size={16} className="lib-nav-mark" />} />
          <NavRow chosen={starred} onPick={() => setup.showStarred("hooks", true)} label="Favorites" count={hooks.filter((h) => favorites.has("hook", hookFavoriteKey(h))).length}
            mark={<Icon name="star" size={16} className="lib-nav-mark" />} />
        </ul>
      )}
    </nav>
  );
}
