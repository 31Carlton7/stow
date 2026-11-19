import { useEffect, useRef } from "react";
import type { GraphEdge, GraphNode } from "@amc/contracts";
import { nodeColour, nodeWeight, type Face } from "./graph-model";

export type GraphCanvasProps = {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  /** The nodes that stay bright while the rest dim, or null when nothing is hovered or picked. */
  lit: ReadonlySet<string> | null;
  pickedId: string | null;
  /** Bring the view to a node. `n` changes each time, so the same node can be flown to twice. */
  flight: { id: string; n: number } | null;
  /** Drawn flat, on a 2D canvas, where there is no WebGL. */
  flat: boolean;
  reducedMotion: boolean;
  onHover: (id: string | null) => void;
  onPick: (id: string | null) => void;
};

type Placed = GraphNode & { x?: number; y?: number; z?: number };
type Line = { source: string | Placed; target: string | Placed; kind: GraphEdge["kind"] };

/** The part of `3d-force-graph` and `force-graph` this draws with. The two share it, which is why the flat drawing is the same code. */
type Drawing = {
  graphData(data: { nodes: Placed[]; links: Line[] }): Drawing;
  width(px: number): Drawing;
  height(px: number): Drawing;
  backgroundColor(colour: string): Drawing;
  nodeRelSize(px: number): Drawing;
  nodeVal(of: (node: Placed) => number): Drawing;
  nodeLabel(of: () => string): Drawing;
  nodeColor(of: (node: Placed) => string): Drawing;
  linkColor(of: (line: Line) => string): Drawing;
  linkWidth(of: (line: Line) => number): Drawing;
  onNodeHover(to: (node: Placed | null) => void): Drawing;
  onNodeClick(to: (node: Placed) => void): Drawing;
  onBackgroundClick(to: () => void): Drawing;
  warmupTicks(ticks: number): Drawing;
  cooldownTicks(ticks: number): Drawing;
  cooldownTime(ms: number): Drawing;
  graph2ScreenCoords(x: number, y: number, z?: number): { x: number; y: number };
  zoomToFit(ms: number, padding: number): Drawing;
  _destructor(): void;
  // Only the 3D drawing:
  nodeOpacity?(opacity: number): Drawing;
  nodeResolution?(segments: number): Drawing;
  linkOpacity?(opacity: number): Drawing;
  showNavInfo?(shown: boolean): Drawing;
  enableNodeDrag?(on: boolean): Drawing;
  cameraPosition?(to?: { x: number; y: number; z: number }, lookAt?: { x: number; y: number; z: number }, ms?: number): { x: number; y: number; z: number };
  controls?(): { autoRotate: boolean; autoRotateSpeed: number };
  // Only the flat one:
  centerAt?(x: number, y: number, ms: number): Drawing;
  zoom?(scale?: number, ms?: number): Drawing & number;
};

const LINE: Record<Face, { rest: string; lit: string; dim: string }> = {
  dark: { rest: "rgba(235,235,245,0.22)", lit: "rgba(255,255,255,0.85)", dim: "rgba(235,235,245,0.04)" },
  light: { rest: "rgba(60,60,67,0.26)", lit: "rgba(0,0,0,0.75)", dim: "rgba(60,60,67,0.05)" },
};
/** How many names are on screen at once. More would be read by no one and cost a layout each frame. */
const LABELS = 36;
/** A node's radius for a weight of one: a sphere's in the 3D drawing, a disc's in the flat one. */
const SPHERE_SIZE = 3.2, FLAT_SIZE = 3;
/** How long the layout is given to spread a new set of nodes before the camera frames them. */
const FRAME_AFTER_MS = 700;
const endId = (end: string | Placed): string => (typeof end === "string" ? end : end.id);
const face = (): Face => (document.documentElement.dataset.mode === "light" ? "light" : "dark");

/**
 * The drawing itself: a force-directed graph the person orbits, zooms and drags, on a see-through
 * ground so the panel shows behind it. Names are the page's own text laid over the canvas, so they
 * are in the system face and as sharp as any other label: agents and projects always, and of the
 * rest the ones nearest the eye, so more appear as the person zooms in.
 */
