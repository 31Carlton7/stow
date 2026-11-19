import { useEffect, useRef, type ReactNode } from "react";
import { hookFavoriteKey, type FavoriteKind } from "@amc/contracts";
import { Icon } from "@amc/ui";
import { EmptyState } from "../components/EmptyState";
import { dragOut, type HandedOut } from "../components/hand-out";
import { FavoriteButton } from "../components/FavoriteButton";
import { useDissolve } from "../components/ScrollFades";
import { AGENT_MARK, HEALTH_WORD, SETUP_TAB_LABEL, agentsOf, healthOf, hookText, hookTitle, ownerOf, plural, reachedBy, serverText, skillFolder, type HealthState } from "./setup-model";
import type { Setup } from "./use-setup";

function Row({ chosen, onPick, handed, title, badge, line, mono = false, foot, kind, favoriteKey }: {
  chosen: boolean; onPick: () => void; handed: HandedOut; title: string; badge?: ReactNode; line: string | null; mono?: boolean; foot: ReactNode; kind: FavoriteKind; favoriteKey: string;
}) {
  return (
    <li className="lib-row" role="option" aria-selected={chosen} data-selected={chosen || undefined} onClick={onPick} {...dragOut(handed)}>
      <span className="lib-row-head"><span className="lib-row-title">{title}</span>{badge}<FavoriteButton kind={kind} of={favoriteKey} placed="row" /></span>
      <span className="lib-row-line" data-mono={mono || undefined} data-empty={line ? undefined : ""}>{line ?? "No description"}</span>
      <span className="lib-row-foot">{foot}</span>
    </li>
  );
}

/** A server's own picture where its vendor has one, asked for when it is first drawn. `size` is the picture's; its tile is drawn round it. */
export function ServerIcon({ name, setup, size = 20 }: { name: string; setup: Setup; size?: number }) {
  const { wantIcon } = setup;
  useEffect(() => { wantIcon(name); }, [name, wantIcon]);
  const picture = setup.icons[name];
  return (
    <span className="setup-icon" aria-hidden="true">
      {picture ? <img src={picture} alt="" width={size} height={size} /> : <Icon name="plug" size={Math.round(size * 0.8)} />}
    </span>
  );
}

export function HealthMark({ state, checking = false }: { state: HealthState; checking?: boolean }) {
  return <span className="setup-health" data-state={state}>{checking ? "Checking" : HEALTH_WORD[state]}</span>;
}

