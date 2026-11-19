import { readOr } from "../library/paths";

/** A config file's JSON, or null for a file that is missing or does not parse. */
export const readJson = (path: string): unknown => { try { return JSON.parse(readOr(path) ?? ""); } catch { return null; } };

export const record = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
