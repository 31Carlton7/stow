import type { RpcServer } from "../rpc/server";
import type { ModelPass } from "./model-pass";
import type { Review } from "./review";

export function registerReview(rpc: RpcServer, review: Review, pass: ModelPass): void {
  rpc.register("review.scan", async () => review.scan());
  rpc.register("review.proposal", async ({ fingerprint }) => ({ changes: review.proposal(fingerprint) }));
  rpc.register("review.approve", async ({ fingerprint }) => review.approve(fingerprint));
  rpc.register("review.reject", async ({ fingerprint }) => { review.reject(fingerprint); return {}; });
  rpc.register("review.undo", async ({ id }) => review.undo(id));
  rpc.register("review.history", async () => ({ applied: review.history() }));
  rpc.register("review.passScope", async () => pass.scope());
  rpc.register("review.setNeverSend", async ({ sourceId, neverSend }) => { pass.setNeverSend(sourceId, neverSend); return {}; });
  rpc.register("review.startPass", async ({ runner }) => pass.start(runner));
  rpc.register("review.stopPass", async () => pass.stop());
  rpc.register("review.passStatus", async () => pass.passStatus());
  rpc.register("review.draft", async ({ fingerprint, runner }) => ({ changes: await review.draftFix(fingerprint, runner) }));
}
