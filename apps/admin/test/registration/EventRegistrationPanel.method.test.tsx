// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import type { RegistrationSettingsDto } from "../../src/api/types.js";
import { getTooltipText, isOff, plain } from "../test-utils.js";
import { api } from "./accessApiMocks.js";
import { PROVIDERS, settings, ssoEventSettings } from "./accessData.js";
import { card, radio, resetApi, saveButton } from "./accessFixtures.js";
import { renderPanel, resetPanelApi } from "./panelFixtures.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const { api: mocks } = await import("./accessApiMocks.js");
  return {
    ...(await importOriginal<typeof import("../../src/api/client.js")>()),
    fetchRegistrationSettings: (...args: unknown[]) => mocks.fetchRegistrationSettings(...args),
    saveRegistrationSettings: (...args: unknown[]) => mocks.saveRegistrationSettings(...args),
    fetchRegistrationReturnAddresses: (...args: unknown[]) => mocks.fetchRegistrationReturnAddresses(...args),
    saveCustomDomain: (...args: unknown[]) => mocks.saveCustomDomain(...args),
    checkCustomDomain: (...args: unknown[]) => mocks.checkCustomDomain(...args),
  };
});
vi.mock("../../src/connection/ConnectionStateProvider.js");
vi.mock("../../src/auth/login-navigation.js", () => ({ goToLogin: vi.fn() }));
vi.mock("@admitto/ui", async (importOriginal) => {
  const { addToast: toast } = await import("./accessApiMocks.js");
  return { ...(await importOriginal<typeof import("@admitto/ui")>()), useToast: () => ({ addToast: toast }) };
});

const NO_PROVIDER = "No identity provider is turned on. Add one under Identity.";
const ENTRA = { id: "idp-entra", state: "ready", display_name: "Contoso Entra", kind: "entra" } as const;
const ONLY_ENTRA = [PROVIDERS[0] as (typeof PROVIDERS)[number]];
const ONLY_GOOGLE = [PROVIDERS[1] as (typeof PROVIDERS)[number]];

const methodCard = () => card("Access method");
const ssoCard = () => card("Company SSO");
const ssoSettings = (overrides: Partial<RegistrationSettingsDto> = {}) => ssoEventSettings(overrides);
const isGreyed = (name: string) => (radio(name) as HTMLButtonElement).disabled;
const trigger = () => within(ssoCard()).getByRole("button", { name: /^Identity provider, / }) as HTMLButtonElement;
const noticeText = () => plain(ssoCard().querySelector(".access-provider .at-notice")?.textContent);
const pickProvider = (name: string) => {
  fireEvent.click(trigger());
  fireEvent.click(screen.getByRole("button", { name }));
};
const saved = (overrides: Partial<RegistrationSettingsDto>) => api.saveRegistrationSettings.mockResolvedValue(ssoSettings(overrides));

beforeEach(() => {
  resetApi();
  resetPanelApi();
});

afterEach(() => {
  cleanup();
});

