import { contextBridge, ipcRenderer } from "electron";

/** What the window hands to another app: a file or folder by its absolute path, or text. */
export type HandedOut = { path: string } | { text: string };

const endpoint = ipcRenderer.sendSync("server:endpoint") as { port: number; token: string } | null;

/** The look the person chose. `accent` is "system", one of the Mac's eight by name, or a `#rrggbb` of their own. */
export type AppearanceChoice = { appearance: "system" | "light" | "dark"; accent: string };
const appearance = ipcRenderer.sendSync("appearance") as { choice: AppearanceChoice; systemAccent: string };

const bridge = {
  /** Where the server listens, and the token offered as the `amc.<token>` subprotocol on every dial. */
  port: endpoint?.port ?? NaN,
  token: endpoint?.token ?? "",
  /** Show a file in the Finder, by its absolute path. */
  reveal: (path: string): Promise<void> => ipcRenderer.invoke("reveal", path),
  /** Start dragging a copy of a file or a skill's folder out of the window, by its absolute path. Call it from `dragstart`. */
  dragOut: (path: string): void => ipcRenderer.send("drag-out", path),
  /** Open the Mac's share sheet at a point of the window, on a file or folder or on text. */
  share: (shared: HandedOut, at: { x: number; y: number }): Promise<void> => ipcRenderer.invoke("share", shared, at),
  /** The look chosen and the Mac's accent colour, as they were when the window was made: there for the first paint. */
  appearance,
  /** Keep a new choice, and turn the window's material to its light or dark. */
  chooseAppearance: (choice: AppearanceChoice): Promise<void> => ipcRenderer.invoke("appearance:choose", choice),
  /** Hear the Mac's accent colour when the person changes it. Returns the way to stop hearing. */
  onSystemAccent: (heard: (colour: string) => void): (() => void) => {
    const listener = (_e: unknown, colour: string) => heard(colour);
    ipcRenderer.on("appearance:system-accent", listener);
    return () => { ipcRenderer.removeListener("appearance:system-accent", listener); };
  },
};
export type Bridge = typeof bridge;

contextBridge.exposeInMainWorld("amc", bridge);

const intro = {
  /** Whether the welcome has yet to be opened on this Mac, as it was when the window was made. */
  firstLaunch: ipcRenderer.sendSync("intro") as boolean,
  /** Keep that the welcome was opened, so it does not show at the next launch. */
  seen: (): Promise<void> => ipcRenderer.invoke("intro:seen"),
};
export type IntroBridge = typeof intro;

contextBridge.exposeInMainWorld("amcIntro", intro);
