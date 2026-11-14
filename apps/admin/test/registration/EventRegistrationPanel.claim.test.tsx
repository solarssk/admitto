// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import type { RegistrationSettingsDto } from "../../src/api/types.js";
import { EventRegistrationPanel } from "../../src/registration/EventRegistrationPanel.js";
import { isOff } from "../test-utils.js";
import { addToast, api, refreshEvent } from "./accessApiMocks.js";
import { settings, ssoChecks } from "./accessData.js";
import { card, resetApi } from "./accessFixtures.js";

const goToLogin = vi.fn();

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const { api: mocks } = await import("./accessApiMocks.js");
  return {
    ...(await importOriginal<typeof import("../../src/api/client.js")>()),
    fetchRegistrationSettings: (...args: unknown[]) => mocks.fetchRegistrationSettings(...args),
    saveRegistrationSettings: (...args: unknown[]) => mocks.saveRegistrationSettings(...args),
    fetchRegistrationSsoProvider: (...args: unknown[]) => mocks.fetchRegistrationSsoProvider(...args),
  };
});
vi.mock("../../src/connection/ConnectionStateProvider.js");
vi.mock("../../src/auth/login-navigation.js", () => ({ goToLogin: (...args: unknown[]) => goToLogin(...args) }));
vi.mock("@admitto/ui", async (importOriginal) => {
  const { addToast: toast } = await import("./accessApiMocks.js");
  return { ...(await importOriginal<typeof import("@admitto/ui")>()), useToast: () => ({ addToast: toast }) };
});

const ssoSettings = (overrides: Partial<RegistrationSettingsDto> = {}) => settings({ access_methods: ["sso"], readiness: ssoChecks(), ...overrides });
const restricted = (overrides: Partial<RegistrationSettingsDto> = {}) => ssoSettings({ sso_claim_name: "tid", sso_claim_values: ["aaa-111"], ...overrides });
const claimName = () => screen.queryByLabelText("Claim name") as HTMLInputElement | null;
const claimValues = () => screen.queryByLabelText("Allowed values") as HTMLTextAreaElement | null;
const type = (control: HTMLElement | null, value: string) => fireEvent.change(control as HTMLElement, { target: { value } });
const ssoCard = () => card("Company SSO");
const saveButton = () => within(ssoCard()).getByRole("button", { name: "Save" });

async function renderPanel(saved: RegistrationSettingsDto, { archived = false } = {}) {
  api.fetchRegistrationSettings.mockResolvedValue(saved);
  render(<EventRegistrationPanel eventId="evt-1" archived={archived} refreshEvent={refreshEvent} />);
  await screen.findByText("Company SSO", { selector: ".at-card__title" });
  await waitFor(() => expect(screen.queryByLabelText("Own address")).toBeTruthy());
}

async function save() {
  fireEvent.click(saveButton());
  await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalled());
}

beforeEach(() => {
  resetApi();
  goToLogin.mockReset();
  api.fetchRegistrationSsoProvider.mockResolvedValue({
    provider_id: "idp-1",
    state: "ready",
    providers: [{ id: "idp-1", display_name: "Acme Entra ID" }],
    redirect_uri: null,
    redirect_uris: [],
  });
});

afterEach(() => {
  cleanup();
});

