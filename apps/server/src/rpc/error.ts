/** The one error a handler throws to have its code cross the wire; anything else arrives as INTERNAL. */
export class RpcError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = "RpcError"; }
}
