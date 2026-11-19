import { useCallback, useState } from "react";
import type { IntroBridge } from "../../../preload";
import { prefersReducedMotion } from "../reduced-motion";

/** The welcome is up, lifting away over the app, or gone. */
type IntroPhase = "shown" | "leaving" | "gone";

/**
 * Whether the welcome is up. It starts up on a first launch, opening it is kept by main so the next
 * launch starts in the app, and Settings can bring it back for one more look.
 */
export function useIntro(kept: IntroBridge | undefined = window.amcIntro) {
  const [phase, setPhase] = useState<IntroPhase>(kept?.firstLaunch ? "shown" : "gone");
  const open = useCallback(() => {
    void kept?.seen();
    // With motion reduced nothing lifts, so there is no end of a lift to wait for.
    setPhase(prefersReducedMotion() ? "gone" : "leaving");
  }, [kept]);
  const lifted = useCallback(() => setPhase("gone"), []);
  const showAgain = useCallback(() => setPhase("shown"), []);
  return { phase, open, lifted, showAgain };
}
export type IntroState = ReturnType<typeof useIntro>;
