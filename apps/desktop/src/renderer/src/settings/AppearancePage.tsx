import { useRef, type CSSProperties } from "react";
import { Icon } from "@amc/ui";
import { useDissolve } from "../components/ScrollFades";
import { ACCENTS, accentColour, accentLabel, isCustomAccent, type AppearanceChoice } from "../theme/accent";
import type { AppearanceControls } from "../theme/useTheme";

const FACES: readonly { id: AppearanceChoice["appearance"]; label: string }[] = [
  { id: "system", label: "Match the Mac" }, { id: "light", label: "Light" }, { id: "dark", label: "Dark" },
];

/**
 * Appearance: light or dark, and the accent. Both follow the Mac until the person chooses otherwise,
 * and a choice is in force as it is made.
 */
export function AppearancePage({ appearance }: { appearance: AppearanceControls }) {
  const { choice, systemAccent, choose } = appearance;
  const scroller = useRef<HTMLDivElement>(null);
  useDissolve(scroller);
  const swatch = (accent: string, label: string, colour: string) => (
    <label key={accent} className="look-swatch" title={label} data-selected={choice.accent === accent || undefined} style={{ "--swatch": colour } as CSSProperties}>
      <input type="radio" name="accent" aria-label={label} checked={choice.accent === accent} onChange={() => choose({ ...choice, accent })} />
    </label>
  );

  return (
    <section className="col models" aria-label="Appearance">
      <div className="col-head" />
      <div className="models-scroll" ref={scroller}>
        <div className="models-page">
          <h1 className="lib-reader-title">Appearance</h1>
          <p className="models-lede">The window follows this Mac's appearance and accent colour until you choose your own here.</p>
          <div className="look-card">
            <div className="look-row">
              <span className="look-name" id="look-face">Appearance</span>
              <div className="seg" role="radiogroup" aria-labelledby="look-face">
                {FACES.map((face) => (
                  <label key={face.id} className="seg-opt" data-selected={choice.appearance === face.id || undefined}>
                    <input type="radio" name="appearance" checked={choice.appearance === face.id} onChange={() => choose({ ...choice, appearance: face.id })} />
                    {face.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="look-row">
              <span className="look-name" id="look-accent">Accent colour</span>
              <div className="look-accent">
                <div className="look-swatches" role="radiogroup" aria-labelledby="look-accent">
                  <label className="look-swatch look-glyph" title="Match the Mac" data-selected={choice.accent === "system" || undefined}>
                    <Icon name="apple" size={12} />
                    <input type="radio" name="accent" aria-label="Match the Mac" checked={choice.accent === "system"} onChange={() => choose({ ...choice, accent: "system" })} />
                  </label>
                  {ACCENTS.map((a) => swatch(a.id, a.label, a.colour))}
                  <label className="look-swatch look-glyph look-well" title="A colour of your own" data-selected={isCustomAccent(choice.accent) || undefined}>
                    <Icon name="add" size={12} />
                    <input type="color" aria-label="A colour of your own" value={accentColour(choice.accent, systemAccent)}
                      onChange={(e) => choose({ ...choice, accent: e.target.value })} />
                  </label>
                </div>
                <span className="look-chosen" role="status">{accentLabel(choice.accent)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
