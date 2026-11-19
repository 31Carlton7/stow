import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Graph, GraphNeighbourhood } from "@amc/contracts";
import { said, type RpcClient } from "../rpc/client";
import { EVERY_KIND, drawn, found, kindCounts, neighboursOf, type Shown } from "./graph-model";

export type GraphRpc = Pick<RpcClient, "call">;

/**
 * The Graph section's state: the graph for the scope chosen, which kinds are drawn, the node the
 * pointer is on and the node picked. Nothing is asked for until the section is first shown, and a
 * picked node's neighbourhood is asked for on its own, because for a session it reads the transcript.
 */
export function useGraph(rpc: GraphRpc) {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [around, setAroundNow] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown>(EVERY_KIND);
  const [hoveredId, setHovered] = useState<string | null>(null);
  const [pickedId, setPicked] = useState<string | null>(null);
  const [picked, setNeighbourhood] = useState<GraphNeighbourhood | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [flight, setFlight] = useState<{ id: string; n: number } | null>(null);
  const asked = useRef(0);

  const load = useCallback(async (scope: string | null): Promise<void> => {
    const ask = ++asked.current;
    try {
      const answered = await rpc.call("graph.get", { around: scope });
      if (ask !== asked.current) return;
      setGraph(answered);
      setError(null);
    } catch (e) {
      if (ask === asked.current) setError(said(e));
    }
  }, [rpc]);

  useEffect(() => {
    setNeighbourhood(null);
    setPickError(null);
    if (pickedId === null) return;
    let live = true;
    rpc.call("graph.neighbourhood", { id: pickedId }).then(
      (answered) => { if (live) setNeighbourhood(answered); },
      (e: unknown) => { if (live) setPickError(said(e)); },
    );
    return () => { live = false; };
  }, [rpc, pickedId]);

  const visible = useMemo(() => (graph === null ? null : drawn(graph, shown)), [graph, shown]);
  const lit = useMemo(() => {
    if (visible === null) return null;
    if (hoveredId !== null) return neighboursOf(visible.edges, hoveredId);
    if (pickedId === null) return null;
    // What a session loaded is not an edge of the drawing, so the picked node's own answer adds it.
    const near = neighboursOf(visible.edges, pickedId);
    for (const link of picked?.links ?? []) near.add(link.node.id);
    return near;
  }, [visible, hoveredId, pickedId, picked]);

  return {
    graph, error, around, shown, visible, lit, hoveredId, pickedId, picked, pickError, typed, flight,
    counts: graph === null ? null : kindCounts(graph.nodes),
    matches: visible === null ? [] : found(visible.nodes, typed),

    /** Read the graph again: what the other sections list can have changed since it was last drawn. */
    refresh: useCallback((): Promise<void> => load(around), [load, around]),
    setAround(scope: string | null): void {
      setAroundNow(scope);
      setPicked(null);
      setHovered(null);
      void load(scope);
    },
    setShown,
    setTyped,
    hover: setHovered,
    pick: setPicked,
    /** Pick a node and bring the view to it: what the search and the card's own links do. */
    flyTo(id: string): void {
      setPicked(id);
      setTyped("");
      setFlight((last) => ({ id, n: (last?.n ?? 0) + 1 }));
    },
  };
}

export type GraphState = ReturnType<typeof useGraph>;
