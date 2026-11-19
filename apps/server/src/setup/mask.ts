import { secretShapeIn } from "../secret-shapes";

const MASK = "••••";
/** A flag or a key whose value is a credential by its name. */
const SECRET_NAME = /(key|token|secret|password|passwd|credential|auth|bearer)/i;
/** A long run with no spaces that mixes letters and digits: an opaque value, as tokens are. */
const OPAQUE = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9_\-+/=.]{32,}$/;

/** A URL with its password and the values of its query string masked. Not a URL: unchanged. */
export function maskUrl(text: string): string {
  let url: URL;
  try { url = new URL(text); } catch { return text; }
  if (!/^https?:|^wss?:/.test(url.protocol)) return text;
  if (url.password) url.password = MASK;
  // The keys are copied first: `set` rewrites the list the iterator is walking.
  for (const key of Array.from(url.searchParams.keys())) url.searchParams.set(key, MASK);
  return url.toString().replaceAll(encodeURIComponent(MASK), MASK);
}

/**
 * One argument of a command line as it may be shown: masked when it is shaped like a known kind of
 * token, when the flag before it or its own `name=` says it is a credential, or when it is a long
 * opaque value; a URL keeps its address and loses its password and query values.
 */
function maskArg(arg: string, previous: string | undefined): string {
  if (secretShapeIn(arg) || OPAQUE.test(arg)) return MASK;
  if (previous?.startsWith("-") && SECRET_NAME.test(previous) && !arg.startsWith("-")) return MASK;
  const eq = arg.indexOf("=");
  if (eq > 0 && SECRET_NAME.test(arg.slice(0, eq))) return `${arg.slice(0, eq + 1)}${MASK}`;
  return maskUrl(arg);
}

export const maskArgs = (args: readonly string[]): string[] => args.map((arg, i) => maskArg(arg, args[i - 1]));

/** A command written as one line (a hook's), masked word by word. */
export const maskCommandLine = (line: string): string => {
  const words = line.split(/(\s+)/);
  return words.map((word, i) => (/^\s+$/.test(word) ? word : maskArg(word, words[i - 2]))).join("");
};
