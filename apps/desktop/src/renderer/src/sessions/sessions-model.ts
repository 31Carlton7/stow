import type {
  Session, SessionAgent, SessionBlock, SessionFacets, SessionFilter, SessionIndexStatus, SessionMetrics, SessionOrigin,
} from "@amc/contracts";
import { plural } from "../setup/setup-model";

export const SESSION_AGENT_LABEL: Record<SessionAgent, string> = { claude: "Claude", codex: "Codex" };

/** How many sessions the list asks for at a time. */
export const LIST_PAGE = 200;
/** How many blocks of a transcript are read at a time. */
export const STRETCH = 120;

/** What the sidebar narrows the list to: one agent, one project, or neither. */
export type SessionScope = Pick<SessionFilter, "agent" | "projectId" | "favorites">;

export const sameScope = (a: SessionScope, b: SessionScope): boolean => a.agent === b.agent && a.projectId === b.projectId && a.favorites === b.favorites;

/** What the two switches add to the conversations a person had. */
export type Shown = { oneShot: boolean; subAgents: boolean };

export function originsShown(shown: Shown): SessionOrigin[] {
  const origins: SessionOrigin[] = ["person", "app"];
  if (shown.oneShot) origins.push("one-shot");
  if (shown.subAgents) origins.push("sub-agent");
  return origins;
}

/** The filter the list is asked for. A session's sub-agents are listed alone: nothing the sidebar or the search says narrows them. */
export function listFilter(scope: SessionScope, shown: Shown, query: string, parentId: string | null): SessionFilter {
  if (parentId !== null) return { parentId, origins: ["sub-agent"] };
  // What is starred is listed whoever was on the other end: the two switches are not asked.
  const filter: SessionFilter = scope.favorites ? { favorites: true } : { ...scope, origins: originsShown(shown) };
  const words = query.trim();
  if (words !== "") filter.query = words;
  return filter;
}

const count = new Intl.NumberFormat("en-US");
/** "4,115". */
export const counted = (n: number): string => count.format(n);

const originCount = (facets: SessionFacets, origin: SessionOrigin): number => facets.origins.find((o) => o.origin === origin)?.count ?? 0;

/** How many sessions each of the sidebar's rows stands for. */
export function sidebarCounts(facets: SessionFacets): { conversations: number; oneShot: number; subAgents: number } {
  return {
    conversations: originCount(facets, "person") + originCount(facets, "app"),
    oneShot: originCount(facets, "one-shot"),
    subAgents: originCount(facets, "sub-agent"),
  };
}

/** The one line at the foot of the list while the index is working, or null when it is not. */
export function statusLine(status: SessionIndexStatus): string | null {
  if (status.state === "listing") return `Listing ${counted(status.listed)} of ${counted(status.files)}`;
  if (status.state === "measuring") return `Measuring ${counted(status.measured)} of ${counted(status.files)}`;
  if (status.state === "paused") return status.pausedWhy === null ? "Paused" : `Paused: ${status.pausedWhy}`;
  return null;
}

/** Under a row's title: the project, the agent, and the app that held the conversation when one did. */
export function whoseLine(session: Session): string {
  const agent = SESSION_AGENT_LABEL[session.agent];
  return `${session.projectName ?? session.cwd ?? "No project"} · ${session.drivenBy === null ? agent : `${agent} in ${session.drivenBy}`}`;
}

/** A row's measure of a session: "12 turns · 48 tool calls". */
export const turnsLine = (metrics: SessionMetrics): string =>
  `${plural(metrics.userTurns, "turn")} · ${plural(metrics.toolCalls, "tool call")}`;

/** A count in a few characters: "812", "14K", "1.2M". */
function shortCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${Math.round(n / 1000)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Everything the second look measured, for the reader. Tokens and cost only where the agent recorded them. */
export function metricsLine(metrics: SessionMetrics): string {
  const parts = [turnsLine(metrics)];
  if (metrics.toolErrors > 0) parts.push(`${metrics.toolErrors} failed`);
  if (metrics.inputTokens !== null) parts.push(`${shortCount(metrics.inputTokens)} tokens in`);
  if (metrics.outputTokens !== null) parts.push(`${shortCount(metrics.outputTokens)} out`);
  if (metrics.costUsd !== null) parts.push(`$${metrics.costUsd.toFixed(2)}`);
  return parts.join(" · ");
}

/** How long a session ran, from its first line to the last write of its file. */
export function ranFor(startedAt: number, endedAt: number): string {
  const minutes = Math.floor((endedAt - startedAt) / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** A transcript's size on disk: "812 B", "14 KB", "2.3 MB". */
export function sizeOf(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** What is said where a text was cut to what a window can draw. */
export const cutNotice = (cut: number): string => `${counted(cut)} more ${cut === 1 ? "character is" : "characters are"} not shown.`;

/** How much of a call's input a folded row carries. The row is one line and the rest is cut by its width. */
const CALLED_WITH_MAX = 200;

/** The first line of what a tool was called with, for its folded row. */
export function calledWith(input: string): string {
  const line = input.split("\n").find((l) => l.trim() !== "") ?? "";
  return line.trim().slice(0, CALLED_WITH_MAX);
}

/** One answer of `sessions.read`, kept whole so the stretches before it are never built again. `key` is the cursor that asked for it. */
export type Stretch = { key: string; blocks: SessionBlock[] };
