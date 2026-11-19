import { useEffect, useRef, useState } from "react";
import type { ModelTier, OfferedModel, RunnerId, RunnerStatus } from "@amc/contracts";
import { EmptyState } from "../components/EmptyState";
import { SourceMark } from "../components/SourceMark";
import { useDissolve } from "../components/ScrollFades";
import { stampTitle } from "../library/when";
import { RUNNER_LABEL, usdSaid } from "../review/review-model";
import type { Models } from "./use-models";

/** What each call was for, as the server records it, in words for the ledger. One it does not know is shown as recorded. */
const PANE_TITLE: Record<ModelsPane, string> = { models: "Models", sent: "What is sent", activity: "Activity" };
const PURPOSE_LABEL: Record<string, string> = { test: "Test", scan: "Reading the library", merge: "Writing a merge", rewrite: "Rewriting a file" };
const TIERS: readonly { tier: ModelTier; label: string }[] = [{ tier: "scan", label: "Reads the library" }, { tier: "write", label: "Writes a fix" }];
/** How each tool is held to answering only. Codex has no way to start with no tools at all, so a run of its that reaches for one is thrown away. */
const HELD_TO: Record<RunnerId, string> = {
  claude: "Runs with no tools and no saved session.",
  codex: "Runs read-only with commands off. A run that reaches for a tool is thrown away.",
};

function probeSaid({ runner, probe }: RunnerStatus): string {
  if (!probe.installed) return `The ${runner} command is not installed on this Mac.`;
  if (probe.signedIn === false) return "Signed out. Sign in from a terminal, then come back.";
  if (probe.signedIn === null) return "It would not say whether it is signed in.";
  return `Signed in${probe.plan ? ` on the ${probe.plan} plan` : ""}.`;
}

