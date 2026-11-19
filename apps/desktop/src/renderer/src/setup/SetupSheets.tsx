import { useState } from "react";
import { Sheet } from "../components/Sheet";
import { AddServerSheet } from "./AddServerSheet";
import { AddSkillsSheet } from "./AddSkillsSheet";
import { ownerOf } from "./setup-model";
import type { Setup, SetupRpc, SetupSheet } from "./use-setup";

/** The one sheet that is up over the Skills or the MCP servers section. */
export function SetupSheets({ setup, rpc, onOpenModels }: { setup: Setup; rpc: SetupRpc; onOpenModels: () => void }) {
  const { sheet } = setup;
  if (sheet === null) return null;
  if (sheet.kind === "add-server") {
    return <AddServerSheet rpc={rpc} servers={setup.servers ?? []} hooks={setup.hooks ?? []} onClose={setup.closeSheet} onAdded={setup.load}
      onOpenModels={() => { setup.closeSheet(); onOpenModels(); }} />;
  }
  if (sheet.kind === "add-skills") return <AddSkillsSheet rpc={rpc} onClose={setup.closeSheet} onInstalled={setup.load} />;
  if (sheet.kind === "remove-server") return <RemoveServerSheet setup={setup} sheet={sheet} />;
  return <RemoveSkillSheet setup={setup} sheet={sheet} />;
}

/**
 * What removing a server asks first: whose config it leaves and the file that holds it. The exact
 * command is the agent's own and is not known to the window before it is run.
 */
function RemoveServerSheet({ setup, sheet }: { setup: Setup; sheet: Extract<SetupSheet, { kind: "remove-server" }> }) {
  const { name, place } = sheet;
  return (
    <Sheet title={`Remove ${name} from ${ownerOf(place)}?`} onClose={setup.closeSheet}
      footer={<>
        <button type="button" className="btn" onClick={setup.closeSheet}>Cancel</button>
        <button type="button" className="btn destructive" disabled={setup.removing} aria-busy={setup.removing || undefined} onClick={() => void setup.remove()}>Remove</button>
      </>}>
      <code className="lib-ask-path" data-selectable>{place.file}</code>
      <p className="lib-ask-line">
        {name} is taken out of {place.agent}'s config, the file above, with {place.agent}'s own command where it has one.
        {place.projectName === null ? ` Every session of ${place.agent} loses it.` : ` Only the project ${place.projectName} loses it.`}
      </p>
      <p className="lib-ask-line">Other agents that have a server of this name keep theirs. Nothing is kept to put it back: adding it again needs its command or URL, and any token it was given.</p>
      {sheet.refusal !== null && <p className="lib-ask-line setup-refusal" role="alert">It was not removed: {sheet.refusal}</p>}
    </Sheet>
  );
}

function RemoveSkillSheet({ setup, sheet }: { setup: Setup; sheet: Extract<SetupSheet, { kind: "remove-skill" }> }) {
  const { skill } = sheet;
  const [at, setAt] = useState(skill.places[0]?.displayPath ?? "");
  const place = skill.places.find((p) => p.displayPath === at);
  const several = skill.places.length > 1;
  return (
    <Sheet title={`Remove ${skill.name}?`} onClose={setup.closeSheet}
      footer={<>
        <button type="button" className="btn" onClick={setup.closeSheet}>Cancel</button>
        <button type="button" className="btn destructive" disabled={setup.removing} aria-busy={setup.removing || undefined}
          onClick={() => void setup.remove(several ? at : undefined)}>{place?.linked ? "Remove the link" : "Move to Trash"}</button>
      </>}>
      {several ? (
        <label className="field setup-field">
          <span>It is reached from {skill.places.length} places. Remove it from</span>
          <select aria-label="Remove it from" value={at} onChange={(e) => setAt(e.target.value)}>
            {skill.places.map((p) => <option key={p.displayPath} value={p.displayPath}>{p.label} · {p.displayPath}</option>)}
          </select>
        </label>
      ) : <code className="lib-ask-path" data-selectable>{at}</code>}
      <p className="lib-ask-line">
        {place?.linked
          ? `This is a link. The link is removed and the folder it leads to is left, so ${place.label} stops reaching the skill and nothing is lost.`
          : `The skill's folder moves to the Trash, with every file in it. ${place?.label ?? "The agent"} stops reaching it.`}
      </p>
      {sheet.refusal !== null && <p className="lib-ask-line setup-refusal" role="alert">It was not removed: {sheet.refusal}</p>}
    </Sheet>
  );
}
