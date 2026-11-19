import { homedir } from "node:os";
import { join } from "node:path";
import { APP_NAME } from "@amc/contracts";

type Env = Record<string, string | undefined>;

/** Where the app keeps its own data. The desktop app always says (`AMC_HOME`); the fallback is for
 *  the server run on its own. */
export const appHome = (env: Env): string => env.AMC_HOME || join(homedir(), "Library", "Application Support", APP_NAME, "home");

/** The home folder whose agent files are read: the person's own, or a fixture a check points at. */
export const sourceHome = (env: Env): string => env.AMC_SOURCE_HOME || homedir();