export function SetupList({ setup }: { setup: Setup }) {
  const { tab, shownSkills, shownServers, shownHooks } = setup;
  const checkingAny = setup.checking.length > 0;
  const scroller = useRef<HTMLUListElement>(null);
  useDissolve(scroller);
  const loaded = tab === "skills" ? shownSkills : tab === "mcp" ? shownServers : shownHooks;
  const starredOnly = tab === "skills" ? setup.skillScope.kind === "favorites" : setup.starredOnly[tab];

  return (
    <section className="col col-list" aria-label={SETUP_TAB_LABEL[tab]}>
      <header className="col-head lib-list-head">
        <h1 className="lib-list-title">{SETUP_TAB_LABEL[tab]}</h1>
        {tab === "mcp" && (
          <>
            <button type="button" className="btn" aria-busy={checkingAny || undefined} disabled={checkingAny || !shownServers?.length} onClick={setup.checkAll}>{checkingAny ? "Checking" : "Check all"}</button>
            <button type="button" className="btn" onClick={() => setup.open("add-server")}><Icon name="add" size={12} />Add</button>
          </>
        )}
        {tab === "skills" && <button type="button" className="btn" onClick={() => setup.open("add-skills")}><Icon name="add" size={12} />Add skills</button>}
        <button type="button" className="icon-btn" aria-label="Read again" title="Read again" aria-busy={setup.loading || undefined} disabled={setup.loading} onClick={() => void setup.load()}>
          <Icon name="reload" size={14} />
        </button>
      </header>
      {tab === "skills" && (
        <label className="lib-search">
          <Icon name="search" size={14} />
          <input className="search-field" type="search" aria-label="Filter the skills" placeholder="Filter" spellCheck={false} value={setup.query} onChange={(e) => setup.setQuery(e.target.value)} />
        </label>
      )}
      {loaded === null ? (
        setup.error !== null
          ? <EmptyState icon="alert" title="The setup could not be read" role="status">{setup.error}</EmptyState>
          : <EmptyState className="is-late" role="status" title="Reading the setup" />
      ) : loaded.length === 0 ? (
        tab === "skills" && setup.query.trim() !== "" ? <EmptyState icon="search" title="Nothing matches">The filter reads each skill's name, description and owner.</EmptyState>
          : starredOnly ? <EmptyState icon="star" title="No favorites">Star a {tab === "skills" ? "skill" : tab === "mcp" ? "server" : "hook"} to keep it here.</EmptyState>
          : tab === "skills" && setup.skillScope.kind === "issues" ? <EmptyState icon="checkCircle" title="Nothing needs a look">No skill has anything that would stop it working.</EmptyState>
          : tab === "skills" ? <EmptyState icon="book" title="No skills">No agent on this Mac has a skills folder with a skill in it.</EmptyState>
          : tab === "mcp" ? <EmptyState icon="plug" title="No MCP servers">No agent's config on this Mac defines one. Add puts one in.</EmptyState>
          : <EmptyState icon="zap" title="No hooks">No agent on this Mac runs a command around its work.</EmptyState>
      ) : (
        <ul className="lib-rows" role="listbox" aria-label={SETUP_TAB_LABEL[tab]} tabIndex={0} ref={scroller}>
          {tab === "skills" && shownSkills!.map((skill) => (
            <Row key={skill.id} chosen={setup.skillId === skill.id} onPick={() => setup.pickSkill(skill.id)} handed={{ path: skillFolder(skill) }} title={skill.name} line={skill.description} kind="skill" favoriteKey={skill.id}
              badge={skill.copies > 1 && (
                <span className="lib-row-copies" title={`${skill.copies} folders on this Mac hold exactly this skill`}><Icon name="copy" size={12} />{skill.copies} copies</span>
              )}
              foot={<>
                <span className="lib-row-place">{reachedBy(skill)}</span>
                {skill.variants > 0 && <span className="lib-chip" data-tone="warning">{plural(skill.variants, "other version")}</span>}
                {!skill.valid && <span className="lib-chip" data-tone="warning">Cannot be picked</span>}
                {setup.issues.has(skill.id) && <span className="lib-chip" data-tone="warning" title={setup.issues.get(skill.id)!.map((issue) => issue.detail).join("\n")}>Needs a look</span>}
              </>} />
          ))}
          {tab === "mcp" && shownServers!.map((server) => (
            <li key={server.name} className="lib-row setup-server" role="option" aria-selected={setup.server?.name === server.name} data-selected={setup.server?.name === server.name || undefined}
              onClick={() => setup.pickServer(server.name)} {...dragOut({ text: serverText(server) })}>
              <ServerIcon name={server.name} setup={setup} />
              <span className="setup-server-text">
                <span className="lib-row-head">
                  <span className="lib-row-title">{server.name}</span>
                  <HealthMark state={healthOf(setup.health, server)} checking={setup.checking.includes(server.name)} />
                  <FavoriteButton kind="mcp" of={server.name} placed="row" />
                </span>
                <span className="lib-row-line" data-mono>{server.definitions[0]?.target ?? ""}</span>
                <span className="lib-row-foot">
                  <span className="setup-agents">
                    {agentsOf(server).map((agent) => (
                      <span key={agent} className="setup-agent" title={agent} role="img" aria-label={agent}><Icon name={AGENT_MARK[agent] ?? "terminal"} size={12} /></span>
                    ))}
                  </span>
                  <span className="lib-row-place">{plural(server.definitions.length, "place")}</span>
                  {server.conflict && <span className="lib-chip" data-tone="warning">Defined two ways</span>}
                </span>
              </span>
            </li>
          ))}
          {tab === "hooks" && shownHooks!.map(({ hook, at }) => (
            <Row key={`${hook.file}:${hook.event}:${at}`} chosen={setup.hookAt === at} onPick={() => setup.pickHook(at)} handed={{ text: hookText(hook) }} title={hookTitle(hook)} line={hook.command} mono kind="hook" favoriteKey={hookFavoriteKey(hook)}
              foot={<span className="lib-row-place">{ownerOf(hook)}</span>} />
          ))}
        </ul>
      )}
    </section>
  );
}
