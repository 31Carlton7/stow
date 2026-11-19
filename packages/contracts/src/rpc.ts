import { z } from "zod";
import { LibraryMethods } from "./library";
import { SetupMethods } from "./setup";
import { ModelMethods } from "./models";
import { ReviewMethods } from "./review";
import { SessionMethods } from "./sessions";
import { ConnectionMethods } from "./connections";
import { HealthMethods } from "./health";
import { GraphMethods } from "./graph";
import { FavoriteMethods } from "./favorites";

export const RpcRequestSchema = z.object({ id: z.string(), method: z.string(), params: z.unknown() });
export const RpcErrorSchema = z.object({ code: z.string(), message: z.string() });
export const RpcResponseSchema = z.discriminatedUnion("ok", [
  z.object({ id: z.string(), ok: z.literal(true), result: z.unknown() }),
  z.object({ id: z.string(), ok: z.literal(false), error: RpcErrorSchema }),
]);
export type RpcRequest = z.infer<typeof RpcRequestSchema>;
export type RpcResponse = z.infer<typeof RpcResponseSchema>;

export type WireMessage = { kind: "request"; msg: RpcRequest } | { kind: "response"; msg: RpcResponse };

export function parseWireMessage(raw: string): WireMessage {
  const json: unknown = JSON.parse(raw);
  const req = RpcRequestSchema.safeParse(json); if (req.success) return { kind: "request", msg: req.data };
  const res = RpcResponseSchema.safeParse(json); if (res.success) return { kind: "response", msg: res.data };
  throw new Error("Unrecognized wire message");
}

export const SystemInfoSchema = z.object({
  version: z.string(),
  /** Where the app keeps its own data: the index and the backups. */
  home: z.string(),
  /** The home folder whose agent files are read. The person's own, unless a check points it at a fixture. */
  sourceHome: z.string(),
  schemaVersion: z.number().int(),
});
export type SystemInfo = z.infer<typeof SystemInfoSchema>;

export const Methods = {
  "system.info": { params: z.object({}), result: SystemInfoSchema },
  ...LibraryMethods,
  ...SetupMethods,
  ...ModelMethods,
  ...ReviewMethods,
  ...SessionMethods,
  ...ConnectionMethods,
  ...HealthMethods,
  ...GraphMethods,
  ...FavoriteMethods,
} as const;

export type MethodName = keyof typeof Methods;
export type MethodParams<M extends MethodName> = z.input<(typeof Methods)[M]["params"]>;
export type MethodResult<M extends MethodName> = z.infer<(typeof Methods)[M]["result"]>;
