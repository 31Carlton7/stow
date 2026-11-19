import { useEffect, useState, type FormEvent } from "react";
import { SKILL_HOME_LABEL, SkillHomeSchema, type SkillHome, type SkillLibrary, type SkillOffer, type SkillSource } from "@amc/contracts";
import { Icon } from "@amc/ui";
import { Sheet } from "../components/Sheet";
import { said } from "../rpc/client";
import { plural, runnableSaid, sizeSaid } from "./setup-model";
import type { SetupRpc } from "./use-setup";

type Opened = { text: string; files: string[] } | { error: string } | "reading";
type Installed = { path: string; ok: boolean; detail: string | null };

const INSTALLED_SAID: Record<SkillOffer["installed"], string | null> = {
  no: null, same: "Already installed", different: "Installed with different text",
};

/**
 * Adding skills: look at a library, a repository or a folder, read what is there, then install the
 * ones ticked. Looking fetches and lists; nothing is copied into an agent's folder until Install.
 */
export function AddSkillsSheet({ rpc, onClose, onInstalled }: { rpc: SetupRpc; onClose: () => void; onInstalled: () => Promise<void> }) {
  const [libraries, setLibraries] = useState<SkillLibrary[]>([]);
  const [from, setFrom] = useState("");
  const [looking, setLooking] = useState<string | null>(null);
  const [lookError, setLookError] = useState<string | null>(null);
  const [source, setSource] = useState<SkillSource | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [opened, setOpened] = useState<Record<string, Opened>>({});
  const [into, setInto] = useState<SkillHome>("claude");
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState<Installed[] | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // With no libraries to offer, the field below still takes any URL or folder.
    rpc.call("skills.libraries", {}).then((answered) => { if (live) setLibraries(answered.libraries); }, () => {});
    return () => { live = false; };
  }, [rpc]);

  const look = async (at: string): Promise<void> => {
    setLooking(at);
    setLookError(null);
    try {
      const found = await rpc.call("skills.inspect", { from: at });
      setSource(found);
      setTicked(new Set());
      setOpened({});
      setInstalled(null);
      setInstallError(null);
    } catch (e) {
      setLookError(said(e));
    } finally {
      setLooking(null);
    }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); if (from.trim() !== "" && looking === null) void look(from.trim()); };

  const tick = (path: string, on: boolean) => {
    const next = new Set(ticked);
    if (on) next.add(path); else next.delete(path);
    setTicked(next);
  };
  const open = (path: string) => {
    if (source === null) return;
    if (opened[path] !== undefined) { setOpened(({ [path]: _closed, ...rest }) => rest); return; }
    setOpened((held) => ({ ...held, [path]: "reading" }));
    rpc.call("skills.preview", { token: source.token, path }).then(
      (read) => setOpened((held) => (held[path] === undefined ? held : { ...held, [path]: read })),
      (e: unknown) => setOpened((held) => (held[path] === undefined ? held : { ...held, [path]: { error: said(e) } })),
    );
  };

  /* A skill installed with different text is only written over when it was ticked knowing that, so it
     is sent apart from the rest: `replace` holds for every path of the call it is on. */
  const install = async (): Promise<void> => {
    if (source === null || ticked.size === 0 || installing) return;
    const chosen = source.offers.filter((offer) => ticked.has(offer.path));
    const fresh = chosen.filter((offer) => offer.installed !== "different").map((offer) => offer.path);
    const replacing = chosen.filter((offer) => offer.installed === "different").map((offer) => offer.path);
    setInstalling(true);
    setInstallError(null);
    const outcomes: Installed[] = [];
    try {
      if (fresh.length > 0) outcomes.push(...(await rpc.call("skills.install", { token: source.token, paths: fresh, into, replace: false })).installed);
      if (replacing.length > 0) outcomes.push(...(await rpc.call("skills.install", { token: source.token, paths: replacing, into, replace: true })).installed);
    } catch (e) {
      setInstallError(said(e));
    }
    if (outcomes.length > 0) {
      setInstalled(outcomes);
      setTicked(new Set());
      await onInstalled();
    }
    setInstalling(false);
  };

  if (source === null) {
    return (
      <Sheet title="Add skills" width={520} onClose={onClose} footer={<button type="button" className="btn" onClick={onClose}>Cancel</button>}>
        <form className="form" onSubmit={submit}>
          <label className="field">
            <span>A repository, a folder of one, or a folder on this Mac</span>
            <span className="setup-look">
              <input value={from} maxLength={2000} spellCheck={false} placeholder="https://github.com/owner/skills or ~/Downloads/skills" aria-label="Where to look" onChange={(e) => setFrom(e.target.value)} />
              <button type="submit" className="btn primary" disabled={from.trim() === "" || looking !== null} aria-busy={looking === from.trim() || undefined}>Look</button>
            </span>
          </label>
        </form>
        {libraries.length > 0 && (
          <>
            <h4 className="setup-sheet-heading">Libraries</h4>
            <ul className="setup-libraries" aria-label="Libraries">
              {libraries.map((library) => (
                <li key={library.url}>
                  <button type="button" className="setup-library" disabled={looking !== null} aria-busy={looking === library.url || undefined} onClick={() => void look(library.url)}>
                    <span className="setup-library-name">{library.name}</span>
                    <span className="setup-library-about">{library.about}</span>
                    <span className="setup-library-url">{library.url}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {looking !== null && <p className="setup-sheet-line" role="status">Fetching {looking}. Nothing is installed or run.</p>}
        {lookError !== null && <p className="setup-sheet-line setup-refusal" role="alert">It could not be looked at: {lookError}</p>}
      </Sheet>
    );
  }

  const replacing = source.offers.filter((offer) => ticked.has(offer.path) && offer.installed === "different").length;
  return (
    <Sheet title="Add skills" width={560} onClose={onClose}
      footer={<>
        <button type="button" className="btn" onClick={() => setSource(null)}>Look somewhere else</button>
        <label className="setup-into">
          <span>Install for</span>
          <select aria-label="Install for" value={into} onChange={(e) => setInto(e.target.value as SkillHome)}>
            {SkillHomeSchema.options.map((home) => <option key={home} value={home}>{SKILL_HOME_LABEL[home]}</option>)}
          </select>
        </label>
        <button type="button" className="btn primary" disabled={ticked.size === 0 || installing} aria-busy={installing || undefined} onClick={() => void install()}>
          {ticked.size === 0 ? "Install" : `Install ${plural(ticked.size, "skill")}`}
        </button>
      </>}>
      <p className="setup-sheet-line">
        {plural(source.offers.length, "skill")} in <span className="setup-from">{source.from}</span>{source.version !== null && ` at ${source.version}`}. Installing copies a skill's folder and runs nothing.
      </p>
      {source.offers.length === 0 && <p className="setup-sheet-line">No folder there holds a SKILL.md.</p>}
      <ul className="setup-offers" aria-label="Skills found">
        {source.offers.map((offer) => {
          const outcome = installed?.find((o) => o.path === offer.path);
          const read = opened[offer.path];
          const state = outcome?.ok ? "Installed" : INSTALLED_SAID[offer.installed];
          return (
            <li key={offer.path} className="setup-offer">
              <label className="setup-offer-head">
                <input type="checkbox" aria-label={`Install ${offer.name}`} checked={ticked.has(offer.path)} disabled={offer.installed === "same" || outcome?.ok === true}
                  onChange={(e) => tick(offer.path, e.target.checked)} />
                <span className="setup-offer-name">{offer.name}</span>
                {state !== null && <span className="lib-chip" data-tone={offer.installed === "different" && !outcome?.ok ? "warning" : undefined}>{state}</span>}
              </label>
              <p className="setup-offer-line" data-empty={offer.description === null ? "" : undefined}>{offer.description ?? "No description"}</p>
              <p className="setup-offer-facts">{plural(offer.files, "file")}, {sizeSaid(offer.bytes)}. {runnableSaid(offer.runnable)}</p>
              {offer.installed === "different" && ticked.has(offer.path) && <p className="setup-offer-facts">Installing writes over the one you have.</p>}
              {outcome && !outcome.ok && <p className="setup-offer-facts setup-refusal" role="alert">Not installed: {outcome.detail ?? "the server did not say why."}</p>}
              <button type="button" className="setup-offer-open" aria-expanded={read !== undefined} onClick={() => open(offer.path)}>
                <Icon name={read !== undefined ? "chevronDown" : "chevronRight"} size={12} />Read its SKILL.md
              </button>
              {read === "reading" && <p className="setup-offer-facts" role="status">Reading it</p>}
              {read !== undefined && read !== "reading" && ("error" in read
                ? <p className="setup-offer-facts setup-refusal" role="alert">{read.error}</p>
                : <>
                    <pre className="setup-code setup-offer-text" data-selectable>{read.text}</pre>
                    {read.files.length > 0 && <p className="setup-offer-facts setup-files">{read.files.join(", ")}</p>}
                  </>)}
            </li>
          );
        })}
      </ul>
      {replacing > 0 && <p className="setup-sheet-line">{plural(replacing, "skill")} ticked will write over one you have with different text.</p>}
      {installError !== null && <p className="setup-sheet-line setup-refusal" role="alert">Installing stopped: {installError}</p>}
    </Sheet>
  );
}
