import { useRef } from "react";
import {
  CHARS_PER_TOKEN, FINDING_TYPE_LABEL, HEALTH_KIND_LABEL, HEALTH_STORAGE_LABEL, HealthKindSchema,
  type HealthCarried, type HealthKind, type HealthPass, type HealthSummary, type SessionAgent,
} from "@amc/contracts";
import { EmptyState } from "../components/EmptyState";
import { SourceMark } from "../components/SourceMark";
import { useDissolve } from "../components/ScrollFades";
import { BreakdownBars, Legend, StackedBars } from "./Charts";
import { bytesSaid, countSaid } from "./chart-model";
import type { Health } from "./use-health";

const AGENT_LABEL: Record<SessionAgent, string> = { claude: "Claude", codex: "Codex" };
/** A kind's slot in the palette is its place in this order, whichever kinds a chart holds. */
const KINDS: readonly HealthKind[] = HealthKindSchema.options;

const many = (n: number, one: string, more = `${one}s`): string => `${countSaid(n)} ${n === 1 ? one : more}`;
const tokensSaid = (chars: number): string => `about ${many(Math.round(chars / CHARS_PER_TOKEN), "token")}`;

function passSaid(pass: HealthPass): string {
  const progress = `${countSaid(pass.read)} of ${countSaid(pass.sessions)}`;
  return pass.state === "paused" ? `Waiting to read what recent sessions loaded (${pass.pausedWhy}): ${progress} read.` : `Reading what recent sessions loaded: ${progress}.`;
}

function fromSaid(carried: HealthCarried): string {
  const left = carried.empty > 0 ? ` ${many(carried.empty, "session")} loaded nothing and ${carried.empty === 1 ? "is" : "are"} left out of the mean.` : "";
  return carried.recorded
    ? `${AGENT_LABEL[carried.agent]}: from what ${many(carried.sessions, "transcript")} recorded loading.${left}`
    : `${AGENT_LABEL[carried.agent]}: worked out from the AGENTS.md files as they are today, for the folders ${many(carried.sessions, "session")} ran in. Codex records nothing per file.${left}`;
}

function Carried({ summary, onOpenFile }: { summary: HealthSummary; onOpenFile: (id: string) => void }) {
  const { carried, contributors, pass } = summary;
  if (carried.every((agent) => agent.sessions === 0)) {
    return <p className="models-line">{pass.sessions === 0 ? "No conversation has been indexed yet." : "No recent conversation that has been read loaded anything."}</p>;
  }
  const kinds = KINDS.filter((kind) => carried.some((agent) => agent.kinds.some((k) => k.kind === kind)));
  const of = (agent: HealthCarried, kind: HealthKind): number => agent.kinds.find((k) => k.kind === kind)?.chars ?? 0;
  return (
    <>
      <p className="models-line">
        Across the last {many(pass.read, "conversation")}, a session loaded this much on average besides the agent's own system prompt and tools, which are not counted. Tokens are estimated at {CHARS_PER_TOKEN} characters each.
      </p>
      <StackedBars label="Characters loaded per session, by agent" rows={carried.map((agent) => ({
        key: agent.agent,
        label: <><SourceMark of={agent.agent} size={16} />{AGENT_LABEL[agent.agent]}</>,
        said: tokensSaid(agent.chars),
        segments: kinds.map((kind) => ({ key: kind, label: HEALTH_KIND_LABEL[kind], colorIndex: KINDS.indexOf(kind), value: of(agent, kind), said: many(of(agent, kind), "character") })),
      }))} />
      <Legend series={kinds.map((kind) => ({ key: kind, label: HEALTH_KIND_LABEL[kind], colorIndex: KINDS.indexOf(kind) }))} />
      <table className="models-table">
        <thead><tr><th>Characters per session</th>{carried.map((agent) => <th key={agent.agent} className="num">{AGENT_LABEL[agent.agent]}</th>)}</tr></thead>
        <tbody>
          {kinds.map((kind) => (
            <tr key={kind}><td>{HEALTH_KIND_LABEL[kind]}</td>{carried.map((agent) => <td key={agent.agent} className="num">{countSaid(of(agent, kind))}</td>)}</tr>
          ))}
          <tr><td>All of it</td>{carried.map((agent) => <td key={agent.agent} className="num">{countSaid(agent.chars)}</td>)}</tr>
        </tbody>
      </table>
      {carried.map((agent) => <p key={agent.agent} className="models-line health-note">{fromSaid(agent)}</p>)}
      <p className="models-line health-note">
        Not counted: what an app that drives the agent puts into its system prompt. Realm hands a session its instructions and memory that way, and a transcript does not record it, so a session Realm ran carries more than is shown here.
      </p>
      <p className="models-line health-note">
        For scale: Claude Code loads the first 200 lines or 25 KB of a MEMORY.md and asks for each CLAUDE.md to stay under 200 lines; Codex stops adding AGENTS.md files at 32 KB.
      </p>
      {contributors.length > 0 && (
        <>
          <h3 className="health-sub">Loaded most</h3>
          <BreakdownBars label="What sessions loaded, heaviest first" format={(chars) => `${countSaid(chars)} chars`} rows={contributors.map((c) => ({
            key: `${c.agent} ${c.kind} ${c.label}`,
            label: c.libraryId === null ? c.label : <button type="button" className="health-link" onClick={() => onOpenFile(c.libraryId!)}>{c.label}</button>,
            value: c.chars,
            caption: `${HEALTH_KIND_LABEL[c.kind]} · ${AGENT_LABEL[c.agent]} · ${many(c.sessions, "session")}`,
          }))} />
        </>
      )}
    </>
  );
}

