import { lookup } from "node:dns/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";
import type { McpServer } from "@amc/contracts";
import { readOr } from "../library/paths";

const ICON_TIMEOUT_MS = 5_000;
const ICON_MAX_BYTES = 200_000;
const MAX_REDIRECTS = 3;

/** Published servers started by a command, by the package named in their arguments, to their vendor's site. */
const VENDOR_SITES: Record<string, string> = {
  "@modelcontextprotocol/server-github": "github.com",
  "@modelcontextprotocol/server-gitlab": "gitlab.com",
  "@modelcontextprotocol/server-slack": "slack.com",
  "@modelcontextprotocol/server-postgres": "postgresql.org",
  "@modelcontextprotocol/server-brave-search": "brave.com",
  "@notionhq/notion-mcp-server": "notion.so",
  "@playwright/mcp": "playwright.dev",
  "@sentry/mcp-server": "sentry.io",
  "@supabase/mcp-server-supabase": "supabase.com",
  "@stripe/mcp": "stripe.com",
  "@upstash/context7-mcp": "context7.com",
  "@cloudflare/mcp-server-cloudflare": "cloudflare.com",
  "@vercel/mcp-adapter": "vercel.com",
  "figma-developer-mcp": "figma.com",
  "firecrawl-mcp": "firecrawl.dev",
  "chrome-devtools-mcp": "developer.chrome.com",
  "mcp-server-git": "git-scm.com",
};

/** `@scope/name@1.2.3` and `name@latest` without the version. */
const withoutVersion = (word: string): string => { const at = word.lastIndexOf("@"); return at > 0 ? word.slice(0, at) : word; };

/**
 * The sites whose icon stands for a server, likeliest first. A server at a URL is its own site,
 * then the domain above it: `mcp.example.com` seldom has an icon and `example.com` does.
 */
export function iconSites(server: McpServer): string[] {
  const sites: string[] = [];
  for (const definition of server.definitions) {
    if (definition.transport === "http" || definition.transport === "sse") {
      let host: string;
      try { host = new URL(definition.target).hostname.toLowerCase(); } catch { continue; }
      const labels = host.split(".");
      sites.push(host);
      if (labels.length > 2) sites.push(labels.slice(-2).join("."));
    } else {
      for (const word of definition.target.split(/\s+/)) {
        const site = VENDOR_SITES[withoutVersion(word)];
        if (site) sites.push(site);
      }
    }
  }
  return [...new Set(sites)];
}

/** An address on this Mac or on a private network, which an icon is never fetched from. */
export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v6 = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6)?.[1];
  if (mapped) return isPrivateAddress(mapped);
  return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith("ff");
}

type IconDeps = {
  /** A folder in the app's own data, where fetched icons are kept. */
  folder: string;
  servers: () => McpServer[];
  fetch?: typeof fetch;
  resolve?: (host: string) => Promise<string[]>;
};

/** Vendors' own icons for servers, fetched once from the vendor's site over https and kept as data URLs. */
export class McpIcons {
  private readonly fetch: typeof fetch;
  private readonly resolve: (host: string) => Promise<string[]>;
  /** Sites that had no icon when asked, so one launch asks each of them once. */
  private readonly without = new Set<string>();

  constructor(private readonly d: IconDeps) {
    this.fetch = d.fetch ?? fetch;
    this.resolve = d.resolve ?? (async (host) => (await lookup(host, { all: true })).map((found) => found.address));
  }

  async iconFor(name: string): Promise<string | null> {
    const server = this.d.servers().find((s) => s.name === name);
    if (!server) return null;
    for (const site of iconSites(server)) {
      if (!/^[a-z0-9.-]+$/.test(site)) continue;
      const kept = join(this.d.folder, `${site}.txt`);
      const cached = readOr(kept);
      if (cached) return cached;
      if (this.without.has(site)) continue;
      const icon = await this.fetchIcon(`https://${site}/favicon.ico`).catch(() => null);
      if (!icon) { this.without.add(site); continue; }
      mkdirSync(this.d.folder, { recursive: true });
      writeFileSync(kept, icon);
      return icon;
    }
    return null;
  }

  private async isPublic(host: string): Promise<boolean> {
    if (isIP(host) !== 0 || host === "localhost" || !host.includes(".") || /\.(local|localhost|internal|lan|home\.arpa)$/.test(host)) return false;
    const addresses = await this.resolve(host);
    return addresses.length > 0 && !addresses.some(isPrivateAddress);
  }

  /** Redirects are followed by hand, so each hop is held to https and a public address like the first. */
  private async fetchIcon(from: string): Promise<string | null> {
    let address = new URL(from);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (address.protocol !== "https:" || !(await this.isPublic(address.hostname))) return null;
      const answer = await this.fetch(address, { redirect: "manual", signal: AbortSignal.timeout(ICON_TIMEOUT_MS), headers: { accept: "image/*" } });
      const next = answer.status >= 300 && answer.status < 400 ? answer.headers.get("location") : null;
      if (next) { address = new URL(next, address); continue; }
      const type = (answer.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      if (!answer.ok || !type.startsWith("image/") || Number(answer.headers.get("content-length") ?? 0) > ICON_MAX_BYTES) return null;
      const bytes = Buffer.from(await answer.arrayBuffer());
      if (bytes.length === 0 || bytes.length > ICON_MAX_BYTES) return null;
      return `data:${type};base64,${bytes.toString("base64")}`;
    }
    return null;
  }
}
