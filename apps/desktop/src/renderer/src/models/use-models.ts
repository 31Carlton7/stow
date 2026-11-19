import { useCallback, useEffect, useState } from "react";
import { RUNNER_IDS, type ModelCall, type ModelTest, type ModelTier, type ModelsStatus, type OfferedModel, type PassScope, type RunnerId } from "@amc/contracts";
import { said, type RpcClient } from "../rpc/client";
import { toast } from "../toasts";

export type ModelsRpc = Pick<RpcClient, "call">;

type Tested = { ok: true; test: ModelTest } | { ok: false; why: string };

/** The Models page's state: each runner and its switch, the day's limit, what a reading would send,
 *  and the calls made so far. Every change is sent, then the page is read again from the server. */
export function useModels(rpc: ModelsRpc) {
  const [status, setStatus] = useState<ModelsStatus | null>(null);
  const [scope, setScope] = useState<PassScope | null>(null);
  const [calls, setCalls] = useState<ModelCall[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState<RunnerId | null>(null);
  const [tested, setTested] = useState<Partial<Record<RunnerId, Tested>>>({});
  const [offered, setOffered] = useState<Partial<Record<RunnerId, OfferedModel[]>>>({});

  const load = useCallback(async (): Promise<void> => {
    try {
      const [runners, sends, ledger] = await Promise.all([rpc.call("models.status", {}), rpc.call("review.passScope", {}), rpc.call("models.ledger", { limit: 30 })]);
      setStatus(runners);
      setScope(sends);
      setCalls(ledger.calls);
      setError(null);
    } catch (e) {
      setError(said(e));
    }
  }, [rpc]);

  useEffect(() => { void load(); }, [load]);

  /** Ask each tool which models it offers. The answer comes from starting the tool, so it is asked
   *  for only by the page that shows it, and one that will not say leaves its fields to be typed in. */
  const readOffered = useCallback((): void => {
    for (const runner of RUNNER_IDS) {
      rpc.call("models.offered", { runner }).then(({ models }) => { if (models !== null) setOffered((held) => ({ ...held, [runner]: models })); }, () => {});
    }
  }, [rpc]);

  /** Send one change, say so if it was refused, and read the page again either way. */
  const change = async (send: () => Promise<unknown>): Promise<void> => {
    try { await send(); }
    catch (e) { toast({ tone: "error", text: said(e) }); }
    await load();
  };

  return {
    status, scope, calls, error, testing, tested, offered, load, readOffered,
    setAllowed: (runner: RunnerId, allowed: boolean) => change(() => rpc.call("models.setAllowed", { runner, allowed })),
    setModel: (runner: RunnerId, tier: ModelTier, model: string) => change(() => rpc.call("models.setModel", { runner, tier, model })),
    setDailyCap: (usd: number) => change(() => rpc.call("models.setDailyCap", { usd })),
    setNeverSend: (sourceId: string, neverSend: boolean) => change(() => rpc.call("review.setNeverSend", { sourceId, neverSend })),
    /** One tiny real call, to see the runner work before anything of the person's is sent. */
    async test(runner: RunnerId): Promise<void> {
      if (testing !== null) return;
      setTesting(runner);
      try {
        const test = await rpc.call("models.test", { runner });
        setTested((held) => ({ ...held, [runner]: { ok: true, test } }));
      } catch (e) {
        setTested((held) => ({ ...held, [runner]: { ok: false, why: said(e) } }));
      } finally {
        setTesting(null);
      }
      await load();
    },
  };
}

export type Models = ReturnType<typeof useModels>;
