import { describe, expect, it } from "vitest";
import { SSO_CLAIM_NAME_MAX, SSO_CLAIM_VALUE_MAX, SSO_CLAIM_VALUES_MAX } from "@admitto/shared";
import {
  chosenMethod,
  claimErrors,
  draftFromSettings,
  missingChecks,
  parseClaim,
  settingsPatch,
  technicalPatch,
  type AccessDraft,
} from "../../src/registration/accessSettings.js";
import { checks, settings } from "./accessData.js";

const base = (overrides: Partial<AccessDraft> = {}): AccessDraft => ({ ...draftFromSettings(settings()), ...overrides });

describe("chosenMethod", () => {
  it.each([
    [["link"], "link"],
    [["password"], "password"],
    [[], null],
    [["link", "password"], null],
    [["sso"], "sso"],
    [["sso", "link"], null],
    [["other"], null],
  ])("reads %j as %j: one way the screen offers, or no choice", (methods, expected) => {
    expect(chosenMethod(methods)).toBe(expected);
  });
});

describe("draftFromSettings", () => {
  it("is the form of the settings as they are saved", () => {
    const draft = draftFromSettings(
      settings({ mode: "approval", access_methods: ["password"], waitlist_enabled: false, verify_email: false, ask_company: true, ask_department: true, max_companions: 1 }),
    );

    expect(draft).toEqual({
      mode: "approval",
      method: "password",
      waitlist_enabled: false,
      verify_email: false,
      ask_company: true,
      ask_department: true,
      companion: true,
      keep_origin: true,
      bot_protection_enabled: true,
      sso_claim_name: "",
      sso_claim_values: "",
      sso_provider_id: null,
    });
  });

  it("holds the identity provider of the event", () => {
    expect(draftFromSettings(settings({ access_methods: ["sso"], sso_provider_id: "idp-a" })).sso_provider_id).toBe("idp-a");
  });

  it("holds the restriction of the company SSO as it is typed: the name, and the values one on each line", () => {
    const draft = draftFromSettings(settings({ access_methods: ["sso"], sso_claim_name: "tid", sso_claim_values: ["aaa", "bbb"] }));

    expect(draft.method).toBe("sso");
    expect(draft.sso_claim_name).toBe("tid");
    expect(draft.sso_claim_values).toBe("aaa\nbbb");
  });

  it("holds the switch that keeps where a request came from as it is saved", () => {
    expect(draftFromSettings(settings({ keep_origin: false })).keep_origin).toBe(false);
    expect(draftFromSettings(settings({ keep_origin: true })).keep_origin).toBe(true);
  });

  it("takes any number of companions above none as one, since the screen offers no other", () => {
    expect(draftFromSettings(settings({ max_companions: 2 })).companion).toBe(true);
    expect(draftFromSettings(settings({ max_companions: 0 })).companion).toBe(false);
  });
});

describe("settingsPatch", () => {
  it("is empty for a form that is as it was, so a save of it sends nothing", () => {
    expect(settingsPatch(base(), base())).toEqual({});
  });

  it.each<[string, Partial<AccessDraft>, object]>([
    ["the mode", { mode: "automatic" }, { mode: "automatic" }],
    ["turning off", { mode: null }, { mode: null }],
    ["the waiting list", { waitlist_enabled: false }, { waitlist_enabled: false }],
    ["the check of the address", { verify_email: false }, { verify_email: false }],
    ["the company", { ask_company: true }, { ask_company: true }],
    ["the department", { ask_department: true }, { ask_department: true }],
    ["a person to bring", { companion: true }, { max_companions: 1 }],
    ["keeping where a request came from", { keep_origin: false }, { keep_origin: false }],
  ])("holds only %s when that is all that changed", (_name, change, patch) => {
    const from = base({ mode: change.mode === null ? "approval" : null });
    expect(settingsPatch({ ...from, ...change }, from)).toEqual(patch);
  });

  it("never holds how guests open the form: the method, the identity provider and the restriction are a superadmin's, from Event settings", () => {
    const sso = base({ method: "sso", sso_provider_id: "idp-a", sso_claim_name: "tid", sso_claim_values: "aaa" });
    expect(settingsPatch({ ...sso, method: "password", sso_provider_id: "idp-b", sso_claim_name: "oid", sso_claim_values: "bbb" }, sso)).toEqual({});
    expect(settingsPatch(base({ method: null }), base({ method: "link" }))).toEqual({});
    expect(settingsPatch({ ...sso, sso_provider_id: "idp-b" }, sso)).toEqual({});
  });

  it("holds the changed settings and no others when several changed", () => {
    expect(settingsPatch(base({ waitlist_enabled: false, ask_company: true }), base())).toEqual({
      waitlist_enabled: false,
      ask_company: true,
    });
  });

  it("sends a person to bring as none when it was taken away", () => {
    expect(settingsPatch(base({ companion: false }), base({ companion: true }))).toEqual({ max_companions: 0 });
  });

  it("is made against the settings the form was made from, so a setting nobody touched is never written back", () => {
    // Somebody else turned the company off meanwhile: this form still holds the old value and must not undo that.
    const startedFrom = base({ ask_company: true });
    const form = { ...startedFrom, waitlist_enabled: false };

    expect(settingsPatch(form, startedFrom)).toEqual({ waitlist_enabled: false });
  });
});

