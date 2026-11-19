import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
// The token foundation first (Tailwind layers and tokens); styles.css is unlayered and so wins conflicts.
import "./theme/tokens.css";
import "./styles.css";
import "./sections.css";
import "./theme/mac.css";
import { applyKeptAccent } from "./theme/useTheme";

applyKeptAccent();

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
