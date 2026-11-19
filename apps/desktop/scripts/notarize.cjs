/**
 * electron-builder's afterSign hook: sends the signed app to Apple's notary service and staples the
 * ticket, or skips and says exactly why. An unsigned build cannot be notarized, and nothing here
 * pretends otherwise. docs/dev/signing.md has the steps.
 */
const APPLE_VARS = ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"];

/** Whether this build notarizes, and if not, why not. */
function notarizeDecision(env) {
  if (!env.CSC_LINK && !env.CSC_NAME) return { run: false, reason: "the build is not signed (no CSC_LINK or CSC_NAME), and an unsigned app cannot be notarized" };
  if (env.APPLE_KEYCHAIN_PROFILE) return { run: true };
  const missing = APPLE_VARS.filter((name) => !env[name]);
  if (missing.length) return { run: false, reason: `no APPLE_KEYCHAIN_PROFILE, and ${missing.join(", ")} missing` };
  return { run: true };
}

async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  const decision = notarizeDecision(process.env);
  if (!decision.run) {
    console.warn(`\n[notarize] SKIPPED: ${decision.reason}. See docs/dev/signing.md.\n`);
    return;
  }
  // Loaded here so a build without credentials never loads the module.
  const { notarize } = await import("@electron/notarize");
  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`;
  console.log(`[notarize] sending ${appPath} to Apple's notary service (this can take a few minutes)`);
  const credentials = process.env.APPLE_KEYCHAIN_PROFILE
    ? { keychainProfile: process.env.APPLE_KEYCHAIN_PROFILE }
    : { appleId: process.env.APPLE_ID, appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD, teamId: process.env.APPLE_TEAM_ID };
  await notarize({ appPath, ...credentials });
  console.log("[notarize] accepted and stapled");
}

module.exports = afterSign;
