import type { McpServer } from "@amc/contracts";
import type { RpcServer } from "../rpc/server";
import type { Skills } from "../setup/skills";
import { skillHealth } from "./skills-health";
import type { SkillImports } from "./skills-imports";
import { SKILL_LIBRARIES } from "./skills-source";

export function registerSkills(rpc: RpcServer, d: { imports: SkillImports; skills: Skills; servers: () => McpServer[] }): void {
  rpc.register("skills.libraries", async () => ({ libraries: [...SKILL_LIBRARIES] }));
  rpc.register("skills.inspect", async ({ from }) => d.imports.inspect(from));
  rpc.register("skills.preview", async ({ token, path }) => d.imports.preview(token, path));
  rpc.register("skills.install", async ({ token, paths, into, replace }) => ({ installed: await d.imports.install(token, paths, into, replace) }));
  rpc.register("skills.remove", async ({ id, place }) => { await d.imports.remove(id, place); return {}; });
  rpc.register("skills.health", async () => ({ skills: skillHealth(d.skills.list(), d.servers()) }));
}