describe("parseClaim", () => {
  it("trims the name, and reads the values one to a line without the empty ones and without a value twice", () => {
    expect(parseClaim({ sso_claim_name: "  tid ", sso_claim_values: " aaa \n\n bbb\r\naaa\n   " })).toEqual({ name: "tid", values: ["aaa", "bbb"] });
  });

  it("is empty for nothing typed", () => {
    expect(parseClaim({ sso_claim_name: "", sso_claim_values: "" })).toEqual({ name: "", values: [] });
  });
});

describe("technicalPatch: the access method, the identity provider and the restriction of the company SSO", () => {
  const sso = (overrides: Partial<AccessDraft> = {}) => base({ method: "sso", ...overrides });

  it("sends the name and the values together when either changed, with no empty and no repeated value", () => {
    expect(technicalPatch(sso({ sso_claim_name: "tid", sso_claim_values: "aaa\n\nbbb\naaa" }), sso())).toEqual({
      sso_claim_name: "tid",
      sso_claim_values: ["aaa", "bbb"],
    });
    expect(technicalPatch(sso({ sso_claim_name: "tid", sso_claim_values: "aaa\nccc" }), sso({ sso_claim_name: "tid", sso_claim_values: "aaa" }))).toEqual({
      sso_claim_name: "tid",
      sso_claim_values: ["aaa", "ccc"],
    });
  });

  it("sends null and an empty list to take the restriction away", () => {
    expect(technicalPatch(sso(), sso({ sso_claim_name: "tid", sso_claim_values: "aaa" }))).toEqual({ sso_claim_name: null, sso_claim_values: [] });
  });

  it("sends nothing for a restriction that only differs in spaces, in the order of the values or in an empty line", () => {
    const saved = sso({ sso_claim_name: "tid", sso_claim_values: "aaa\nbbb" });

    expect(technicalPatch(sso({ sso_claim_name: " tid ", sso_claim_values: "bbb\n\naaa \n" }), saved)).toEqual({});
  });

  it("sends the way in and the restriction in one save when the event moves to the company SSO", () => {
    expect(technicalPatch(sso({ sso_claim_name: "tid", sso_claim_values: "aaa" }), base({ method: "link" }))).toEqual({
      access_methods: ["sso"],
      sso_claim_name: "tid",
      sso_claim_values: ["aaa"],
    });
  });

  it("sends no restriction for another way in, whatever is typed, since the server refuses one and clears it when the way in changes", () => {
    const typed = { sso_claim_name: "tid", sso_claim_values: "aaa" };

    expect(technicalPatch(base({ method: "link", ...typed }), base({ method: "link" }))).toEqual({});
    expect(technicalPatch(base({ method: "password", ...typed }), sso(typed))).toEqual({ access_methods: ["password"] });
    expect(technicalPatch(base({ method: null, ...typed }), sso(typed))).toEqual({ access_methods: [] });
  });

  it("sends the provider only for Company SSO, and only when it changed", () => {
    const withProvider = sso({ sso_provider_id: "idp-a" });
    expect(technicalPatch({ ...withProvider, sso_provider_id: "idp-b" }, withProvider)).toEqual({ sso_provider_id: "idp-b" });
    expect(technicalPatch({ ...withProvider, sso_provider_id: null }, withProvider)).toEqual({ sso_provider_id: null });
    expect(technicalPatch(withProvider, withProvider)).toEqual({});
    // A move to Company SSO sends the way and the provider together.
    expect(technicalPatch({ ...base(), method: "sso", sso_provider_id: "idp-a" }, base())).toEqual({ access_methods: ["sso"], sso_provider_id: "idp-a" });
    // The server clears the provider when the way changes to another, so none is sent.
    expect(technicalPatch({ ...withProvider, method: "link", sso_provider_id: "idp-b" }, withProvider)).toEqual({ access_methods: ["link"] });
  });

  it("sends the access method as a list of one, and none as an empty list", () => {
    expect(technicalPatch(base({ method: "password" }), base({ method: "link" }))).toEqual({ access_methods: ["password"] });
    expect(technicalPatch(base({ method: null }), base({ method: "link" }))).toEqual({ access_methods: [] });
  });
});

