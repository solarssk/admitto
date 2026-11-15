// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDENTITY_PROVIDERS_ROUTE } from "../../src/identity/routes.js";
import { ApiError } from "../../src/api/client.js";
import type { RegistrationSettingsDto, RoleAssignment } from "../../src/api/types.js";
import { getTooltipText, isOff, plain } from "../test-utils.js";
import { api } from "./accessApiMocks.js";
import { PROVIDERS, settings, ssoChecks, ssoEventSettings } from "./accessData.js";
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
const NO_PROVIDER_ORGANISER = "No identity provider is set up. Ask a superadmin to set up an identity provider.";
const NO_PROVIDER_SUPERADMIN = "No identity provider is turned on. Add one under Identity.";

const wayInCard = () => card("Access method");
const ssoSettings = (overrides: Partial<RegistrationSettingsDto> = {}) => ssoEventSettings(overrides);
const isGreyed = (name: string) => (radio(name) as HTMLButtonElement).disabled;
const providerTrigger = () => within(wayInCard()).getByRole("button", { name: /^Identity provider, / });
const noticeText = () => plain(wayInCard().querySelector(".at-notice")?.textContent);
const pickProvider = (name: string) => {
  fireEvent.click(providerTrigger());
  fireEvent.click(screen.getByRole("button", { name }));
};
const ENTRA: RegistrationSettingsDto["sso_provider"] = { id: "idp-entra", state: "ready", display_name: "Contoso Entra", kind: "entra" };

beforeEach(() => {
  resetApi();
  assignments = [ORG_ADMIN];
});

afterEach(() => {
  cleanup();
});

describe("Company SSO while no identity provider is turned on", () => {
  it("leaves all three choosable when there is a provider, with no hover text", async () => {
    await renderLoaded(settings());

    expect([isGreyed("Link"), isGreyed("Password"), isGreyed("Company SSO")]).toEqual([false, false, false]);
    for (const name of ["Link", "Password", "Company SSO"]) expect(getTooltipText(radio(name))).toBeNull();
  });

  it("greys out Company SSO alone, with only a hover text, and tells an administrator to ask a superadmin", async () => {
    await renderLoaded(settings({ sso_providers: [] }));

    expect([isGreyed("Link"), isGreyed("Password"), isGreyed("Company SSO")]).toEqual([false, false, true]);
    expect(getTooltipText(radio("Company SSO"))).toBe(NO_PROVIDER_ORGANISER);
    expect(getTooltipText(radio("Link"))).toBeNull();
    expect(getTooltipText(radio("Password"))).toBeNull();
    expect(within(wayInCard()).queryByRole("link")).toBeNull();
  });

  it("tells a superadmin where to add one, in the same hover text", async () => {
    assignments = [SUPERADMIN];
    await renderLoaded(settings({ sso_providers: [] }));

    expect(getTooltipText(radio("Company SSO"))).toBe(NO_PROVIDER_SUPERADMIN);
  });

  it("describes the greyed method to a screen reader with the same text, kept out of sight", async () => {
    await renderLoaded(settings({ sso_providers: [] }));

    const note = document.getElementById(radio("Company SSO").getAttribute("aria-describedby") ?? "none");
    expect(note?.textContent).toBe(NO_PROVIDER_ORGANISER);
    expect(note?.className).toBe("sr-only");
    expect(radio("Link").getAttribute("aria-describedby")).toBeNull();
  });

  it("does not change the method when the greyed one is pressed, and sends nothing", async () => {
    await renderLoaded(settings({ sso_providers: [] }));

    fireEvent.click(radio("Company SSO"));

    expect(radio("Link").getAttribute("aria-checked")).toBe("true");
    expect(radio("Company SSO").getAttribute("aria-checked")).toBe("false");
    expect(isOff(saveButton())).toBe(true);
    expect(api.saveRegistrationSettings).not.toHaveBeenCalled();
  });

  it("keeps a chosen Company SSO chosen, greyed, and says under it who sets providers up", async () => {
    await renderLoaded(ssoSettings({ sso_providers: [], sso_provider_id: null, sso_provider: null }));

    expect(radio("Company SSO").getAttribute("aria-checked")).toBe("true");
    expect(isGreyed("Company SSO")).toBe(true);
    expect(isOff(saveButton())).toBe(true);
    expect(within(wayInCard()).getByText(NO_PROVIDER_ORGANISER, { selector: "p" })).toBeTruthy();
    expect((providerTrigger() as HTMLButtonElement).disabled).toBe(true);
  });

  it("gives a superadmin the way to Identity under a chosen Company SSO", async () => {
    assignments = [SUPERADMIN];
    await renderLoaded(ssoSettings({ sso_providers: [], sso_provider_id: null, sso_provider: null }));

    const link = within(wayInCard()).getByRole("link", { name: "Add one under Identity." });
    expect(link.getAttribute("href")).toBe(IDENTITY_PROVIDERS_ROUTE);
    expect(wayInCard().querySelector(".access-provider .settings-card-intro")?.textContent).toBe(NO_PROVIDER_SUPERADMIN);
  });

  it("does not read the list of enabled methods any more: a settings answer without it greys nothing", async () => {
    const { enabled_access_methods: _gone, ...without } = settings();
    await renderLoaded(without as RegistrationSettingsDto);

    expect([isGreyed("Link"), isGreyed("Password"), isGreyed("Company SSO")]).toEqual([false, false, false]);
  });

  it("is free of axe violations with Company SSO greyed", async () => {
    await renderLoaded(settings({ sso_providers: [] }));

    const result = await axe.run(wayInCard(), { rules: { "color-contrast": { enabled: false } } });

    expect(result.violations).toEqual([]);
  });
});

