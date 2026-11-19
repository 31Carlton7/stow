import { useCallback, useEffect, useRef, useState } from "react";
import type { AppliedFix, Finding, ModelsStatus, PassScope, PassStatus, ProposedChange, RunnerId } from "@amc/contracts";
import { said, type RpcClient } from "../rpc/client";
import { dismissToast, toast } from "../toasts";
import { keptBy, type ReviewFilter } from "./review-model";

export type ReviewRpc = Pick<RpcClient, "call">;

/** What the detail column is waiting on, so its buttons say so and cannot be pressed twice. */
type ReviewWork = "approve" | "reject" | "draft" | null;

/**
 * The review inbox's state: what a scan found, the finding being read with what approving it would
 * change, the model's reading while one runs, and the fixes already applied.
 *
 * A scan reads every file, so it is not run on a timer or on focus: once when the window opens, when
 * the person asks, and after anything here changes a file.
 */
export function useReview(rpc: ReviewRpc) {
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [rejected, setRejected] = useState(0);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState<ReviewFilter>({ kind: "all" });
  const [picked, setPicked] = useState<string | null>(null);
  const [changes, setChanges] = useState<ProposedChange[] | null>(null);
  const [work, setWork] = useState<ReviewWork>(null);
  const [history, setHistory] = useState<AppliedFix[]>([]);
  const [pass, setPass] = useState<PassStatus | null>(null);
  const [scope, setScope] = useState<PassScope | null>(null);
  const [models, setModels] = useState<ModelsStatus | null>(null);
  const scans = useRef(0);
  /** The toast that offers each applied fix's Undo, so it goes when the fix is undone from the list instead. */
  const receipts = useRef(new Map<number, string>());

  const scan = useCallback(async (): Promise<void> => {
    const mine = ++scans.current;
    setScanning(true);
    try {
      const [found, applied, reading, sends, status] = await Promise.all([
        rpc.call("review.scan", {}), rpc.call("review.history", {}), rpc.call("review.passStatus", {}),
        rpc.call("review.passScope", {}), rpc.call("models.status", {}),
      ]);
      if (mine !== scans.current) return;
      setFindings(found.findings);
      setRejected(found.rejected);
      setHistory(applied.applied);
      setPass(reading);
      setScope(sends);
      setModels(status);
      setScanError(null);
    } catch (e) {
      if (mine === scans.current) setScanError(said(e));
    } finally {
      if (mine === scans.current) setScanning(false);
    }
  }, [rpc]);

  useEffect(() => { void scan(); }, [scan]);

  /** Read again what the Models page can change under the inbox: which runners are on, and what a
   *  reading would send. Cheap, where a scan reads every file. */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [reading, sends, status] = await Promise.all([rpc.call("review.passStatus", {}), rpc.call("review.passScope", {}), rpc.call("models.status", {})]);
      setPass(reading);
      setScope(sends);
      setModels(status);
    } catch {
      // The next scan says what is wrong; a strip that is a moment out of date is not worth a notice.
    }
  }, [rpc]);

  const shown = findings === null ? null : keptBy(filter, findings);
  const finding = findings?.find((f) => f.fingerprint === picked) ?? null;

  // What approving the finding would change, asked for when it has a fix that is already written.
  const proposable = finding !== null && finding.fix !== null && !finding.needsDraft ? finding.fingerprint : null;
  useEffect(() => {
    setChanges(null);
    if (proposable === null) return;
    let live = true;
    rpc.call("review.proposal", { fingerprint: proposable }).then(
      (answered) => { if (live) setChanges(answered.changes); },
      (e: unknown) => { if (live) toast({ tone: "error", text: said(e) }); },
    );
    return () => { live = false; };
  }, [rpc, proposable]);

  const reading = pass?.running ?? false;
  useEffect(() => {
    if (!reading) return;
    const timer = setInterval(() => {
      rpc.call("review.passStatus", {}).then((status) => {
        setPass(status);
        if (!status.running) void scan();
      }, () => {});
    }, 1_000);
    return () => clearInterval(timer);
  }, [rpc, reading, scan]);

  /** Run one change to the inbox, say what went wrong if it did, and scan again either way. */
  const act = async (kind: Exclude<ReviewWork, null>, run: () => Promise<void>): Promise<void> => {
    if (work !== null) return;
    setWork(kind);
    try { await run(); }
    catch (e) { toast({ tone: "error", text: said(e) }); }
    finally { setWork(null); }
    await scan();
  };

  const undo = (id: number): Promise<void> => act("approve", async () => {
    await rpc.call("review.undo", { id });
    const receipt = receipts.current.get(id);
    if (receipt !== undefined) dismissToast(receipt);
    receipts.current.delete(id);
    toast({ tone: "success", text: "Undone. The files are as they were." });
  });

  return {
    findings, shown, rejected, scanError, scanning, filter, finding, changes, work, history, pass, scope, models,
    /** The runners the person has turned on and that are there to run. */
    runners: (models?.runners ?? []).filter((r) => r.settings.allowed && r.probe.installed),

    scan, refresh,
    setFilter(next: ReviewFilter): void { setFilter(next); setPicked(null); },
    pick(fingerprint: string): void { setPicked(fingerprint); },

    approve(): Promise<void> {
      if (!finding) return Promise.resolve();
      return act("approve", async () => {
        const fix = await rpc.call("review.approve", { fingerprint: finding.fingerprint });
        setPicked(null);
        receipts.current.set(fix.id, toast({ tone: "success", text: `Fixed: ${finding.title}`, action: { label: "Undo", run: () => void undo(fix.id) } }));
      });
    },
    reject(): Promise<void> {
      if (!finding) return Promise.resolve();
      return act("reject", async () => {
        await rpc.call("review.reject", { fingerprint: finding.fingerprint });
        setPicked(null);
      });
    },
    undo,
    /** Have the stronger model write this finding's fix. One call on the person's plan. */
    draft(runner: RunnerId): Promise<void> {
      if (!finding) return Promise.resolve();
      return act("draft", async () => { await rpc.call("review.draft", { fingerprint: finding.fingerprint, runner }); });
    },

    async startPass(runner: RunnerId): Promise<void> {
      try { setPass(await rpc.call("review.startPass", { runner })); }
      catch (e) { toast({ tone: "error", text: said(e) }); }
    },
    async stopPass(): Promise<void> {
      try { setPass(await rpc.call("review.stopPass", {})); }
      catch (e) { toast({ tone: "error", text: said(e) }); }
    },
  };
}

export type Review = ReturnType<typeof useReview>;