describe("claimErrors", () => {
  const sso = (name: string, values: string) => base({ method: "sso", sso_claim_name: name, sso_claim_values: values });

  it("has nothing to say about no restriction, or about a complete one", () => {
    expect(claimErrors(sso("", ""))).toEqual({});
    expect(claimErrors(sso("tid", "aaa"))).toEqual({});
    expect(claimErrors(sso("http://schemas.example.com/claims/tenant", "aaa\nbbb"))).toEqual({});
  });

  it("asks for the other half when only one of the two is filled in", () => {
    expect(claimErrors(sso("tid", ""))).toEqual({ values: "Enter at least one value, or clear the name." });
    expect(claimErrors(sso("tid", " \n \n"))).toEqual({ values: "Enter at least one value, or clear the name." });
    expect(claimErrors(sso("", "aaa"))).toEqual({ name: "Enter the name of the claim these values belong to." });
  });

  it("refuses a name with a space or a character outside plain ASCII, as the server does", () => {
    const words = "The name has letters, digits and signs only, with no spaces.";

    expect(claimErrors(sso("my claim", "aaa")).name).toBe(words);
    expect(claimErrors(sso("ti\u0161", "aaa")).name).toBe(words);
    expect(claimErrors(sso("a\tb", "aaa")).name).toBe(words);
  });

  it("keeps to the limits: the name, the number of values and the length of a value", () => {
    expect(claimErrors(sso("a".repeat(SSO_CLAIM_NAME_MAX), "aaa"))).toEqual({});
    expect(claimErrors(sso("a".repeat(SSO_CLAIM_NAME_MAX + 1), "aaa")).name).toBe(`The name can have at most ${SSO_CLAIM_NAME_MAX} characters.`);
    const many = (count: number) => Array.from({ length: count }, (_, index) => `v${index}`).join("\n");
    expect(claimErrors(sso("tid", many(SSO_CLAIM_VALUES_MAX)))).toEqual({});
    expect(claimErrors(sso("tid", many(SSO_CLAIM_VALUES_MAX + 1))).values).toBe(`List at most ${SSO_CLAIM_VALUES_MAX} values.`);
    expect(claimErrors(sso("tid", "v".repeat(SSO_CLAIM_VALUE_MAX)))).toEqual({});
    expect(claimErrors(sso("tid", "v".repeat(SSO_CLAIM_VALUE_MAX + 1))).values).toBe(`A value can have at most ${SSO_CLAIM_VALUE_MAX} characters.`);
  });

  it("refuses a value with a control character inside it", () => {
    expect(claimErrors(sso("tid", "aa\u0007bb")).values).toBe("A value cannot hold a control character.");
  });

  it("counts a value twice as one, as the server does", () => {
    expect(claimErrors(sso("tid", Array.from({ length: SSO_CLAIM_VALUES_MAX + 5 }, () => "same").join("\n")))).toEqual({});
  });

  it("has nothing to check for another way in, even with a restriction typed", () => {
    expect(claimErrors(base({ method: "link", sso_claim_name: "bad name", sso_claim_values: "" }))).toEqual({});
  });
});

describe("missingChecks", () => {
  it("names the checks that are not met, in order, and none when all are", () => {
    expect(missingChecks(checks("mail_provider", "legal_documents"))).toEqual(["legal_documents", "mail_provider"]);
    expect(missingChecks(checks())).toEqual([]);
  });
});
