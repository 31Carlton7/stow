import { useEffect } from "react";

/**
 * Whether the Mac draws overlay scrollbars: the ones that appear on scroll and reserve no width.
 *
 * Chromium keeps the overlay bar when a page only colours or thins it; a `::-webkit-scrollbar` rule,
 * which every masked scroller needs for its track margins, turns it into a classic bar that holds a
 * gutter. So the thin styled bar is for the Macs whose system draws classic bars anyway, and the rest
 * get the system's own bar, trackless.
 *
 * Measured, not read from a preference: "automatically" depends on what is plugged in, and the only
 * party that knows the answer is the scroller Chromium draws. A probe with every scrollbar property
 * at its default reserves no width exactly when the system bar is an overlay.
 */
export function overlayScrollbars(doc: Document): boolean {
  const probe = doc.createElement("div");
  probe.style.cssText = "position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll;visibility:hidden;scrollbar-color:auto;scrollbar-width:auto";
  doc.body.appendChild(probe);
  const reserved = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return reserved === 0;
}

/** Says which kind the Mac draws on the root (`data-overlay-scrollbars`), for the stylesheet. Measured
 *  again when the window comes forward, because plugging a mouse in changes the answer under a
 *  running app. */
export function useScrollbarStyle(): void {
  useEffect(() => {
    const root = document.documentElement;
    const measure = () => {
      if (overlayScrollbars(document)) root.setAttribute("data-overlay-scrollbars", "");
      else root.removeAttribute("data-overlay-scrollbars");
    };
    measure();
    window.addEventListener("focus", measure);
    return () => { window.removeEventListener("focus", measure); root.removeAttribute("data-overlay-scrollbars"); };
  }, []);
}
