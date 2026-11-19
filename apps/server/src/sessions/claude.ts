import type { Line } from "./lines";
import { arr, injectedBy, noFacts, note, rec, recordOf, said, sentence, spoken, str, toMs, toolCall, toolResult, withSkipped, type Piece, type Reading } from "./transcript";

/**
 * The records Claude Code keeps of each request it sent. They are most of a big file's bytes and
 * hold nothing of the conversation, and `type` is their first key, so they are passed over unparsed.
 */
const REQUEST_RECORD = '{"type":"api-request';

/** A turn the CLI says did not come from the person: `turnOrigin` on a `user` record, `origin.kind` on a queued one. */
const NOT_THE_PERSON: Record<string, string> = {
  task_notification: "Task notification", "task-notification": "Task notification",
  scheduled: "Scheduled prompt", peer: "Another session", system: "System",
};

/**
 * `~/.claude/projects/<slug>/<sessionId>.jsonl`, one JSON record per line. The conversation is the
 * `user` and `assistant` records, each wrapping an API message whose `content` is a string or a list
 * of `text`, `thinking`, `tool_use`, `tool_result` and `image` parts. `system` records are the CLI
 * speaking (a compaction, a failed request), and `attachment` records are what it loaded or was
 * handed between turns. The other types (`session-owner`, `queue-operation`, `mode`, `last-prompt`,
 * `file-history-snapshot`, and more with each release) are the CLI's own bookkeeping and are skipped
 * by not being named here.
 */
