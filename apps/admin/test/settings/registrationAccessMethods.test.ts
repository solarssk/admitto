import { describe, expect, it } from "vitest";
import {
  accessMethodsDirty,
  accessMethodsDraftFrom,
  afterWaysInSave,
  buildAccessMethodsSaveBody,
  buildSsoProviderSaveBody,
  mergeWaysIn,
  ssoProviderNote,
  ssoProviderOptions,
  type AccessMethodsDraft,
  type WaysIn,
} from "../../src/settings/registrationAccessMethods.js";
import { accessMethodsDto, ssoProviderDto } from "./accessMethodsFixtures.js";

const draft = (overrides: Partial<AccessMethodsDraft> = {}): AccessMethodsDraft => ({ link: false, password: false, sso: false, ssoProviderId: null, ...overrides });
const ways = (on: Parameters<typeof accessMethodsDto>[0] = [], provider = ssoProviderDto()): WaysIn => ({ methods: accessMethodsDto(on), sso: provider });

describe("accessMethodsDraftFrom", () => {
  it("is off for every switch, and no provider, when the server has nothing on", () => {
    expect(accessMethodsDraftFrom(ways())).toEqual(draft());
  });

  it("follows the ways that the server has on, not whether a guest can use them", () => {
    expect(accessMethodsDraftFrom(ways(["link"]))).toEqual(draft({ link: true }));
    expect(accessMethodsDraftFrom(ways(["link", "password", "sso"]))).toEqual(draft({ link: true, password: true, sso: true }));
  });

  it("keeps the provider as the server has it, also when it is gone or off", () => {
    expect(accessMethodsDraftFrom(ways([], ssoProviderDto({ provider_id: "gone", state: "missing" }))).ssoProviderId).toBe("gone");
    expect(accessMethodsDraftFrom(ways([], ssoProviderDto({ provider_id: "idp-entra", state: "disabled" }))).ssoProviderId).toBe("idp-entra");
  });

  it("is off for a switch whose way the server leaves out of its answer", () => {
    expect(accessMethodsDraftFrom({ methods: { methods: [] }, sso: ssoProviderDto() })).toEqual(draft());
  });
});

describe("accessMethodsDirty", () => {
  it("is false for the saved draft and true for any switch turned", () => {
    expect(accessMethodsDirty(draft(), draft())).toBe(false);
    expect(accessMethodsDirty(draft({ link: true }), draft())).toBe(true);
    expect(accessMethodsDirty(draft({ password: true }), draft())).toBe(true);
    expect(accessMethodsDirty(draft({ sso: true }), draft())).toBe(true);
    expect(accessMethodsDirty(draft({ link: true }), draft({ link: true }))).toBe(false);
  });

  it("is true when the provider differs, whether or not the sign-in is on", () => {
    expect(accessMethodsDirty(draft({ ssoProviderId: "idp-okta" }), draft())).toBe(true);
    expect(accessMethodsDirty(draft({ sso: true, ssoProviderId: "idp-okta" }), draft({ sso: true, ssoProviderId: "idp-okta" }))).toBe(false);
  });
});

describe("buildAccessMethodsSaveBody", () => {
  it("is null when no switch changed, also when only the provider did", () => {
    expect(buildAccessMethodsSaveBody(draft(), draft())).toBeNull();
    expect(buildAccessMethodsSaveBody(draft({ sso: true, ssoProviderId: "idp-okta" }), draft({ sso: true }))).toBeNull();
  });

  it("lists the ways that are on, in the order of the server", () => {
    expect(buildAccessMethodsSaveBody(draft({ link: true }), draft())).toEqual({ methods: ["link"] });
    expect(buildAccessMethodsSaveBody(draft({ link: true, password: true, sso: true }), draft())).toEqual({ methods: ["link", "password", "sso"] });
    expect(buildAccessMethodsSaveBody(draft({ sso: true, password: true }), draft())).toEqual({ methods: ["password", "sso"] });
  });

  it("lists nothing when the last way is turned off, since the server replaces the whole list", () => {
    expect(buildAccessMethodsSaveBody(draft(), draft({ password: true }))).toEqual({ methods: [] });
  });

  it("keeps the company sign-in in the list when another way is turned on", () => {
    expect(buildAccessMethodsSaveBody(draft({ link: true, sso: true }), draft({ sso: true }))).toEqual({ methods: ["link", "sso"] });
  });
});

describe("buildSsoProviderSaveBody", () => {
  it("is null when the provider did not change, even if the switches did", () => {
    expect(buildSsoProviderSaveBody(draft({ link: true, ssoProviderId: "idp-okta" }), draft({ ssoProviderId: "idp-okta" }))).toBeNull();
  });

  it("sends the provider that was chosen, and null when the choice is taken away", () => {
    expect(buildSsoProviderSaveBody(draft({ ssoProviderId: "idp-okta" }), draft())).toEqual({ provider_id: "idp-okta" });
    expect(buildSsoProviderSaveBody(draft(), draft({ ssoProviderId: "idp-okta" }))).toEqual({ provider_id: null });
  });
});

