import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AboutPage } from "./AboutPage";
import { SettingsSidebar, type SettingsPane } from "./SettingsSidebar";

function Sidebar({ startAt }: { startAt: SettingsPane }) {
  const [pane, show] = useState(startAt);
  return <><SettingsSidebar pane={pane} show={show} /><output>{pane}</output></>;
}
const rows = () => within(screen.getByRole("navigation", { name: "Settings" })).getAllByRole("button");
const current = () => rows().filter((row) => row.getAttribute("aria-current") === "true").map((row) => row.textContent);

describe("the Settings sidebar", () => {
  it("lists appearance, everything the Models page held, and About", () => {
    render(<Sidebar startAt="appearance" />);
    expect(rows().map((row) => row.textContent)).toEqual(["Appearance", "Models", "What is sent", "Activity", "About"]);
    expect(current()).toEqual(["Appearance"]);
  });

  it("marks the page Settings was opened at", () => {
    render(<Sidebar startAt="models" />);
    expect(current()).toEqual(["Models"]);
  });

  it("shows the page whose row is pressed", () => {
    render(<Sidebar startAt="appearance" />);
    fireEvent.click(screen.getByRole("button", { name: "What is sent" }));
    expect(screen.getByRole("status")).toHaveTextContent("sent");
    expect(current()).toEqual(["What is sent"]);
  });
});

describe("About", () => {
  it("says which build is showing and whose files it reads", async () => {
    const rpc = { call: async () => ({ version: "0.1.0", home: "/data", sourceHome: "/Users/sam", schemaVersion: 6 }) } as unknown as Parameters<typeof AboutPage>[0]["rpc"];
    render(<AboutPage rpc={rpc} onShowWelcome={() => {}} />);
    const page = within(screen.getByRole("region", { name: "About" }));
    expect((await page.findByText("Version")).nextElementSibling).toHaveTextContent("0.1.0");
    expect(page.getByText("Reading").nextElementSibling).toHaveTextContent("/Users/sam");
  });
});
