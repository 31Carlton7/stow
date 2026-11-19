import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "@amc/ui";
import { useDissolve } from "./ScrollFades";
import { createPortal } from "react-dom";

const FOCUSABLE = 'input, select, textarea, button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/** Generic modal: dimmed backdrop + centered panel. Escape or backdrop click closes; Tab wraps
 *  inside the panel; the first focusable control receives focus on open.
 *
 *  Portalled to `document.body`, so the backdrop's `position: fixed; inset: 0` resolves against the
 *  window whatever contains the control that opened it. */
export function Sheet({ title, onClose, children, footer, width = 420 }: {
  title: string; onClose: () => void; children: ReactNode;
  /** Actions that stay put while the body scrolls — the sheet's decision, at the end of what it is
   *  a decision about. Absent means no bar at all rather than an empty one. */
  footer?: ReactNode;
  width?: number;
}) {
  const panel = useRef<HTMLDivElement>(null);
  /* The body scrolls between the head and the foot, and dissolves at an end once there is more of it
     there. The panel itself cannot take the mask: it would take the panel's shadow with it. */
  const body = useRef<HTMLDivElement>(null);
  useDissolve(body);
  /* Read through a ref, so the effect below runs once for the sheet's life. Keyed on `onClose`, a
     caller that passes a new function each render had the first field take the keyboard back on
     every keystroke typed into the second. */
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const el = panel.current; if (!el) return;
    const prev = document.activeElement as HTMLElement | null;
    ((el.querySelector(".sheet-body") ?? el).querySelector<HTMLElement>(FOCUSABLE) ?? el).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        /* A popup that a control in the panel has open, portalled out of it, answers its own Escape. Both listen on window and this one was registered first, so
           without this the key that closes the picker closed the sheet under it too: mount order,
           not stacking order (design.md). Asked of the control, which says so whether the focus is
           in the popup, on the control, or nowhere at all. */
        if (el.querySelector('[aria-haspopup]:not([aria-haspopup="false"])[aria-expanded="true"]')) return;
        e.stopPropagation(); close.current(); return;
      }
      if (e.key !== "Tab") return;
      const nodes = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)); if (nodes.length === 0) return;
      const first = nodes[0]!, last = nodes[nodes.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      /* Focus goes back where it came from — unless something outside the sheet has the keyboard by
         now, which a restore would take it back from. The panel is already out of the DOM here, so
         focus it held reads as the body. */
      const now = document.activeElement;
      if (!now || now === document.body || el.contains(now)) prev?.focus?.();
    };
  }, []);
  return createPortal(
    <div className="sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} className="sheet" style={{ width }} tabIndex={-1}>
        <div className="sheet-head"><h3>{title}</h3><button type="button" className="icon-btn" aria-label="Close" title="Close (Esc)" onClick={onClose}><Icon name="close" size={14} /></button></div>
        <div className="sheet-body" ref={body}>{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
