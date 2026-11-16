// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import type { RegistrationSettingsDto } from "../../src/api/types.js";
import { EventRegistrationPanel } from "../../src/registration/EventRegistrationPanel.js";
import { isOff, plain } from "../test-utils.js";
import { reportApiError } from "../../src/connection/__mocks__/ConnectionStateProvider.js";
import { addToast, api, refreshEvent } from "./accessApiMocks.js";
import { settings, ssoChecks, ssoEventSettings } from "./accessData.js";
import { card, resetApi } from "./accessFixtures.js";
import { onDirtyChange, onSavingChange, renderPanel, resetPanelApi, save } from "./panelFixtures.js";

const goToLogin = vi.fn();

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const { api: mocks } = await import("./accessApiMocks.js");
  return {
    ...(await importOriginal<typeof import("../../src/api/client.js")>()),
    fetchRegistrationSettings: (...args: unknown[]) => mocks.fetchRegistrationSettings(...args),
    saveRegistrationSettings: (...args: unknown[]) => mocks.saveRegistrationSettings(...args),
    fetchRegistrationSsoProvider: (...args: unknown[]) => mocks.fetchRegistrationSsoProvider(...args),
    saveCustomDomain: (...args: unknown[]) => mocks.saveCustomDomain(...args),
    checkCustomDomain: (...args: unknown[]) => mocks.checkCustomDomain(...args),
  };
});
vi.mock("../../src/connection/ConnectionStateProvider.js");
vi.mock("../../src/auth/login-navigation.js", () => ({ goToLogin: (...args: unknown[]) => goToLogin(...args) }));
vi.mock("@admitto/ui", async (importOriginal) => {
  const { addToast: toast } = await import("./accessApiMocks.js");
  return { ...(await importOriginal<typeof import("@admitto/ui")>()), useToast: () => ({ addToast: toast }) };
});

const ssoSettings = (overrides: Partial<RegistrationSettingsDto> = {}) => ssoEventSettings(overrides);
const restricted = (overrides: Partial<RegistrationSettingsDto> = {}) => ssoSettings({ sso_claim_name: "tid", sso_claim_values: ["aaa-111"], ...overrides });
const claimName = () => screen.queryByLabelText("Claim name") as HTMLInputElement | null;
const claimValues = () => screen.queryByLabelText("Allowed values") as HTMLTextAreaElement | null;
const type = (control: HTMLElement | null, value: string) => fireEvent.change(control as HTMLElement, { target: { value } });
const ssoCard = () => card("Company SSO");
const saveButton = () => screen.getByRole("button", { name: "Save" });

beforeEach(() => {
  resetApi();
  goToLogin.mockReset();
  resetPanelApi();
});

afterEach(() => {
  cleanup();
});