describe("the access method of an event, in Event settings", () => {
  it("is the first card, named Access method, with one short instruction and the choice in the narrow group of the segmented control", async () => {
    await renderPanel(settings({ access_methods: [] }));

    expect([...document.querySelectorAll(".at-card__title")].map((title) => title.textContent)).toEqual(["Access method", "Company SSO", "Address for guests"]);
    expect(within(methodCard()).getByText("Choose the access method for the registration form.")).toBeTruthy();
    expect(within(methodCard()).getByRole("radiogroup", { name: "Access method" }).classList.contains("access-seg")).toBe(true);
    expect(methodCard().querySelector(".at-notice")).toBeNull();
  });

  it("says what each method means in one notice, with the bot check when it is on", async () => {
    await renderPanel(settings({ access_methods: [] }));

    const notice = () => methodCard().querySelectorAll(".at-notice");
    fireEvent.click(radio("Link"));
    expect([notice().length, notice()[0]?.textContent]).toEqual([1, "Anyone who has the link can ask to join. A bot check protects the form."]);
    fireEvent.click(radio("Password"));
    expect([notice().length, notice()[0]?.textContent]).toEqual([1, "Guests need the link and the event password to open the form. A bot check protects the form."]);
    fireEvent.click(radio("Company SSO"));
    expect(notice()[0]?.textContent).toBe("Guests sign in with the company's single sign-on (SSO), using their work account. Their email comes from that sign-in.");
  });

  it.each([
    ["link", "Anyone who has the link can ask to join."],
    ["password", "Guests need the link and the event password to open the form."],
  ] as const)("says nothing of a bot check for %s when bot protection is off, and says it when it is on", async (way, sentence) => {
    await renderPanel(settings({ access_methods: [way], bot_protection: "not_used" }));
    expect(methodCard().querySelector(".at-notice")?.textContent).toBe(sentence);
    cleanup();

    await renderPanel(settings({ access_methods: [way], bot_protection: "required" }));
    expect(methodCard().querySelector(".at-notice")?.textContent).toBe(`${sentence} A bot check protects the form.`);
  });

  it("leaves all three choosable when an identity provider is turned on, with no hover text", async () => {
    await renderPanel(settings());

    expect([isGreyed("Link"), isGreyed("Password"), isGreyed("Company SSO")]).toEqual([false, false, false]);
    for (const name of ["Link", "Password", "Company SSO"]) expect(getTooltipText(radio(name))).toBeNull();
  });

  it("is free of axe violations", async () => {
    await renderPanel(ssoSettings());

    const result = await axe.run(methodCard(), { rules: { "color-contrast": { enabled: false } } });

    expect(result.violations).toEqual([]);
  });
});

describe("Company SSO while no identity provider is turned on", () => {
  it("greys out Company SSO alone, with only a hover text that says where to add one", async () => {
    await renderPanel(settings({ sso_providers: [] }));

    expect([isGreyed("Link"), isGreyed("Password"), isGreyed("Company SSO")]).toEqual([false, false, true]);
    expect(getTooltipText(radio("Company SSO"))).toBe(NO_PROVIDER);
    expect(getTooltipText(radio("Link"))).toBeNull();
    expect(getTooltipText(radio("Password"))).toBeNull();
    const note = document.getElementById(radio("Company SSO").getAttribute("aria-describedby") ?? "none");
    expect(note?.textContent).toBe(NO_PROVIDER);
    expect(note?.className).toBe("sr-only");
  });

  it("does not change the method when the greyed one is pressed, and sends nothing", async () => {
    await renderPanel(settings({ sso_providers: [] }));

    fireEvent.click(radio("Company SSO"));

    expect(radio("Link").getAttribute("aria-checked")).toBe("true");
    expect(radio("Company SSO").getAttribute("aria-checked")).toBe("false");
    expect(isOff(saveButton())).toBe(true);
    expect(api.saveRegistrationSettings).not.toHaveBeenCalled();
  });

  it("keeps a chosen Company SSO chosen, greyed, with a grey picker and the way to Identity", async () => {
    await renderPanel(ssoSettings({ sso_providers: [], sso_provider_id: null, sso_provider: null }));

    expect(radio("Company SSO").getAttribute("aria-checked")).toBe("true");
    expect(isGreyed("Company SSO")).toBe(true);
    expect(isOff(saveButton())).toBe(true);
    expect(trigger().disabled).toBe(true);
    expect(within(ssoCard()).getByRole("link", { name: "Add one under Identity." }).getAttribute("href")).toBe("/admin/settings/identity/providers");
  });
});

