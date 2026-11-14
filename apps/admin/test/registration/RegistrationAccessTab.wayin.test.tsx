// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RegistrationSettingsDto, RoleAssignment } from "../../src/api/types.js";
import { getTooltipText, isOff } from "../test-utils.js";
import { api } from "./accessApiMocks.js";
import { settings, ssoChecks } from "./accessData.js";
import { card, radio, renderLoaded, resetApi, saveButton, toggle } from "./accessFixtures.js";

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
const REASON = "Not turned on for this organisation.";

const wayInCard = () => card("How guests open the form");
const ssoSettings = (overrides: Partial<RegistrationSettingsDto> = {}) => settings({ access_methods: ["sso"], readiness: ssoChecks(), ...overrides });
const isGreyed = (name: string) => (radio(name) as HTMLButtonElement).disabled;

beforeEach(() => {
  resetApi();
  assignments = [ORG_ADMIN];
});

afterEach(() => {
  cleanup();
});

describe("the ways in a superadmin has not turned on", () => {
  const forOrganiser = `${REASON} Ask a superadmin.`;
  const forSuperadmin = `${REASON} Turn it on in Organisation settings, External services.`;

  it("leaves all three choosable when all three are on, with no hover text", async () => {
    await renderLoaded(settings({ enabled_access_methods: ["link", "password", "sso"] }));

    expect([isGreyed("Link"), isGreyed("Password"), isGreyed("Company SSO")]).toEqual([false, false, false]);
    for (const name of ["Link", "Password", "Company SSO"]) expect(getTooltipText(radio(name))).toBeNull();
  });

  it("greys out each way that is off with only a hover text, and tells an administrator to ask a superadmin", async () => {
    await renderLoaded(settings({ access_methods: ["link"], enabled_access_methods: ["link"] }));

    expect([isGreyed("Link"), isGreyed("Password"), isGreyed("Company SSO")]).toEqual([false, true, true]);
    expect(getTooltipText(radio("Password"))).toBe(forOrganiser);
    expect(getTooltipText(radio("Company SSO"))).toBe(forOrganiser);
    expect(getTooltipText(radio("Link"))).toBeNull();
    // Nothing is written in the card about it, and nothing links anywhere.
    expect(within(wayInCard()).queryByText(REASON, { selector: "p, li, a" })).toBeNull();
    expect(within(wayInCard()).queryByRole("link")).toBeNull();
    expect(wayInCard().querySelector(".at-hint, strong")).toBeNull();
  });

  it("describes a greyed way to a screen reader with the same text, kept out of sight", async () => {
    await renderLoaded(settings({ enabled_access_methods: ["link", "password"] }));

    const note = document.getElementById(radio("Company SSO").getAttribute("aria-describedby") ?? "none");
    expect(note?.textContent).toBe(forOrganiser);
    expect(note?.className).toBe("sr-only");
    expect(radio("Link").getAttribute("aria-describedby")).toBeNull();
  });

  it("keeps the choice in the narrow group of the segmented control", async () => {
    await renderLoaded(settings({ enabled_access_methods: ["link"] }));

    expect(within(wayInCard()).getByRole("radiogroup", { name: "How guests open the form" }).classList.contains("access-seg")).toBe(true);
  });

  it("does not change the way when a greyed one is pressed, and sends nothing", async () => {
    await renderLoaded(settings({ access_methods: ["link"], enabled_access_methods: ["link"] }));

    fireEvent.click(radio("Password"));
    fireEvent.click(radio("Company SSO"));

    expect(radio("Link").getAttribute("aria-checked")).toBe("true");
    expect(radio("Password").getAttribute("aria-checked")).toBe("false");
    expect(isOff(saveButton())).toBe(true);
    expect(api.saveRegistrationSettings).not.toHaveBeenCalled();
  });

  it("tells a superadmin where to turn it on, in the same hover text", async () => {
    assignments = [SUPERADMIN];
    await renderLoaded(settings({ access_methods: ["link"], enabled_access_methods: ["link"] }));

    expect(getTooltipText(radio("Password"))).toBe(forSuperadmin);
    expect(getTooltipText(radio("Company SSO"))).toBe(forSuperadmin);
    expect(within(wayInCard()).queryByRole("link")).toBeNull();
  });

  it("keeps a chosen way chosen, greyed with the same hover text, when a superadmin turned it off afterwards", async () => {
    await renderLoaded(settings({ access_methods: ["password"], password_set: true, enabled_access_methods: ["link", "sso"] }));

    expect(radio("Password").getAttribute("aria-checked")).toBe("true");
    expect(isGreyed("Password")).toBe(true);
    expect(getTooltipText(radio("Password"))).toBe(forOrganiser);
    expect(isGreyed("Link")).toBe(false);
    expect(isOff(saveButton())).toBe(true);
    expect(screen.getByText("Event password")).toBeTruthy();
  });

  it("lets the person move from a way that was turned off to one that is on", async () => {
    await renderLoaded(settings({ access_methods: ["password"], password_set: true, enabled_access_methods: ["link"] }));
    api.saveRegistrationSettings.mockResolvedValue(settings({ access_methods: ["link"], enabled_access_methods: ["link"] }));

    fireEvent.click(radio("Link"));
    fireEvent.click(saveButton());

    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { access_methods: ["link"] }));
  });

  it("is named at the top of the card with one short instruction, and says what the chosen way means in one notice, none when nothing is chosen", async () => {
    await renderLoaded(settings({ access_methods: [], enabled_access_methods: ["link", "password", "sso"] }));

    expect(within(wayInCard()).getByText("Choose how guests open the registration form.")).toBeTruthy();
    expect(wayInCard().textContent).not.toMatch(/Way in/);
    expect(wayInCard().querySelector(".at-notice")).toBeNull();

    const notice = () => wayInCard().querySelectorAll(".at-notice");
    fireEvent.click(radio("Link"));
    expect([notice().length, notice()[0]?.textContent]).toEqual([1, "Anyone who has the link can ask to join. A bot check protects the form."]);
    fireEvent.click(radio("Password"));
    expect([notice().length, notice()[0]?.textContent]).toEqual([1, "Guests need the link and the event password to open the form. A bot check protects it."]);
    fireEvent.click(radio("Company SSO"));
    expect([notice().length, notice()[0]?.textContent]).toEqual([1, "Guests sign in with the company account. Their email comes from that sign-in."]);
  });

  it("is free of axe violations with a greyed way", async () => {
    await renderLoaded(settings({ enabled_access_methods: ["link"] }));

    const result = await axe.run(wayInCard(), { rules: { "color-contrast": { enabled: false } } });

    expect(result.violations).toEqual([]);
  });
});

