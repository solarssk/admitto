// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import type { RegistrationSettingsDto } from "../../src/api/types.js";
import { isOff } from "../test-utils.js";
import { api } from "./accessApiMocks.js";
import { archivedEvent, settings, ssoChecks } from "./accessData.js";
import { card, radio, renderLoaded, resetApi, saveButton, toggle } from "./accessFixtures.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const { api: mocks } = await import("./accessApiMocks.js");
  return {
    ...(await importOriginal<typeof import("../../src/api/client.js")>()),
    fetchRegistrationSettings: (...args: unknown[]) => mocks.fetchRegistrationSettings(...args),
    saveRegistrationSettings: (...args: unknown[]) => mocks.saveRegistrationSettings(...args),
    setRegistrationPassword: (...args: unknown[]) => mocks.setRegistrationPassword(...args),
    clearRegistrationPassword: (...args: unknown[]) => mocks.clearRegistrationPassword(...args),
    fetchLegalDocuments: (...args: unknown[]) => mocks.fetchLegalDocuments(...args),
    fetchRegistrationCounts: (...args: unknown[]) => mocks.fetchRegistrationCounts(...args),
  };
});
vi.mock("../../src/connection/ConnectionStateProvider.js");
vi.mock("../../src/auth/login-navigation.js", () => ({ goToLogin: vi.fn() }));
// The restriction is a superadmin's to change (RegistrationAccessTab.wayin.test.tsx holds what anybody else sees).
vi.mock("../../src/auth/AuthProvider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/auth/AuthProvider.js")>()),
  useOptionalAuth: () => ({ assignments: [{ role: "superadmin", scope_type: "instance", scope_id: null }] }),
}));
vi.mock("@admitto/ui", async (importOriginal) => {
  const { addToast: toast } = await import("./accessApiMocks.js");
  return { ...(await importOriginal<typeof import("@admitto/ui")>()), useToast: () => ({ addToast: toast }) };
});

const ssoSettings = (overrides: Partial<RegistrationSettingsDto> = {}) => settings({ access_methods: ["sso"], readiness: ssoChecks(), ...overrides });
const claimName = () => screen.queryByLabelText("Claim name") as HTMLInputElement | null;
const claimValues = () => screen.queryByLabelText("Allowed values") as HTMLTextAreaElement | null;
const type = (control: HTMLElement | null, value: string) => fireEvent.change(control as HTMLElement, { target: { value } });
const alertText = () => screen.getByRole("alert").textContent ?? "";

async function save() {
  fireEvent.click(saveButton());
  await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalled());
}

beforeEach(() => {
  resetApi();
});

afterEach(() => {
  cleanup();
});

describe("the company SSO as the way in of an event", () => {
  it("is a third way in beside the link and the password, and says what it does", async () => {
    await renderLoaded(ssoSettings());

    expect(radio("Company SSO").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Guests sign in with the company's single sign-on (SSO), using their work account. Their email comes from that sign-in.")).toBeTruthy();
    expect(screen.queryByText("Event password")).toBeNull();
    expect(screen.queryByText("Choosing another way in later removes the password.")).toBeNull();
  });

  it("greys out the confirmation of the address for the company SSO and says why, and gives the switch back, unchanged, with the other ways in", async () => {
    await renderLoaded(settings({ verify_email: true }));
    expect(isOff(toggle("Confirm email addresses"))).toBe(false);

    fireEvent.click(radio("Company SSO"));

    expect(isOff(toggle("Confirm email addresses"))).toBe(true);
    expect(screen.getByText(/Not used with Company SSO\. The address comes from the identity provider, so no confirmation link is sent\./)).toBeTruthy();
    expect(screen.queryByText(/Guests confirm their address with a link/)).toBeNull();
    fireEvent.click(radio("Link"));
    expect(isOff(toggle("Confirm email addresses"))).toBe(false);
    expect(toggle("Confirm email addresses").checked).toBe(true);
    expect(screen.getByText(/Guests confirm their address with a link/)).toBeTruthy();
  });

  it("does not send the confirmation of the address when the way in is the company SSO, though it is on", async () => {
    await renderLoaded(settings({ verify_email: true }));
    api.saveRegistrationSettings.mockResolvedValue(ssoSettings({ verify_email: true }));

    fireEvent.click(radio("Company SSO"));
    await save();

    expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { access_methods: ["sso"] });
  });

  it("has no fields of the restriction on this tab, for any way, since a superadmin sets it in Event settings", async () => {
    await renderLoaded(ssoSettings({ sso_claim_name: "tid", sso_claim_values: ["aaa-111"] }));
    expect(screen.queryByLabelText("Claim name")).toBeNull();
    expect(screen.queryByLabelText("Allowed values")).toBeNull();
    expect(card("How guests open the form").textContent).not.toMatch(/claim/i);

    fireEvent.click(radio("Link"));
    fireEvent.click(radio("Company SSO"));
    expect(screen.queryByLabelText("Claim name")).toBeNull();
  });

  it("sends only the way in, never the restriction, when the way is changed to the company SSO and back", async () => {
    await renderLoaded(ssoSettings({ sso_claim_name: "tid", sso_claim_values: ["aaa-111"] }));
    api.saveRegistrationSettings.mockResolvedValue(settings());

    fireEvent.click(radio("Link"));
    await save();

    expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { access_methods: ["link"] });
  });
});

describe("the setup checklist of an event with the company SSO", () => {
  const rows = () => Array.from(card("Setup checklist").querySelectorAll("li.access-check"));

  it("has no bot protection among its checks, and the company SSO as one", async () => {
    await renderLoaded(ssoSettings());

    expect(screen.queryByText("Bot protection")).toBeNull();
    expect(within(card("Setup checklist")).getByText("Company SSO")).toBeTruthy();
    expect(rows()).toHaveLength(10);
  });

  it("says that the form stays closed and who sets it up, with where, when the identity provider is not chosen", async () => {
    await renderLoaded(ssoSettings({ readiness: ssoChecks("identity_provider") }));

    const row = rows()[0] as HTMLElement;
    expect(row.textContent).toContain("Company SSO is not set up, so the form stays closed.");
    expect(row.textContent).toContain("Ask a superadmin to choose the identity provider in Organisation settings, External services, Access methods.");
  });
});
