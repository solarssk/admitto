import { describe, expect, it } from "vitest";
import { chosenMethod, consentOptions, draftFromSettings, missingChecks, settingsPatch, type AccessDraft } from "../../src/registration/accessSettings.js";
import { checks, legalAnswer, settings, texts } from "./accessData.js";

const base = (overrides: Partial<AccessDraft> = {}): AccessDraft => ({ ...draftFromSettings(settings()), ...overrides });

describe("chosenMethod", () => {
  it.each([
    [["link"], "link"],
    [["password"], "password"],
    [[], null],
    [["link", "password"], null],
    [["sso"], null],
    [["sso", "link"], null],
  ])("reads %j as %j: one way the screen offers, or no choice", (methods, expected) => {
    expect(chosenMethod(methods)).toBe(expected);
  });
});

describe("draftFromSettings", () => {
  it("is the form of the settings as they are saved", () => {
    const draft = draftFromSettings(
      settings({ mode: "approval", access_methods: ["password"], waitlist_enabled: false, verify_email: false, ask_company: true, ask_department: true, max_companions: 1, consent_keys: ["photo"], styled_form_controls: true }),
    );

    expect(draft).toEqual({
      mode: "approval",
      method: "password",
      waitlist_enabled: false,
      verify_email: false,
      ask_company: true,
      ask_department: true,
      companion: true,
      consent_keys: ["photo"],
      styled_form_controls: true,
    });
  });

  it("has the styled boxes off for settings that do not have them on", () => {
    expect(draftFromSettings(settings()).styled_form_controls).toBe(false);
  });

  it("copies the consents, so editing the form never changes the settings it came from", () => {
    const saved = settings({ consent_keys: ["photo"] });
    const draft = draftFromSettings(saved);

    draft.consent_keys.push("news");

    expect(saved.consent_keys).toEqual(["photo"]);
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
    ["the way in", { method: "password" }, { access_methods: ["password"] }],
    ["the waiting list", { waitlist_enabled: false }, { waitlist_enabled: false }],
    ["the check of the address", { verify_email: false }, { verify_email: false }],
    ["the company", { ask_company: true }, { ask_company: true }],
    ["the department", { ask_department: true }, { ask_department: true }],
    ["a person to bring", { companion: true }, { max_companions: 1 }],
    ["the consents", { consent_keys: ["photo"] }, { consent_keys: ["photo"] }],
    ["the styled boxes", { styled_form_controls: true }, { styled_form_controls: true }],
  ])("holds only %s when that is all that changed", (_name, change, patch) => {
    const from = base({ mode: change.mode === null ? "approval" : null });
    expect(settingsPatch({ ...from, ...change }, from)).toEqual(patch);
  });

  it("holds the changed settings and no others when several changed", () => {
    expect(settingsPatch(base({ waitlist_enabled: false, ask_company: true, consent_keys: ["photo"] }), base())).toEqual({
      waitlist_enabled: false,
      ask_company: true,
      consent_keys: ["photo"],
    });
  });

  it("sends a person to bring as none when it was taken away", () => {
    expect(settingsPatch(base({ companion: false }), base({ companion: true }))).toEqual({ max_companions: 0 });
  });

  it("sends no way in as an empty list", () => {
    expect(settingsPatch(base({ method: null }), base({ method: "link" }))).toEqual({ access_methods: [] });
  });

  it("does not count the order of the consents as a change, and does count a consent that was added or taken off", () => {
    expect(settingsPatch(base({ consent_keys: ["b", "a"] }), base({ consent_keys: ["a", "b"] }))).toEqual({});
    expect(settingsPatch(base({ consent_keys: ["a", "b", "c"] }), base({ consent_keys: ["a", "b"] }))).toEqual({ consent_keys: ["a", "b", "c"] });
    expect(settingsPatch(base({ consent_keys: ["a"] }), base({ consent_keys: ["a", "b"] }))).toEqual({ consent_keys: ["a"] });
  });

  it("is made against the settings the form was made from, so a setting nobody touched is never written back", () => {
    // Somebody else turned the company off meanwhile: this form still holds the old value and must not undo that.
    const startedFrom = base({ ask_company: true });
    const form = { ...startedFrom, waitlist_enabled: false };

    expect(settingsPatch(form, startedFrom)).toEqual({ waitlist_enabled: false });
  });
});

describe("missingChecks", () => {
  it("names the checks that are not met, in order, and none when all are", () => {
    expect(missingChecks(checks("mail_provider", "legal_documents"))).toEqual(["legal_documents", "mail_provider"]);
    expect(missingChecks(checks())).toEqual([]);
  });
});

describe("consentOptions", () => {
  it("offers the published extra consents by their title, and not a draft, the privacy notice or the terms", () => {
    const items = texts(["photo", "Photos and video", true], ["news", "News about our events", false]);

    expect(consentOptions(items, [])).toEqual([{ id: "photo", label: "Photos and video" }]);
  });

  it("keeps a consent that is chosen and is not published, marked, so that it can be taken off", () => {
    const items = texts(["photo", "Photos and video", true], ["news", "News about our events", false]);

    expect(consentOptions(items, ["photo", "news"])).toEqual([
      { id: "photo", label: "Photos and video" },
      { id: "news", label: "News about our events (not published)" },
    ]);
  });

  it("names a chosen consent whose text is gone by its key", () => {
    expect(consentOptions(texts(), ["gone"])).toEqual([{ id: "gone", label: "gone (not published)" }]);
  });

  it("offers nothing for an event without extra consents", () => {
    expect(consentOptions(legalAnswer(texts()).items, [])).toEqual([]);
  });
});
