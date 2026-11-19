export const PROFILE_ID: string;
export const SPACE_ID: string;
export const DEPLOY_STEPS: string;
export const SESSIONS: { typed: string; subAgent: string; oneShot: string; codex: string; realm: string; dispatched: string };
export function claudeSlug(folder: string): string;
export function buildFixtureHome(root: string): { home: string; atlas: string; beacon: string; worktree: string; repo: string; claudeMemory: string };