/** A text field that sends its value when it is left or Enter is pressed, and not on every key. */
function Held({ label, value, onCommit }: { label: string; value: string; onCommit: (next: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const commit = () => { if (draft.trim() !== "" && draft !== value) onCommit(draft.trim()); else setDraft(value); };
  return (
    <label className="field">
      <span>{label}</span>
      <input type="text" spellCheck={false} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
    </label>
  );
}

/** One of the models the tool itself lists. The one in use stays in the list when the tool no longer offers it, under the id it was set by. */
function Picked({ label, value, offered, onCommit }: { label: string; value: string; offered: OfferedModel[]; onCommit: (next: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} title={value} onChange={(e) => onCommit(e.target.value)}>
        {!offered.some((model) => model.id === value) && <option value={value}>{value}</option>}
        {offered.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
      </select>
    </label>
  );
}

function RunnerCard({ models, runner }: { models: Models; runner: RunnerStatus }) {
  const name = RUNNER_LABEL[runner.runner];
  const tested = models.tested[runner.runner];
  const usable = runner.probe.installed && runner.probe.signedIn !== false;
  const offered = models.offered[runner.runner];
  return (
    <article className="models-card" aria-label={name}>
      <header className="models-card-head">
        <SourceMark of={runner.runner} size={18} />
        <h2 className="models-card-name">{name}</h2>
        <label className="models-allow">
          <span>{runner.settings.allowed ? "Allowed" : "Off"}</span>
          <input type="checkbox" role="switch" className="switch" aria-label={`Allow ${name} to make model calls`} checked={runner.settings.allowed}
            disabled={!usable && !runner.settings.allowed} onChange={(e) => void models.setAllowed(runner.runner, e.target.checked)} />
        </label>
      </header>
      <div className="models-card-said">
        <p className="models-line models-signed" data-usable={usable || undefined}>
          {probeSaid(runner)}
          {runner.probe.version !== null && <span className="models-version">{runner.probe.version}</span>}
        </p>
        <p className="models-line">{HELD_TO[runner.runner]}</p>
      </div>
      <div className="models-fields">
        {TIERS.map(({ tier, label }) => {
          const field = { label, value: runner.settings.models[tier], onCommit: (model: string) => void models.setModel(runner.runner, tier, model) };
          return offered ? <Picked key={tier} offered={offered} {...field} /> : <Held key={tier} {...field} />;
        })}
      </div>
      <div className="models-test">
        <button type="button" className="btn" disabled={!runner.settings.allowed || models.testing !== null} aria-busy={models.testing === runner.runner || undefined}
          onClick={() => void models.test(runner.runner)}>
          {models.testing === runner.runner ? "Testing…" : "Test"}
        </button>
        <p className="models-line" role="status">
          {tested === undefined ? (runner.settings.allowed ? "Asks one tiny question, to see it answer." : "Turn it on to test it.")
            : tested.ok ? `${tested.test.model} answered in ${(tested.test.durationMs / 1000).toFixed(1)} s: ${tested.test.inputTokens} tokens in, ${tested.test.outputTokens} out${tested.test.costUsd === null ? "" : `, ${usdSaid(tested.test.costUsd)}`}.`
            : tested.why}
        </p>
      </div>
    </article>
  );
}

/** The parts of Settings that are about models, each a page of its own. */
export type ModelsPane = "models" | "sent" | "activity";

/**
 * What Settings says about models: which of the person's signed-in tools may be asked and how much
 * in a day, what a reading sends, and every call made. Each tool is off until switched on here.
 */
export function ModelsPage({ models, pane }: { models: Models; pane: ModelsPane }) {
  const { status, scope, calls, readOffered } = models;
  const scroller = useRef<HTMLDivElement>(null);
  useDissolve(scroller);
  useEffect(() => { if (pane === "models") readOffered(); }, [pane, readOffered]);

  return (
    <section className="col models" aria-label={PANE_TITLE[pane]}>
      <div className="col-head" />
      {status === null ? (
        models.error !== null
          ? <EmptyState icon="alert" title="Claude and Codex could not be asked" role="status">{models.error}</EmptyState>
          : <EmptyState className="is-late" role="status" title="Asking Claude and Codex" />
      ) : (
        <div className="models-scroll" ref={scroller}>
          <div className="models-page">
            <h1 className="lib-reader-title">{PANE_TITLE[pane]}</h1>
            {pane === "models" && (
              <>
                <p className="models-lede">
                  Stow can ask a model to read your library for things to clean up, and to write the fixes you ask for. It asks through a tool you are already signed in to on this Mac, on your own plan, and only one you allow here.
                </p>
                <div className="models-cards">{status.runners.map((runner) => <RunnerCard key={runner.runner} models={models} runner={runner} />)}</div>
                <p className="models-line models-why">
                  Each has two models. Reading goes over every file, so a small, fast model does it. A fix is written once, when you ask for it, so the strongest model writes it.
                </p>

                <h2 className="models-heading">Daily limit</h2>
                <div className="models-limit">
                  <Held label="Stop for the day at (US dollars)" value={String(status.dailyCapUsd)}
                    onCommit={(next) => { const usd = Number(next); if (Number.isFinite(usd) && usd >= 0) void models.setDailyCap(usd); }} />
                  <p className="models-line">
                    Used today: {usdSaid(status.spentTodayUsd)}. A plan is not billed per call, so this counts what the same calls would cost at the API's prices.
                  </p>
                </div>
              </>
            )}

            {pane === "sent" && (
              <>
                <p className="models-lede">A reading sends your memory files to the model you allowed, and nothing else. Turn a place off to keep its files on this Mac.</p>
                {scope !== null && (
                  <>
                    <p className="models-line">
                      {scope.files} files in {scope.calls} {scope.calls === 1 ? "call" : "calls"}. Each memory is sent once however many copies there are. Indexes and empty files are not sent.
                      {scope.withheld > 0 && ` ${scope.withheld} ${scope.withheld === 1 ? "file is" : "files are"} held back for looking like ${scope.withheld === 1 ? "it holds" : "they hold"} a credential.`}
                    </p>
                    <table className="models-table models-sends">
                      <thead><tr><th>Kept in</th><th className="num">Files</th><th>Send</th></tr></thead>
                      <tbody>
                        {scope.sources.map((source) => (
                          <tr key={source.id} data-off={source.neverSend || undefined}>
                            <td>{source.label}</td>
                            <td className="num">{source.files}</td>
                            <td>
                              <input type="checkbox" role="switch" className="switch" aria-label={`Send ${source.label} to a model`} checked={!source.neverSend}
                                onChange={(e) => void models.setNeverSend(source.id, !e.target.checked)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </>
            )}

            {pane === "activity" && (
              <>
                <p className="models-lede">Every time a model was asked, newest first, with how many files it was sent. Hold the pointer over a count to see which.</p>
                {calls.length === 0 ? <p className="models-line">No call has been made.</p> : (
                  <table className="models-table">
                    <thead><tr><th>When</th><th>Model</th><th>For</th><th className="num">Files</th><th className="num">Tokens</th><th className="num">Cost</th><th>Outcome</th></tr></thead>
                    <tbody>
                      {calls.map((call) => (
                        <tr key={call.id} data-off={!call.ok || undefined}>
                          <td><time title={stampTitle(call.ts)}>{new Date(call.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></td>
                          <td>{call.model}</td>
                          <td>{PURPOSE_LABEL[call.purpose] ?? call.purpose}</td>
                          <td className="num" title={call.sent.join("\n")}>{call.sent.length}</td>
                          <td className="num">{call.inputTokens === null ? "" : (call.inputTokens + (call.outputTokens ?? 0)).toLocaleString("en-US")}</td>
                          <td className="num">{usdSaid(call.apiEquivalentUsd)}</td>
                          <td>{call.ok ? "Answered" : call.error}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
