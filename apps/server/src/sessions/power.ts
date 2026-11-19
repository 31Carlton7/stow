import { execFileSync } from "node:child_process";
import { cpus, loadavg } from "node:os";

/** `pmset` names the source the Mac is drawing from; anything that is not a Mac with a battery is on the mains. */
function onBattery(): boolean {
  try { return execFileSync("pmset", ["-g", "batt"], { encoding: "utf8", timeout: 2_000 }).includes("'Battery Power'"); }
  catch { return false; }
}

/**
 * Why work that can wait should wait, or null when it need not. Busy is more runnable work over the
 * last minute than the Mac has cores.
 */
export function whyWait(): string | null {
  if (onBattery()) return "on battery";
  return loadavg()[0]! > cpus().length ? "the Mac is busy" : null;
}
