// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render } from "@testing-library/react";

// Stub the settings panels so SettingsPage's routing behavior can be tested
// in isolation without wiring up every panel's API surface.
vi.mock("../../src/settings/BrandingPanel.js", () => ({
  BrandingPanel: () => <div data-testid="branding-panel" />,
}));
vi.mock("../../src/settings/InstanceUrlPanel.js", () => ({
  InstanceUrlPanel: () => <div data-testid="instance-url-panel" />,
}));
vi.mock("../../src/settings/MailTransportPanel.js", () => ({
  MailTransportPanel: () => <div data-testid="mail-panel" />,
}));
vi.mock("../../src/settings/SessionsPanel.js", () => ({
  SessionsPanel: () => <div data-testid="sessions-panel" />,
}));
vi.mock("../../src/settings/EventArchivingPanel.js", () => ({
  EventArchivingPanel: () => <div data-testid="archiving-panel" />,
}));
vi.mock("../../src/settings/SecurityPanel.js", () => ({
  SecurityPanel: () => <div data-testid="security-panel" />,
}));
vi.mock("../../src/settings/AuditLogPanel.js", () => ({
  AuditLogPanel: () => <div data-testid="audit-panel" />,
}));

import { SettingsPage } from "../../src/pages/SettingsPage.js";

afterEach(() => {
  cleanup();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/settings" element={<SettingsPage />} />
        <Route
          path="/admin/settings/identity/providers"
          element={<div>identity-providers-route</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SettingsPage Identity tab", () => {
  it("hands off to the canonical Identity route when the tab is clicked", async () => {
    renderAt("/admin/settings");
    // The Identity tab button is rendered by the Tabs component.
    const identityTab = screen.getByRole("tab", { name: "Identity" });
    fireEvent.click(identityTab);
    await waitFor(() => {
      expect(screen.getByText("identity-providers-route")).toBeTruthy();
    });
  });

  it("redirects legacy ?tab=identity to the canonical Identity route", async () => {
    renderAt("/admin/settings?tab=identity");
    await waitFor(() => {
      expect(screen.getByText("identity-providers-route")).toBeTruthy();
    });
  });

  it("renders the Security panel when the Security tab is clicked", async () => {
    renderAt("/admin/settings");
    fireEvent.click(screen.getByRole("tab", { name: "Security" }));
    await waitFor(() => {
      expect(screen.getByTestId("security-panel")).toBeTruthy();
    });
  });

  it("renders the General panel by default and switches to Mail", async () => {
    renderAt("/admin/settings");
    expect(screen.getByTestId("branding-panel")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Mail" }));
    await waitFor(() => {
      expect(screen.getByTestId("mail-panel")).toBeTruthy();
    });
  });
});