describe("the Company SSO card", () => {
  it("shows the identity provider of the organisation, read only, with where it is chosen", async () => {
    await renderPanel(ssoSettings());

    const provider = within(ssoCard()).getByLabelText("Identity provider") as HTMLInputElement;
    expect(provider.value).toBe("Acme Entra ID");
    expect(provider.readOnly).toBe(true);
    expect(within(ssoCard()).getByText("Chosen for the organisation, in Organisation settings, Identity.")).toBeTruthy();
  });

  it.each([
    ["none is chosen", { provider_id: null, state: "none", providers: [{ id: "idp-1", display_name: "Acme Entra ID" }], redirect_uri: null, redirect_uris: [] }],
  ])("leaves the provider row out when %s", async (_what, answer) => {
    api.fetchRegistrationSsoProvider.mockResolvedValue(answer);
    await renderPanel(ssoSettings());

    expect(screen.queryByLabelText("Identity provider")).toBeNull();
    expect(claimName()).toBeTruthy();
  });

  it("leaves the provider row out, and still works, when its name cannot be read", async () => {
    api.fetchRegistrationSsoProvider.mockRejectedValue(new ApiError(500, "internal_error"));
    await renderPanel(ssoSettings());

    expect(screen.queryByLabelText("Identity provider")).toBeNull();
    expect(claimName()).toBeTruthy();
  });

  it("explains the restriction in two sentences: the claim and its values, OpenID Connect, tid, exact matching, never an address, and empty for none", async () => {
    await renderPanel(ssoSettings());
    const text = ssoCard().textContent ?? "";

    expect(text).toMatch(/OpenID Connect, such as Microsoft Entra ID/);
    expect(text).toMatch(/Name the claim and list the values that may register/);
    expect(text).toMatch(/Leave both empty for no restriction\./);
    expect(text).toMatch(/must match exactly, with capital letters as they are\./);
    expect(text).toMatch(/Never use the end of an email address here/);
    expect(text).not.toMatch(/[–—]/);
  });

  it("shows the same fields, grey and with Save off, for an event whose way is not the company SSO, with the sentence that says where to choose it", async () => {
    await renderPanel(settings({ access_methods: ["link"] }));

    expect(claimName()?.disabled).toBe(true);
    expect(claimValues()?.disabled).toBe(true);
    expect((within(ssoCard()).getByLabelText("Identity provider") as HTMLInputElement).disabled).toBe(true);
    expect(isOff(saveButton())).toBe(true);
    expect(within(ssoCard()).getByText("Choose Company SSO as the way guests open the form, on the Access tab of Registration.")).toBeTruthy();
  });

  it("does not react to typing in the grey fields, and says nothing of the way for an event that uses the company SSO", async () => {
    await renderPanel(settings({ access_methods: ["link"] }));
    type(claimName(), "tid");
    type(claimValues(), "aaa-111");
    expect(isOff(saveButton())).toBe(true);
    cleanup();

    await renderPanel(ssoSettings());
    expect(within(ssoCard()).queryByText(/Choose Company SSO as the way/)).toBeNull();
    expect(claimName()?.disabled).toBe(false);
  });

  it("shows the restriction that is saved, the name and one value on each line, with Save off", async () => {
    await renderPanel(restricted({ sso_claim_values: ["aaa-111", "bbb-222"] }));

    expect(claimName()?.value).toBe("tid");
    expect(claimValues()?.value).toBe("aaa-111\nbbb-222");
    expect(isOff(saveButton())).toBe(true);
  });

  it("sends the name and the values, and nothing else, in one save, and shows what was saved", async () => {
    await renderPanel(ssoSettings());
    api.saveRegistrationSettings.mockResolvedValue(restricted({ sso_claim_values: ["aaa-111", "bbb-222"] }));

    type(claimName(), "tid");
    type(claimValues(), "aaa-111\n\nbbb-222\n");
    await save();

    expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { sso_claim_name: "tid", sso_claim_values: ["aaa-111", "bbb-222"] });
    await waitFor(() => expect(claimValues()?.value).toBe("aaa-111\nbbb-222"));
    expect(addToast).toHaveBeenCalledWith("Registration settings saved.", "success");
    expect(isOff(saveButton())).toBe(true);
  });

  it("sends the name too when only the values changed, since the server takes the two together", async () => {
    await renderPanel(restricted());
    api.saveRegistrationSettings.mockResolvedValue(restricted({ sso_claim_values: ["aaa-111", "ccc-333"] }));

    type(claimValues(), "aaa-111\nccc-333");
    await save();

    expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { sso_claim_name: "tid", sso_claim_values: ["aaa-111", "ccc-333"] });
  });

  it("takes the restriction away with null and an empty list when both fields are cleared", async () => {
    await renderPanel(restricted());
    api.saveRegistrationSettings.mockResolvedValue(ssoSettings());

    type(claimName(), "");
    type(claimValues(), "");
    await save();

    expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { sso_claim_name: null, sso_claim_values: [] });
    await waitFor(() => expect(claimName()?.value).toBe(""));
  });

  it("does not count spaces or an empty line as a change", async () => {
    await renderPanel(restricted());

    type(claimName(), " tid ");
    type(claimValues(), "\naaa-111 \n\n");

    expect(isOff(saveButton())).toBe(true);
  });

  it("locks the fields and Save for an archived event", async () => {
    await renderPanel(restricted(), { archived: true });

    expect(claimName()?.disabled).toBe(true);
    expect(claimValues()?.disabled).toBe(true);
    expect(isOff(saveButton())).toBe(true);
  });

  it("hands a lost session to the sign-in", async () => {
    await renderPanel(ssoSettings());
    api.saveRegistrationSettings.mockRejectedValue(new ApiError(401, "unauthorized"));

    type(claimName(), "tid");
    type(claimValues(), "aaa-111");
    await save();

    await waitFor(() => expect(goToLogin).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reads the event again when the save is refused because the event is archived", async () => {
    await renderPanel(ssoSettings());
    api.saveRegistrationSettings.mockRejectedValue(new ApiError(403, "event_archived", "event_archived"));

    type(claimName(), "tid");
    type(claimValues(), "aaa-111");
    await save();

    await screen.findByRole("alert");
    expect(refreshEvent).toHaveBeenCalled();
  });

  it("says in its own words when the server refuses the restriction for another way, and never shows the code", async () => {
    await renderPanel(ssoSettings());
    api.saveRegistrationSettings.mockRejectedValue(new ApiError(422, "sso_claim_needs_sso", "sso_claim_needs_sso"));

    type(claimName(), "tid");
    type(claimValues(), "aaa-111");
    await save();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The restriction to one company works with the company SSO only.");
    expect(alert.textContent).not.toContain("sso_claim_needs_sso");
  });
});

