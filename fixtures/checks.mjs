/** A check's pass/fail lines, and the exit that says whether any failed. */
export function checks() {
  const failures = [];
  return {
    check(what, ok, detail = "") {
      console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? `: ${detail}` : ""}`);
      if (!ok) failures.push(what);
    },
    finish() {
      if (failures.length > 0) {
        console.error(`\n${failures.length} check(s) failed`);
        process.exit(1);
      }
      console.log("\nall checks passed");
    },
  };
}