export default function GraphCanvas(props: GraphCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const names = useRef<HTMLDivElement>(null);
  const drawing = useRef<Drawing | null>(null);
  const placed = useRef(new Map<string, Placed>());
  const latest = useRef(props);
  latest.current = props;
  const { flat, reducedMotion } = props;

  /** Ask the drawing to colour everything again: its accessors read what is lit and the face as they are now. */
  const recolour = (): void => {
    const made = drawing.current;
    if (!made) return;
    const shade = face();
    const dimmed = shade === "dark" ? "rgba(140,140,150,0.12)" : "rgba(120,120,128,0.14)";
    made.nodeColor((node) => (latest.current.lit === null || latest.current.lit.has(node.id) ? nodeColour(node, shade) : dimmed));
    made.linkColor((line) => {
      const { lit } = latest.current;
      if (lit === null) return LINE[shade].rest;
      return lit.has(endId(line.source)) && lit.has(endId(line.target)) ? LINE[shade].lit : LINE[shade].dim;
    });
  };

  const framing = useRef<number | undefined>(undefined);
  const feed = (): void => {
    const made = drawing.current;
    if (!made) return;
    const { nodes, edges } = latest.current;
    // A node keeps the object the layout moves, so switching a kind off and on leaves the rest where they were.
    const kept = new Map<string, Placed>();
    for (const node of nodes) kept.set(node.id, Object.assign(placed.current.get(node.id) ?? {}, node));
    placed.current = kept;
    made.graphData({ nodes: [...kept.values()], links: edges.map((edge) => ({ ...edge })) });
    if (host.current) host.current.dataset.nodes = String(nodes.length);
    // What is drawn has changed, so it is framed again: a few nodes would otherwise sit small in the
    // middle of the panel. After the layout has had a moment to spread them.
    clearTimeout(framing.current);
    framing.current = window.setTimeout(() => drawing.current?.zoomToFit(latest.current.reducedMotion ? 0 : 600, 56), FRAME_AFTER_MS);
  };

  useEffect(() => {
    const el = host.current!;
    let gone = false;
    let frame = 0;
    let stopTurning = (): void => {};
    const start = async (): Promise<void> => {
      const made = (flat
        ? new (await import("force-graph")).default(el)
        : new (await import("3d-force-graph")).default(el, { controlType: "orbit", rendererConfig: { alpha: true, antialias: true } })) as unknown as Drawing;
      if (gone) { made._destructor(); return; }
      drawing.current = made;
      made.backgroundColor("rgba(0,0,0,0)").width(el.clientWidth).height(el.clientHeight)
        .nodeRelSize(flat ? FLAT_SIZE : SPHERE_SIZE).nodeVal(nodeWeight).nodeLabel(() => "").linkWidth(() => 0)
        .onNodeHover((node) => { el.style.cursor = node ? "pointer" : ""; latest.current.onHover(node?.id ?? null); })
        .onNodeClick((node) => latest.current.onPick(node.id))
        .onBackgroundClick(() => latest.current.onPick(null));
      made.nodeOpacity?.(0.94).nodeResolution?.(12).linkOpacity?.(1).showNavInfo?.(false);
      // With motion reduced the layout is worked out before the first frame and then holds still.
      if (reducedMotion) made.warmupTicks(160).cooldownTicks(0);
      else made.warmupTicks(40).cooldownTime(8000);
      recolour();
      feed();
      el.dataset.drawn = flat ? "2d" : "3d";

      const controls = made.controls?.();
      if (controls && !reducedMotion) {
        // A slow turn shows the depth until the person takes hold of it; then it is theirs.
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.35;
        stopTurning = () => { controls.autoRotate = false; };
        el.addEventListener("pointerdown", stopTurning, { once: true });
        el.addEventListener("wheel", stopTurning, { once: true, passive: true });
      }

      const pool: HTMLSpanElement[] = [];
      let odd = false;
      const nameThem = (): void => {
        frame = requestAnimationFrame(nameThem);
        odd = !odd;
        const layer = names.current;
        if (odd || !layer) return;
        const eye = made.cameraPosition?.();
        const scale = flat ? Number(made.zoom?.() ?? 1) : 1;
        const width = el.clientWidth, height = el.clientHeight;
        const { lit, pickedId } = latest.current;
        const scored: { node: Placed; at: { x: number; y: number }; reach: number; score: number }[] = [];
        for (const node of placed.current.values()) {
          if (node.x === undefined || node.y === undefined) continue;
          const hub = node.kind === "agent" || node.kind === "project";
          const far = eye ? Math.hypot(eye.x - node.x, eye.y - node.y, eye.z - (node.z ?? 0)) : 600 / scale;
          const near = lit !== null && lit.has(node.id);
          if (!hub && !near && far > 260) continue;
          if (lit !== null && !near && !hub) continue;
          const at = made.graph2ScreenCoords(node.x, node.y, node.z ?? 0);
          if (at.x < 0 || at.y < 0 || at.x > width || at.y > height) continue;
          // How far the sphere reaches on screen, so its name starts clear of it. The 3D camera's field of view is 40°.
          const reach = flat ? Math.sqrt(nodeWeight(node)) * FLAT_SIZE * scale : (Math.cbrt(nodeWeight(node)) * SPHERE_SIZE * height) / (0.728 * far);
          scored.push({ node, at, reach, score: (node.id === pickedId ? 1e6 : near ? 1e3 : hub ? 400 : 0) + nodeWeight(node) * 40 - far });
        }
        scored.sort((a, b) => b.score - a.score);
        const named = scored.slice(0, LABELS);
        while (pool.length < named.length) { const tag = document.createElement("span"); tag.className = "graph-name"; layer.append(tag); pool.push(tag); }
        for (const [n, tag] of pool.entries()) {
          const name = named[n];
          if (!name) { tag.hidden = true; continue; }
          tag.hidden = false;
          if (tag.textContent !== name.node.label) tag.textContent = name.node.label;
          tag.dataset.kind = name.node.kind;
          tag.toggleAttribute("data-dim", lit !== null && !lit.has(name.node.id));
          tag.style.translate = `${Math.round(name.at.x + name.reach + 4)}px ${Math.round(name.at.y)}px`;
        }
      };
      frame = requestAnimationFrame(nameThem);
    };
    void start();

    const sized = new ResizeObserver(() => drawing.current?.width(el.clientWidth).height(el.clientHeight));
    sized.observe(el);
    const faced = new MutationObserver(recolour);
    faced.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode"] });
    return () => {
      gone = true;
      cancelAnimationFrame(frame);
      clearTimeout(framing.current);
      sized.disconnect();
      faced.disconnect();
      el.removeEventListener("pointerdown", stopTurning);
      el.removeEventListener("wheel", stopTurning);
      drawing.current?._destructor();
      drawing.current = null;
      names.current?.replaceChildren();
      delete el.dataset.drawn;
    };
    // The drawing is made once for a kind of canvas; what it draws is fed to it below.
  }, [flat, reducedMotion]);

  useEffect(feed, [props.nodes, props.edges]);
  useEffect(recolour, [props.lit, props.pickedId]);

  useEffect(() => {
    const made = drawing.current;
    const node = props.flight === null ? undefined : placed.current.get(props.flight.id);
    if (!made || !node || node.x === undefined || node.y === undefined) return;
    const ms = reducedMotion ? 0 : 900;
    if (made.centerAt) { made.centerAt(node.x, node.y, ms); made.zoom?.(3, ms); return; }
    const z = node.z ?? 0;
    const out = 1 + 140 / Math.max(1, Math.hypot(node.x, node.y, z));
    if (made.controls) made.controls()!.autoRotate = false;
    made.cameraPosition?.({ x: node.x * out, y: node.y * out, z: z * out }, { x: node.x, y: node.y, z }, ms);
  }, [props.flight, reducedMotion]);

  return (
    <div className="graph-canvas">
      <div className="graph-host" ref={host} />
      <div className="graph-names" ref={names} aria-hidden="true" />
    </div>
  );
}
