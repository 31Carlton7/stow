import type { Line } from "./lines";
import { arr, injectedBy, noFacts, note, rec, recordOf, said, spoken, str, toMs, toolCall, toolResult, withSkipped, type Piece, type Reading } from "./transcript";

/**
 * `~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl`, one `{ timestamp, type, payload }` per line.
 *
 * `response_item` is what went to and came from the model, and it is the only place the files on
 * this Mac keep the conversation: `message` (a `user`, `assistant` or `developer` role over a list of
 * text and image parts), `reasoning`, the tool calls and their outputs. A `user` message is not
 * always the person: Codex sends `<environment_context>` and the like in the same role, so each part
 * is judged by how it opens. `event_msg` repeats the same turns as the app drew them
 * (`item_completed`) and is read only for the running token count and an interrupted turn. Older
 * rollouts that spoke through `event_msg` `user_message` and `agent_message` are not on this Mac
 * and are not read.
 */
export function codexReading(): Reading {
  const facts = noFacts();
  let model: string | null = null;

  const messagePieces = (payload: Record<string, unknown>, at: number | null): Piece[] => {
    const role = str(payload.role);
    return arr(payload.content).flatMap((raw): Piece[] => {
      const part = rec(raw);
      const text = str(part.text);
      if (str(part.type) === "input_image") return role === "user" ? [spoken("user", at, "[image]")] : [];
      if (text.trim() === "") return [];
      if (role === "assistant") return [said(at, text, model)];
      const label = injectedBy(text);
      if (role === "user") return [label === null ? spoken("user", at, text) : note(at, label, text)];
      return [note(at, label ?? "Instructions", text)];
    });
  };

  const itemPieces = (payload: Record<string, unknown>, at: number | null): Piece[] => {
    const callId = str(payload.call_id) || str(payload.id);
    switch (str(payload.type)) {
      case "message":
        if (str(payload.role) === "assistant") facts.assistantTurns++;
        return messagePieces(payload, at);
      case "agent_message":
        // One agent of a team writing to another.
        return [note(at, `${str(payload.author) || "agent"} → ${str(payload.recipient) || "agent"}`, arr(payload.content).map((part) => str(rec(part).text)).join("\n"))];
      case "reasoning": {
        // The reasoning itself is encrypted; only a summary, when there is one, can be read.
        const summary = arr(payload.summary).map((part) => str(rec(part).text)).filter(Boolean).join("\n\n");
        return summary === "" ? [] : [spoken("thinking", at, summary)];
      }
      // `function_call` carries JSON `arguments`; `custom_tool_call` a free text (a patch, a script).
      case "function_call": return [toolCall(at, str(payload.name), str(payload.arguments), callId)];
      case "custom_tool_call": return [toolCall(at, str(payload.name), str(payload.input), callId)];
      case "function_call_output":
      case "custom_tool_call_output": {
        const output = outputText(payload.output);
        return [toolResult(callId, output, exitedNonZero(output))];
      }
      case "tool_search_call": return [toolCall(at, "tool_search", payload.arguments, callId)];
      case "tool_search_output":
        return [toolResult(callId, arr(payload.tools).map((tool) => str(rec(tool).name)).filter(Boolean).join("\n"), false)];
      case "web_search_call": return [toolCall(at, "web_search", payload.action, "")];
      // The picture comes back as base64 in `result`, which is not text to show.
      case "image_generation_call": return [toolCall(at, "image_generation", str(payload.revised_prompt), "")];
      default: return [];
    }
  };

  const feed = (line: Line): Piece[] => {
    const record = recordOf(line);
    if (!record) return [];
    const payload = rec(record.payload);
    const at = toMs(record.timestamp);
    switch (str(record.type)) {
      case "session_meta": {
        // Resuming a thread appends another of these. The first names the conversation the file is.
        if (facts.sessionId !== null) return [];
        facts.sessionId = str(payload.id) || str(payload.session_id) || null;
        facts.cwd = str(payload.cwd) || null;
        facts.startedBy = str(payload.originator) || null;
        facts.startedAt = toMs(payload.timestamp) ?? at;
        if (typeof payload.source === "string") facts.source = payload.source;
        const spawned = rec(rec(payload.source).subagent);
        if (payload.source !== null && typeof payload.source === "object" && "subagent" in payload.source) {
          facts.subAgent = true;
          facts.parentId = str(rec(spawned.thread_spawn).parent_thread_id) || null;
        }
        return [];
      }
      case "turn_context": {
        const named = str(payload.model) || null;
        const changed = named !== null && model !== null && named !== model;
        model = named ?? model;
        facts.model ??= model;
        facts.cwd ??= str(payload.cwd) || null;
        return changed ? [note(at, "Model", named)] : [];
      }
      case "response_item": return withSkipped(itemPieces(payload, at), line.skipped);
      case "compacted": return withSkipped([note(at, "Compaction", str(payload.message))], line.skipped);
      case "event_msg": {
        if (str(payload.type) === "turn_aborted") return [note(at, "Interrupted", str(payload.reason))];
        if (str(payload.type) === "token_count") {
          // A running total for the thread, written after every call to the model.
          const total = rec(rec(payload.info).total_token_usage);
          if (typeof total.input_tokens === "number" && typeof total.output_tokens === "number") {
            facts.inputTokens = total.input_tokens;
            facts.outputTokens = total.output_tokens;
          }
        }
        return [];
      }
      default: return [];
    }
  };

  return { facts, feed };
}

/** A tool's output: a string, or a list of `{ type, text }` parts whose pictures are named. */
function outputText(output: unknown): string {
  if (typeof output === "string") return output;
  return arr(output).map((raw) => { const part = rec(raw); return str(part.text) || `[${str(part.type) || "content"}]`; }).join("\n");
}

/**
 * Whether a tool's output says its command failed. Codex keeps no flag for it: a shell tool's output
 * opens with a few lines of its own, one of them `Process exited with code N` or `Exit code: N`, and
 * an older one is JSON with the code under `metadata`.
 */
function exitedNonZero(output: string): boolean {
  const head = output.slice(0, 400);
  const said = /\bexit(?:ed with)? code:? (\d+)/i.exec(head) ?? /"exit_code":\s*(\d+)/.exec(head);
  return said !== null && said[1] !== "0";
}
