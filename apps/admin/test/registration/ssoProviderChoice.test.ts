import { describe, expect, it } from "vitest";
import { methodEdit, providerNotice, providerOptions } from "../../src/registration/ssoProviderChoice.js";
import { PROVIDERS } from "./accessData.js";

const ENTRA = { id: "idp-entra", state: "ready", display_name: "Contoso Entra", kind: "entra" } as const;
const NOTHING_SAVED = { method: null, providerId: null };

describe("methodEdit", () => {
  it.each([
    ["the only provider there is, when the event has none saved", null, [PROVIDERS[0]], "idp-entra"],
    ["the provider the event has saved, even when there are two", "idp-google", PROVIDERS, "idp-google"],
    ["the saved provider rather than the only one", "idp-google", [PROVIDERS[0]], "idp-google"],
    ["no provider when there are two and none is saved", null, PROVIDERS, null],
    ["no provider when there is none", null, [], null],
  ] as const)("gives Company SSO %s", (_what, saved, providers, expected) => {
    expect(methodEdit("sso", saved, [...providers] as typeof PROVIDERS)).toEqual({ method: "sso", sso_provider_id: expected });
  });

  it.each(["link", "password"] as const)("clears the provider in the form for %s, whatever is saved", (method) => {
    expect(methodEdit(method, "idp-google", PROVIDERS)).toEqual({ method, sso_provider_id: null });
    expect(methodEdit(method, null, [PROVIDERS[0] as (typeof PROVIDERS)[number]])).toEqual({ method, sso_provider_id: null });
  });
});

describe("providerOptions", () => {
  it("lists the providers with the icon of their kind", () => {
    expect(providerOptions(PROVIDERS, null, null)).toEqual([
      { id: "idp-entra", label: "Contoso Entra", icon: "brand-azure" },
      { id: "idp-google", label: "Contoso Google", icon: "brand-google" },
    ]);
  });

  it("adds the chosen provider that is turned off, marked, and only that one", () => {
    const off = { ...ENTRA, state: "disabled" } as const;
    expect(providerOptions([PROVIDERS[1] as (typeof PROVIDERS)[number]], off, "idp-entra").map((option) => option.label)).toEqual(["Contoso Google", "Contoso Entra (turned off)"]);
    expect(providerOptions([PROVIDERS[1] as (typeof PROVIDERS)[number]], off, "idp-google")).toHaveLength(1);
    expect(providerOptions([PROVIDERS[1] as (typeof PROVIDERS)[number]], { ...ENTRA, state: "missing", display_name: null, kind: null }, "idp-entra")).toHaveLength(1);
  });

  it("lists a turned off provider without an icon when its kind is not known", () => {
    const off = { id: "idp-entra", state: "disabled", display_name: "Contoso Entra", kind: null } as const;
    expect(providerOptions([], off, "idp-entra")).toEqual([{ id: "idp-entra", label: "Contoso Entra (turned off)", icon: undefined }]);
  });

  it("does not list it twice when it is on the list", () => {
    expect(providerOptions(PROVIDERS, { ...ENTRA, state: "disabled" }, "idp-entra")).toHaveLength(2);
  });
});

describe("providerNotice", () => {
  it("says the form is closed while none is chosen, and is ready for one that is turned on", () => {
    expect(providerNotice({ providers: PROVIDERS, current: null, chosenId: null, saved: NOTHING_SAVED }).variant).toBe("warning");
    expect(providerNotice({ providers: PROVIDERS, current: ENTRA, chosenId: "idp-entra", saved: NOTHING_SAVED })).toBeNull();
  });

  it("names a provider that is turned off, and says another is gone when the choice is on no list", () => {
    expect(providerNotice({ providers: [], current: { ...ENTRA, state: "disabled" }, chosenId: "idp-entra", saved: NOTHING_SAVED })?.text).toMatch(/^Contoso Entra is turned off, so the form stays closed\./);
    expect(providerNotice({ providers: [], current: { id: "idp-entra", state: "disabled", display_name: null, kind: null }, chosenId: "idp-entra", saved: NOTHING_SAVED })?.text).toMatch(/^This provider is turned off/);
    expect(providerNotice({ providers: PROVIDERS, current: null, chosenId: "idp-gone", saved: NOTHING_SAVED })?.text).toMatch(/no longer exists/);
  });

  it("says to sign in again, alone for a provider that is turned on, only when a saved Company SSO event moves to another provider", () => {
    const again = "Guests who are filling in the form will have to sign in again.";
    const saved = { method: "sso", providerId: "idp-entra" } as const;
    expect(providerNotice({ providers: PROVIDERS, current: ENTRA, chosenId: "idp-google", saved })).toEqual({ variant: "info", text: again });
    expect(providerNotice({ providers: [], current: ENTRA, chosenId: "idp-gone", saved })?.text).toBe(`The identity provider that was chosen no longer exists, so the form stays closed. Choose another one. ${again}`);
    expect(providerNotice({ providers: PROVIDERS, current: ENTRA, chosenId: "idp-entra", saved })).toBeNull();
    expect(providerNotice({ providers: PROVIDERS, current: ENTRA, chosenId: null, saved })?.text).not.toMatch(/sign in again/);
    expect(providerNotice({ providers: PROVIDERS, current: null, chosenId: "idp-google", saved: { method: "link", providerId: "idp-entra" } })).toBeNull();
    expect(providerNotice({ providers: PROVIDERS, current: null, chosenId: "idp-google", saved: { method: "sso", providerId: null } })).toBeNull();
  });
});
