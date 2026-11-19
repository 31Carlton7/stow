import hermesOnDark from "./marks/hermes-dark.svg";
import hermesOnLight from "./marks/hermes.svg";
import openclaw from "./marks/openclaw.svg";
import type { BrandName } from "./brand-icons";

/**
 * The marks that are pictures and not one-ink glyphs, each the vendor's own file as it ships with
 * the tool (VENDORED.md says from where): Hermes Agent's icon, which has a drawing for a light
 * ground and one for a dark, and OpenClaw's, which is one drawing in its own colours.
 */
export const brandPictures: Partial<Record<BrandName, { onLight: string; onDark?: string }>> = {
  hermes: { onLight: hermesOnLight, onDark: hermesOnDark },
  openclaw: { onLight: openclaw },
};
