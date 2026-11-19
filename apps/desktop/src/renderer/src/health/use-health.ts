import { useCallback, useEffect, useState } from "react";
import type { HealthSummary } from "@amc/contracts";
import { said, type RpcClient } from "../rpc/client";

export type HealthRpc = Pick<RpcClient, "call">;

/** How often a page waiting on the reading of recent sessions asks how far it has got. */
const ASK_MS = 1500;

/**
 * The Health page's numbers. They are read when the page opens; while recent sessions are still
 * being read the cheap status is asked for, and the numbers are read again when it has finished.
 */
export function useHealth(rpc: HealthRpc) {
  const [summary, setSummary] = useState<HealthSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setSummary(await rpc.call("health.summary", {}));
      setError(null);
    } catch (e) {
      setError(said(e));
    }
  }, [rpc]);

  useEffect(() => { void load(); }, [load]);

  const waiting = summary !== null && summary.pass.state !== "idle";
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      rpc.call("health.status", {}).then((pass) => {
        if (pass.state === "idle") void load();
        else setSummary((held) => held && { ...held, pass });
      }, () => {});
    }, ASK_MS);
    return () => clearInterval(timer);
  }, [waiting, rpc, load]);

  return { summary, error, load };
}

export type Health = ReturnType<typeof useHealth>;