describe("the identity provider of Company SSO, in Event settings", () => {
  it("is greyed with the other fields while the method is not Company SSO, and is offered when it is chosen", async () => {
    await renderPanel(settings());
    expect(trigger().disabled).toBe(true);
    expect(ssoCard().querySelector(".access-provider .at-notice")).toBeNull();

    fireEvent.click(radio("Company SSO"));

    expect(trigger().disabled).toBe(false);
    expect(trigger().getAttribute("aria-label")).toBe("Identity provider, none selected");
    expect((screen.getByLabelText("Claim name") as HTMLInputElement).disabled).toBe(false);
  });

  it("lists the providers that are turned on with the icon of their kind, and sets the one that is picked", async () => {
    await renderPanel(settings());
    fireEvent.click(radio("Company SSO"));

    fireEvent.click(trigger());
    const options = screen.getAllByRole("button", { name: /^Contoso / });
    expect(options.map((option) => option.getAttribute("aria-label"))).toEqual(["Contoso Entra", "Contoso Google"]);
    expect(options.map((option) => option.querySelector("i")?.className)).toEqual(["ti ti-brand-azure", "ti ti-brand-google"]);
    fireEvent.click(options[1] as HTMLElement);

    expect(trigger().getAttribute("aria-label")).toBe("Identity provider, Contoso Google");
  });

  it("sends the method and the provider together in one request", async () => {
    await renderPanel(settings());
    saved({});

    fireEvent.click(radio("Company SSO"));
    pickProvider("Contoso Entra");
    fireEvent.click(saveButton());

    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { access_methods: ["sso"], sso_provider_id: "idp-entra", expected_sso_provider_id: null }));
    await waitFor(() => expect(isOff(saveButton())).toBe(true));
  });

  it("sends the method, the provider and the restriction together, and nothing more once they are saved", async () => {
    await renderPanel(settings());
    saved({ sso_claim_name: "tid", sso_claim_values: ["aaa-111"] });

    fireEvent.click(radio("Company SSO"));
    pickProvider("Contoso Entra");
    fireEvent.change(screen.getByLabelText("Claim name"), { target: { value: "tid" } });
    fireEvent.change(screen.getByLabelText("Allowed values"), { target: { value: "aaa-111" } });
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { access_methods: ["sso"], sso_provider_id: "idp-entra", sso_claim_name: "tid", sso_claim_values: ["aaa-111"], expected_sso_provider_id: null }),
    );
    await waitFor(() => expect(isOff(saveButton())).toBe(true));
  });

  it("sends only the provider when only the provider changed", async () => {
    await renderPanel(ssoSettings());
    saved({ sso_provider_id: "idp-google", sso_provider: { ...ENTRA, id: "idp-google", display_name: "Contoso Google", kind: "google" } });

    pickProvider("Contoso Google");
    fireEvent.click(saveButton());

    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { sso_provider_id: "idp-google", expected_sso_provider_id: "idp-entra" }));
  });

  it("takes the provider of the answer of a save, so that one that is turned off meanwhile is marked", async () => {
    await renderPanel(settings({ sso_providers: ONLY_ENTRA }));
    saved({ sso_providers: ONLY_ENTRA, sso_provider_id: "idp-google", sso_provider: { id: "idp-google", state: "disabled", display_name: "Contoso Google", kind: "google" } });
    fireEvent.click(radio("Company SSO"));
    pickProvider("Contoso Entra");
    fireEvent.click(saveButton());

    await waitFor(() => expect(trigger().getAttribute("aria-label")).toBe("Identity provider, Contoso Google (turned off)"));
  });

  it("sends only the method when it is changed away from Company SSO, because the server clears the provider and the restriction", async () => {
    await renderPanel(ssoSettings({ sso_claim_name: "tid", sso_claim_values: ["aaa-111"] }));
    api.saveRegistrationSettings.mockResolvedValue(settings());

    pickProvider("Contoso Google");
    fireEvent.click(radio("Link"));
    fireEvent.click(saveButton());

    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { access_methods: ["link"], expected_sso_provider_id: "idp-entra" }));
    await waitFor(() => expect(screen.getByLabelText("Claim name")).toHaveProperty("disabled", true));
    expect((screen.getByLabelText("Claim name") as HTMLInputElement).value).toBe("");
  });

  it("changes nothing when the method that is chosen is pressed again: the provider and the claim in the form stay", async () => {
    await renderPanel(ssoSettings());
    pickProvider("Contoso Google");
    fireEvent.change(screen.getByLabelText("Claim name"), { target: { value: "tid" } });

    fireEvent.click(radio("Company SSO"));

    expect(trigger().getAttribute("aria-label")).toBe("Identity provider, Contoso Google");
    expect((screen.getByLabelText("Claim name") as HTMLInputElement).value).toBe("tid");
    // The same on a method that is only in the draft, with the provider that was picked for it.
    cleanup();
    await renderPanel(settings());
    fireEvent.click(radio("Company SSO"));
    pickProvider("Contoso Entra");
    fireEvent.click(radio("Company SSO"));
    expect(trigger().getAttribute("aria-label")).toBe("Identity provider, Contoso Entra");
  });

  it("empties the greyed picker and sends no provider after Link, Company SSO and Link again", async () => {
    await renderPanel(settings({ sso_providers: ONLY_ENTRA }));

    fireEvent.click(radio("Company SSO"));
    expect(trigger().getAttribute("aria-label")).toBe("Identity provider, Contoso Entra");
    fireEvent.click(radio("Link"));

    expect(trigger().disabled).toBe(true);
    expect(trigger().getAttribute("aria-label")).toBe("Identity provider, none selected");
    expect(isOff(saveButton())).toBe(true);
    expect(api.saveRegistrationSettings).not.toHaveBeenCalled();
  });

  it("brings the saved provider back when Company SSO is chosen again, sends nothing, and clears it for Link on save", async () => {
    await renderPanel(ssoSettings());

    fireEvent.click(radio("Link"));
    expect(trigger().getAttribute("aria-label")).toBe("Identity provider, none selected");
    fireEvent.click(radio("Company SSO"));
    expect(trigger().getAttribute("aria-label")).toBe("Identity provider, Contoso Entra");
    expect(isOff(saveButton())).toBe(true);

    api.saveRegistrationSettings.mockResolvedValue(settings());
    fireEvent.click(radio("Link"));
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { access_methods: ["link"], expected_sso_provider_id: "idp-entra" }));
  });

  it("takes the only provider by itself when Company SSO is chosen, and does not when there are two", async () => {
    await renderPanel(settings({ sso_providers: ONLY_ENTRA }));

    fireEvent.click(radio("Company SSO"));

    expect(trigger().getAttribute("aria-label")).toBe("Identity provider, Contoso Entra");
    cleanup();

    await renderPanel(settings());
    fireEvent.click(radio("Company SSO"));
    expect(trigger().getAttribute("aria-label")).toBe("Identity provider, none selected");
  });

  it("says that the form stays closed until a provider is chosen, and says nothing once one that is turned on is", async () => {
    await renderPanel(settings());
    fireEvent.click(radio("Company SSO"));

    expect(noticeText()).toBe("Choose an identity provider. Until you do, the form stays closed.");
    expect(ssoCard().querySelector(".access-provider .at-notice--warning")).not.toBeNull();

    pickProvider("Contoso Entra");
    expect(ssoCard().querySelector(".access-provider .at-notice")).toBeNull();
  });

  it("keeps a provider that was turned off in the list, marked, and says how to open the form again", async () => {
    await renderPanel(ssoSettings({ sso_providers: ONLY_GOOGLE, sso_provider: { ...ENTRA, state: "disabled" } as RegistrationSettingsDto["sso_provider"] }));

    expect(trigger().getAttribute("aria-label")).toBe("Identity provider, Contoso Entra (turned off)");
    expect(noticeText()).toBe("Contoso Entra is turned off, so the form stays closed. Choose another provider or turn it on under Identity.");
    expect(ssoCard().querySelector(".access-provider .at-notice--warning")).not.toBeNull();
    expect(isOff(saveButton())).toBe(true);
  });

  it("says that a provider that was deleted is gone, and offers the others", async () => {
    await renderPanel(ssoSettings({ sso_providers: ONLY_GOOGLE, sso_provider: { id: "idp-entra", state: "missing", display_name: null, kind: null } }));

    expect(noticeText()).toBe("The identity provider that was chosen no longer exists, so the form stays closed. Choose another one.");
    expect(trigger().getAttribute("aria-label")).toBe("Identity provider, none selected");
  });

  it("warns that guests who are filling in the form sign in again when the provider of a saved event changes, and not before", async () => {
    await renderPanel(ssoSettings());
    expect(noticeText()).not.toMatch(/sign in again/);

    pickProvider("Contoso Google");

    expect(noticeText()).toBe("Guests who are filling in the form will have to sign in again.");
    pickProvider("Contoso Entra");
    expect(noticeText()).not.toMatch(/sign in again/);
  });

  it("does not warn about signing in again when Company SSO is chosen for the first time", async () => {
    await renderPanel(settings());
    fireEvent.click(radio("Company SSO"));
    pickProvider("Contoso Entra");

    expect(noticeText()).not.toMatch(/sign in again/);
  });

  it("takes the form back to what is saved with Reset, and sends nothing", async () => {
    await renderPanel(ssoSettings());

    pickProvider("Contoso Google");
    fireEvent.click(radio("Link"));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(radio("Company SSO").getAttribute("aria-checked")).toBe("true");
    expect(trigger().getAttribute("aria-label")).toBe("Identity provider, Contoso Entra");
    expect(api.saveRegistrationSettings).not.toHaveBeenCalled();
  });

  it("reads the settings again when the server says that the provider is not available any more, and tells the person", async () => {
    await renderPanel(settings());
    api.saveRegistrationSettings.mockRejectedValue(new ApiError(422, "sso_provider_not_available"));
    fireEvent.click(radio("Company SSO"));
    pickProvider("Contoso Entra");
    api.fetchRegistrationSettings.mockClear();

    fireEvent.click(saveButton());

    await waitFor(() => expect(api.fetchRegistrationSettings).toHaveBeenCalled());
    expect((await screen.findByRole("alert")).textContent).toBe("This identity provider is not available. Choose another one.");
  });

  it("sends the provider that was last read, not the one in the form, with every save", async () => {
    await renderPanel(ssoSettings());
    saved({ sso_provider_id: "idp-google", sso_provider: { ...ENTRA, id: "idp-google", display_name: "Contoso Google", kind: "google" } });

    pickProvider("Contoso Google");
    fireEvent.click(saveButton());

    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { sso_provider_id: "idp-google", expected_sso_provider_id: "idp-entra" }));
  });

  it("keeps sending the provider the form was made from when a later read finds another one, so the save is refused and not applied to it", async () => {
    await renderPanel(ssoSettings());
    // Somebody else moves the event to Google; the address card reads the settings again.
    api.fetchRegistrationSettings.mockResolvedValue(ssoSettings({ sso_provider_id: "idp-google", sso_provider: { ...ENTRA, id: "idp-google", display_name: "Contoso Google", kind: "google" } }));
    api.saveCustomDomain.mockResolvedValue({ custom_domain: "events.example.com", custom_domain_status: "unchecked", custom_domain_check_result: null, custom_domain_verified_at: null, custom_domain_checked_at: null });
    fireEvent.change(screen.getByLabelText("Own address"), { target: { value: "events.example.com" } });
    fireEvent.click(within(card("Address for guests")).getByRole("button", { name: "Set address" }));
    await waitFor(() => expect(api.fetchRegistrationSettings).toHaveBeenCalledTimes(2));
    api.saveRegistrationSettings.mockRejectedValue(new ApiError(409, "sso_provider_changed"));

    fireEvent.change(screen.getByLabelText("Claim name"), { target: { value: "tid" } });
    fireEvent.change(screen.getByLabelText("Allowed values"), { target: { value: "a" } });
    await waitFor(() => expect(isOff(saveButton())).toBe(false));
    fireEvent.click(saveButton());

    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { sso_claim_name: "tid", sso_claim_values: ["a"], expected_sso_provider_id: "idp-entra" }));
  });

  it("sends the provider of the answer of the last save as the one that was read", async () => {
    await renderPanel(ssoSettings());
    saved({ sso_provider_id: "idp-google", sso_provider: { ...ENTRA, id: "idp-google", display_name: "Contoso Google", kind: "google" } });
    pickProvider("Contoso Google");
    fireEvent.click(saveButton());
    await waitFor(() => expect(isOff(saveButton())).toBe(true));
    api.saveRegistrationSettings.mockClear();
    saved({ sso_provider_id: "idp-google", sso_claim_name: "tid", sso_claim_values: ["a"] });

    fireEvent.change(screen.getByLabelText("Claim name"), { target: { value: "tid" } });
    fireEvent.change(screen.getByLabelText("Allowed values"), { target: { value: "a" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { sso_claim_name: "tid", sso_claim_values: ["a"], expected_sso_provider_id: "idp-google" }));
  });

  it("saves nothing, reads again, shows what is saved now and says why, when somebody else changed the provider meanwhile", async () => {
    await renderPanel(ssoSettings());
    api.saveRegistrationSettings.mockRejectedValue(new ApiError(409, "sso_provider_changed"));
    fireEvent.change(screen.getByLabelText("Claim name"), { target: { value: "tid" } });
    fireEvent.change(screen.getByLabelText("Allowed values"), { target: { value: "a" } });
    api.fetchRegistrationSettings.mockClear();
    api.fetchRegistrationSettings.mockResolvedValue(ssoSettings({ sso_provider_id: "idp-google", sso_provider: { ...ENTRA, id: "idp-google", display_name: "Contoso Google", kind: "google" } }));

    fireEvent.click(saveButton());

    expect((await screen.findByRole("alert")).textContent).toBe("The identity provider of this event was changed meanwhile. Reload the page and check the restriction.");
    await waitFor(() => expect(trigger().getAttribute("aria-label")).toBe("Identity provider, Contoso Google"));
    expect((screen.getByLabelText("Claim name") as HTMLInputElement).value).toBe("");
    expect(api.fetchRegistrationSettings).toHaveBeenCalledTimes(1);
    expect(api.saveRegistrationSettings).toHaveBeenCalledTimes(1);
    expect(isOff(saveButton())).toBe(true);

    // The next save carries the provider that was read again.
    api.saveRegistrationSettings.mockClear();
    api.saveRegistrationSettings.mockResolvedValue(ssoSettings({ sso_provider_id: "idp-google", sso_claim_name: "tid", sso_claim_values: ["a"] }));
    fireEvent.change(screen.getByLabelText("Claim name"), { target: { value: "tid" } });
    fireEvent.change(screen.getByLabelText("Allowed values"), { target: { value: "a" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { sso_claim_name: "tid", sso_claim_values: ["a"], expected_sso_provider_id: "idp-google" }));
  });

  it("is told when the server refuses a change of the access method because registration is not ready, and reads the settings again", async () => {
    await renderPanel(settings({ mode: "approval" }));
    api.saveRegistrationSettings.mockRejectedValue(new ApiError(409, "registration_not_ready"));
    fireEvent.click(radio("Password"));
    api.fetchRegistrationSettings.mockClear();

    fireEvent.click(saveButton());

    expect((await screen.findByRole("alert")).textContent).toBe("Registration needs something that is not set up yet. Set up what the list marks as missing, then try again.");
    await waitFor(() => expect(api.fetchRegistrationSettings).toHaveBeenCalled());
  });

  it("is free of axe violations with the provider chosen", async () => {
    await renderPanel(ssoSettings());

    const result = await axe.run(ssoCard(), { rules: { "color-contrast": { enabled: false } } });

    expect(result.violations).toEqual([]);
  });
});