describe("the restriction of the company SSO by who looks", () => {
  const restricted = (overrides: Partial<RegistrationSettingsDto> = {}) =>
    ssoSettings({ sso_claim_name: "tid", sso_claim_values: ["aaa-111", "bbb-222"], ...overrides });
  const name = () => screen.getByLabelText("Claim name") as HTMLInputElement;
  const values = () => screen.getByLabelText("Allowed values") as HTMLTextAreaElement;

  it("shows an administrator the claim and its values, read only, with the sentence that says why", async () => {
    await renderLoaded(restricted());

    expect(name().value).toBe("tid");
    expect(values().value).toBe("aaa-111\nbbb-222");
    expect([name().readOnly, values().readOnly]).toEqual([true, true]);
    expect(within(wayInCard()).getByText("Only a superadmin can change this.")).toBeTruthy();
  });

  it("sends nothing for the restriction when an administrator saves another change", async () => {
    await renderLoaded(restricted());
    api.saveRegistrationSettings.mockResolvedValue(restricted({ ask_company: true }));

    fireEvent.click(toggle("Ask for the company"));
    fireEvent.click(saveButton());

    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { ask_company: true }));
  });

  it("shows an administrator the empty restriction as read only too, so nothing there invites typing", async () => {
    await renderLoaded(ssoSettings());

    expect([name().readOnly, values().readOnly]).toEqual([true, true]);
    fireEvent.change(name(), { target: { value: "tid" } });
    expect(isOff(saveButton())).toBe(true);
  });

  it("lets a superadmin type the claim and the values, and does not say that only a superadmin can", async () => {
    assignments = [SUPERADMIN];
    await renderLoaded(restricted());

    expect([name().readOnly, values().readOnly]).toEqual([false, false]);
    expect(within(wayInCard()).queryByText("Only a superadmin can change this.")).toBeNull();
  });
});
