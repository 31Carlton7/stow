import type { FormEvent } from "react";
import { LIBRARY_GROUP_LABEL, type LibraryFile, type LibrarySource, type MemoryType } from "@amc/contracts";
import { EmptyState } from "../components/EmptyState";
import { Sheet } from "../components/Sheet";
import { MEMORY_TYPES } from "./library-model";
import type { Library, NewMemoryDraft, Question } from "./use-library";

const nameOf = (file: LibraryFile): string => file.rel.split("/").at(-1)!;

/** The one sheet that is up: a question first, since it is asked over whatever else is open. */
export function LibrarySheets({ library }: { library: Library }) {
  const { question, newMemory, index } = library;
  if (question) return <QuestionSheet question={question} onAnswer={library.answer} />;
  if (newMemory && index) return <NewMemorySheet library={library} draft={newMemory} sources={index.sources} />;
  return null;
}

/**
 * What a change asks before it is made. Each names the file and says what happens to it: nothing here
 * can be taken back from inside the app except through the backup or the commit it names.
 */
function QuestionSheet({ question, onAnswer }: { question: Question; onAnswer: (yes: boolean) => void }) {
  const no = () => onAnswer(false);
  const yes = () => onAnswer(true);
  if (question.kind === "discard") {
    return (
      <Sheet title="Discard your changes?" onClose={no}
        footer={<><button type="button" className="btn" onClick={no}>Keep editing</button><button type="button" className="btn destructive" onClick={yes}>Discard changes</button></>}>
        <p className="lib-ask-line">What you changed in {nameOf(question.file)} has not been saved, and leaving it now loses it.</p>
      </Sheet>
    );
  }
  if (question.kind === "delete") {
    const { file } = question;
    return (
      <Sheet title={`Delete ${nameOf(file)}?`} onClose={no}
        footer={<><button type="button" className="btn" onClick={no}>Cancel</button><button type="button" className="btn destructive" onClick={yes}>{file.external ? "Move to Trash" : "Delete"}</button></>}>
        <code className="lib-ask-path" data-selectable>{file.displayPath}</code>
        <p className="lib-ask-line">
          {file.external
            ? `This is ${LIBRARY_GROUP_LABEL[file.group]}'s own file. It moves to the Trash, and a copy is kept in the app's backups first.`
            : "It is removed from the memory repository with one commit, which also takes its line out of MEMORY.md."}
        </p>
        <p className="lib-ask-line">{file.readBy}</p>
      </Sheet>
    );
  }
  const owner = LIBRARY_GROUP_LABEL[question.kind === "write-external" ? question.file.group : question.source.group];
  const again = <p className="lib-ask-line">You are asked once: later changes to {owner}'s files kept in the same place are written without this question until the app is closed.</p>;
  if (question.kind === "write-external") {
    const { file } = question;
    return (
      <Sheet title={`Change ${owner}'s own file?`} onClose={no}
        footer={<><button type="button" className="btn" onClick={no}>Keep editing</button><button type="button" className="btn primary" onClick={yes}>Change the file</button></>}>
        <code className="lib-ask-path" data-selectable>{file.displayPath}</code>
        <p className="lib-ask-line">
          {nameOf(file)} is {owner}'s own file, with no history to go back to. A copy of it as it is now is kept in the app's backups before your change is written.
        </p>
        {again}
      </Sheet>
    );
  }
  const { source, folder } = question;
  return (
    <Sheet title={`Write into ${owner}'s own folder?`} onClose={no}
      footer={<><button type="button" className="btn" onClick={no}>Cancel</button><button type="button" className="btn primary" onClick={yes}>Save the memory</button></>}>
      <code className="lib-ask-path" data-selectable>{folder === "" ? source.path : `${source.path}/${folder}`}</code>
      <p className="lib-ask-line">
        The new memory is a file in this folder, which is {owner}'s own, with a line added to the MEMORY.md there. A copy of that MEMORY.md as it is now is kept in the app's backups first.
      </p>
      {again}
    </Sheet>
  );
}

/** A new memory: where it goes, what it is called, the line that says when to read it, its type and its text. */
function NewMemorySheet({ library, draft, sources }: { library: Library; draft: NewMemoryDraft; sources: LibrarySource[] }) {
  const places = sources.filter((s) => s.folders.length > 0);
  const place = places.find((s) => s.id === draft.sourceId);
  if (places.length === 0) {
    return (
      <Sheet title="New memory" onClose={library.cancelNew} footer={<button type="button" className="btn" onClick={library.cancelNew}>Close</button>}>
        <EmptyState icon="folder" title="Nowhere to keep one yet">New memories go in a memory folder an agent already has, and none was found on this Mac.</EmptyState>
      </Sheet>
    );
  }
  const ready = place !== undefined && draft.name.trim() !== "" && draft.description.trim() !== "" && !library.creating;
  const submit = (e: FormEvent) => { e.preventDefault(); if (ready) library.create(); };
  const type = MEMORY_TYPES.find((t) => t.id === draft.type);
  return (
    <Sheet title="New memory" width={520} onClose={library.cancelNew}
      footer={<>
        <button type="button" className="btn" onClick={library.cancelNew}>Cancel</button>
        <button type="submit" form="library-new-memory" className="btn primary" disabled={!ready} aria-busy={library.creating || undefined}>Save memory</button>
      </>}>
      <form className="form lib-new" id="library-new-memory" onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input value={draft.name} maxLength={120} placeholder="Staging URL" onChange={(e) => library.changeNew({ name: e.target.value })} />
        </label>
        <label className="field">
          <span>Description</span>
          <input value={draft.description} maxLength={300} placeholder="One line: what it is, so an agent knows when to read it"
            onChange={(e) => library.changeNew({ description: e.target.value })} />
        </label>
        <div className="lib-new-pair">
          <label className="field">
            <span>Kept in</span>
            <select value={draft.sourceId}
              onChange={(e) => library.changeNew({ sourceId: e.target.value, folder: places.find((s) => s.id === e.target.value)?.folders[0]?.rel ?? "" })}>
              {places.map((s) => <option key={s.id} value={s.id}>{LIBRARY_GROUP_LABEL[s.group]} · {s.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Folder</span>
            <select value={draft.folder} onChange={(e) => library.changeNew({ folder: e.target.value })}>
              {(place?.folders ?? []).map((f) => <option key={f.rel} value={f.rel}>{f.label}</option>)}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Type</span>
          <select value={draft.type} title={type?.title} onChange={(e) => library.changeNew({ type: e.target.value as MemoryType })}>
            {MEMORY_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Text</span>
          <textarea rows={7} value={draft.body} spellCheck={false} onChange={(e) => library.changeNew({ body: e.target.value })} />
        </label>
        {place && <p className="lib-new-by">{place.by}</p>}
      </form>
    </Sheet>
  );
}
