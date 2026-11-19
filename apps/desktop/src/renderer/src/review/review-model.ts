import { agentOfPath } from "../components/SourceMark";
import { FINDING_TYPE_LABEL, type Finding, type FindingSeverity, type FindingType, type PassScope, type RunnerId } from "@amc/contracts";

/** What the sidebar's row keeps of the findings: all of them, the ones with a fix ready, or one kind. */
export type ReviewFilter = { kind: "all" } | { kind: "ready" } | { kind: "type"; type: FindingType } | { kind: "history" };

export const RUNNER_LABEL: Record<RunnerId, string> = { claude: "Claude", codex: "Codex" };

export const SEVERITY_LABEL: Record<FindingSeverity, string> = { high: "Misleading agents now", medium: "Worth a look", low: "Tidying" };

export const sameFilter = (a: ReviewFilter, b: ReviewFilter): boolean =>
  a.kind === b.kind && (a.kind !== "type" || (b.kind === "type" && a.type === b.type));

/** The one agent every file of a finding belongs to, or null when they are several agents' or nobody's. */
export function oneAgentOf(finding: Finding): string | null {
  const agents = new Set(finding.subjects.map((subject) => agentOfPath(subject.displayPath)));
  return agents.size === 1 ? [...agents][0]! : null;
}

/** A fix that can be approved as it stands. */
export const isReady = (finding: Finding): boolean => finding.fix !== null && !finding.needsDraft;

export function keptBy(filter: ReviewFilter, findings: readonly Finding[]): Finding[] {
  if (filter.kind === "ready") return findings.filter(isReady);
  if (filter.kind === "type") return findings.filter((f) => f.type === filter.type);
  return [...findings];
}

/** The kinds present, each with how many, in the order the findings came (most serious first). */
export function kindsOf(findings: readonly Finding[]): { type: FindingType; label: string; count: number }[] {
  const counts = new Map<FindingType, number>();
  for (const finding of findings) counts.set(finding.type, (counts.get(finding.type) ?? 0) + 1);
  return [...counts].map(([type, count]) => ({ type, label: FINDING_TYPE_LABEL[type], count }));
}

/** Findings under the heading of how serious they are, in the order they came. */
export function bySeverity(findings: readonly Finding[]): { severity: FindingSeverity; findings: Finding[] }[] {
  const groups: { severity: FindingSeverity; findings: Finding[] }[] = [];
  for (const finding of findings) {
    const last = groups.at(-1);
    if (last?.severity === finding.severity) last.findings.push(finding);
    else groups.push({ severity: finding.severity, findings: [finding] });
  }
  return groups;
}

/** What a finding offers, in the few words its row has room for. */
export function offerOf(finding: Finding): string {
  if (finding.needsDraft) return "Fix can be written";
  return finding.fix === null ? "For you to decide" : "Fix ready";
}

/**
 * Roughly how many tokens a reading sends. A token is about 3.6 characters of this kind of text, and
 * each call carries about 4,000 more: the instructions, the answer's schema and what the command line
 * adds of its own. Real readings of 8 and 9 short files reported from 2,600 to about 5,000 tokens in,
 * depending on what the provider had cached.
 */
export const passTokens = (scope: PassScope): number => Math.round(scope.chars / 3.6) + scope.calls * 4_000;

/** A count of tokens as a person says it: "510,000", "about 2 million". */
export function tokensSaid(tokens: number): string {
  if (tokens >= 1_000_000) return `about ${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")} million`;
  return (Math.round(tokens / 1_000) * 1_000).toLocaleString("en-US");
}

/** Dollars as a ledger shows them: cents where there are any, and "under a cent" below that. */
export function usdSaid(usd: number): string {
  if (usd === 0) return "$0.00";
  return usd < 0.01 ? "under a cent" : `$${usd.toFixed(2)}`;
}
