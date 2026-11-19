import { useCallback, useEffect, useRef, useState } from "react";
import type { Session, SessionContext, SessionFacets, SessionIndexStatus } from "@amc/contracts";
import { useFavorites } from "../favorites/use-favorites";
import { said, type RpcClient } from "../rpc/client";
import { LIST_PAGE, STRETCH, listFilter, type SessionScope, type Shown, type Stretch } from "./sessions-model";

export type SessionsRpc = Pick<RpcClient, "call">;
export type ReaderView = "transcript" | "context";

/** How long the search field is left alone before its words are sent. */
const SEARCH_PAUSE_MS = 250;
/** How often the index is asked how far it has got, while it is working. */
const STATUS_EVERY_MS = 2000;
const FIRST_STRETCH = "start";

/**
 * The Sessions section's state: the list as the sidebar and the search narrow it, how far the index
 * has got, and the one session being read with its transcript and its context. Nothing here writes:
 * a transcript is read where the agent left it.
 */
export function useSessions(rpc: SessionsRpc) {
  const [facets, setFacets] = useState<SessionFacets | null>(null);
  const [status, setStatus] = useState<SessionIndexStatus | null>(null);
  const [statusAsked, setStatusAsked] = useState(false);
  const [scope, setScope] = useState<SessionScope>({});
  const [shown, setShown] = useState<Shown>({ oneShot: false, subAgents: false });
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [parent, setParent] = useState<Session | null>(null);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [matched, setMatched] = useState(0);
  const [listError, setListError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<ReaderView>("transcript");
  const [stretches, setStretches] = useState<Stretch[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [context, setContext] = useState<SessionContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);

  const parentId = parent?.id ?? null;
  const sessionId = session?.id ?? null;

  // The latest list asked for is the only one whose answer is kept: a slow answer to an earlier
  // filter must not land over the rows of the one chosen after it.
  const listAsk = useRef(0);
  const loadList = useCallback(async (): Promise<void> => {
    const ask = ++listAsk.current;
    try {
      const page = await rpc.call("sessions.list", { filter: listFilter(scope, shown, query, parentId), limit: LIST_PAGE, offset: 0 });
      if (ask !== listAsk.current) return;
      setSessions(page.sessions);
      setMatched(page.matched);
      setListError(null);
      // The one being read is the same session as its row, which may since have been measured.
      setSession((open) => page.sessions.find((listed) => listed.id === open?.id) ?? open);
    } catch (e) {
      if (ask === listAsk.current) setListError(said(e));
    }
  }, [rpc, scope, shown, query, parentId]);
  // For whoever reads the list again without choosing a new filter: they ask for the one now chosen.
  const listNow = useRef(loadList);
  useEffect(() => { listNow.current = loadList; }, [loadList]);

  useEffect(() => {
    setSessions(null);
    void loadList();
  }, [loadList]);

  // The starred list is read again when a session is starred or unstarred: the server keeps what it lists.
  const starred = useFavorites().all.filter((f) => f.kind === "session").map((f) => f.key).join("\n");
  const starredListed = scope.favorites === true;
  const starredBefore = useRef(starred);
  useEffect(() => {
    if (starredBefore.current === starred) return;
    starredBefore.current = starred;
    if (starredListed) void listNow.current();
  }, [starred, starredListed]);

  // A failure here is said by the list, which asks the same server at the same moment.
  const loadFacets = useCallback((): Promise<void> => rpc.call("sessions.facets", {}).then(setFacets, () => {}), [rpc]);

  // With no answer nothing is said about the index, and it is not asked again until the section is next entered.
  const askStatus = useCallback(async (): Promise<void> => {
    try { setStatus(await rpc.call("sessions.status", {})); } catch { setStatus(null); }
    setStatusAsked(true);
  }, [rpc]);

  useEffect(() => { void loadFacets(); void askStatus(); }, [loadFacets, askStatus]);

  // Asked again only while the index is working. What it listed is in the index once listing ends,
  // and what it measured once it is idle, so those are the two moments the list is read again.
  const was = useRef<SessionIndexStatus["state"] | null>(null);
  useEffect(() => {
    if (status === null) return;
    const before = was.current;
    was.current = status.state;
    if ((before === "listing" && status.state !== "listing") || (before === "measuring" && status.state === "idle")) {
      void listNow.current();
      void loadFacets();
    }
    if (status.state === "idle") return;
    const timer = setTimeout(() => void askStatus(), STATUS_EVERY_MS);
    return () => clearTimeout(timer);
  }, [status, askStatus, loadFacets]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed.trim()), SEARCH_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [typed]);

  // A ref beside the state: two scrolls in one frame both come before the render that would tell the second a stretch is on its way.
  const stretchAsked = useRef(false);
  const read = useCallback(async (id: string, cursor: string | undefined, live: () => boolean): Promise<void> => {
    stretchAsked.current = true;
    setReading(true);
    try {
      const stretch = await rpc.call("sessions.read", { id, cursor, limit: STRETCH });
      if (!live()) return;
      setStretches((kept) => [...(kept ?? []), { key: cursor ?? FIRST_STRETCH, blocks: stretch.blocks }]);
      setNext(stretch.next);
      setReadError(null);
    } catch (e) {
      if (live()) setReadError(said(e));
    } finally {
      if (live()) { stretchAsked.current = false; setReading(false); }
    }
  }, [rpc]);

  // Which session the reader is on, so an answer for the one before it is dropped.
  const readingOf = useRef<string | null>(null);
  useEffect(() => {
    readingOf.current = sessionId;
    setStretches(null);
    setNext(null);
    setReadError(null);
    setContext(null);
    setContextError(null);
    if (sessionId !== null) void read(sessionId, undefined, () => readingOf.current === sessionId);
  }, [sessionId, read]);

  // Asked each time the Context tab is shown: whether a file has changed since is a fact about now.
  useEffect(() => {
    if (sessionId === null || view !== "context") return;
    let live = true;
    rpc.call("sessions.context", { id: sessionId }).then(
      (answered) => { if (live) setContext(answered); },
      (e: unknown) => { if (live) setContextError(said(e)); },
    );
    return () => { live = false; };
  }, [rpc, sessionId, view]);

  return {
    facets, status, statusAsked, scope, shown, typed, query, parent, sessions, matched, listError, loadingMore,
    session, view, stretches, next, reading, readError, context, contextError,

    setScope(to: SessionScope): void { setParent(null); setScope(to); },
    setShown,
    setTyped,
    setView,
    open: setSession,
    listSubAgents: setParent,
    leaveSubAgents(): void { setParent(null); },

    /** Read again what the index can have changed since this section was last on screen. */
    refresh: useCallback(async (): Promise<void> => { await Promise.all([listNow.current(), loadFacets(), askStatus()]); }, [loadFacets, askStatus]),

    async loadMore(): Promise<void> {
      if (sessions === null || loadingMore) return;
      const ask = listAsk.current;
      setLoadingMore(true);
      try {
        const page = await rpc.call("sessions.list", { filter: listFilter(scope, shown, query, parentId), limit: LIST_PAGE, offset: sessions.length });
        if (ask !== listAsk.current) return;
        setSessions([...sessions, ...page.sessions]);
        setMatched(page.matched);
      } catch (e) {
        if (ask === listAsk.current) setListError(said(e));
      } finally {
        setLoadingMore(false);
      }
    },

    readMore(): void {
      if (sessionId === null || next === null || stretchAsked.current) return;
      void read(sessionId, next, () => readingOf.current === sessionId);
    },

    reveal(path: string): void { void window.amc?.reveal(path); },
  };
}

export type Sessions = ReturnType<typeof useSessions>;
