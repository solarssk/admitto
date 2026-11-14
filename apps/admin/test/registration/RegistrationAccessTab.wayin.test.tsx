// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RegistrationSettingsDto, RoleAssignment } from "../../src/api/types.js";
import { isOff } from "../test-utils.js";
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

const wayInCard = () => card("Way in");
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
  it("leaves all three choosable when all three are on, and says nothing about a reason", async () => {
    await renderLoaded(settings({ enabled_access_methods: ["link", "password", "sso"] }));

    expect([isGreyed("Link"), isGreyed("Password"), isGreyed("Company sign-in")]).toEqual([false, false, false]);
    expect(within(wayInCard()).queryByText(REASON, { exact: false })).toBeNull();
  });

  it("greys out each way that is off, names it with its reason, and tells an administrator to ask a superadmin", async () => {
    await renderLoaded(settings({ access_methods: ["link"], enabled_access_methods: ["link"] }));

    expect([isGreyed("Link"), isGreyed("Password"), isGreyed("Company sign-in")]).toEqual([false, true, true]);
    const reasons = within(wayInCard()).getAllByRole("listitem");
    expect(reasons.map((item) => item.textContent)).toEqual([
      `Password: ${REASON} Ask a superadmin.`,
      `Company sign-in: ${REASON} Ask a superadmin.`,
    ]);
    expect(within(wayInCard()).queryByRole("link")).toBeNull();
  });

  it("ties the reasons to the choice for a screen reader", async () => {
    await renderLoaded(settings({ enabled_access_methods: ["link", "password"] }));

    const group = within(wayInCard()).getByRole("radiogroup", { name: "Way in" });
    const reasons = document.getElementById(group.getAttribute("aria-describedby") ?? "none");
    expect(reasons?.textContent).toBe(`Company sign-in: ${REASON} Ask a superadmin.`);
  });

  it("does not change the way in when a greyed one is pressed, and sends nothing", async () => {
    await renderLoaded(settings({ access_methods: ["link"], enabled_access_methods: ["link"] }));

    fireEvent.click(radio("Password"));
    fireEvent.click(radio("Company sign-in"));

    expect(radio("Link").getAttribute("aria-checked")).toBe("true");
    expect(radio("Password").getAttribute("aria-checked")).toBe("false");
    expect(isOff(saveButton())).toBe(true);
    expect(api.saveRegistrationSettings).not.toHaveBeenCalled();
  });

  it("gives a superadmin the place to turn it on instead of the advice to ask", async () => {
    assignments = [SUPERADMIN];
    await renderLoaded(settings({ access_methods: ["link"], enabled_access_methods: ["link"] }));

    const links = within(wayInCard()).getAllByRole("link", { name: "Turn it on in Organisation settings" });
    expect(links).toHaveLength(2);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/admin/settings?tab=external", "/admin/settings?tab=external"]);
    expect(within(wayInCard()).queryByText("Ask a superadmin.", { exact: false })).toBeNull();
  });

  it("keeps a chosen way in chosen, greyed with the same reason, when a superadmin turned it off afterwards", async () => {
    await renderLoaded(settings({ access_methods: ["password"], password_set: true, enabled_access_methods: ["link", "sso"] }));

    expect(radio("Password").getAttribute("aria-checked")).toBe("true");
    expect(isGreyed("Password")).toBe(true);
    expect(within(wayInCard()).getByRole("listitem").textContent).toBe(`Password: ${REASON} Ask a superadmin.`);
    // The other ways stay open to be chosen, and nothing of the event is removed by looking.
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

  it("is free of axe violations with a greyed way in", async () => {
    await renderLoaded(settings({ enabled_access_methods: ["link"] }));

    const result = await axe.run(wayInCard(), { rules: { "color-contrast": { enabled: false } } });

    expect(result.violations).toEqual([]);
  });
});

describe("the restriction of the company sign-in by who looks", () => {
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
