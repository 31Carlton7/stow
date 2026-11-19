import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { MATCH_THE_MAC, accentColour, type AppearanceChoice } from "./accent";

export type Mode = "light" | "dark";

/** Tracks the OS colour scheme via `prefers-color-scheme`. Falls back to light where matchMedia is unavailable (tests). */
export function useSystemMode(): Mode {
  const mq = () => window.matchMedia?.("(prefers-color-scheme: dark)");
  const [mode, setMode] = useState<Mode>(() => (mq()?.matches ? "dark" : "light"));
  useEffect(() => {
    const m = mq(); if (!m) return;
    const fn = () => setMode(m.matches ? "dark" : "light");
    m.addEventListener("change", fn);
    return () => m.removeEventListener("change", fn);
  }, []);
  return mode;
}

/** The app wears the Mac's appearance: the stylesheet holds both faces, and this says which is on.
 *  A layout effect, so the first paint already carries the mode. */
export function useApplyTheme(): void {
  const mode = useSystemMode();
  useLayoutEffect(() => { document.documentElement.dataset.mode = mode; }, [mode]);
}

/** Hand the stylesheet the accent: every shade of it is made there, from this one colour. */
export function applyAccent(colour: string): void {
  document.documentElement.style.setProperty("--accent-base", colour);
}

/** The accent as it was chosen when the window was made. Called before the first render, so no
 *  frame is painted in another colour. */
export function applyKeptAccent(): void {
  const kept = window.amc?.appearance;
  if (kept) applyAccent(accentColour(kept.choice.accent, kept.systemAccent));
}

export type AppearanceControls = { choice: AppearanceChoice; systemAccent: string; choose: (next: AppearanceChoice) => void };

/**
 * The look the person chose, and the way to choose another. The accent is this page's to paint; light
 * and dark are the window's, which the main process turns, and the page follows it as it follows the Mac.
 */
export function useAppearance(): AppearanceControls {
  const [choice, setChoice] = useState<AppearanceChoice>(() => window.amc?.appearance.choice ?? MATCH_THE_MAC);
  const [systemAccent, setSystemAccent] = useState(() => window.amc?.appearance.systemAccent ?? "");
  useEffect(() => window.amc?.onSystemAccent(setSystemAccent), []);
  useLayoutEffect(() => applyAccent(accentColour(choice.accent, systemAccent)), [choice.accent, systemAccent]);
  const choose = useCallback((next: AppearanceChoice) => {
    setChoice(next);
    void window.amc?.chooseAppearance(next);
  }, []);
  return { choice, systemAccent, choose };
}
