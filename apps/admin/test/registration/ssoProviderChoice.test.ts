import { describe, expect, it } from "vitest";
import { methodEdit, providerIsLocked, providerNotice, providerOptions } from "../../src/registration/ssoProviderChoice.js";
import { PROVIDERS } from "./accessData.js";

const ENTRA = { id: "idp-entra", state: "ready", display_name: "Contoso Entra", kind: "entra" } as const;
const NOTHING_SAVED = { method: null, providerId: null };

describe("providerIsLocked", () => {
  it.each([
    ["an administrator, Company SSO limited to one company", { access_methods: ["sso"], sso_claim_name: "tid" }, false, true],
    ["a superadmin, the same event", { access_methods: ["sso"], sso_claim_name: "tid" }, true, false],
    ["an administrator, no restriction", { access_methods: ["sso"], sso_claim_name: null }, false, false],
    ["an administrator, another method", { access_methods: ["link"], sso_claim_name: "tid" }, false, false],
  ] as const)("is decided for %s", (_who, saved, superadmin, expected) => {
    expect(providerIsLocked({ access_methods: [...saved.access_methods], sso_claim_name: saved.sso_claim_name }, superadmin)).toBe(expected);
  });
});

describe("methodEdit", () => {
  it("takes the only provider with Company SSO while none is chosen", () => {
    expect(methodEdit("sso", { sso_provider_id: null }, [PROVIDERS[0] as (typeof PROVIDERS)[number]])).toEqual({ method: "sso", sso_provider_id: "idp-entra" });
  });

  it.each([
    ["two providers", "sso", null, PROVIDERS],
    ["a provider already chosen", "sso", "idp-google", [PROVIDERS[0]]],
    ["no provider", "sso", null, []],
    ["another method", "link", null, [PROVIDERS[0]]],
  ] as const)("changes only the method for %s", (_what, method, chosen, providers) => {
    expect(methodEdit(method, { sso_provider_id: chosen }, [...providers] as typeof PROVIDERS)).toEqual({ method });
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

  it("does not list it twice when it is on the list", () => {
    expect(providerOptions(PROVIDERS, { ...ENTRA, state: "disabled" }, "idp-entra")).toHaveLength(2);
  });
});

describe("providerNotice", () => {
  it("says the form is closed while none is chosen, and is ready for one that is turned on", () => {
    expect(providerNotice({ providers: PROVIDERS, current: null, chosenId: null, saved: NOTHING_SAVED }).variant).toBe("warning");
    expect(providerNotice({ providers: PROVIDERS, current: ENTRA, chosenId: "idp-entra", saved: NOTHING_SAVED })).toEqual({
      variant: "info",
      text: "Guests sign in with their work account. Their email comes from that sign-in.",
    });
  });

  it("names a provider that is turned off, and says another is gone when the choice is on no list", () => {
    expect(providerNotice({ providers: [], current: { ...ENTRA, state: "disabled" }, chosenId: "idp-entra", saved: NOTHING_SAVED }).text).toMatch(/^Contoso Entra is turned off, so the form stays closed\./);
    expect(providerNotice({ providers: [], current: { id: "idp-entra", state: "disabled", display_name: null, kind: null }, chosenId: "idp-entra", saved: NOTHING_SAVED }).text).toMatch(/^This provider is turned off/);
    expect(providerNotice({ providers: PROVIDERS, current: null, chosenId: "idp-gone", saved: NOTHING_SAVED }).text).toMatch(/no longer exists/);
  });

  it("adds the sign-in-again sentence only when a saved Company SSO event moves to another provider", () => {
    const again = / Guests who are filling in the form will have to sign in again\.$/;
    const saved = { method: "sso", providerId: "idp-entra" } as const;
    expect(providerNotice({ providers: PROVIDERS, current: ENTRA, chosenId: "idp-google", saved }).text).toMatch(again);
    expect(providerNotice({ providers: PROVIDERS, current: ENTRA, chosenId: "idp-entra", saved }).text).not.toMatch(again);
    expect(providerNotice({ providers: PROVIDERS, current: ENTRA, chosenId: null, saved }).text).not.toMatch(again);
    expect(providerNotice({ providers: PROVIDERS, current: null, chosenId: "idp-google", saved: { method: "link", providerId: "idp-entra" } }).text).not.toMatch(again);
    expect(providerNotice({ providers: PROVIDERS, current: null, chosenId: "idp-google", saved: { method: "sso", providerId: null } }).text).not.toMatch(again);
  });
});
