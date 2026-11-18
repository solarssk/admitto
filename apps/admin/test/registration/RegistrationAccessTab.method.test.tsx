// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RegistrationSettingsDto, RoleAssignment } from "../../src/api/types.js";
import { plain } from "../test-utils.js";
import { api } from "./accessApiMocks.js";
import { checks, settings, ssoChecks, ssoEventSettings } from "./accessData.js";
import { checklistRows, renderChecklistLoaded, renderLoaded, resetApi, saveButton } from "./accessFixtures.js";

let assignments: RoleAssignment[] = [];

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const { api: mocks } = await import("./accessApiMocks.js");
  return {
    ...(await importOriginal<typeof import("../../src/api/client.js")>()),
    fetchRegistrationSettings: (...args: unknown[]) => mocks.fetchRegistrationSettings(...args),
    saveRegistrationSettings: (...args: unknown[]) => mocks.saveRegistrationSettings(...args),
    fetchLegalDocuments: (...args: unknown[]) => mocks.fetchLegalDocuments(...args),
    fetchRegistrationCounts: (...args: unknown[]) => mocks.fetchRegistrationCounts(...args),
  };
});
vi.mock("../../src/connection/ConnectionStateProvider.js");
vi.mock("../../src/auth/login-navigation.js", () => ({ goToLogin: vi.fn() }));
vi.mock("../../src/auth/AuthProvider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/auth/AuthProvider.js")>()),
  useOptionalAuth: () => ({ assignments }),
}));
vi.mock("@admitto/ui", async (importOriginal) => {
  const { addToast: toast } = await import("./accessApiMocks.js");
  return { ...(await importOriginal<typeof import("@admitto/ui")>()), useToast: () => ({ addToast: toast }) };
});

const SUPERADMIN: RoleAssignment = { role: "superadmin", scope_type: "instance", scope_id: null };
const ORG_ADMIN: RoleAssignment = { role: "admin", scope_type: "organization", scope_id: "org-1" };
const SETTINGS_LINK = "/admin/events/evt-1/settings?tab=registration";


beforeEach(() => {
  resetApi();
  assignments = [ORG_ADMIN];
});

afterEach(() => {
  cleanup();
});

describe("the checklist rows that are put right in Event settings, Registration", () => {
  const rows = () => checklistRows();
  it.each([
    ["access_method", "No access method is chosen yet. Guests cannot open the form.", "Ask a superadmin to choose it in Event settings, Registration.", "Access method"],
    ["password", "Set the password that guests will enter.", "Ask a superadmin to set it in Event settings, Registration.", "Event password"],
  ] as const)("send an organiser to ask, and a superadmin to the settings, for %s", async (key, missing, ask, title) => {
    const readiness = key === "password" ? [{ key: "access_method", ok: true }, { key: "password", ok: false }] : checks(key);
    await renderChecklistLoaded(settings({ access_methods: key === "password" ? ["password"] : [], readiness }));
    let row = rows().find((entry) => entry.textContent?.includes(missing)) as HTMLElement;
    expect(row.textContent).toContain(ask);
    expect(within(row).queryByRole("link")).toBeNull();
    cleanup();

    assignments = [SUPERADMIN];
    await renderChecklistLoaded(settings({ access_methods: key === "password" ? ["password"] : [], readiness }));
    row = rows().find((entry) => entry.textContent?.includes(missing)) as HTMLElement;
    expect(within(row).getByRole("link", { name: `Open Event settings: ${title}` }).getAttribute("href")).toBe(SETTINGS_LINK);
  });

  it("do the same for the identity provider", async () => {
    await renderChecklistLoaded(ssoEventSettings({ readiness: ssoChecks("identity_provider") }));
    const row = rows()[0] as HTMLElement;
    expect(row.textContent).toContain("Ask a superadmin to choose it in Event settings, Registration.");
    cleanup();

    assignments = [SUPERADMIN];
    await renderChecklistLoaded(ssoEventSettings({ readiness: ssoChecks("identity_provider") }));
    expect(within(rows()[0] as HTMLElement).getByRole("link", { name: "Open Event settings: Identity provider" }).getAttribute("href")).toBe(SETTINGS_LINK);
  });

  it("do the same in the list of what a refused save needs", async () => {
    const refused: RegistrationSettingsDto = settings({ mode: null });
    await renderLoaded(refused);
    const { ApiError } = await import("../../src/api/client.js");
    const error = new ApiError(409, "registration_not_ready");
    error.blockers = ["password"];
    api.saveRegistrationSettings.mockRejectedValue(error);

    fireEvent.click(screen.getByRole("radio", { name: "Automatic" }));
    fireEvent.click(saveButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Ask a superadmin to set it in Event settings, Registration.");
  });
});