describe("the card of the access method", () => {
  it("is named Access method, with one short instruction, and the choice is in the narrow group of the segmented control", async () => {
    await renderLoaded(settings({ access_methods: [] }));

    expect(within(wayInCard()).getByText("Choose how guests open the registration form.")).toBeTruthy();
    expect(wayInCard().textContent).not.toMatch(/Way in/);
    expect(within(wayInCard()).getByRole("radiogroup", { name: "Access method" }).classList.contains("access-seg")).toBe(true);
    expect(wayInCard().querySelector(".at-notice")).toBeNull();
  });

  it("says what the link and the password mean in one notice, with the bot check when it is on", async () => {
    await renderLoaded(settings({ access_methods: [] }));

    const notice = () => wayInCard().querySelectorAll(".at-notice");
    fireEvent.click(radio("Link"));
    expect([notice().length, notice()[0]?.textContent]).toEqual([1, "Anyone who has the link can ask to join. A bot check protects the form."]);
    fireEvent.click(radio("Password"));
    expect([notice().length, notice()[0]?.textContent]).toEqual([1, "Guests need the link and the event password to open the form. A bot check protects the form."]);
  });

  it.each([
    ["link", "Anyone who has the link can ask to join."],
    ["password", "Guests need the link and the event password to open the form."],
  ] as const)("says nothing of a bot check for %s when a superadmin switched it off, and says it when it is on", async (way, sentence) => {
    await renderLoaded(settings({ access_methods: [way], bot_protection: "not_used" }));
    expect(wayInCard().querySelector(".at-notice")?.textContent).toBe(sentence);
    cleanup();

    await renderLoaded(settings({ access_methods: [way], bot_protection: "required" }));
    expect(wayInCard().querySelector(".at-notice")?.textContent).toBe(`${sentence} A bot check protects the form.`);
  });

  it("does not mention a bot check for Company SSO in either state, and has one notice, about the provider", async () => {
    await renderLoaded(ssoSettings({ bot_protection: "not_used" }));
    expect(wayInCard().querySelectorAll(".at-notice")).toHaveLength(1);
    expect(noticeText()).toBe("Guests sign in with their work account. Their email comes from that sign-in.");
  });

  it("moves from a password to the link after the person confirms, and sends only the method", async () => {
    await renderLoaded(settings({ access_methods: ["password"], password_set: true }));
    api.saveRegistrationSettings.mockResolvedValue(settings({ access_methods: ["link"] }));

    fireEvent.click(radio("Link"));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Remove the event password?" })).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(radio("Link").getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(saveButton());

    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { access_methods: ["link"] }));
  });
});

