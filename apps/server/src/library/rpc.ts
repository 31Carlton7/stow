import type { RpcServer } from "../rpc/server";
import type { Library } from "./library";

export function registerLibrary(rpc: RpcServer, library: Library): void {
  rpc.register("library.sources", async () => library.sources());
  rpc.register("library.list", async (filter) => ({ entries: library.list(filter) }));
  rpc.register("library.read", async ({ id }) => library.read(id));
  rpc.register("library.write", async ({ id, text, confirmExternal }) => library.write(id, text, confirmExternal));
  rpc.register("library.create", async (memory) => library.create(memory));
  rpc.register("library.delete", async ({ id, confirmExternal }) => library.delete(id, confirmExternal));
  rpc.register("library.setTags", async ({ id, tags }) => ({ tags: library.setTags(id, tags) }));
}
