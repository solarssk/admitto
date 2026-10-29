// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { ToastProvider } from "@admitto/ui";
import { StaffRoutes } from "../../src/App.js";
import type { RoleAssignment } from "../../src/api/types.js";
import { accessMethodsDto } from "../settings/accessMethodsFixtures.js";
import { makeOrgAdminAssignment, makeSuperadminAssignment } from "../test-utils.js";

let assignments: RoleAssignment[] = [];

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments, setupComplete: true, refresh: () => Promise.resolve() }),
}));

// The shells and the picker are not what this file is about; the guards, the routes and the panel are real.
vi.mock("../../src/layouts/EventsListShell.js", async () => {
  const { Outlet } = await import("react-router");
  return { EventsListShell: () => <Outlet /> };
});

vi.mock("../../src/layouts/InstanceSettingsShell.js", async () => {
  const { Outlet } = await import("react-router");
  return { InstanceSettingsShell: () => <Outlet /> };
});

vi.mock("../../src/layouts/SettingsLayout.js", async () => {
  const { Outlet } = await import("react-router");
  return { SettingsLayout: () => <Outlet /> };
});

vi.mock("../../src/pages/EventsPickerPage.js", () => ({
  EventsPickerPage: () => <div>events picker</div>,
}));

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchExternalServices: vi.fn(),
    fetchRegistrationTurnstile: vi.fn(),
    fetchRegistrationAccessMethods: vi.fn(),
    saveRegistrationAccessMethods: vi.fn(),
  };
});

import { fetchExternalServices, fetchRegistrationAccessMethods, fetchRegistrationTurnstile, saveRegistrationAccessMethods } from "../../src/api/client.js";

function renderAt(path: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <StaffRoutes />
      </MemoryRouter>
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.mocked(fetchExternalServices).mockResolvedValue({
    weather: {
      enabled: true,
      provider: "metno",
      base_url: "https://api.open-meteo.com",
      api_key: { configured: false, source: "none" },
      attribution: "Weather data by MET Norway",
      attribution_url: "https://www.met.no/en",
      commercial_notice: "Free Open-Meteo is non-commercial.",
      horizon_days: 9,
      contact_configured: true,
    },
    maps: {
      enabled: true,
      tile_url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: "© OpenStreetMap",
      max_zoom: 19,
      geocoding_provider: "nominatim",
      geocoding_base_url: "https://nominatim.openstreetmap.org",
    },
  });
  vi.mocked(fetchRegistrationTurnstile).mockResolvedValue({ site_key: null, secret_set: false, status: "incomplete" });
  vi.mocked(fetchRegistrationAccessMethods).mockResolvedValue(accessMethodsDto());
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  assignments = [];
});

describe("the Ways in card, which sits on the superadmin-only settings route", () => {
  it("shows a superadmin the card on External services, after reading the ways in", async () => {
    assignments = [makeSuperadminAssignment()];
    renderAt("/admin/settings?tab=external");

    expect(await screen.findByRole("switch", { name: "Link" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Password" })).toBeTruthy();
    expect(fetchRegistrationAccessMethods).toHaveBeenCalledTimes(1);
  });

  it("sends an administrator of an organisation back to the events, without reading or showing the ways in", async () => {
    assignments = [makeOrgAdminAssignment()];
    renderAt("/admin/settings?tab=external");

    expect(await screen.findByText("events picker")).toBeTruthy();
    expect(screen.queryByText("Ways in")).toBeNull();
    expect(screen.queryByRole("switch", { name: "Link" })).toBeNull();
    expect(fetchRegistrationAccessMethods).not.toHaveBeenCalled();
    expect(saveRegistrationAccessMethods).not.toHaveBeenCalled();
  });
});
