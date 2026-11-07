import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { LegalDocumentDto } from "../../src/api/types.js";
import {
  CONSENT_KEY_PATTERN,
  consentKeyProblem,
  consentTarget,
  defaultTitle,
  legalFormState,
  legalTextRows,
  missingTextName,
  planCopy,
  type LegalFormInput,
} from "../../src/registration/legalTexts.js";
import { legalDoc } from "./legalFixtures.js";

const privacy = (extra: Partial<LegalDocumentDto> = {}) => legalDoc("privacy-notice", extra);
const terms = (extra: Partial<LegalDocumentDto> = {}) => legalDoc("event-terms", extra);
const consent = (key: string, extra: Partial<LegalDocumentDto> = {}) => legalDoc(`consent-${key}`, extra);

describe("CONSENT_KEY_PATTERN", () => {
  it("is the rule the server keeps (apps/web/src/legal/legal-documents.ts)", () => {
    const server = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../web/src/legal/legal-documents.ts"), "utf8");
    const literal = /LEGAL_CONSENT_KEY_PATTERN\s*=\s*\/(.+)\/;/.exec(server);
    expect(literal?.[1]).toBe(CONSENT_KEY_PATTERN.source);
  });

  it.each(["photo", "a", "photo-consent_2", "0abc", "a".repeat(40)])("accepts %j", (key) => {
    expect(CONSENT_KEY_PATTERN.test(key)).toBe(true);
  });

  it.each(["", "Photo", "-photo", "_photo", "photo consent", "photo.consent", "a".repeat(41), "zażółć"])("refuses %j", (key) => {
    expect(CONSENT_KEY_PATTERN.test(key)).toBe(false);
  });
});

describe("consentTarget and defaultTitle", () => {
  it("names a consent by its key", () => {
    expect(consentTarget("photo")).toEqual({ ref: "consent-photo", kind: "consent", key: "photo" });
  });

  it("starts the privacy notice and the terms with their names and a consent with no title", () => {
    expect(defaultTitle("privacy_notice")).toBe("Privacy notice");
    expect(defaultTitle("event_terms")).toBe("Event terms");
    expect(defaultTitle("consent")).toBe("");
  });
});

describe("legalTextRows", () => {
  it("lists the privacy notice and the terms first even when neither is written", () => {
    expect(legalTextRows([]).map((row) => [row.target.ref, row.document])).toEqual([
      ["privacy-notice", null],
      ["event-terms", null],
    ]);
  });

  it("puts the texts that exist in their rows and the consents after them, in the order given", () => {
    const rows = legalTextRows([terms(), consent("b"), consent("a"), privacy()]);

    expect(rows.map((row) => [row.target.ref, row.document?.ref ?? null])).toEqual([
      ["privacy-notice", "privacy-notice"],
      ["event-terms", "event-terms"],
      ["consent-b", "consent-b"],
      ["consent-a", "consent-a"],
    ]);
    expect(rows[2]?.target).toEqual({ ref: "consent-b", kind: "consent", key: "b" });
  });
});

describe("missingTextName", () => {
  it("uses the title of a text that is written, and the name of its kind for one that is not", () => {
    const items = [privacy({ title: "How we use your data" }), consent("photo", { title: "Photos" })];

    expect(missingTextName({ ref: "privacy-notice", kind: "privacy_notice", key: null }, items)).toBe("How we use your data");
    expect(missingTextName({ ref: "consent-photo", kind: "consent", key: "photo" }, items)).toBe("Photos");
    expect(missingTextName({ ref: "event-terms", kind: "event_terms", key: null }, items)).toBe("Event terms");
    expect(missingTextName({ ref: "consent-video", kind: "consent", key: "video" }, items)).toBe('Consent "video"');
  });
});

