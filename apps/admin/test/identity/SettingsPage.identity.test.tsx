// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useNavigate, useLocation } from "react-router";
import { render } from "@testing-library/react";

vi.mock("../../src/settings/BrandingSettingsPanel.js", () => ({
  BrandingSettingsPanel: () => <div data-testid="branding-settings-panel" />,
}));
vi.mock("../../src/settings/GeneralSettingsPanel.js", () => ({
  GeneralSettingsPanel: () => <div data-testid="general-settings-panel" />,
}));
vi.mock("../../src/settings/MailTransportPanel.js", () => ({
  MailTransportPanel: () => <div data-testid="mail-panel" />,
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

import { SettingsLayout } from "../../src/layouts/SettingsLayout.js";
import { SettingsTabContent } from "../../src/pages/SettingsPage.js";

// ScrollFadeTabs (wrapping this layout's own tab strip) scrolls its active tab into view on
// mount/change - jsdom does not implement scrollIntoView.
Element.prototype.scrollIntoView = vi.fn();

afterEach(() => {
  cleanup();
});

function settingsRoutes(identityOutlet: ReactNode = <div>identity-providers-route</div>) {
  return (
    <Route path="/admin/settings" element={<SettingsLayout />}>
      <Route index element={<SettingsTabContent />} />
      <Route path="identity/providers" element={identityOutlet} />
    </Route>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>{settingsRoutes()}</Routes>
    </MemoryRouter>,
  );
}

describe("SettingsLayout Identity tab", () => {
  it("hands off to the canonical Identity route when the tab is clicked", async () => {
    renderAt("/admin/settings");
    fireEvent.click(screen.getByRole("tab", { name: "Identity" }));
    await waitFor(() => {
      expect(screen.getByText("identity-providers-route")).toBeTruthy();
    });
    expect(screen.getByRole("tab", { name: "Identity" }).getAttribute("aria-selected")).toBe("true");
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

  it("renders the Branding panel when the Branding tab is clicked", async () => {
    renderAt("/admin/settings");
    fireEvent.click(screen.getByRole("tab", { name: "Branding" }));
    await waitFor(() => {
      expect(screen.getByTestId("branding-settings-panel")).toBeTruthy();
    });
  });

  it("renders the General panel by default and switches to Mail", async () => {
    renderAt("/admin/settings");
    expect(screen.getByTestId("general-settings-panel")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Mail" }));
    await waitFor(() => {
      expect(screen.getByTestId("mail-panel")).toBeTruthy();
    });
  });

  it("uses replace (not push) for the legacy ?tab=identity redirect so Back does not loop", async () => {
    function BackProbe() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate(-1)}>
          back-probe
        </button>
      );
    }

    render(
      <MemoryRouter initialEntries={["/admin/somewhere-before", "/admin/settings?tab=identity"]}>
        <Routes>
          <Route path="/admin/somewhere-before" element={<div>before-page</div>} />
          {settingsRoutes(
            <>
              <div>identity-providers-route</div>
              <BackProbe />
            </>,
          )}
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("identity-providers-route")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "back-probe" }));
    await waitFor(() => {
      expect(screen.getByText("before-page")).toBeTruthy();
    });
  });

  it("reflects the active in-page tab in the URL via replace when clicked", async () => {
    function LocationProbe() {
      const loc = useLocation();
      return <div data-testid="location-probe">{loc.search}</div>;
    }
    render(
      <MemoryRouter initialEntries={["/admin/settings"]}>
        <Routes>
          <Route path="/admin/settings" element={<SettingsLayout />}>
            <Route
              index
              element={
                <>
                  <SettingsTabContent />
                  <LocationProbe />
                </>
              }
            />
            <Route path="identity/providers" element={<div>identity-providers-route</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("location-probe").textContent).toBe("");
    fireEvent.click(screen.getByRole("tab", { name: "Security" }));
    await waitFor(() => {
      expect(screen.getByTestId("location-probe").textContent).toContain("tab=security");
    });
    fireEvent.click(screen.getByRole("tab", { name: "Archiving" }));
    await waitFor(() => {
      expect(screen.getByTestId("location-probe").textContent).toContain("tab=archiving");
    });
  });

  it("restores the active tab from ?tab= on initial load", async () => {
    renderAt("/admin/settings?tab=security");
    await waitFor(() => {
      expect(screen.getByTestId("security-panel")).toBeTruthy();
    });
    expect(screen.getByTestId("security-panel").getAttribute("hidden")).toBeNull();
  });

  it("does not mount the General or Branding panels on a non-General deep link", async () => {
    renderAt("/admin/settings?tab=security");
    await waitFor(() => {
      expect(screen.getByTestId("security-panel")).toBeTruthy();
    });
    expect(screen.queryByTestId("branding-settings-panel")).toBeNull();
    expect(screen.queryByTestId("general-settings-panel")).toBeNull();
  });

  it("ignores an unknown ?tab= value and falls back to General", async () => {
    renderAt("/admin/settings?tab=nonsense");
    expect(screen.getByTestId("general-settings-panel")).toBeTruthy();
  });

  it("restores the active tab after navigating to Identity and Back", async () => {
    function BackProbe() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate(-1)}>
          back-probe
        </button>
      );
    }
    render(
      <MemoryRouter
        initialEntries={["/admin/settings?tab=security", "/admin/settings/identity/providers"]}
        initialIndex={0}
      >
        <Routes>
          {settingsRoutes(
            <>
              <div>identity-providers-route</div>
              <BackProbe />
            </>,
          )}
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("security-panel")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("tab", { name: "Identity" }));
    await waitFor(() => {
      expect(screen.getByText("identity-providers-route")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "back-probe" }));
    await waitFor(() => {
      expect(screen.getByTestId("security-panel")).toBeTruthy();
    });
    expect(screen.getByTestId("security-panel").getAttribute("hidden")).toBeNull();
  });

  it("realigns to General when the URL param is cleared while mounted", async () => {
    function SettingsLink() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate("/admin/settings")}>
          settings-link
        </button>
      );
    }
    render(
      <MemoryRouter initialEntries={["/admin/settings?tab=mail"]}>
        <Routes>
          <Route
            path="/admin/settings"
            element={
              <>
                <SettingsLayout />
                <SettingsLink />
              </>
            }
          >
            <Route index element={<SettingsTabContent />} />
            <Route path="identity/providers" element={<div>identity-providers-route</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("tab", { name: "Mail" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "settings-link" }));
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "General" }).getAttribute("aria-selected")).toBe("true");
    });
    expect(screen.getByRole("tab", { name: "Mail" }).getAttribute("aria-selected")).toBe("false");
  });

  it("keeps primary Settings tabs visible on the Identity overview route", async () => {
    renderAt("/admin/settings/identity/providers");
    expect(screen.getByRole("tab", { name: "General" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Identity" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("tab", { name: "Providers" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Cloudflare Access" })).toBeNull();
  });
});
