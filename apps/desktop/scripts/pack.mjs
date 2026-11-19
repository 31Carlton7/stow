/**
 * Runs electron-builder, signing only when the environment says who signs.
 *
 * With CSC_NAME (an identity in the keychain) or CSC_LINK (a .p12, with CSC_KEY_PASSWORD) set,
 * electron-builder signs and scripts/notarize.cjs runs after it. With neither, the build is unsigned
 * (`-c.mac.identity=null`) and says so. docs/dev/signing.md has the steps.
 */
import { spawnSync } from "node:child_process";

const signing = Boolean(process.env.CSC_LINK || process.env.CSC_NAME);
if (signing) console.log("[pack] signing: CSC_LINK or CSC_NAME is set, so electron-builder signs and notarize.cjs runs after");
else console.warn("[pack] NOT SIGNING: no CSC_LINK or CSC_NAME in the environment, so this build is unsigned. See docs/dev/signing.md.");
const args = process.argv.slice(2);
const packed = spawnSync("electron-builder", signing ? args : [...args, "-c.mac.identity=null"], { stdio: "inherit" });
if (packed.error) throw packed.error;
process.exit(packed.status ?? 1);