describe("the Company SSO card", () => {
  it("lets a superadmin choose the identity provider of the event, with the icon of its kind, above the claim", async () => {
    await renderPanel(ssoSettings());

    const trigger = within(ssoCard()).getByRole("button", { name: "Identity provider, Contoso Entra" }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(false);
    expect(trigger.querySelector("i")?.className).toContain("ti-brand-azure");
    expect(within(ssoCard()).getByText("The provider guests sign in with. Providers are set up under Identity.", { normalizer: plain })).toBeTruthy();
    // The provider and the claim name are the first two fields of the same grid, so they stand in one row.
    const parts = [...(ssoCard().querySelector(".mail-transport-section") as HTMLElement).children];
    expect(parts[0]?.className).toBe("access-provider");
    expect(parts[1]?.contains(claimName())).toBe(true);
  });

  it("shows two made-up GUIDs as the placeholder of the allowed values, not as a value", async () => {
    await renderPanel(ssoSettings());

    expect(claimValues()?.value).toBe("");
    expect(claimValues()?.placeholder).toBe("3f2c1a9e-5b7d-4c1e-9a2f-0123456789ab\n7b0e4d21-8a3c-4f6d-b1e5-9876543210fe");
  });

  it("says that no identity provider is chosen yet when the event has none, and shows the way to Identity when none is turned on", async () => {
    await renderPanel(ssoSettings({ sso_provider_id: null, sso_provider: null }));
    expect(within(ssoCard()).getByRole("button", { name: "Identity provider, none selected" })).toBeTruthy();
    expect(plain(ssoCard().querySelector(".access-provider .at-notice")?.textContent)).toBe("Choose an identity provider. Until you do, the form stays closed.");
    cleanup();

    await renderPanel(ssoSettings({ sso_provider_id: null, sso_provider: null, sso_providers: [] }));
    expect(within(ssoCard()).getByRole("link", { name: "Add one under Identity." }).getAttribute("href")).toBe("/admin/settings/identity/providers");
    expect((within(ssoCard()).getByRole("button", { name: "Identity provider, none selected" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("marks a provider that is turned off, and keeps the provider fields grey and notice free for an event that does not use Company SSO", async () => {
    await renderPanel(ssoSettings({ sso_providers: [{ id: "idp-google", display_name: "Contoso Google", kind: "google" }], sso_provider: { id: "idp-entra", state: "disabled", display_name: "Contoso Entra", kind: "entra" } }));
    expect(within(ssoCard()).getByRole("button", { name: "Identity provider, Contoso Entra (turned off)" })).toBeTruthy();
    cleanup();

    await renderPanel(settings({ access_methods: ["link"] }));
    expect((within(ssoCard()).getByRole("button", { name: /^Identity provider, / }) as HTMLButtonElement).disabled).toBe(true);
    expect(ssoCard().querySelector(".access-provider .at-notice")).toBeNull();
  });

  it("takes the list of providers from the answer of a save of the claim, so a provider turned off meanwhile is marked and the form is said to be closed", async () => {
    await renderPanel(ssoSettings());
    api.saveRegistrationSettings.mockResolvedValue(
      ssoSettings({
        sso_claim_name: "tid",
        sso_claim_values: ["aaa-111"],
        sso_providers: [{ id: "idp-google", display_name: "Contoso Google", kind: "google" }],
        sso_provider: { id: "idp-entra", state: "disabled", display_name: "Contoso Entra", kind: "entra" },
      }),
    );
    type(claimName(), "tid");
    type(claimValues(), "aaa-111");

    await save();

    await waitFor(() => expect(within(ssoCard()).getByRole("button", { name: "Identity provider, Contoso Entra (turned off)" })).toBeTruthy());
    expect(plain(ssoCard().querySelector(".access-provider .at-notice--warning")?.textContent)).toMatch(/^Contoso Entra is turned off, so the form stays closed\./);
  });

  it("reads the provider from the settings of the event, and still works, when the return addresses cannot be read", async () => {
    api.fetchRegistrationSsoProvider.mockRejectedValue(new ApiError(500, "internal_error"));
    await renderPanel(ssoSettings());

    expect(within(ssoCard()).getByRole("button", { name: "Identity provider, Contoso Entra" })).toBeTruthy();
    expect(claimName()).toBeTruthy();
  });

  it("says that the return addresses could not be read, with a Retry that reads them again, and never says that the instance has no address", async () => {
    api.fetchRegistrationSsoProvider.mockRejectedValueOnce(new ApiError(500, "internal_error"));
    await renderPanel(ssoSettings());
    fireEvent.click(within(ssoCard()).getByRole("button", { name: "Setup for your IT team" }));

    expect(within(ssoCard()).getByText("Could not read the return addresses.")).toBeTruthy();
    expect(within(ssoCard()).queryByText(/has no return address|not set/)).toBeNull();
    expect(within(ssoCard()).queryByLabelText("Return address")).toBeNull();
    api.fetchRegistrationSsoProvider.mockResolvedValue({
      provider_id: "idp-1",
      state: "ready",
      providers: [{ id: "idp-1", display_name: "Acme Entra ID", kind: "entra" }],
      redirect_uri: null,
      redirect_uris: [{ uri: "https://admitto.example.com/sso/callback", host: "instance", verified: true }],
    });

    fireEvent.click(within(ssoCard()).getByRole("button", { name: "Retry reading the return addresses" }));

    await waitFor(() => expect((within(ssoCard()).getByLabelText("Return address") as HTMLInputElement).value).toBe("https://admitto.example.com/sso/callback"));
    expect(within(ssoCard()).queryByText("Could not read the return addresses.")).toBeNull();
    expect(api.fetchRegistrationSsoProvider).toHaveBeenCalledTimes(2);
  });

  it("keeps the failure, and the Retry, when the Retry fails too, and sends a lost session to the sign-in", async () => {
    api.fetchRegistrationSsoProvider.mockRejectedValue(new ApiError(500, "internal_error"));
    await renderPanel(ssoSettings());
    fireEvent.click(within(ssoCard()).getByRole("button", { name: "Setup for your IT team" }));

    fireEvent.click(within(ssoCard()).getByRole("button", { name: "Retry reading the return addresses" }));
    await waitFor(() => expect(api.fetchRegistrationSsoProvider).toHaveBeenCalledTimes(2));
    expect(within(ssoCard()).getByText("Could not read the return addresses.")).toBeTruthy();

    api.fetchRegistrationSsoProvider.mockRejectedValue(new ApiError(401, "unauthorized"));
    fireEvent.click(within(ssoCard()).getByRole("button", { name: "Retry reading the return addresses" }));
    await waitFor(() => expect(goToLogin).toHaveBeenCalled());
  });

  it("explains the restriction: what a claim is, the claim and its values, tid, exact matching, never an address, and empty for none", async () => {
    await renderPanel(ssoSettings());
    const text = plain(ssoCard().textContent);

    expect(text).toMatch(/Limit who can register\. The identity provider tells us facts about each guest, called claims\./);
    expect(text).toMatch(/Name a claim and list the values that may register\./);
    expect(text).toMatch(/Example: the claim tid with the ID of your company, so only people of that company can register\./);
    expect(text).toMatch(/A claim that holds a list, such as groups, works too: a guest who is in any listed group can register\./);
    expect(text).toMatch(/Leave both fields empty for no limit\./);
    expect(text).toMatch(/The name of the fact to check, for example tid\./);
    expect(text).toMatch(/The grey lines are an example, not values\./);
    expect(text).toMatch(/Values must match exactly, capital letters too\./);
    expect(text).toMatch(/Never use the end of an email address/);
    expect(text).not.toMatch(/[–—]/);
  });

  it("shows the same fields, grey and with Save off, for an event whose way is not the company SSO, with the sentence that says where to choose it", async () => {
    await renderPanel(settings({ access_methods: ["link"] }));

    expect(claimName()?.disabled).toBe(true);
    expect(claimValues()?.disabled).toBe(true);
    expect(isOff(saveButton())).toBe(true);
    const notice = ssoCard().querySelector(".at-notice--info") as HTMLElement;
    expect(plain(notice.textContent)).toBe("This event does not use Company SSO, so these fields are off. To use it, choose Company SSO under Access method, above.");
    // The explanation comes first, then the notice, then the fields.
    const parts = [...(ssoCard().querySelector(".access-claim") as HTMLElement).children];
    expect(parts.map((part) => part.className.split(" ")[0])).toEqual(["settings-card-intro", "at-notice", "mail-transport-section"]);
  });

  it("does not react to typing in the grey fields, and says nothing of the way for an event that uses the company SSO", async () => {
    await renderPanel(settings({ access_methods: ["link"] }));
    type(claimName(), "tid");
    type(claimValues(), "aaa-111");
    expect(isOff(saveButton())).toBe(true);
    cleanup();

    await renderPanel(ssoSettings());
    expect(ssoCard().querySelector(".access-claim > .at-notice")).toBeNull();
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

    expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { sso_claim_name: "tid", sso_claim_values: ["aaa-111", "bbb-222"], expected_sso_provider_id: "idp-entra" });
    await waitFor(() => expect(claimValues()?.value).toBe("aaa-111\nbbb-222"));
    expect(addToast).toHaveBeenCalledWith("Registration settings saved.", "success");
    expect(isOff(saveButton())).toBe(true);
  });

  it("sends the name too when only the values changed, since the server takes the two together", async () => {
    await renderPanel(restricted());
    api.saveRegistrationSettings.mockResolvedValue(restricted({ sso_claim_values: ["aaa-111", "ccc-333"] }));

    type(claimValues(), "aaa-111\nccc-333");
    await save();

    expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { sso_claim_name: "tid", sso_claim_values: ["aaa-111", "ccc-333"], expected_sso_provider_id: "idp-entra" });
  });

  it("takes the restriction away with null and an empty list when both fields are cleared", async () => {
    await renderPanel(restricted());
    api.saveRegistrationSettings.mockResolvedValue(ssoSettings());

    type(claimName(), "");
    type(claimValues(), "");
    await save();

    expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { sso_claim_name: null, sso_claim_values: [], expected_sso_provider_id: "idp-entra" });
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
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
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
    expect(alert.textContent).toContain("The restriction to one company works with Company SSO only.");
    expect(alert.textContent).not.toContain("sso_claim_needs_sso");
  });
});

describe("the address card and the typed restriction", () => {
  const DOMAIN = "summit.acme.example";
  const own = { domain: DOMAIN, status: "unchecked" as const, check_result: null, verified: false, checked_at: null };
  const state = { custom_domain: DOMAIN, custom_domain_status: "unchecked" as const, custom_domain_check_result: null, custom_domain_verified_at: null, custom_domain_checked_at: null };

  it.each([
    ["Set address", () => api.saveCustomDomain.mockResolvedValue(state), settings, "Set address"],
    ["Check now", () => api.checkCustomDomain.mockResolvedValue(state), () => settings({ own_address: own }), "Check now"],
    ["Remove", () => api.saveCustomDomain.mockResolvedValue({ ...state, custom_domain: null }), () => settings({ own_address: own }), "Remove"],
  ])("keeps an unsaved claim, and Unsaved changes, when %s is used on the address card and the settings are read again", async (_what, mock, make, button) => {
    mock();
    await renderPanel(ssoSettings({ ...make(), access_methods: ["sso"], readiness: ssoChecks() }));
    api.fetchRegistrationSettings.mockResolvedValue(ssoSettings({ own_address: button === "Remove" ? null : own }));
    type(claimName(), "tid");
    type(claimValues(), "aaa-111");
    if (button === "Set address") fireEvent.change(screen.getByLabelText("Own address"), { target: { value: DOMAIN } });

    fireEvent.click(within(card("Address for guests")).getByRole("button", { name: button }));
    if (button === "Remove") fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(api.fetchRegistrationSettings).toHaveBeenCalledTimes(2));
    // The settings that were read again are on screen by now.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(claimName()?.value).toBe("tid");
    expect(claimValues()?.value).toBe("aaa-111");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it("does not take a restriction that somebody else changed meanwhile for an edit, when the address card reads the settings again", async () => {
    api.saveCustomDomain.mockResolvedValue(state);
    await renderPanel(restricted());
    api.fetchRegistrationSettings.mockResolvedValue(restricted({ own_address: own, sso_claim_name: "groups", sso_claim_values: ["staff"] }));
    fireEvent.change(screen.getByLabelText("Own address"), { target: { value: DOMAIN } });

    fireEvent.click(within(card("Address for guests")).getByRole("button", { name: "Set address" }));
    await waitFor(() => expect(api.fetchRegistrationSettings).toHaveBeenCalledTimes(2));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));

    // The address is what was read again; the restriction is what the person saw.
    expect(await within(card("Address for guests")).findByText(`${DOMAIN}: Not checked yet`)).toBeTruthy();
    // The person did not touch the restriction: it is not a change, and Save has nothing of it to send.
    expect(claimName()?.value).toBe("tid");
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    expect(isOff(saveButton())).toBe(true);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(saveButton());
    expect(api.saveRegistrationSettings).not.toHaveBeenCalled();
  });

  it("takes an edit back, with Reset, to the restriction the person saw, not to the one another superadmin set meanwhile", async () => {
    api.saveCustomDomain.mockResolvedValue(state);
    await renderPanel(restricted());
    api.fetchRegistrationSettings.mockResolvedValue(restricted({ own_address: own, sso_claim_name: "groups", sso_claim_values: ["staff"] }));
    fireEvent.change(screen.getByLabelText("Own address"), { target: { value: DOMAIN } });
    fireEvent.click(within(card("Address for guests")).getByRole("button", { name: "Set address" }));
    await waitFor(() => expect(api.fetchRegistrationSettings).toHaveBeenCalledTimes(2));
    type(claimValues(), "aaa-111\nbbb-222");

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(claimName()?.value).toBe("tid");
    expect(claimValues()?.value).toBe("aaa-111");
  });

  it("blocks the address card while the restriction is being saved, and does not send what is tried", async () => {
    await renderPanel(ssoSettings({ own_address: own }));
    let finish: (answer: RegistrationSettingsDto) => void = () => undefined;
    api.saveRegistrationSettings.mockReturnValue(new Promise<RegistrationSettingsDto>((resolve) => (finish = resolve)));
    type(claimName(), "tid");
    type(claimValues(), "aaa-111");

    fireEvent.click(saveButton());
    await waitFor(() => expect(onSavingChange).toHaveBeenLastCalledWith(true));

    const addressCard = card("Address for guests");
    fireEvent.change(screen.getByLabelText("Own address"), { target: { value: "other.acme.example" } });
    expect((screen.getByLabelText("Own address") as HTMLInputElement).disabled).toBe(true);
    for (const name of ["Set address", "Check now", "Remove"]) {
      expect(isOff(within(addressCard).getByRole("button", { name }))).toBe(true);
      fireEvent.click(within(addressCard).getByRole("button", { name }));
    }
    expect(api.saveCustomDomain).not.toHaveBeenCalled();
    expect(api.checkCustomDomain).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    finish(ssoSettings({ own_address: own, sso_claim_name: "tid", sso_claim_values: ["aaa-111"] }));
    await waitFor(() => expect((screen.getByLabelText("Own address") as HTMLInputElement).disabled).toBe(false));
  });

  it("blocks the Save and Reset of the restriction while an address request is out", async () => {
    let finish: (value: unknown) => void = () => undefined;
    api.checkCustomDomain.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await renderPanel(ssoSettings({ own_address: own }));
    type(claimName(), "tid");
    type(claimValues(), "aaa-111");

    fireEvent.click(within(card("Address for guests")).getByRole("button", { name: "Check now" }));
    await waitFor(() => expect(onSavingChange).toHaveBeenLastCalledWith(true));

    expect(isOff(saveButton())).toBe(true);
    expect(isOff(screen.getByRole("button", { name: "Reset" }))).toBe(true);
    fireEvent.click(saveButton());
    expect(api.saveRegistrationSettings).not.toHaveBeenCalled();
    finish(state);
    await waitFor(() => expect(isOff(saveButton())).toBe(false));
  });

  it("does not take the address back to what the save of the restriction knew, when the address was saved first", async () => {
    api.saveCustomDomain.mockResolvedValue(state);
    await renderPanel(ssoSettings());
    fireEvent.change(screen.getByLabelText("Own address"), { target: { value: DOMAIN } });
    api.fetchRegistrationSettings.mockResolvedValue(ssoSettings({ own_address: own }));
    fireEvent.click(within(card("Address for guests")).getByRole("button", { name: "Set address" }));
    await waitFor(() => expect(api.fetchRegistrationSettings).toHaveBeenCalledTimes(2));
    expect(await within(card("Address for guests")).findByText(`${DOMAIN}: Not checked yet`)).toBeTruthy();
    // The answer of the save is made of what the server knew before the address: no address.
    api.saveRegistrationSettings.mockResolvedValue(ssoSettings({ own_address: null, sso_claim_name: "tid", sso_claim_values: ["aaa-111"] }));
    type(claimName(), "tid");
    type(claimValues(), "aaa-111");

    await save();
    await waitFor(() => expect(screen.queryByText("Unsaved changes")).toBeNull());

    expect(within(card("Address for guests")).getByText(`${DOMAIN}: Not checked yet`)).toBeTruthy();
    expect((screen.getByLabelText("Own address") as HTMLInputElement).value).toBe(DOMAIN);
    expect(claimName()?.value).toBe("tid");
  });

  it("still saves the typed claim after the address card was used", async () => {
    api.saveCustomDomain.mockResolvedValue(state);
    await renderPanel(ssoSettings());
    api.fetchRegistrationSettings.mockResolvedValue(ssoSettings({ own_address: own }));
    type(claimName(), "tid");
    type(claimValues(), "aaa-111");
    fireEvent.change(screen.getByLabelText("Own address"), { target: { value: DOMAIN } });
    fireEvent.click(within(card("Address for guests")).getByRole("button", { name: "Set address" }));
    await waitFor(() => expect(api.fetchRegistrationSettings).toHaveBeenCalledTimes(2));
    api.saveRegistrationSettings.mockResolvedValue(ssoSettings({ own_address: own, sso_claim_name: "tid", sso_claim_values: ["aaa-111"] }));

    await save();

    expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { sso_claim_name: "tid", sso_claim_values: ["aaa-111"], expected_sso_provider_id: "idp-entra" });
  });
});

describe("the requests of the address card, for the page", () => {
  it.each([
    ["Set address", (resolve: (value: unknown) => void) => api.saveCustomDomain.mockReturnValue(new Promise(resolve)), "Set address"],
    ["Check now", (resolve: (value: unknown) => void) => api.checkCustomDomain.mockReturnValue(new Promise(resolve)), "Check now"],
  ])("tells the page that a request is out while %s runs, and that it is over", async (_what, hold, button) => {
    let finish: (value: unknown) => void = () => undefined;
    hold((resolve) => (finish = resolve));
    await renderPanel(ssoSettings({ own_address: { domain: "summit.acme.example", status: "unchecked", check_result: null, verified: false, checked_at: null } }));
    if (button === "Set address") fireEvent.change(screen.getByLabelText("Own address"), { target: { value: "other.acme.example" } });

    fireEvent.click(within(card("Address for guests")).getByRole("button", { name: button }));

    await waitFor(() => expect(onSavingChange).toHaveBeenLastCalledWith(true));
    finish({ custom_domain: "other.acme.example", custom_domain_status: "unchecked", custom_domain_check_result: null, custom_domain_verified_at: null, custom_domain_checked_at: null });
    await waitFor(() => expect(onSavingChange).toHaveBeenLastCalledWith(false));
  });

  it("keeps the page told that a save is out while the claim saves and an address request has ended", async () => {
    await renderPanel(ssoSettings());
    let finish: (answer: RegistrationSettingsDto) => void = () => undefined;
    api.saveRegistrationSettings.mockReturnValue(new Promise<RegistrationSettingsDto>((resolve) => (finish = resolve)));
    type(claimName(), "tid");
    type(claimValues(), "aaa-111");

    fireEvent.click(saveButton());
    await waitFor(() => expect(onSavingChange).toHaveBeenLastCalledWith(true));
    finish(ssoSettings({ sso_claim_name: "tid", sso_claim_values: ["aaa-111"] }));

    await waitFor(() => expect(onSavingChange).toHaveBeenLastCalledWith(false));
  });
});

describe("reading the tab", () => {
  it("is an error with a Retry when the settings cannot be read, tells the connection state, and loads when the Retry works", async () => {
    api.fetchRegistrationSettings.mockRejectedValueOnce(new ApiError(500, "internal_error", "internal_error"));
    api.fetchRegistrationSettings.mockResolvedValue(ssoSettings());
    render(<EventRegistrationPanel eventId="evt-1" archived={false} refreshEvent={refreshEvent} />);

    expect((await screen.findByRole("alert")).textContent).toMatch(/Could not load the registration settings|Something went wrong/);
    expect(reportApiError).toHaveBeenCalledWith(500);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByLabelText("Own address")).toBeTruthy();
    expect(claimName()).toBeTruthy();
  });

  it("hands a lost session to the sign-in when the name of the provider cannot be read for want of one", async () => {
    api.fetchRegistrationSsoProvider.mockRejectedValue(new ApiError(401, "unauthorized"));
    api.fetchRegistrationSettings.mockResolvedValue(ssoSettings());
    render(<EventRegistrationPanel eventId="evt-1" archived={false} refreshEvent={refreshEvent} />);

    await waitFor(() => expect(goToLogin).toHaveBeenCalled());
  });

  it("keeps what the cards show when the settings cannot be read again after the event turned out to be archived", async () => {
    await renderPanel(ssoSettings());
    api.saveRegistrationSettings.mockRejectedValue(new ApiError(403, "event_archived", "event_archived"));
    api.fetchRegistrationSettings.mockRejectedValue(new ApiError(500, "internal_error"));

    type(claimName(), "tid");
    type(claimValues(), "aaa-111");
    await save();

    await screen.findByRole("alert");
    await waitFor(() => expect(api.fetchRegistrationSettings).toHaveBeenCalledTimes(2));
    expect(claimName()?.value).toBe("tid");
  });
});

describe("the Save and Reset of the tab", () => {
  it("shows Unsaved changes with the first edit, tells the page, and takes the edit back with Reset", async () => {
    await renderPanel(restricted());
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);

    type(claimValues(), "aaa-111\nbbb-222");

    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(claimValues()?.value).toBe("aaa-111");
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(api.saveRegistrationSettings).not.toHaveBeenCalled();
  });

  it("tells the page that a save is running, and that it is over", async () => {
    await renderPanel(restricted());
    let finish: (answer: RegistrationSettingsDto) => void = () => undefined;
    api.saveRegistrationSettings.mockReturnValue(new Promise<RegistrationSettingsDto>((resolve) => (finish = resolve)));

    type(claimValues(), "aaa-111\nbbb-222");
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSavingChange).toHaveBeenLastCalledWith(true));
    finish(restricted({ sso_claim_values: ["aaa-111", "bbb-222"] }));

    await waitFor(() => expect(onSavingChange).toHaveBeenLastCalledWith(false));
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("keeps the text of an edit and says why when the save fails", async () => {
    await renderPanel(restricted());
    api.saveRegistrationSettings.mockRejectedValue(new ApiError(500, "internal_error", "internal_error"));

    type(claimValues(), "aaa-111\nbbb-222");
    await save();

    expect((await screen.findByRole("alert")).textContent).toMatch(/Something went wrong/);
    expect(claimValues()?.value).toBe("aaa-111\nbbb-222");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });

  it("works without a way to read the event again when the save is refused because the event is archived", async () => {
    await renderPanel(ssoSettings(), { withRefresh: false });
    api.saveRegistrationSettings.mockRejectedValue(new ApiError(403, "event_archived", "event_archived"));

    type(claimName(), "tid");
    type(claimValues(), "aaa-111");
    await save();

    await screen.findByRole("alert");
    expect(refreshEvent).not.toHaveBeenCalled();
  });
});

describe("what is wrong with the restriction", () => {
  it("names the missing value when only the name is typed, in the field, and says why nothing was saved when Save is pressed", async () => {
    await renderPanel(ssoSettings());

    type(claimName(), "tid");
    expect(screen.getByText("Enter at least one value, or clear the name.")).toBeTruthy();
    expect(claimValues()?.getAttribute("aria-invalid")).toBe("true");
    fireEvent.click(saveButton());

    expect((await screen.findByRole("alert")).textContent).toBe("Fix the restriction to one company before you save.");
    expect(api.saveRegistrationSettings).not.toHaveBeenCalled();
    type(claimValues(), "aaa-111");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("names the missing claim when only values are typed", async () => {
    await renderPanel(ssoSettings());

    type(claimValues(), "aaa-111");

    expect(screen.getByText("Enter the name of the claim these values belong to.")).toBeTruthy();
    expect(claimName()?.getAttribute("aria-invalid")).toBe("true");
  });

  it("refuses a name with a space and says what a name may hold", async () => {
    await renderPanel(ssoSettings());

    type(claimName(), "my claim");
    type(claimValues(), "aaa-111");

    expect(screen.getByText("The name has letters, digits and signs only, with no spaces.")).toBeTruthy();
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