describe("afterWaysInSave", () => {
  const edited = draft({ link: true, sso: true, ssoProviderId: "idp-okta" });

  it("makes both parts the saved ones when both requests worked", () => {
    const got = { methods: accessMethodsDto(["link", "sso"]), sso: ssoProviderDto({ provider_id: "idp-okta", state: "ready" }) };

    const after = afterWaysInSave(edited, draft(), got);

    expect(after.draft).toEqual(edited);
    expect(after.saved).toEqual(edited);
  });

  it("keeps the part that failed as the person left it, and still changed, while the part that worked is saved", () => {
    const providerOnly = afterWaysInSave(edited, draft(), { methods: null, sso: ssoProviderDto({ provider_id: "idp-okta", state: "ready" }) });
    expect(providerOnly.saved).toEqual(draft({ ssoProviderId: "idp-okta" }));
    expect(providerOnly.draft).toEqual(edited);
    expect(accessMethodsDirty(providerOnly.draft, providerOnly.saved)).toBe(true);

    const methodsOnly = afterWaysInSave(edited, draft(), { methods: accessMethodsDto(["link", "sso"]), sso: null });
    expect(methodsOnly.saved).toEqual(draft({ link: true, sso: true }));
    expect(methodsOnly.draft).toEqual(edited);
    expect(accessMethodsDirty(methodsOnly.draft, methodsOnly.saved)).toBe(true);
  });

  it("takes what the server answered, not what was sent", () => {
    const after = afterWaysInSave(draft({ link: true }), draft(), { methods: accessMethodsDto(["password"]), sso: null });

    expect(after.draft).toEqual(draft({ password: true }));
    expect(after.saved).toEqual(draft({ password: true }));
  });

  it("changes nothing when nothing was saved, and never the objects it was given", () => {
    const saved = draft();
    const after = afterWaysInSave(edited, saved, { methods: null, sso: null });

    expect(after.draft).toEqual(edited);
    expect(after.saved).toEqual(saved);
    expect(after.saved).not.toBe(saved);
  });
});

describe("mergeWaysIn", () => {
  it("takes the newest answer of each part and keeps the older one of a part that did not come", () => {
    const before = ways(["link"]);
    const newSso = ssoProviderDto({ provider_id: "idp-okta", state: "ready" });

    expect(mergeWaysIn(before, { methods: null, sso: newSso })).toEqual({ methods: before.methods, sso: newSso });
    expect(mergeWaysIn(before, { methods: accessMethodsDto(["password"]), sso: null })).toEqual({ methods: accessMethodsDto(["password"]), sso: before.sso });
  });
});

describe("ssoProviderOptions", () => {
  it("offers the providers that are turned on by the name staff gave them", () => {
    expect(ssoProviderOptions(ssoProviderDto())).toEqual([
      { id: "idp-entra", label: "Company Entra ID" },
      { id: "idp-okta", label: "Okta" },
    ]);
    expect(ssoProviderOptions(ssoProviderDto({ providers: [] }))).toEqual([]);
  });
});

describe("ssoProviderNote", () => {
  it.each([
    ["not_selected", null, /No identity provider is chosen yet\. Forms of events that use the company sign-in stay closed, and nothing is deleted\./],
    ["missing", "gone", /The identity provider that was chosen no longer exists\. Forms .* stay closed/],
    ["disabled", "idp-entra", /The identity provider that was chosen is turned off\. Forms .* stay closed/],
  ] as const)("warns for a choice that is %s, and says that forms stay closed", (state, providerId, text) => {
    const note = ssoProviderNote(ssoProviderDto({ state, provider_id: providerId }), providerId);

    expect(note.tone).toBe("warning");
    expect(note.text).toMatch(text);
  });

  it("names the provider when the choice is ready", () => {
    expect(ssoProviderNote(ssoProviderDto({ state: "ready", provider_id: "idp-okta" }), "idp-okta")).toEqual({ tone: "info", text: "Guests sign in with Okta." });
  });

  it("does not name a provider it cannot find among the ones turned on", () => {
    expect(ssoProviderNote(ssoProviderDto({ state: "ready", provider_id: "idp-x", providers: [] }), "idp-x").text).toBe("Guests sign in with the chosen provider.");
  });

  it("says that a change takes effect on Save while the picker holds another provider than the saved one", () => {
    const saved = ssoProviderDto({ state: "disabled", provider_id: "idp-entra" });

    expect(ssoProviderNote(saved, "idp-okta")).toEqual({ tone: "info", text: "The change of provider takes effect when you save." });
    expect(ssoProviderNote(ssoProviderDto(), "idp-okta").tone).toBe("info");
  });

  it("has no dash that stands for a pause", () => {
    const states = [ssoProviderDto(), ssoProviderDto({ state: "missing", provider_id: "x" }), ssoProviderDto({ state: "disabled", provider_id: "y" })];

    for (const sso of states) expect(ssoProviderNote(sso, sso.provider_id).text).not.toMatch(/[–—]/);
  });
});