describe("the identity provider of Company SSO", () => {
  it("is not offered for the link or the password, and is offered when Company SSO is chosen", async () => {
    await renderLoaded(settings());
    expect(within(wayInCard()).queryByText("Identity provider")).toBeNull();

    fireEvent.click(radio("Company SSO"));

    expect(within(wayInCard()).getByText("Identity provider")).toBeTruthy();
    expect(within(wayInCard()).getByText("The provider guests sign in with. A superadmin sets providers up under Identity.", { normalizer: plain })).toBeTruthy();
    expect(providerTrigger().getAttribute("aria-label")).toBe("Identity provider, none selected");
  });

  it("lists the providers that are turned on with the icon of their kind, and sets the one that is picked", async () => {
    await renderLoaded(settings());
    fireEvent.click(radio("Company SSO"));

    fireEvent.click(providerTrigger());
    const options = screen.getAllByRole("button", { name: /^Contoso / });
    expect(options.map((option) => option.getAttribute("aria-label"))).toEqual(["Contoso Entra", "Contoso Google"]);
    expect(options.map((option) => option.querySelector("i")?.className)).toEqual(["ti ti-brand-azure", "ti ti-brand-google"]);
    fireEvent.click(options[1] as HTMLElement);

    expect(providerTrigger().getAttribute("aria-label")).toBe("Identity provider, Contoso Google");
  });

  it("sends the method and the provider together, and not the provider again once it is saved", async () => {
    await renderLoaded(settings());
    api.saveRegistrationSettings.mockResolvedValue(ssoSettings());

    fireEvent.click(radio("Company SSO"));
    pickProvider("Contoso Entra");
    fireEvent.click(saveButton());

    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { access_methods: ["sso"], sso_provider_id: "idp-entra" }));
    await waitFor(() => expect(isOff(saveButton())).toBe(true));
  });

  it("sends only the provider when only the provider changed", async () => {
    await renderLoaded(ssoSettings());
    api.saveRegistrationSettings.mockResolvedValue(ssoSettings({ sso_provider_id: "idp-google", sso_provider: { ...ENTRA, id: "idp-google", display_name: "Contoso Google", kind: "google" } as RegistrationSettingsDto["sso_provider"] }));

    pickProvider("Contoso Google");
    fireEvent.click(saveButton());

    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { sso_provider_id: "idp-google" }));
  });

  it("sends no provider when the method is changed away from Company SSO, because the server clears it", async () => {
    await renderLoaded(ssoSettings());
    api.saveRegistrationSettings.mockResolvedValue(settings());

    pickProvider("Contoso Google");
    fireEvent.click(radio("Link"));
    fireEvent.click(saveButton());

    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { access_methods: ["link"] }));
  });

  it("takes the only provider by itself when Company SSO is chosen, and does not when there are two", async () => {
    await renderLoaded(settings({ sso_providers: [PROVIDERS[0] as (typeof PROVIDERS)[number]] }));

    fireEvent.click(radio("Company SSO"));

    expect(providerTrigger().getAttribute("aria-label")).toBe("Identity provider, Contoso Entra");
    cleanup();

    await renderLoaded(settings());
    fireEvent.click(radio("Company SSO"));
    expect(providerTrigger().getAttribute("aria-label")).toBe("Identity provider, none selected");
  });

  it("keeps a provider that a person picked when the only provider is there and they pick it again", async () => {
    await renderLoaded(settings({ sso_providers: [PROVIDERS[0] as (typeof PROVIDERS)[number]] }));
    api.saveRegistrationSettings.mockResolvedValue(ssoSettings());

    fireEvent.click(radio("Company SSO"));
    fireEvent.click(saveButton());

    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { access_methods: ["sso"], sso_provider_id: "idp-entra" }));
  });

  it("says that the form stays closed until a provider is chosen", async () => {
    await renderLoaded(settings());
    fireEvent.click(radio("Company SSO"));

    expect(noticeText()).toBe("Choose an identity provider. Until you do, the form stays closed.");
    expect(wayInCard().querySelector(".at-notice--warning")).not.toBeNull();

    pickProvider("Contoso Entra");
    expect(noticeText()).toBe("Guests sign in with their work account. Their email comes from that sign-in.");
    expect(wayInCard().querySelector(".at-notice--info")).not.toBeNull();
  });

  it("keeps a provider that was turned off in the list, marked, and says that the form stays closed", async () => {
    await renderLoaded(ssoSettings({ sso_providers: [PROVIDERS[1] as (typeof PROVIDERS)[number]], sso_provider: { ...ENTRA, state: "disabled" } as RegistrationSettingsDto["sso_provider"] }));

    expect(providerTrigger().getAttribute("aria-label")).toBe("Identity provider, Contoso Entra (turned off)");
    expect(noticeText()).toBe("Contoso Entra is turned off, so the form stays closed. Choose another provider or ask a superadmin to turn it on.");
    expect(wayInCard().querySelector(".at-notice--warning")).not.toBeNull();
    expect(isOff(saveButton())).toBe(true);
  });

  it("says that a provider that was deleted is gone, and offers the others", async () => {
    await renderLoaded(ssoSettings({ sso_providers: [PROVIDERS[1] as (typeof PROVIDERS)[number]], sso_provider: { id: "idp-entra", state: "missing", display_name: null, kind: null } }));

    expect(noticeText()).toBe("The identity provider that was chosen no longer exists, so the form stays closed. Choose another one.");
    expect(providerTrigger().getAttribute("aria-label")).toBe("Identity provider, none selected");
  });

  it("warns that guests who are filling in the form sign in again when the provider of a saved event changes, and not before", async () => {
    await renderLoaded(ssoSettings());
    expect(noticeText()).not.toMatch(/sign in again/);

    pickProvider("Contoso Google");

    expect(noticeText()).toBe("Guests sign in with their work account. Their email comes from that sign-in. Guests who are filling in the form will have to sign in again.");
    pickProvider("Contoso Entra");
    expect(noticeText()).not.toMatch(/sign in again/);
  });

  it("does not warn about signing in again when Company SSO is chosen for the first time", async () => {
    await renderLoaded(settings());
    fireEvent.click(radio("Company SSO"));
    pickProvider("Contoso Entra");

    expect(noticeText()).not.toMatch(/sign in again/);
  });

  it("is only read, for an administrator, while the event is limited to one company, and says why", async () => {
    await renderLoaded(ssoSettings({ sso_claim_name: "tid", sso_claim_values: ["aaa-111"] }));

    expect((providerTrigger() as HTMLButtonElement).disabled).toBe(true);
    expect(providerTrigger().getAttribute("aria-label")).toBe("Identity provider, Contoso Entra");
    expect(plain(wayInCard().textContent)).toContain("Only a superadmin can change the identity provider while the event is limited to one company.");
  });

  it("is changed by a superadmin while the event is limited to one company, and by an administrator when it is not", async () => {
    assignments = [SUPERADMIN];
    await renderLoaded(ssoSettings({ sso_claim_name: "tid", sso_claim_values: ["aaa-111"] }));
    expect((providerTrigger() as HTMLButtonElement).disabled).toBe(false);
    expect(plain(wayInCard().textContent)).not.toContain("Only a superadmin can change");
    cleanup();

    assignments = [ORG_ADMIN];
    await renderLoaded(ssoSettings());
    expect((providerTrigger() as HTMLButtonElement).disabled).toBe(false);
  });

  it("reads the settings again when the server says that the provider is not available any more", async () => {
    await renderLoaded(settings());
    api.saveRegistrationSettings.mockRejectedValue(new ApiError(422, "sso_provider_not_available"));
    fireEvent.click(radio("Company SSO"));
    pickProvider("Contoso Entra");
    api.fetchRegistrationSettings.mockClear();

    fireEvent.click(saveButton());

    await waitFor(() => expect(api.fetchRegistrationSettings).toHaveBeenCalled());
    expect((await screen.findByRole("alert")).textContent).toBe("This identity provider is not available. Choose another one.");
  });

  it("is free of axe violations with the provider chosen", async () => {
    await renderLoaded(ssoSettings());

    const result = await axe.run(wayInCard(), { rules: { "color-contrast": { enabled: false } } });

    expect(result.violations).toEqual([]);
  });
});

describe("an event with a restriction of the company SSO, on this tab", () => {
  const restricted = () => settings({ access_methods: ["sso"], readiness: ssoChecks(), sso_claim_name: "tid", sso_claim_values: ["aaa-111"] });

  it("sends nothing for the restriction when another setting is saved", async () => {
    await renderLoaded(restricted());
    api.saveRegistrationSettings.mockResolvedValue({ ...restricted(), ask_company: true });

    fireEvent.click(toggle("Ask for the company"));
    fireEvent.click(saveButton());

    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { ask_company: true }));
  });
});
