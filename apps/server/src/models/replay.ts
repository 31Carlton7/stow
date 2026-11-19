import type { CliExit, CliRun, RunCli } from "./cli";

/** A `RunCli` for the suites: answers each start with the next recorded exit and keeps what was asked. */
export function replay(exits: Partial<CliExit>[]): { runCli: RunCli; started: CliRun[] } {
  const started: CliRun[] = [];
  const queue = [...exits];
  const runCli: RunCli = async (run) => {
    started.push(run);
    const next = queue.shift();
    if (!next) throw new Error(`nothing recorded for ${run.command} ${run.args.join(" ")}`);
    return { code: 0, stdout: "", stderr: "", missing: false, aborted: false, timedOut: false, ...next };
  };
  return { runCli, started };
}

/** The value that follows `flag` on a recorded command line. */
export const argAfter = (run: CliRun, flag: string): string | undefined => run.args[run.args.indexOf(flag) + 1];
