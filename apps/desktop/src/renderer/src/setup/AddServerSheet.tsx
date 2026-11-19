import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  MCP_AGENT_LABEL, McpDraftSchema, type Hook, type McpAgent, type McpOutcome, type McpServer, type McpStep, type McpSuggestion, type RunnerId, type RunnerStatus,
} from "@amc/contracts";
import { Icon } from "@amc/ui";
import { RunnerPicker } from "../components/RunnerPicker";
import { Sheet } from "../components/Sheet";
import { said } from "../rpc/client";
import { MCP_AGENTS, commandLine, commandWords } from "./setup-model";
import type { SetupRpc } from "./use-setup";

type Way = "describe" | "fill";
const WAYS: { id: Way; label: string }[] = [{ id: "describe", label: "Describe it" }, { id: "fill", label: "Fill it in" }];

/** One variable or header the server is given. `needed` is one a model's draft said the person must fill in. */
type Given = { key: number; name: string; value: string; needed: boolean };

/** The projects a server can be added for: the ones some agent's config on this Mac already names. */
function projectsOf(servers: readonly McpServer[], hooks: readonly Hook[]): { id: string; name: string }[] {
  const names = new Map<string, string>();
  for (const at of [...servers.flatMap((s) => s.definitions), ...hooks]) if (at.projectId !== null) names.set(at.projectId, at.projectName ?? at.projectId);
  return [...names].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Adding a server, two ways in over one form: a request in words that a model drafts the form from,
 * or the form itself. Either way nothing is added until the sheet has shown, per agent, the command
 * that will run or the file that will change.
 *
 * A value typed for a variable or a header lives only in this component: it is sent with the preview
 * and the add, emptied once the add has answered, and gone with the sheet.
 */
export function AddServerSheet({ rpc, servers, hooks, onClose, onAdded, onOpenModels }: {
  rpc: SetupRpc; servers: readonly McpServer[]; hooks: readonly Hook[]; onClose: () => void; onAdded: () => Promise<void>; onOpenModels: () => void;
}) {
  const [way, setWay] = useState<Way>("describe");
  const [runners, setRunners] = useState<RunnerStatus[] | null>(null);
  const [chosenRunner, setChosenRunner] = useState<RunnerId | null>(null);
  const [ask, setAsk] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [suggestion, setSuggestion] = useState<McpSuggestion | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [startedBy, setStartedBy] = useState<"command" | "url">("command");
  const [line, setLine] = useState("");
  const [url, setUrl] = useState("");
  const [transport, setTransport] = useState<"http" | "sse">("http");
  const [given, setGiven] = useState<Given[]>([]);
  const givenKey = useRef(0);
  const [agents, setAgents] = useState<ReadonlySet<McpAgent>>(new Set<McpAgent>(["claude"]));
  const [projectId, setProjectId] = useState<string | null>(null);

  const [steps, setSteps] = useState<McpStep[] | null>(null);
  const [outcomes, setOutcomes] = useState<McpOutcome[] | null>(null);
  const [working, setWorking] = useState<"preview" | "add" | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    rpc.call("models.status", {}).then(
      (status) => { if (live) setRunners(status.runners.filter((r) => r.settings.allowed && r.probe.installed)); },
      () => { if (live) setRunners([]); },
    );
    return () => { live = false; };
  }, [rpc]);
  const runner = runners?.find((r) => r.runner === chosenRunner) ?? runners?.[0];

  /** What was shown would be done is for the form as it stood: any change to it takes the preview away. */
  const changed = () => { setSteps(null); setOutcomes(null); setRefusal(null); };
  const give = (name = "", needed = false): Given => ({ key: ++givenKey.current, name, value: "", needed });

  const fill = (drafted: McpSuggestion) => {
    const { draft } = drafted;
    setName(draft.name);
    if (draft.transport === "stdio") {
      setStartedBy("command");
      setLine(commandLine(draft.command === undefined ? draft.args : [draft.command, ...draft.args]));
    } else {
      setStartedBy("url");
      setTransport(draft.transport);
      setUrl(draft.url ?? "");
    }
    const drafts = draft.transport === "stdio" ? draft.env : draft.headers;
    const names = [...new Set([...Object.keys(drafts), ...drafted.needs])];
    setGiven(names.map((n) => ({ ...give(n, drafted.needs.includes(n)), value: drafts[n] ?? "" })));
    // The draft does not say which agents were asked for, so the ones the request names are ticked.
    const named = MCP_AGENTS.filter((agent) => ask.toLowerCase().includes(agent));
    if (named.length > 0) setAgents(new Set(named));
    changed();
  };
  const draftIt = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!runner || ask.trim().length < 3 || drafting) return;
    setDrafting(true);
    setSuggestError(null);
    try {
      const drafted = await rpc.call("mcp.suggest", { ask: ask.trim(), runner: runner.runner });
      setSuggestion(drafted);
      fill(drafted);
    } catch (err) {
      setSuggestError(said(err));
    } finally {
      setDrafting(false);
    }
  };

  const words = commandWords(line);
  const pairs = Object.fromEntries(given.filter((g) => g.name.trim() !== "").map((g) => [g.name.trim(), g.value]));
  const parsed = McpDraftSchema.safeParse(startedBy === "command"
    ? { name: name.trim(), transport: "stdio", command: words[0], args: words.slice(1), env: pairs }
    : { name: name.trim(), transport, url: url.trim(), headers: pairs });
  const draft = parsed.success && (startedBy === "url" || words.length > 0) && agents.size > 0 ? parsed.data : null;
  const unfilled = given.filter((g) => g.needed && g.value === "").map((g) => g.name);
  const taking = steps?.filter((step) => step.refused === null).map((step) => step.agent) ?? [];

  const preview = async (): Promise<void> => {
    if (draft === null || working !== null) return;
    setWorking("preview");
    setRefusal(null);
    try {
      setSteps((await rpc.call("mcp.preview", { draft, placement: { agents: [...agents], projectId } })).steps);
    } catch (e) {
      setRefusal(`What adding it will do could not be read: ${said(e)}`);
    } finally {
      setWorking(null);
    }
  };
  const add = async (): Promise<void> => {
    if (draft === null || taking.length === 0 || working !== null) return;
    setWorking("add");
    setRefusal(null);
    try {
      const added = await rpc.call("mcp.add", { draft, placement: { agents: taking, projectId } });
      setOutcomes(added.outcomes);
      setGiven((held) => held.map((g) => ({ ...g, value: "" })));
      await onAdded();
    } catch (e) {
      setRefusal(`It could not be added: ${said(e)}`);
    } finally {
      setWorking(null);
    }
  };

  const formShown = way === "fill" || suggestion !== null;
  const projects = projectsOf(servers, hooks);
  const what = startedBy === "command" ? "variable" : "header";

  return (
    <Sheet title="Add an MCP server" width={560} onClose={onClose}
      footer={outcomes !== null ? <button type="button" className="btn primary" onClick={onClose}>Done</button> : (
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          {formShown && steps === null && (
            <button type="button" className="btn primary" disabled={draft === null || working !== null} aria-busy={working === "preview" || undefined} onClick={() => void preview()}>Show what it will do</button>
          )}
          {steps !== null && (
            <button type="button" className="btn primary" disabled={taking.length === 0 || working !== null} aria-busy={working === "add" || undefined} onClick={() => void add()}>
              {taking.length === 0 ? "Add" : `Add to ${new Intl.ListFormat("en", { type: "conjunction" }).format(taking.map((agent) => MCP_AGENT_LABEL[agent]))}`}
            </button>
          )}
        </>
      )}>
      <div className="seg setup-ways" role="radiogroup" aria-label="How to add it">
        {WAYS.map((w) => (
          <label key={w.id} className="seg-opt" data-selected={way === w.id || undefined}>
            <input type="radio" name="setup-add-way" checked={way === w.id} onChange={() => setWay(w.id)} />
            {w.label}
          </label>
        ))}
      </div>

      {way === "describe" && (runners === null ? null : !runner ? (
        <div className="setup-describe">
          <p className="setup-sheet-line">A model can draft the server from a sentence. Nothing is sent until you turn a model on. Fill it in needs no model.</p>
          <button type="button" className="btn" onClick={onOpenModels}>Open Models</button>
        </div>
      ) : (
        <form className="form setup-describe-form" onSubmit={(e) => void draftIt(e)}>
          <label className="field">
            <span>What to add</span>
            <input value={ask} maxLength={600} placeholder="Add the Linear server to Claude and Codex" aria-label="What to add" onChange={(e) => setAsk(e.target.value)} />
          </label>
          <div className="setup-describe">
            <p className="setup-sheet-line">Your sentence is sent to {runner.settings.models.write} in one call. It drafts the form; it adds nothing.</p>
            {runners.length > 1 && <RunnerPicker runners={runners} chosen={runner.runner} onChoose={setChosenRunner} name="drafting-runner" />}
            <button type="submit" className="btn" disabled={ask.trim().length < 3 || drafting} aria-busy={drafting || undefined}>{suggestion === null ? "Draft it" : "Draft again"}</button>
          </div>
          {suggestError !== null && <p className="setup-sheet-line setup-refusal" role="alert">No draft was made: {suggestError}</p>}
        </form>
      ))}

      {way === "describe" && suggestion !== null && (
        <p className="lib-reader-note setup-drafted" role="status"><Icon name="magicWand" size={14} />
          <span>
            A model ({suggestion.model}) wrote what is below, and it can be wrong.{" "}
            {suggestion.source !== null ? <>It says the server comes from <span className="setup-from">{suggestion.source}</span>. </> : "It did not say where the server comes from. "}
            Check it before adding.
          </span>
        </p>
      )}

      {formShown && (
        <form className="form setup-add" aria-label="The server" onSubmit={(e) => { e.preventDefault(); void preview(); }}>
          <label className="field">
            <span>Name</span>
            <input value={name} maxLength={64} spellCheck={false} placeholder="linear" onChange={(e) => { setName(e.target.value); changed(); }} />
          </label>
          <div className="field">
            <span>Started by</span>
            <div className="seg setup-started" role="radiogroup" aria-label="Started by">
              {(["command", "url"] as const).map((by) => (
                <label key={by} className="seg-opt" data-selected={startedBy === by || undefined}>
                  <input type="radio" name="setup-add-started" checked={startedBy === by} onChange={() => { setStartedBy(by); changed(); }} />
                  {by === "command" ? "A command" : "A URL"}
                </label>
              ))}
            </div>
          </div>
          {startedBy === "command" ? (
            <label className="field">
              <span>Command, with its arguments</span>
              <input className="setup-mono" value={line} maxLength={4000} spellCheck={false} placeholder="npx -y @example/mcp-server" onChange={(e) => { setLine(e.target.value); changed(); }} />
            </label>
          ) : (
            <div className="setup-url">
              <label className="field">
                <span>URL</span>
                <input className="setup-mono" type="url" value={url} maxLength={2000} spellCheck={false} placeholder="https://mcp.example.com/mcp" onChange={(e) => { setUrl(e.target.value); changed(); }} />
              </label>
              <label className="field">
                <span>Speaks</span>
                <select aria-label="Speaks" value={transport} onChange={(e) => { setTransport(e.target.value as "http" | "sse"); changed(); }}>
                  <option value="http">HTTP</option>
                  <option value="sse">SSE</option>
                </select>
              </label>
            </div>
          )}
          <div className="field">
            <span>{startedBy === "command" ? "Variables it needs" : "Headers it needs"}</span>
            {given.map((g) => (
              <div key={g.key} className="setup-given">
                <input value={g.name} maxLength={200} spellCheck={false} aria-label={`Name of the ${what}`} placeholder={startedBy === "command" ? "API_KEY" : "Authorization"}
                  onChange={(e) => { setGiven((held) => held.map((h) => (h.key === g.key ? { ...h, name: e.target.value } : h))); changed(); }} />
                <input type="password" value={g.value} maxLength={4000} autoComplete="off" aria-label={g.name.trim() === "" ? `Value of the ${what}` : `Value of ${g.name.trim()}`}
                  placeholder={g.needed ? "Needs a value from you" : "Value"}
                  onChange={(e) => { setGiven((held) => held.map((h) => (h.key === g.key ? { ...h, value: e.target.value } : h))); changed(); }} />
                <button type="button" className="icon-btn" aria-label={`Take out ${g.name.trim() === "" ? `the ${what}` : g.name.trim()}`} title="Take out"
                  onClick={() => { setGiven((held) => held.filter((h) => h.key !== g.key)); changed(); }}><Icon name="close" size={12} /></button>
              </div>
            ))}
            <p className="setup-given-foot">
              <button type="button" className="btn" onClick={() => setGiven((held) => [...held, give()])}><Icon name="add" size={12} />Add a {what}</button>
              <span>A value goes straight to the agent's own config. The app does not keep it and cannot show it again.</span>
            </p>
          </div>
          <fieldset className="field setup-agents-pick">
            <legend>Add it to</legend>
            {MCP_AGENTS.map((agent) => (
              <label key={agent} className="setup-tick">
                <input type="checkbox" checked={agents.has(agent)}
                  onChange={(e) => { const next = new Set(agents); if (e.target.checked) next.add(agent); else next.delete(agent); setAgents(next); changed(); }} />
                {MCP_AGENT_LABEL[agent]}
              </label>
            ))}
          </fieldset>
          <label className="field">
            <span>For</span>
            <select aria-label="For" value={projectId ?? ""} onChange={(e) => { setProjectId(e.target.value === "" ? null : e.target.value); changed(); }}>
              <option value="">Every session</option>
              {projects.map((project) => <option key={project.id} value={project.id}>Only the project {project.name}</option>)}
            </select>
          </label>
          {name.trim() !== "" && draft === null && (
            <p className="setup-sheet-line">
              {agents.size === 0 ? "Tick at least one agent." : !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name.trim()) ? "A name is letters, digits, dots, dashes and underscores, with no spaces."
                : startedBy === "command" ? "Give the command that starts it." : "Give the whole URL, starting https://."}
            </p>
          )}
        </form>
      )}

      {steps !== null && (
        <section className="setup-steps" aria-label="What adding it will do">
          <h4 className="setup-sheet-heading">{outcomes === null ? "What adding it will do" : "What was done"}</h4>
          {unfilled.length > 0 && outcomes === null && <p className="setup-sheet-line">{unfilled.join(", ")} {unfilled.length === 1 ? "has" : "have"} no value yet. The server may not start without {unfilled.length === 1 ? "it" : "them"}.</p>}
          <ul className="setup-step-list">
            {steps.map((step) => {
              const outcome = outcomes?.find((o) => o.agent === step.agent);
              return (
                <li key={step.agent} className="setup-step">
                  <span className="setup-step-who">{MCP_AGENT_LABEL[step.agent]}</span>
                  {step.refused !== null ? <span className="setup-step-how setup-refusal">Cannot take it: {step.refused}</span> : (
                    <>
                      <span className="setup-step-how">{step.how === "command" ? "Runs this command" : "Changes this file"}</span>
                      <pre className="setup-code" data-selectable>{step.shows}</pre>
                    </>
                  )}
                  {outcome && (
                    <span className="setup-step-outcome" data-ok={outcome.ok || undefined} role="status">
                      {outcome.ok ? `Added${outcome.detail ? `: ${outcome.detail}` : "."}` : `Not added: ${outcome.detail ?? "its tool did not say why."}`}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {refusal !== null && <p className="setup-sheet-line setup-refusal" role="alert">{refusal}</p>}
    </Sheet>
  );
}
