import { Suspense, lazy, useRef } from "react";
import { hookFavoriteKey, type Hook, type McpServer, type SkillDetail, type SkillIssue } from "@amc/contracts";
import { Icon } from "@amc/ui";
import { EmptyState } from "../components/EmptyState";
import { ShareButton, type HandedOut } from "../components/hand-out";
import { FavoriteButton } from "../components/FavoriteButton";
import { SourceMark } from "../components/SourceMark";
import { useDissolve } from "../components/ScrollFades";
import { ago, stampTitle, useNow } from "../library/when";
import { PathLabel } from "../review/DiffView";
import { HealthMark, ServerIcon } from "./SetupList";
import { agentOfPlace, healthAt, hookText, hookTitle, mcpAgentOf, ownerOf, plural, serverText, skillFolder, waysOf } from "./setup-model";
import type { Setup } from "./use-setup";

const RichTextEditor = lazy(() => import("../editors/RichTextEditor").then((m) => ({ default: m.RichTextEditor })));
const NOOP = () => {};
/** How many of a skill's other files are named before the rest are counted. */
const FILES_SHOWN = 12;

function SkillPage({ skill, issues, onReveal, onRemove }: { skill: SkillDetail; issues: SkillIssue[]; onReveal: (path: string) => void; onRemove: () => void }) {
  const now = useNow();
  return (
    <article className="lib-reader" aria-labelledby="setup-title">
      <h2 className="lib-reader-title" id="setup-title">{skill.name}</h2>
      <p className="lib-reader-where">
        Skill · <time dateTime={new Date(skill.updatedAt).toISOString()} title={stampTitle(skill.updatedAt)}>Edited {ago(skill.updatedAt, now)}</time>
      </p>
      {skill.description && <p className="lib-reader-desc">{skill.description}</p>}
      {!skill.valid && (
        <p className="lib-reader-note"><Icon name="alert" size={14} />
          <span>Its SKILL.md is missing the name or the description an agent picks a skill by, so no agent will load it.</span>
        </p>
      )}
      {issues.map((issue) => (
        <p key={`${issue.kind}:${issue.detail}`} className="lib-reader-note setup-issue" data-tone="warning"><Icon name="alert" size={14} /><span>{issue.detail}</span></p>
      ))}
      <dl className="lib-props">
        <dt>Reached from</dt>
        <dd>
          <ul className="setup-places">
            {skill.places.map((place) => (
              <li key={place.displayPath}>
                <span className="setup-place-who"><SourceMark of={agentOfPlace(place.label)} />{place.label}</span>
                <PathLabel className="setup-place-path" path={place.displayPath} />
                <span className="setup-place-how">{place.linked ? "Link" : "Its own folder"}</span>
              </li>
            ))}
          </ul>
        </dd>
        {skill.copies > 1 && <><dt>Copies</dt><dd>{skill.copies} folders on this Mac hold exactly this skill, and they are not links to one another.</dd></>}
        {skill.variants > 0 && <><dt>Versions</dt><dd>{plural(skill.variants, "other skill")} on this Mac {skill.variants === 1 ? "has" : "have"} this name with different text.</dd></>}
        <dt>File</dt>
        <dd className="lib-props-file">
          <code className="lib-path" title={skill.path}><span className="lib-path-name">SKILL.md</span></code>
          <button type="button" className="icon-btn" aria-label="Show in Finder" title="Show in Finder" onClick={() => onReveal(skill.path)}><Icon name="folder" size={14} /></button>
        </dd>
        {skill.files.length > 0 && (
          <>
            <dt>Other files</dt>
            <dd className="setup-files">
              {skill.files.slice(0, FILES_SHOWN).join(", ")}{skill.files.length > FILES_SHOWN && ` and ${skill.files.length - FILES_SHOWN} more`}
            </dd>
          </>
        )}
      </dl>
      <p className="setup-acts"><button type="button" className="btn" onClick={onRemove}>Remove</button></p>
      {skill.body.trim() === "" ? <p className="lib-reader-none">Nothing is written below its properties.</p> : (
        <div className="lib-reader-body" data-selectable>
          <Suspense fallback={null}><RichTextEditor key={skill.id} text={skill.body} onChange={NOOP} readOnly /></Suspense>
        </div>
      )}
    </article>
  );
}