export function claudeReading(): Reading {
  const facts = noFacts();
  let titleIsCustom = false;
  /** One API message is written as several records, each repeating its usage so far. */
  let counting: { id: string; input: number; output: number } | null = null;

  const countUsage = (message: Record<string, unknown>): void => {
    const id = str(message.id);
    if (counting?.id !== id) {
      facts.assistantTurns++;
      counting = { id, input: 0, output: 0 };
    }
    const usage = rec(message.usage);
    if (typeof usage.output_tokens !== "number") return;
    const tokens = (key: string): number => (typeof usage[key] === "number" ? usage[key] : 0);
    // Everything the model was sent, whether it was billed in full, written to the cache or read from it.
    const input = tokens("input_tokens") + tokens("cache_creation_input_tokens") + tokens("cache_read_input_tokens");
    facts.inputTokens = (facts.inputTokens ?? 0) + input - counting.input;
    facts.outputTokens = (facts.outputTokens ?? 0) + usage.output_tokens - counting.output;
    counting.input = input;
    counting.output = usage.output_tokens;
  };

  const userPieces = (record: Record<string, unknown>, at: number | null): Piece[] => {
    const injected = notThePerson(record);
    const words = (text: string): Piece[] => {
      if (text.trim() === "") return [];
      const label = injected ?? injectedBy(text);
      return [label === null ? spoken("user", at, text) : note(at, label, text)];
    };
    const content = rec(record.message).content;
    if (typeof content === "string") return words(content);
    return arr(content).flatMap((raw) => {
      const part = rec(raw);
      switch (str(part.type)) {
        case "text": return words(str(part.text));
        case "tool_result": return [toolResult(str(part.tool_use_id), resultText(part.content), part.is_error === true)];
        // The picture itself is base64 in the file; the turn is kept so it is not missing.
        case "image": return injected === null ? [spoken("user", at, "[image]")] : [];
        default: return [];
      }
    });
  };

  const assistantPieces = (record: Record<string, unknown>, at: number | null): Piece[] => {
    const message = rec(record.message);
    // The CLI writes its own stand-in messages under a model named `<synthetic>`.
    const model = str(message.model) !== "" && !str(message.model).startsWith("<") ? str(message.model) : null;
    facts.model ??= model;
    countUsage(message);
    return arr(message.content).flatMap((raw) => {
      const part = rec(raw);
      switch (str(part.type)) {
        case "text": return str(part.text).trim() === "" ? [] : [said(at, str(part.text), model)];
        case "thinking": return str(part.thinking).trim() === "" ? [] : [spoken("thinking", at, str(part.thinking))];
        case "tool_use": return [toolCall(at, str(part.name), part.input, str(part.id))];
        default: return [];
      }
    });
  };

  const systemPieces = (record: Record<string, unknown>, at: number | null): Piece[] => {
    switch (str(record.subtype)) {
      case "compact_boundary": return [note(at, "Compaction", str(record.content))];
      case "api_error": return [note(at, "API error", str(rec(record.error).message))];
      case "stop_hook_summary": {
        const errors = arr(record.hookErrors).map((e) => (typeof e === "string" ? e : JSON.stringify(e)));
        if (errors.length === 0 && record.preventedContinuation !== true) return [];
        return [note(at, "Stop hook", [str(record.stopReason), ...errors].filter(Boolean).join("\n"))];
      }
      default: return str(record.content).trim() === "" ? [] : [note(at, sentence(str(record.subtype) || "system"), str(record.content))];
    }
  };

  const attachmentPieces = (record: Record<string, unknown>, at: number | null): Piece[] => {
    const attached = rec(record.attachment);
    switch (str(attached.type)) {
      case "hook_additional_context":
        return [note(at, `Hook · ${str(attached.hookEvent)}`, arr(attached.content).map(str).join("\n"))];
      case "hook_non_blocking_error":
        return [note(at, `Hook error · ${str(attached.hookEvent)}`, str(attached.stderr) || str(attached.stdout))];
      case "queued_command": {
        // What arrived while the agent was busy. It is delivered here and never as a `user` record.
        const prompt = str(attached.prompt);
        if (prompt.trim() === "") return [];
        const from = str(rec(attached.origin).kind);
        const typed = str(attached.commandMode) === "prompt" && attached.isMeta !== true && (from === "" || from === "human");
        const label = typed ? injectedBy(prompt) : NOT_THE_PERSON[from || str(attached.commandMode)] ?? "Queued";
        return [label === null ? spoken("user", at, prompt) : note(at, label, prompt)];
      }
      case "model": {
        const identity = rec(attached.identity);
        facts.model ??= str(identity.modelId) || null;
        const name = str(identity.marketingName) || str(identity.modelId);
        return name === "" ? [] : [note(at, "Model", name)];
      }
      default: return [];
    }
  };

  const feed = (line: Line): Piece[] => {
    if (line.text.startsWith(REQUEST_RECORD)) return [];
    const record = recordOf(line);
    if (!record) return [];
    facts.sessionId ??= str(record.sessionId) || null;
    facts.cwd ??= str(record.cwd) || null;
    facts.startedBy ??= str(record.entrypoint) || null;
    if (record.isSidechain === true) facts.subAgent = true;
    const at = toMs(record.timestamp);
    facts.startedAt ??= at;
    switch (str(record.type)) {
      case "user": return withSkipped(userPieces(record, at), line.skipped);
      case "assistant": return withSkipped(assistantPieces(record, at), line.skipped);
      case "system": return systemPieces(record, at);
      case "attachment": return withSkipped(attachmentPieces(record, at), line.skipped);
      case "custom-title":
        if (str(record.customTitle) !== "") { facts.title = str(record.customTitle); titleIsCustom = true; }
        return [];
      case "ai-title":
        if (!titleIsCustom && str(record.aiTitle) !== "") facts.title = str(record.aiTitle);
        return [];
      case "cost-state":
        // The CLI's running total for the session: the last one written is the session's.
        if (typeof record.totalCostUSD === "number") facts.costUsd = record.totalCostUSD;
        return [];
      default: return [];
    }
  };

  return { facts, feed };
}

/** Why a `user` record is not the person's words, from the record's own fields, or null when it is. */
function notThePerson(record: Record<string, unknown>): string | null {
  if (record.isCompactSummary === true) return "Compaction summary";
  const origin = NOT_THE_PERSON[str(record.turnOrigin)];
  if (origin) return origin;
  if (str(record.promptSource) === "system") return "System";
  return record.isMeta === true ? "Injected" : null;
}

/** A `tool_result`'s content: a string, or the API's list form, whose pictures are named rather than dropped. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  return arr(content).map((raw) => {
    const part = rec(raw);
    return str(part.type) === "text" ? str(part.text) : `[${str(part.type) || "content"}]`;
  }).join("\n");
}
