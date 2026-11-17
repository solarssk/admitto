// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isOff } from "../test-utils.js";
import { api } from "./accessApiMocks.js";
import { settings, ssoEventSettings } from "./accessData.js";
import { checklistPanel, radio, renderChecklistLoaded, renderLoaded, resetApi, saveButton, toggle } from "./accessFixtures.js";

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
// A superadmin reads the tab here (RegistrationAccessTab.method.test.tsx holds what an organiser sees).
vi.mock("../../src/auth/AuthProvider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/auth/AuthProvider.js")>()),
  useOptionalAuth: () => ({ assignments: [{ role: "superadmin", scope_type: "instance", scope_id: null }] }),
}));
vi.mock("@admitto/ui", async (importOriginal) => {
  const { addToast: toast } = await import("./accessApiMocks.js");
  return { ...(await importOriginal<typeof import("@admitto/ui")>()), useToast: () => ({ addToast: toast }) };
});

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

describe("the company SSO as the way in of an event, on the Access tab", () => {
  it("has no control that changes it on this tab, and the checklist states it with the identity provider", async () => {
    await renderLoaded(ssoEventSettings());

    expect(screen.queryByRole("radio", { name: "Company SSO" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
    expect(screen.queryByText("Event password")).toBeNull();
    expect(screen.queryByLabelText("Claim name")).toBeNull();
    expect(screen.queryByLabelText("Allowed values")).toBeNull();
    cleanup();

    await renderChecklistLoaded(ssoEventSettings());
    expect(checklistPanel().textContent).toContain("Company SSO. Guests sign in with Contoso Entra.");
  });

  it("greys out the confirmation of the address for the company SSO and says why, and gives the switch back, unchanged, with the other ways in", async () => {
    await renderLoaded(ssoEventSettings({ verify_email: true }));

    expect(isOff(toggle("Confirm email addresses"))).toBe(true);
    expect(screen.getByText(/Not used with Company SSO\. The address comes from the identity provider, so no confirmation link is sent\./)).toBeTruthy();
    expect(screen.queryByText(/Guests confirm their address with a link/)).toBeNull();
    cleanup();

    await renderLoaded(settings({ verify_email: true }));
    expect(isOff(toggle("Confirm email addresses"))).toBe(false);
    expect(toggle("Confirm email addresses").checked).toBe(true);
    expect(screen.getByText(/Guests confirm their address with a link/)).toBeTruthy();
  });

  it("sends no access method, provider or restriction when another setting is saved", async () => {
    await renderLoaded(ssoEventSettings({ sso_claim_name: "tid", sso_claim_values: ["aaa-111"] }));
    api.saveRegistrationSettings.mockResolvedValue(ssoEventSettings({ waitlist_enabled: false }));

    fireEvent.click(toggle("Waiting list"));
    await save();

    expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { waitlist_enabled: false });
  });
});
