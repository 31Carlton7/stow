import { Icon, type IconName } from "@amc/ui";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { dismissToast, toastStore, type Toast, type ToastTone } from "../toasts";
import { prefersReducedMotion } from "../reduced-motion";

/** How much of each toast tucked behind the front one shows above it, and the gap between them fanned
 *  out under the pointer. */
const PEEK = 10;
const GAP = 8;
/** A toast's height before its first measurement: a line and its padding. Measured in the same frame,
 *  before paint, so this only decides where the very first layout pass looks. */
const ESTIMATE = 42;
/** How long a leaving toast stays in the DOM: the same fact as its fade (`--dur-swap`), so the timer
 *  neither clips the fade nor parks a finished toast on screen. */
export const TOAST_EXIT_MS = 160;

const TONE_ICON: Record<ToastTone, IconName> = { error: "errorCircle", warning: "alert", success: "checkCircle", info: "info" };

/**
 * Whether the window has the keyboard and is on screen — the toasts' clocks run only then. A notice
 * that arrives while someone is in another app waits for them to come back.
 */
function useWindowWatched(): boolean {
  const [watched, setWatched] = useState(() => document.visibilityState !== "hidden");
  useEffect(() => {
    const away = () => setWatched(false);
    const back = () => setWatched(document.visibilityState !== "hidden");
    window.addEventListener("blur", away);
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", back);
    return () => {
      window.removeEventListener("blur", away);
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", back);
    };
  }, []);
  return watched;
}

/**
 * The window's toasts: a stack at its foot, in the bottom-right corner, newest in front and the two
 * before it tucked behind, fanning out under the pointer. Each one says its piece, runs a thin line
 * across its foot for as long as it is up, and leaves when the line reaches the end. The pointer on
 * the stack, focus in it, or the window not having the keyboard all stop every clock — a person
 * reading one, or selecting its text to copy, is never cut off.
 *
 * Portalled to `document.body` for the reason `Sheet` is.
 */
export function Toasts() {
  const toasts = useSyncExternalStore(toastStore.subscribe, toastStore.read);
  const watched = useWindowWatched();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const expanded = hovered || focused;
  const paused = expanded || !watched;

  // Front first: index 0 is the newest, and it is also first in the reading and the tab order.
  const stack = [...toasts].reverse();
  const heightOf = (t: Toast) => heights[t.id] ?? ESTIMATE;
  const frontHeight = stack[0] ? heightOf(stack[0]) : 0;
  /** How far up each toast sits fanned out: the heights of the ones in front of it, and their gaps. */
  const fanned = stack.map((_, k) => stack.slice(0, k).reduce((sum, t) => sum + heightOf(t) + GAP, 0));
  const fannedHeight = stack.length === 0 ? 0 : fanned[stack.length - 1]! + heightOf(stack[stack.length - 1]!);

  const onHeight = useCallback((id: string, h: number) => {
    setHeights((cur) => (cur[id] === h ? cur : { ...cur, [id]: h }));
  }, []);
  // A stack that empties under the pointer or the keyboard never hears it leave — the element the
  // pointer was over is gone — and the next toast would arrive paused.
  useEffect(() => { if (toasts.length === 0) { setHovered(false); setFocused(false); setHeights({}); } }, [toasts.length]);

  const style: CSSProperties = { height: expanded ? fannedHeight : frontHeight };
  return createPortal(
    <section className="toasts" aria-label="Notices" style={style} data-expanded={expanded || undefined}
      onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}>
      {stack.map((t, index) => (
        <ToastCard key={t.id} toast={t} index={index} count={stack.length}
          y={expanded ? -fanned[index]! : -PEEK * index} scale={expanded ? 1 : 1 - 0.05 * index}
          height={expanded || index === 0 ? heightOf(t) : frontHeight}
          paused={paused} onHeight={onHeight} onGone={dismissToast} />
      ))}
    </section>,
    document.body,
  );
}

function ToastCard({ toast, index, count, y, scale, height, paused, onHeight, onGone }: {
  toast: Toast; index: number; count: number; y: number; scale: number; height: number; paused: boolean;
  onHeight: (id: string, h: number) => void; onGone: (id: string) => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  /** What is left of its time. Spent only while the clock runs; a pause keeps the rest. */
  const remaining = useRef(toast.life);

  const leave = useCallback(() => {
    // Focus on its way out with it would land on <body>, which nobody chose. The next toast's close
    // takes it if there is one, so a reader dismissing by keyboard can go on doing so.
    const el = card.current;
    if (el?.contains(document.activeElement)) {
      const next = [...(el.parentElement?.querySelectorAll<HTMLElement>(".toast-close") ?? [])].find((b) => !el.contains(b));
      if (next) next.focus();
      else (document.activeElement as HTMLElement | null)?.blur();
    }
    setLeaving(true);
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => onGone(toast.id), prefersReducedMotion() ? 0 : TOAST_EXIT_MS);
    return () => clearTimeout(t);
  }, [leaving, onGone, toast.id]);

  // The clock, and the line across the foot is drawn on the same one: both stop and start on `paused`,
  // so the line reaching the end and the toast leaving are the same moment.
  useEffect(() => {
    if (paused || leaving) return;
    const started = performance.now();
    const t = setTimeout(leave, remaining.current);
    return () => { clearTimeout(t); remaining.current = Math.max(0, remaining.current - (performance.now() - started)); };
  }, [paused, leaving, leave]);

  // Its own height, which the stack fans out by. The body is measured rather than the card, because
  // a toast tucked behind is clipped to the front one's height.
  useLayoutEffect(() => {
    const el = body.current; if (!el) return;
    const measure = () => onHeight(toast.id, el.offsetHeight);
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [onHeight, toast.id]);

  return (
    <div ref={card} className="toast" role={toast.tone === "error" ? "alert" : "status"} aria-atomic="true"
      data-tone={toast.tone} data-front={index === 0 || undefined} data-leaving={leaving || undefined} data-paused={paused || undefined}
      style={{ zIndex: count - index, "--toast-y": `${y}px`, "--toast-scale": scale, "--toast-h": `${height}px`, "--toast-life": `${toast.life}ms` } as CSSProperties}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); leave(); } }}>
      <div ref={body} className="toast-body">
        <span className="toast-icon"><Icon name={toast.icon ?? TONE_ICON[toast.tone]} size={16} /></span>
        {/* The words select, so an error's wording can be copied; nothing on the card acts on a press
            but its buttons, which stay chrome. */}
        <p className="toast-text" data-selectable="">{toast.text}</p>
        {/* Taken, it is done with: the toast goes as the thing it offered happens. */}
        {toast.action && (
          <button type="button" className="toast-action" onClick={() => { toast.action!.run(); leave(); }}>
            {toast.action.label}
          </button>
        )}
        <button type="button" className="icon-btn toast-close" aria-label="Dismiss" title="Dismiss" onClick={leave}>
          <Icon name="close" size={12} />
        </button>
      </div>
      <span className="toast-progress" aria-hidden="true" />
    </div>
  );
}
