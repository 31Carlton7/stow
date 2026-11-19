import { useEffect, useState } from "react";
import { LibraryGroupSchema, type GraphOpen } from "@amc/contracts";
import { Icon, type IconName } from "@amc/ui";
import { Toasts } from "./components/Toasts";
import { FavoritesPage } from "./favorites/FavoritesPage";
import { FavoritesSidebar, type FavoritesShown } from "./favorites/FavoritesSidebar";
import { useFavoriteItems, type FavoriteItem } from "./favorites/use-favorite-items";
import { FavoritesProvider } from "./favorites/use-favorites";
import { GraphPanel } from "./graph/GraphPanel";
import { GraphSidebar } from "./graph/GraphSidebar";
import { useGraph } from "./graph/use-graph";
import { HealthPage } from "./health/HealthPage";
import { useHealth } from "./health/use-health";
import { Intro } from "./intro/Intro";
import { useIntro, type IntroState } from "./intro/use-intro";
import { LibraryGrid } from "./library/LibraryGrid";
import { LibraryList } from "./library/LibraryList";
import { LibraryReader } from "./library/LibraryReader";
import { LibrarySheets } from "./library/LibrarySheets";
import { LibrarySidebar } from "./library/LibrarySidebar";
import { useLibrary } from "./library/use-library";
import { ModelsPage } from "./models/ModelsPage";
import { useModels } from "./models/use-models";
import { ReviewDetail } from "./review/ReviewDetail";
import { ReviewList } from "./review/ReviewList";
import { ReviewSidebar } from "./review/ReviewSidebar";
import { useReview } from "./review/use-review";
import { server } from "./rpc/client";
import { SessionReader } from "./sessions/SessionReader";
import { SessionsList } from "./sessions/SessionsList";
import { SessionsSidebar } from "./sessions/SessionsSidebar";
import { useSessions } from "./sessions/use-sessions";
import { SetupDetail } from "./setup/SetupDetail";
import { SetupList } from "./setup/SetupList";
import { SetupSheets } from "./setup/SetupSheets";
import { HooksSidebar, McpSidebar, SkillsSidebar } from "./setup/SetupSidebar";
import type { SetupTab } from "./setup/setup-model";
import { AboutPage } from "./settings/AboutPage";
import { AppearancePage } from "./settings/AppearancePage";
import { SettingsSidebar, type SettingsPane } from "./settings/SettingsSidebar";
import { useSetup } from "./setup/use-setup";
import { useScrollbarStyle } from "./theme/scrollbars";
import { useAppearance, useApplyTheme } from "./theme/useTheme";

type Section = "library" | SetupTab | "sessions" | "favorites" | "graph" | "review" | "settings";

/** The three sections that show what agents are set up with besides memory. One state serves them:
 *  each is the same two columns over a different list. */
const SETUP_SECTIONS: readonly Section[] = ["skills", "mcp", "hooks"];
const isSetup = (section: Section): section is SetupTab => SETUP_SECTIONS.includes(section);

/** The window, with what is starred held above every section of it. */
export function App() {
  const intro = useIntro();
  return (
    <FavoritesProvider rpc={server}>
      <Sections intro={intro} />
      {intro.phase !== "gone" && <Intro intro={intro} />}
    </FavoritesProvider>
  );
}

/**
 * Three columns, as Mail lays out mailboxes, messages and the one being read. The sidebar's top
 * rows choose which section the columns are of.
 */
