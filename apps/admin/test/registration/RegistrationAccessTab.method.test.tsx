// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RegistrationSettingsDto, RoleAssignment } from "../../src/api/types.js";
import { plain } from "../test-utils.js";
import { api } from "./accessApiMocks.js";
import { checks, settings, ssoChecks, ssoEventSettings } from "./accessData.js";
import { card, renderLoaded, resetApi, saveButton } from "./accessFixtures.js";

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

const row = () => Array.from(card("Setup checklist").querySelectorAll("li.access-check")).find((entry) => entry.textContent?.includes("Access method")) as HTMLElement;
const rows = () => Array.from(card("Setup checklist").querySelectorAll("li.access-check"));

beforeEach(() => {
  resetApi();
  assignments = [ORG_ADMIN];
});

afterEach(() => {
  cleanup();
});

describe("the row Access method of the checklist: what is set, to read", () => {
  it("states the method and who sets it, as text, with no control, card or link", async () => {
    await renderLoaded(settings());

    expect(row().textContent).toContain("Link. Anyone who has the link can ask to join.");
    expect(row().textContent).toContain("Set by a superadmin in Event settings, Registration.");
    expect(within(row()).queryByRole("link")).toBeNull();
    expect(within(row()).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Access method" })).toBeNull();
    expect(screen.queryByText("Access method", { selector: ".at-card__title" })).toBeNull();
  });

  it("says the same to a superadmin, as static text without a link", async () => {
    assignments = [SUPERADMIN];
    await renderLoaded(settings({ access_methods: ["password"], password_set: true }));

    expect(row().textContent).toContain("Password. Guests need the link and the event password to open the form.");
    expect(row().textContent).toContain("Set by a superadmin in Event settings, Registration.");
    expect(within(row()).queryByRole("link")).toBeNull();
  });

  it("says which identity provider guests sign in with for Company SSO, and marks one that is turned off", async () => {
    await renderLoaded(ssoEventSettings());
    expect(row().textContent).toContain("Company SSO. Guests sign in with Contoso Entra.");
    cleanup();

    await renderLoaded(ssoEventSettings({ sso_provider: { id: "idp-entra", state: "disabled", display_name: "Contoso Entra", kind: "entra" } }));
    expect(row().textContent).toContain("Company SSO. Guests sign in with Contoso Entra (turned off).");
    cleanup();

    await renderLoaded(ssoEventSettings({ sso_provider_id: null, sso_provider: null }));
    expect(row().textContent).toContain("Company SSO. No identity provider is chosen yet.");
  });

  it("is the warning row, with who to ask and without the sentence about who sets it, when no access method is chosen", async () => {
    await renderLoaded(settings({ access_methods: [], readiness: checks("access_method") }));

    expect(row().textContent).toContain("No access method is chosen yet. Guests cannot open the form.");
    expect(row().textContent).toContain("Ask a superadmin to choose it in Event settings, Registration.");
    expect(row().textContent).not.toContain("Set by a superadmin");
    expect(row().querySelector(".ti-alert-triangle")).not.toBeNull();
  });

  it("is free of axe violations", async () => {
    assignments = [SUPERADMIN];
    await renderLoaded(ssoEventSettings());

    const result = await axe.run(card("Setup checklist"), { rules: { "color-contrast": { enabled: false } } });

    expect(result.violations).toEqual([]);
  });
});

describe("the checklist rows that are put right in Event settings, Registration", () => {
  it.each([
    ["access_method", "No access method is chosen yet. Guests cannot open the form.", "Ask a superadmin to choose it in Event settings, Registration.", "Choose it in Event settings, Registration."],
    ["password", "Set the password that guests will enter.", "Ask a superadmin to set it in Event settings, Registration.", "Set it in Event settings, Registration."],
  ] as const)("send an organiser to ask, and a superadmin to the settings, for %s", async (key, missing, ask, go) => {
    const readiness = key === "password" ? [{ key: "access_method", ok: true }, { key: "password", ok: false }] : checks(key);
    await renderLoaded(settings({ access_methods: key === "password" ? ["password"] : [], readiness }));
    let row = rows().find((entry) => entry.textContent?.includes(missing)) as HTMLElement;
    expect(row.textContent).toContain(ask);
    expect(within(row).queryByRole("link")).toBeNull();
    cleanup();

    assignments = [SUPERADMIN];
    await renderLoaded(settings({ access_methods: key === "password" ? ["password"] : [], readiness }));
    row = rows().find((entry) => entry.textContent?.includes(missing)) as HTMLElement;
    expect(within(row).getByRole("link", { name: go }).getAttribute("href")).toBe(SETTINGS_LINK);
  });

  it("do the same for the identity provider", async () => {
    await renderLoaded(ssoEventSettings({ readiness: ssoChecks("identity_provider") }));
    const row = rows()[0] as HTMLElement;
    expect(row.textContent).toContain("Ask a superadmin to choose it in Event settings, Registration.");
    cleanup();

    assignments = [SUPERADMIN];
    await renderLoaded(ssoEventSettings({ readiness: ssoChecks("identity_provider") }));
    expect(within(rows()[0] as HTMLElement).getByRole("link", { name: "Choose it in Event settings, Registration." }).getAttribute("href")).toBe(SETTINGS_LINK);
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
