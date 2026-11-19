import { basename } from "node:path";
import { z } from "zod";
import { McpDraftSchema, type McpSuggestion, type RunnerId } from "@amc/contracts";
import type { ModelGate } from "../models/gate";
import { RpcError } from "../rpc/error";
import { secretShapeIn } from "../secret-shapes";

/** The programs a drafted server may be started by: the launchers that fetch and run a published package. */
export const LAUNCHERS = ["npx", "uvx", "docker", "node", "python", "bunx", "deno"];

const GUIDANCE = [
  "You draft the configuration of one MCP (Model Context Protocol) server from a person's request in words.",
  "Answer with the server the request most plainly means, as its vendor publishes it. You run nothing and add nothing: a person reads your draft and decides.",
  "name: short, lowercase, letters digits and dashes.",
  "transport: \"stdio\" for a server started by a command, \"http\" for a streamable HTTP URL, \"sse\" for an SSE URL. Prefer the vendor's hosted URL when it has one.",
  `For stdio: command is one of ${LAUNCHERS.join(", ")} and args are its arguments, each its own string; url is null.`,
  "For http and sse: url is the https address; command is null and args is empty.",
  "Never write a secret, a token or a placeholder for one anywhere. List the NAMES of the environment variables the server needs in envNames (stdio) and of the headers it needs in headerNames (http, sse); the person fills the values in.",
  "source: the package name or the vendor's page the server comes from, or null when you are not sure it exists. Do not invent a package.",
].join("\n");

/** Codex holds a model to a schema only when every property is required and nothing else is allowed. */
const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "transport", "command", "args", "url", "envNames", "headerNames", "source"],
  properties: {
    name: { type: "string" },
    transport: { type: "string", enum: ["stdio", "http", "sse"] },
    command: { type: ["string", "null"] },
    args: { type: "array", items: { type: "string" } },
    url: { type: ["string", "null"] },
    envNames: { type: "array", items: { type: "string" } },
    headerNames: { type: "array", items: { type: "string" } },
    source: { type: ["string", "null"] },
  },
};

const Drafted = z.object({
  name: z.string(),
  transport: z.enum(["stdio", "http", "sse"]),
  command: z.string().nullable(),
  args: z.array(z.string()),
  url: z.string().nullable(),
  envNames: z.array(z.string().min(1).max(200)).max(20),
  headerNames: z.array(z.string().min(1).max(200)).max(20),
  source: z.string().max(400).nullable(),
});

const refuse = (code: string, message: string): never => { throw new RpcError(code, message); };

/** A model's answer as a suggestion, or a refusal that says what was wrong with it. */
export function suggestionFrom(output: unknown, model: string): McpSuggestion {
  const drafted = Drafted.safeParse(output);
  if (!drafted.success) return refuse("MCP_SUGGEST_INVALID", "the model's answer was not a server draft: ask again, or fill the server in yourself");
  const { name, transport, command, args, url, envNames, headerNames, source } = drafted.data;
  const stdio = transport === "stdio";
  const blank = (names: string[]): Record<string, string> => Object.fromEntries(names.map((key) => [key, ""]));
  const draft = McpDraftSchema.safeParse({
    name, transport, args: stdio ? args : [],
    ...(stdio ? { command: command ?? "" } : { url: url ?? "" }),
    env: stdio ? blank(envNames) : {}, headers: stdio ? {} : blank(headerNames),
  });
  if (!draft.success) return refuse("MCP_SUGGEST_INVALID", "the model's answer was not a server draft: ask again, or fill the server in yourself");

  if (stdio) {
    const launcher = draft.data.command ?? "";
    if (!LAUNCHERS.includes(launcher)) {
      return refuse("MCP_SUGGEST_LAUNCHER", `the model drafted a server started by \`${basename(launcher).slice(0, 40) || "nothing"}\`, which is not one of ${LAUNCHERS.join(", ")}: nothing was suggested`);
    }
  } else if (!draft.data.url?.startsWith("https://")) {
    return refuse("MCP_SUGGEST_INVALID", "the model drafted a server at an address that is not https: nothing was suggested");
  }
  if ([...draft.data.args, draft.data.url ?? ""].some((word) => secretShapeIn(word) !== null)) {
    return refuse("MCP_SUGGEST_SECRET", "the model's draft held what looks like a secret: nothing was suggested");
  }
  return { draft: draft.data, needs: stdio ? envNames : headerNames, source, model };
}

/** One model call, with no tools, that drafts a server from words. It adds nothing. */
export async function suggestServer(gate: ModelGate, ask: string, runner: RunnerId): Promise<McpSuggestion> {
  const outcome = await gate.run({ runner, tier: "write", purpose: "mcp-suggest", sent: [], system: GUIDANCE, prompt: ask, schema: DRAFT_SCHEMA });
  return suggestionFrom(outcome.output, outcome.model);
}