describe("what is wrong with the restriction", () => {
  it("names the missing value when only the name is typed, in the field, and keeps Save off", async () => {
    await renderPanel(ssoSettings());

    type(claimName(), "tid");

    expect(screen.getByText("Enter at least one value, or clear the name.")).toBeTruthy();
    expect(claimValues()?.getAttribute("aria-invalid")).toBe("true");
    expect(isOff(saveButton())).toBe(true);
  });

  it("names the missing claim when only values are typed", async () => {
    await renderPanel(ssoSettings());

    type(claimValues(), "aaa-111");

    expect(screen.getByText("Enter the name of the claim these values belong to.")).toBeTruthy();
    expect(claimName()?.getAttribute("aria-invalid")).toBe("true");
    expect(isOff(saveButton())).toBe(true);
  });

  it("refuses a name with a space and says what a name may hold", async () => {
    await renderPanel(ssoSettings());

    type(claimName(), "my claim");
    type(claimValues(), "aaa-111");

    expect(screen.getByText("The name has letters, digits and signs only, with no spaces.")).toBeTruthy();
    expect(isOff(saveButton())).toBe(true);
  });

  it("refuses more values than the server takes, and values that are too long", async () => {
    await renderPanel(ssoSettings());
    type(claimName(), "tid");

    type(claimValues(), Array.from({ length: 21 }, (_, index) => `v${index}`).join("\n"));
    expect(screen.getByText("List at most 20 values.")).toBeTruthy();

    type(claimValues(), "v".repeat(129));
    expect(screen.getByText("A value can have at most 128 characters.")).toBeTruthy();
  });

  it("takes the error of a field away when it is put right, and Save comes on", async () => {
    await renderPanel(ssoSettings());
    type(claimName(), "tid");

    type(claimValues(), "aaa-111");

    expect(screen.queryByText("Enter at least one value, or clear the name.")).toBeNull();
    expect(claimValues()?.getAttribute("aria-invalid")).toBeNull();
    expect(isOff(saveButton())).toBe(false);
  });
});

describe("the Company SSO card, for a screen reader", () => {
  async function violations(): Promise<string[]> {
    // The colours are drawn by the stylesheet that jsdom does not load, so contrast is left to the check in a real browser.
    const result = await axe.run(ssoCard(), { rules: { "color-contrast": { enabled: false } } });
    return result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
  }

  it("has no violation with the fields empty, filled in or in error", async () => {
    await renderPanel(ssoSettings());
    expect(await violations()).toEqual([]);

    type(claimName(), "tid");
    type(claimValues(), "aaa-111");
    expect(await violations()).toEqual([]);

    type(claimValues(), "");
    expect(await violations()).toEqual([]);
  });
});
