import { useEffect, useRef, useState } from "react";
import { APP_NAME } from "@amc/contracts";
import logo from "../../../../build/logo.png";
import type { IntroState } from "./use-intro";

/** "hello" as one stroke of a pen, drawn for this app: the path is written along its length. */
const HELLO = "M 22.1 168 C 52.5 166 97.6 114 108.8 62 C 114 38 109.3 25 100 27 C 90.4 30 81.9 56 75.5 92 L 60 180 C 66.7 142 91 106 113 106 C 131 106 131.9 124 128 146 C 124.1 168 129.8 181 146 180 C 172.4 178 209.3 150 213.5 126 C 216.3 110 207.6 103 195.2 105 C 176.7 108 163.2 128 161.6 148 C 159.8 170 173.6 182 194 180 C 228.7 176 280.7 108 291.5 58 C 296.4 36 291.3 25 283 27 C 274.3 31 265.5 58 258.8 96 L 250.7 142 C 246.1 168 253.6 182 272 180 C 306.7 176 358.7 108 369.5 58 C 374.4 36 369.3 25 361 27 C 352.3 31 343.5 58 336.8 96 L 328.7 142 C 324.1 168 331.6 182 350 180 C 364.4 178 375.2 162 378.3 144 C 382.2 122 401 106 419 106 C 439 106 448.2 122 444.7 142 C 440.8 164 424 180 404 180 C 386 180 374.5 166 378.3 144 C 382.2 122 401 106 419 106 C 433 106 440.4 121 460.4 121 C 474.4 121 489.8 113 501.4 104";

const FACTS = [
  `${APP_NAME} reads your agents' files where they are, and changes nothing until you say so.`,
  "Nothing is sent anywhere unless you switch a model on.",
  `Removing ${APP_NAME} loses nothing.`,
];

/**
 * The welcome a first launch opens on: the word writes itself, what the app is arrives under it, and
 * the button, Return or Escape lift it away. A press anywhere before that ends the writing.
 */
export function Intro({ intro }: { intro: IntroState }) {
  const { phase, open, lifted } = intro;
  const [written, setWritten] = useState(false);
  const welcome = useRef<HTMLDivElement>(null);
  useEffect(() => { welcome.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== "Escape") return;
      e.preventDefault();
      open();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="intro" ref={welcome} role="dialog" aria-modal="true" aria-label={`Welcome to ${APP_NAME}`} tabIndex={-1}
      data-written={written || undefined} data-leaving={phase === "leaving" || undefined}
      onPointerDown={() => setWritten(true)}
      onAnimationEnd={(e) => { if (e.target === e.currentTarget && phase === "leaving") lifted(); }}>
      <div className="intro-drag" />
      <svg className="intro-word" viewBox="12 14 500 178" role="img" aria-label="hello">
        <path d={HELLO} pathLength={1} />
      </svg>
      <div className="intro-about">
        <img className="intro-icon" src={logo} alt="" draggable={false} />
        <p className="intro-line">Everything your agents know, in one place.</p>
        <ul className="intro-facts">
          {FACTS.map((fact) => <li key={fact}>{fact}</li>)}
        </ul>
        <button type="button" className="btn primary intro-open" onClick={open}>Open {APP_NAME}</button>
      </div>
    </div>
  );
}
