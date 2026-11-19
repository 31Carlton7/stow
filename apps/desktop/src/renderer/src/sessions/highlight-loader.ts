import { useSyncExternalStore } from "react";
import type { HLJSApi } from "highlight.js";

/**
 * highlight.js, kept out of the boot chunk.
 *
 * It is minified script no window needs before it first paints, and most windows open on a
 * transcript long after the app is up. A render that needs it before it has loaded draws its plain
 * fallback (escaped code) and asks for it, and every subscriber of `useHighlighter` re-renders when
 * it lands. Rendering stays synchronous: the library is either here or the text is drawn as text,
 * never a promise in the middle of a render.
 */
let hljs: HLJSApi | null = null;
let loading: Promise<void> | null = null;
let version = 0;
const listeners = new Set<() => void>();

export function loadHighlighter(): Promise<void> {
  loading ??= import("./highlight-grammars").then(
    (h) => {
      hljs = h.default;
      version += 1;
      for (const listener of listeners) listener();
    },
    (err: unknown) => {
      // A chunk that failed to load is asked for again by the next render that needs it.
      loading = null;
      throw err;
    },
  );
  return loading;
}

const request = (): void => { loadHighlighter().catch(() => {}); };

/** highlight.js with every grammar registered, if it has loaded; otherwise null, and the load is started. */
export function hljsIfLoaded(): HLJSApi | null {
  if (!hljs) request();
  return hljs;
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = (): number => version;

/** A number that changes when the library lands: put it in the deps of anything that renders with it. */
export function useHighlighter(): number {
  return useSyncExternalStore(subscribe, snapshot);
}
