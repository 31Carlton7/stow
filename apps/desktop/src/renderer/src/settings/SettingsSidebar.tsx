import { Icon, type IconName } from "@amc/ui";
import type { ModelsPane } from "../models/ModelsPage";

export type SettingsPane = "appearance" | ModelsPane | "about";

const PANES: readonly { id: SettingsPane; label: string; icon: IconName }[] = [
  { id: "appearance", label: "Appearance", icon: "paintBrush" },
  { id: "models", label: "Models", icon: "cpu" },
  { id: "sent", label: "What is sent", icon: "send" },
  { id: "activity", label: "Activity", icon: "clock" },
  { id: "about", label: "About", icon: "info" },
];

/** The pages of Settings, as System Settings lists its own. */
export function SettingsSidebar({ pane, show }: { pane: SettingsPane; show: (pane: SettingsPane) => void }) {
  return (
    <nav className="sb-list lib-nav" aria-label="Settings">
      <ul className="lib-nav-list">
        {PANES.map(({ id, label, icon }) => (
          <li key={id}>
            <button type="button" className="lib-nav-row" data-selected={pane === id || undefined} aria-current={pane === id || undefined} onClick={() => show(id)}>
              <Icon name={icon} size={16} className="lib-nav-mark" />
              <span className="lib-nav-name">{label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