function Sections({ intro }: { intro: IntroState }) {
  useApplyTheme();
  const appearance = useAppearance();
  useScrollbarStyle();
  const [section, setSection] = useState<Section>("library");
  const library = useLibrary(server);
  const setup = useSetup(server);
  const sessions = useSessions(server);
  const graph = useGraph(server);
  const review = useReview(server);
  const models = useModels(server);
  const waiting = review.findings?.length ?? 0;
  const [healthShown, setHealthShown] = useState(false);
  const starred = useFavoriteItems(server, setup, section === "favorites");
  const [starredShown, setStarredShown] = useState<FavoritesShown>("all");
  const [settingsPane, setSettingsPane] = useState<SettingsPane>("appearance");
  const openModels = () => { setSettingsPane("models"); setSection("settings"); };

  // Each section reads again what another can have changed under it: Settings switches on the model
  // the inbox offers, and a reading started in the inbox adds to the calls Settings lists. Sessions
  // reads again what agents have written while the window was on something else.
  const { refresh: refreshReview } = review;
  const { load: loadModels } = models;
  const { refresh: refreshSessions } = sessions;
  const { setTab } = setup;
  const { refresh: refreshGraph } = graph;
  useEffect(() => {
    if (section === "review") void refreshReview();
    if (section === "settings") void loadModels();
    if (section === "sessions") void refreshSessions();
    if (section === "graph") void refreshGraph();
    if (isSetup(section)) setTab(section);
  }, [section, refreshReview, loadModels, refreshSessions, refreshGraph, setTab]);

  const destination = (to: Section, label: string, icon: IconName, count = 0) => (
    <li>
      <button type="button" className="lib-nav-row" data-selected={section === to || undefined} aria-current={section === to || undefined}
        onClick={() => { if (to !== section) library.leaving(() => setSection(to)); }}>
        <Icon name={icon} size={16} className="lib-nav-mark" />
        <span className="lib-nav-name">{label}</span>
        {count > 0 && <span className="dest-count" aria-label={`${count} waiting`}>{count}</span>}
      </button>
    </li>
  );
  const openFile = (id: string) => library.leaving(() => { library.show(id); setSection("library"); });
  /** Where a node of the graph is opened: the thing itself in its own section, or that section narrowed to it. */
  const openNode = (to: GraphOpen): void => {
    if (to.what === "file") { openFile(to.id); return; }
    if (to.section === "library") library.setScope(to.what === "agent" ? { group: LibraryGroupSchema.parse(to.id) } : { projectId: to.id });
    if (to.what === "skill") { setup.setTab("skills"); setup.pickSkill(to.id); }
    if (to.what === "server") { setup.setTab("mcp"); setup.pickServer(to.id); }
    if (to.what === "session") void server.call("sessions.get", { id: to.id }).then(sessions.open, () => {});
    if (to.section === "sessions" && to.what === "project") sessions.setScope({ projectId: to.id });
    setSection(to.section);
  };
  /** Where a favourite is opened: the thing itself, in the section it lives in. */
  const openFavorite = (item: FavoriteItem): void => {
    if (item.kind === "file") { openFile(item.key); return; }
    if (item.kind === "skill") { setup.setSkillScope({ kind: "all" }); setup.pickSkill(item.key); setSection("skills"); }
    if (item.kind === "mcp") { setup.setAgent(null); setup.pickServer(item.key); setSection("mcp"); }
    if (item.kind === "hook") { setup.showStarred("hooks", false); setup.pickHook(item.at); setSection("hooks"); }
    if (item.kind === "session") { sessions.open(item.session); setSection("sessions"); }
  };

  return (
    <div className="app" inert={intro.phase === "shown"}>
      <aside className="sidebar" aria-label="Sections">
        <div className="sb-head" />
        <ul className="dest" aria-label="Sections">
          {destination("library", "Library", "context")}
          {destination("skills", "Skills", "book")}
          {destination("mcp", "MCP servers", "plug")}
          {destination("hooks", "Hooks", "zap")}
          {destination("sessions", "Sessions", "session")}
          {destination("favorites", "Favorites", "star")}
          {destination("graph", "Graph", "link")}
          {destination("review", "Review", "review", waiting)}
          {destination("settings", "Settings", "settings")}
        </ul>
        <div className="dest-rule" />
        {section === "library" && <LibrarySidebar library={library} />}
        {section === "sessions" && <SessionsSidebar sessions={sessions} />}
        {section === "favorites" && <FavoritesSidebar items={starred} shown={starredShown} show={setStarredShown} />}
        {section === "graph" && <GraphSidebar graph={graph} />}
        {section === "review" && <ReviewSidebar review={review} health={{ shown: healthShown, show: setHealthShown }} />}
        {section === "skills" && <SkillsSidebar setup={setup} />}
        {section === "mcp" && <McpSidebar setup={setup} />}
        {section === "hooks" && <HooksSidebar setup={setup} />}
        {section === "settings" && <SettingsSidebar pane={settingsPane} show={setSettingsPane} />}
      </aside>
      <main className="main">
        {section === "library" && (library.layout === "grid" ? <LibraryGrid library={library} /> : <><LibraryList library={library} /><LibraryReader library={library} /></>)}
        {isSetup(section) && setup.tab === section && <><SetupList setup={setup} /><SetupDetail setup={setup} /></>}
        {section === "sessions" && <><SessionsList sessions={sessions} /><SessionReader sessions={sessions} onOpenFile={openFile} /></>}
        {section === "favorites" && <FavoritesPage items={starred} shown={starredShown} onOpen={openFavorite} />}
        {section === "graph" && <GraphPanel graph={graph} onOpen={openNode} />}
        {section === "review" && healthShown && (
          <HealthShown onOpenFile={openFile} onOpenFinding={(fingerprint) => { review.setFilter({ kind: "all" }); review.pick(fingerprint); setHealthShown(false); }}
            onReviewReady={() => { review.setFilter({ kind: "ready" }); setHealthShown(false); }} />
        )}
        {section === "review" && !healthShown && (
          <>
            <ReviewList review={review} onOpenModels={openModels} />
            <ReviewDetail review={review} onOpenFile={openFile} onOpenModels={openModels} />
          </>
        )}
        {section === "settings" && settingsPane === "appearance" && <AppearancePage appearance={appearance} />}
        {section === "settings" && settingsPane === "about" && <AboutPage rpc={server} onShowWelcome={intro.showAgain} />}
        {section === "settings" && settingsPane !== "appearance" && settingsPane !== "about" && <ModelsPage models={models} pane={settingsPane} />}
      </main>
      <LibrarySheets library={library} />
      <SetupSheets setup={setup} rpc={server} onOpenModels={openModels} />
      <Toasts />
    </div>
  );
}

/** The Health page with its numbers, read each time it is opened: a scan reads every file, so it is not kept running behind other sections. */
function HealthShown(props: Omit<Parameters<typeof HealthPage>[0], "health">) {
  return <HealthPage health={useHealth(server)} {...props} />;
}