function ServerPage({ server, setup }: { server: McpServer; setup: Setup }) {
  const checking = setup.checking.includes(server.name);
  const ways = waysOf(server);
  const places = server.definitions.length;
  return (
    <article className="lib-reader" aria-labelledby="setup-title">
      <h2 className="lib-reader-title setup-title" id="setup-title"><ServerIcon name={server.name} setup={setup} size={26} />{server.name}</h2>
      <p className="lib-reader-where">MCP server · defined in {plural(places, "place")}</p>
      {server.conflict ? (
        <p className="lib-reader-note" data-tone="warning"><Icon name="alert" size={14} />
          <span>It is started {ways.length} different ways, so agents that call it by this name do not get the same tools.</span>
        </p>
      ) : places > 1 && <p className="lib-reader-desc">Every place starts it the same way.</p>}
      {ways.map((way, at) => (
        <section key={way.fingerprint} className="setup-way" aria-label={ways.length > 1 ? `Way ${at + 1}` : "How it is started"}>
          <h3 className="rev-heading">{ways.length > 1 ? `Way ${at + 1}, in ${plural(way.places.length, "place")}` : "How it is started"}</h3>
          <pre className="setup-code" data-selectable>{way.target}</pre>
          <ul className="setup-places">
            {way.places.map((place) => {
              const health = healthAt(setup.health, server.name, place);
              const agent = mcpAgentOf(place.agent);
              return (
                <li key={`${place.file}:${place.agent}:${place.projectId ?? ""}`}>
                <span className="setup-place-who"><SourceMark of={place.agent} />{ownerOf(place)}</span>
                <PathLabel className="setup-place-path" path={place.file} />
                <span className="setup-place-how">
                  {[place.transport === "unknown" ? null : place.transport, place.disabled ? "switched off" : null].filter(Boolean).join(" · ")}
                </span>
                {(place.envKeys.length > 0 || place.headerKeys.length > 0) && (
                  <span className="setup-place-keys">
                    {place.envKeys.length > 0 && `Given ${place.envKeys.join(", ")}. `}
                    {place.headerKeys.length > 0 && `Sends the ${place.headerKeys.length === 1 ? "header" : "headers"} ${place.headerKeys.join(", ")}. `}
                    Their values are never read into this app.
                  </span>
                )}
                <span className="setup-place-health">
                  <HealthMark state={health?.state ?? "unknown"} checking={checking} />
                  {health?.detail && <span className="setup-place-why">{health.detail}</span>}
                  {health?.tools != null && health.state === "connected" && <span className="setup-place-why">{plural(health.tools, "tool")}</span>}
                </span>
                <span className="setup-place-acts">
                  <button type="button" className="btn" disabled={checking} onClick={() => setup.checkServer(server.name)}>Check again</button>
                  {agent !== null && health?.state === "needs-sign-in" && <button type="button" className="btn primary" onClick={() => void setup.signIn(server.name, agent)}>Sign in</button>}
                  {agent !== null
                    ? <button type="button" className="btn" onClick={() => setup.askRemoveServer(server.name, place, agent)}>Remove</button>
                    : <span className="setup-place-why">{place.agent}'s servers are changed in {place.agent} itself.</span>}
                </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </article>
  );
}

function HookPage({ hook }: { hook: Hook }) {
  return (
    <article className="lib-reader" aria-labelledby="setup-title">
      <h2 className="lib-reader-title" id="setup-title">{hookTitle(hook)}</h2>
      <p className="lib-reader-where"><SourceMark of={hook.agent} size={13} />Hook · {ownerOf(hook)}</p>
      <dl className="lib-props">
        <dt>Runs on</dt><dd>{hook.event}</dd>
        {hook.matcher !== null && <><dt>Only for</dt><dd>{hook.matcher}</dd></>}
        <dt>File</dt><dd><PathLabel className="setup-place-path" path={hook.file} /></dd>
      </dl>
      <h3 className="rev-heading">The command</h3>
      <pre className="setup-code" data-selectable>{hook.command}</pre>
    </article>
  );
}

/** The skill, MCP server or hook being read. */
export function SetupDetail({ setup }: { setup: Setup }) {
  const scroller = useRef<HTMLDivElement>(null);
  useDissolve(scroller);
  const { tab } = setup;
  const page = tab === "skills" ? (setup.skill && (
    <SkillPage skill={setup.skill} issues={setup.issues.get(setup.skill.id) ?? []} onReveal={setup.reveal} onRemove={() => setup.askRemoveSkill(setup.skill!)} />
  ))
    : tab === "mcp" ? (setup.server && <ServerPage server={setup.server} setup={setup} />)
    : (setup.hook && <HookPage hook={setup.hook} />);
  const star = tab === "skills" ? (setup.skill && <FavoriteButton kind="skill" of={setup.skill.id} placed="bar" />)
    : tab === "mcp" ? (setup.server && <FavoriteButton kind="mcp" of={setup.server.name} placed="bar" />)
    : (setup.hook && <FavoriteButton kind="hook" of={hookFavoriteKey(setup.hook)} placed="bar" />);

  const handed: HandedOut | null = !page ? null
    : tab === "skills" ? { path: skillFolder(setup.skill!) }
    : tab === "mcp" ? { text: serverText(setup.server!) }
    : { text: hookText(setup.hook!) };

  return (
    <section className="col col-reader" aria-label="Reader">
      {star || handed ? (
        <header className="col-head lib-reader-bar"><div className="col-head-actions">{star}{handed && <ShareButton handed={handed} />}</div></header>
      ) : <div className="col-head" />}
      {page ? <div className="lib-reader-scroll" ref={scroller}>{page}</div>
        : tab === "skills" && setup.skillId !== null ? (
          setup.skillError !== null
            ? <EmptyState icon="alert" title="The skill could not be read" role="status">{setup.skillError}</EmptyState>
            : <EmptyState className="is-late" role="status" title="Opening the skill" />
        )
        : tab === "skills" ? <EmptyState icon="book" title="Pick a skill">Each shows every agent that reaches it, and whether that is a link or a copy.</EmptyState>
        : tab === "mcp" ? <EmptyState icon="plug" title="Pick a server">Each shows every config that defines it, and whether they agree.</EmptyState>
        : <EmptyState icon="zap" title="Pick a hook">Each shows the command an agent runs, and when.</EmptyState>}
    </section>
  );
}