function Reach({ summary, onOpenFinding }: { summary: HealthSummary; onOpenFinding: (fingerprint: string) => void }) {
  const { reach, pass } = summary;
  if (reach.findings === 0) return <p className="models-line">Review holds no findings.</p>;
  return (
    <>
      <p className="models-line">
        Review holds {many(reach.findings, "finding")} about {many(reach.files, "file")} ({many(reach.chars, "character")}). {countSaid(reach.sessions)} of the last {many(pass.read, "conversation")} loaded at least one of those files.
        That is how far the findings reach. It does not say any session went worse for it.
      </p>
      {reach.widest.length > 0 && (
        <BreakdownBars label="Findings by how many recent sessions loaded their files" colorIndex={1} format={(sessions) => many(sessions, "session")} rows={reach.widest.map((finding) => ({
          key: finding.fingerprint,
          label: <button type="button" className="health-link" onClick={() => onOpenFinding(finding.fingerprint)}>{finding.title}</button>,
          value: finding.sessions,
          caption: FINDING_TYPE_LABEL[finding.type],
        }))} />
      )}
    </>
  );
}

function Fixes({ summary, onReviewReady }: { summary: HealthSummary; onReviewReady: () => void }) {
  const { fixes } = summary;
  if (fixes.ready === 0) return <p className="models-line">No fix is ready to approve.</p>;
  // A fix can add to a file sessions load (a memory put back in its index), so the change goes either way.
  const changed = fixes.perSession.filter((agent) => agent.chars !== 0);
  const loadSaid = (agent: (typeof changed)[number]): string =>
    `A ${AGENT_LABEL[agent.agent]} session would load ${many(Math.abs(agent.chars), "character")} ${agent.chars > 0 ? "fewer" : "more"} on average (${tokensSaid(Math.abs(agent.chars))})`;
  return (
    <>
      <p className="models-line">
        Approving the {many(fixes.ready, "ready fix", "ready fixes")} would remove {many(fixes.filesRemoved, "file")}, change {countSaid(fixes.filesChanged)} and free {bytesSaid(fixes.bytesFreed)}.
        {changed.length === 0
          ? " No recent session loaded a file they change, so a session would load what it does now."
          : ` ${changed.map(loadSaid).join(". ")}.`}
      </p>
      <button type="button" className="btn primary health-act" onClick={onReviewReady}>Review the {many(fixes.ready, "ready fix", "ready fixes")}</button>
    </>
  );
}

function Storage({ summary }: { summary: HealthSummary }) {
  return (
    <>
      <BreakdownBars label="Kept on disk, by kind" colorIndex={2} format={bytesSaid}
        rows={summary.storage.map((kept) => ({ key: kept.kind, label: HEALTH_STORAGE_LABEL[kept.kind], value: kept.bytes, caption: many(kept.files, "file") }))} />
      <p className="models-line health-note">
        Transcripts are each agent's own record of a session. Removing one loses that conversation and changes nothing an agent loads; one-shot calls and sub-agents are the ones least likely to be read again. This app does not delete transcripts.
      </p>
      <p className="models-line health-note">
        Memory, instructions and skills are small, and sessions load them. Change them through Review, where every fix can be undone.
      </p>
    </>
  );
}

/**
 * Health: what agents carry into a session and keep on disk, as counts. No score, and no claim that
 * a file made a session worse: the page says how much was loaded and how many sessions loaded it.
 */
export function HealthPage({ health, onOpenFile, onOpenFinding, onReviewReady }: {
  health: Health;
  onOpenFile: (id: string) => void;
  onOpenFinding: (fingerprint: string) => void;
  onReviewReady: () => void;
}) {
  const { summary } = health;
  const scroller = useRef<HTMLDivElement>(null);
  useDissolve(scroller);

  return (
    <section className="col models health" aria-label="Health">
      <div className="col-head" />
      {summary === null ? (
        health.error !== null
          ? <EmptyState icon="alert" title="The measures could not be read" role="status">{health.error}</EmptyState>
          : <EmptyState className="is-late" role="status" title="Measuring" />
      ) : (
        <div className="models-scroll" ref={scroller}>
          <div className="models-page">
            <h1 className="lib-reader-title">Health</h1>
            <p className="models-lede">
              What your agents load into a session and keep on disk, counted from your own files and transcripts. These are measures, not a grade.
            </p>
            {summary.pass.state !== "idle" && <p className="models-line health-pass" role="status">{passSaid(summary.pass)} The numbers below are of what has been read so far.</p>}

            <h2 className="models-heading">What a session carries</h2>
            <Carried summary={summary} onOpenFile={onOpenFile} />

            <h2 className="models-heading">What the findings touch</h2>
            <Reach summary={summary} onOpenFinding={onOpenFinding} />

            <h2 className="models-heading">What fixing would change</h2>
            <Fixes summary={summary} onReviewReady={onReviewReady} />

            <h2 className="models-heading">Storage</h2>
            <Storage summary={summary} />
          </div>
        </div>
      )}
    </section>
  );
}
