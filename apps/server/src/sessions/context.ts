import { closeSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SessionAgent, SessionContext, SessionContextFile } from "@amc/contracts";
import type { Library } from "../library/library";
import { readOr, realOr, tildify, within } from "../library/paths";
import { projectRoot } from "../library/projects";
import { LineReader } from "./lines";
import { arr, rec, recordOf, str } from "./transcript";

/** How far into a file its context is looked for. What a session loads, it loads early or in small pieces. */
const CONTEXT_BYTES = 32 * 1024 * 1024;

type Deps = { home: string; library: Pick<Library, "inspect"> };

/**
 * What a session had loaded.
 *
 * Claude Code writes it down: an `attachment` record for each thing it put in front of the model.
 * `instructions` holds the instruction and memory files with their text as loaded, so each can be
 * compared with the file as it is now. `skill_listing`, `mcp_instructions_delta` and
 * `hook_additional_context` hold text that is no file. The system prompt, the tool definitions and
 * the small `environment` and `session_context` records are not counted here.
 *
 * Codex writes nothing per file, so its answer is worked out: the `AGENTS.md` files it reads for the
 * folder the session ran in, as they are today.
 */
export function contextOf(file: { path: string; agent: SessionAgent; cwd: string | null }, d: Deps): SessionContext {
  return file.agent === "claude" ? recordedContext(file.path, d) : folderContext(file.cwd, d);
}

function recordedContext(path: string, d: Deps): SessionContext {
  const held = new Map(d.library.inspect().map((file) => [file.real, file]));
  const loaded = new Map<string, SessionContextFile>();
  let chars = 0;
  let answered = false;
  const load = (file: SessionContextFile): void => {
    // A file loaded again (it changed, or the session was compacted) is listed once, as it was last loaded.
    loaded.delete(`${file.role}\n${file.displayPath}`);
    loaded.set(`${file.role}\n${file.displayPath}`, file);
    if (!answered) chars += file.chars;
  };
  const text = (role: string, displayPath: string, loadedText: string, missing: number): void => {
    if (loadedText !== "") load({ role, displayPath, chars: loadedText.length + missing, libraryId: null, changedSince: null });
  };

  const fd = openSync(path, "r");
  try {
    const lines = new LineReader(fd);
    for (let line = lines.next(); line !== null && line.start < CONTEXT_BYTES; line = lines.next()) {
      // `type` is not an attachment record's first key, so the cheap test is for the word anywhere in the line.
      if (!answered && line.text.includes('"type":"assistant"') && recordOf(line)?.type === "assistant") answered = true;
      if (!line.text.includes('"attachment"')) continue;
      const record = recordOf(line);
      if (record?.type !== "attachment") continue;
      const attached = rec(record.attachment);
      switch (str(attached.type)) {
        case "instructions": {
          const files = arr(attached.files).map(rec).filter((entry) => str(entry.path) !== "");
          for (const [n, entry] of files.entries()) {
            const real = realOr(str(entry.path));
            const now = held.get(real)?.text ?? readOr(real);
            // A line the reader cut lost the end of its last file's text: its length is known, what it said is not.
            const cutShort = line.skipped > 0 && n === files.length - 1;
            load({
              role: str(entry.type) === "AutoMem" ? "Memory" : "Instructions",
              displayPath: tildify(str(entry.path), d.home),
              chars: str(entry.content).length + (cutShort ? line.skipped : 0),
              libraryId: held.get(real)?.entry.id ?? null,
              // Claude records a file's text without the blank space around it.
              changedSince: cutShort || now === null ? null : now.trim() !== str(entry.content).trim(),
            });
          }
          break;
        }
        case "skill_listing": {
          const count = typeof attached.skillCount === "number" ? attached.skillCount : arr(attached.names).length;
          text("Skill list", `${count} skills`, str(attached.content), line.skipped);
          break;
        }
        case "mcp_instructions_delta": {
          const blocks = arr(attached.addedBlocks).map(str);
          for (const [n, name] of arr(attached.addedNames).map(str).entries()) text("MCP instructions", name, blocks[n] ?? "", 0);
          break;
        }
        case "hook_additional_context":
          text("Hook", str(attached.hookName) || str(attached.hookEvent), arr(attached.content).map(str).join("\n"), line.skipped);
          break;
      }
    }
  } finally { closeSync(fd); }
  return { files: [...loaded.values()], recorded: true, chars };
}

/** Codex reads its own `AGENTS.md`, then one from each folder from the top of the repository down to where it runs. */
function folderContext(cwd: string | null, d: Deps): SessionContext {
  const held = new Map(d.library.inspect().map((file) => [file.real, file]));
  const candidates = [join(d.home, ".codex", "AGENTS.md")];
  if (cwd !== null) {
    const folder = realOr(cwd);
    const top = projectRoot(folder);
    const chain: string[] = [];
    for (let dir = folder; within(dir, top); dir = dirname(dir)) {
      chain.unshift(join(dir, "AGENTS.md"));
      if (dir === top || dirname(dir) === dir) break;
    }
    candidates.push(...chain);
  }
  const files: SessionContextFile[] = [];
  for (const candidate of candidates) {
    const real = realOr(candidate);
    const now = held.get(real)?.text ?? readOr(real);
    // Codex passes over an empty file.
    if (now === null || now.trim() === "") continue;
    files.push({ role: "Instructions", displayPath: tildify(candidate, d.home), chars: now.length, libraryId: held.get(real)?.entry.id ?? null, changedSince: null });
  }
  return { files, recorded: false, chars: files.reduce((sum, file) => sum + file.chars, 0) };
}