describe("planCopy", () => {
  it("adds a text this event has not got, and replaces one it has, saying whether that one is published", () => {
    const plan = planCopy(
      [privacy({ title: "Source notice" }), terms(), consent("photo")],
      [privacy({ published: true }), terms({ published: false })],
      10,
    );

    expect(plan.steps.map((step) => [step.source.ref, step.action])).toEqual([
      ["privacy-notice", "replace_published"],
      ["event-terms", "replace_draft"],
      ["consent-photo", "add"],
    ]);
  });

  it("keeps the order of the source and leaves the texts it does not have alone", () => {
    const plan = planCopy([terms(), privacy()], [consent("here-only", { published: true })], 10);

    expect(plan.steps.map((step) => step.source.ref)).toEqual(["event-terms", "privacy-notice"]);
    expect(plan.steps.map((step) => step.action)).toEqual(["add", "add"]);
  });

  it("counts the consents this event would have, and says when that is more than it may", () => {
    const current = [consent("a"), consent("b"), consent("c")];
    const source = [consent("c"), consent("d"), consent("e")];

    expect(planCopy(source, current, 5)).toMatchObject({ consentsAfter: 5, overLimit: false });
    expect(planCopy(source, current, 4)).toMatchObject({ consentsAfter: 5, overLimit: true });
  });

  it("copies nothing from an event that has no texts", () => {
    expect(planCopy([], [privacy()], 10)).toEqual({ steps: [], consentsAfter: 0, overLimit: false });
  });
});

describe("consentKeyProblem", () => {
  const used = new Set(["photo"]);

  it("says nothing about a key that is not typed yet, or one that is fine", () => {
    expect(consentKeyProblem("", used)).toBeUndefined();
    expect(consentKeyProblem("video", used)).toBeUndefined();
  });

  it.each(["Photo", "-photo", "photo consent", "a".repeat(41)])("says what the rule is for %j", (key) => {
    expect(consentKeyProblem(key, used)).toMatch(/^Use lowercase letters, digits, hyphens and underscores, up to 40 characters/);
  });

  it("says when the event has a consent with the key", () => {
    expect(consentKeyProblem("photo", used)).toBe("This event already has a consent with this key.");
  });
});

describe("legalFormState", () => {
  const base: LegalFormInput = {
    title: "Privacy notice",
    savedTitle: "Privacy notice",
    html: "<p>Words</p>",
    baseline: "<p>Words</p>",
    contentLimit: 100,
    isNewConsent: false,
    keyText: "",
    keyProblem: undefined,
  };
  const state = (input: Partial<LegalFormInput>) => legalFormState({ ...base, ...input });

  it("has nothing to save when nothing changed since the text was loaded", () => {
    expect(state({})).toEqual({ dirty: false, empty: false, tooLong: false, canSave: false });
  });

  it("is changed by the title, by the words, and (for a new consent) by the key", () => {
    expect(state({ title: "How we use your data" }).dirty).toBe(true);
    expect(state({ html: "<p>More words</p>" }).dirty).toBe(true);
    expect(state({ isNewConsent: true, keyText: "p" }).dirty).toBe(true);
    expect(state({ keyText: "p" }).dirty).toBe(false);
  });

  it("is not changed before the editor has reported, however the title compares", () => {
    expect(state({ html: null, baseline: null })).toEqual({ dirty: false, empty: true, tooLong: false, canSave: false });
    expect(state({ html: "<p>Words</p>", baseline: null }).dirty).toBe(false);
  });

  it("can be saved when it is changed, has words, fits, and has a title", () => {
    expect(state({ html: "<p>More words</p>" }).canSave).toBe(true);
    expect(state({ title: "Renamed" }).canSave).toBe(true);
  });

  it.each([
    ["no words", { html: "", baseline: "<p>Words</p>" }],
    ["too many characters", { html: "x".repeat(101), baseline: "<p>Words</p>" }],
    ["a title that is only spaces", { title: "   " }],
    ["a new consent with no key", { isNewConsent: true, title: "Photos", html: "<p>I agree</p>", baseline: "", keyText: "" }],
    ["a new consent with a key that is refused", { isNewConsent: true, title: "Photos", html: "<p>I agree</p>", baseline: "", keyText: "Photo", keyProblem: "no" }],
  ])("cannot be saved with %s", (_name, input) => {
    expect(state(input).canSave).toBe(false);
  });

  it("can save a new consent with a key that is accepted", () => {
    expect(state({ isNewConsent: true, title: "Photos", html: "<p>I agree</p>", baseline: "", keyText: "photo" }).canSave).toBe(true);
  });

  it("says when the text is empty and when it is too long", () => {
    expect(state({ html: "" })).toMatchObject({ empty: true, tooLong: false });
    expect(state({ html: "x".repeat(101) })).toMatchObject({ empty: false, tooLong: true });
    expect(state({ html: "x".repeat(100) }).tooLong).toBe(false);
  });
});
