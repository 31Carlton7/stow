import type { AppearanceChoice } from "../../../preload";

export type { AppearanceChoice };

/** The Mac's eight accent colours, in the order System Settings shows them. */
export const ACCENTS = [
  { id: "blue", label: "Blue", colour: "#007aff" },
  { id: "purple", label: "Purple", colour: "#af52de" },
  { id: "pink", label: "Pink", colour: "#ff2d55" },
  { id: "red", label: "Red", colour: "#ff3b30" },
  { id: "orange", label: "Orange", colour: "#ff9500" },
  { id: "yellow", label: "Yellow", colour: "#ffcc00" },
  { id: "green", label: "Green", colour: "#34c759" },
  { id: "graphite", label: "Graphite", colour: "#8e8e93" },
] as const;

export const MATCH_THE_MAC: AppearanceChoice = { appearance: "system", accent: "system" };

export const isCustomAccent = (accent: string): boolean => /^#[0-9a-f]{6}$/i.test(accent);

/** The one colour the stylesheet makes the accent's shades from: the Mac's own, one of the eight, or
 *  the person's. A choice that is none of them (a kept file from another build) is the Mac's. */
export function accentColour(accent: string, systemAccent: string): string {
  if (isCustomAccent(accent)) return accent.toLowerCase();
  const named = ACCENTS.find((a) => a.id === accent);
  if (named) return named.colour;
  return isCustomAccent(systemAccent) ? systemAccent.toLowerCase() : ACCENTS[0].colour;
}

/** What the chosen accent is called, under the swatches. */
export function accentLabel(accent: string): string {
  if (isCustomAccent(accent)) return `Your own, ${accent.toLowerCase()}`;
  return ACCENTS.find((a) => a.id === accent)?.label ?? "Matches the Mac";
}
