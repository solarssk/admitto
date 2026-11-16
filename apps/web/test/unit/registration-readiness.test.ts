import { describe, expect, it } from "vitest";
import type { RegistrantFormField } from "@admitto/tickets";
import { isRequiredFieldOffForm } from "../../src/registration/field-on-form.js";
import {
  READINESS_KEYS,
  chosenAccessMethod,
  evaluateRegistrationReadiness,
  publicFieldsOf,
  readinessBlockers,
  type EventReadinessFacts,
  type ReadinessEnvironment,
  type ReadinessInput,
  type RegistrationReadinessKey,
} from "../../src/registration/readiness.js";

/**
 * The checks of an event, one at a time. Nothing here touches a database: every key is broken alone on a baseline that is
 * ready, and the list must name that key and no other. The agreement with the public page (an event judged ready opens
 * its form) is in test/integration/registration-readiness.test.ts.
 */
const PUBLISHED = new Date("2026-10-20T10:00:00Z");

const PROVIDER = { id: "idp-1", display_name: "Example sign-in", kind: "generic" as const };

const environment = (overrides: Partial<ReadinessEnvironment> = {}): ReadinessEnvironment => ({
  botProtectionReady: true,
  botProtectionMode: "required",
  enabledSsoProviders: [PROVIDER],
  mailConfigured: true,
  instanceBaseUrl: "https://events.example.com",
  ...overrides,
});

const eventFacts = (overrides: Partial<EventReadinessFacts> = {}): EventReadinessFacts => ({
  archived: false,
  ended: false,
  legalRows: [
    { kind: "privacy_notice", key: "", title: "Privacy notice", published_at: PUBLISHED },
    { kind: "event_terms", key: "", title: "Event terms", published_at: PUBLISHED },
  ],
  fields: [],
  ...overrides,
});

const ready = (overrides: Partial<ReadinessInput> = {}): ReadinessInput => ({
  settings: { access_methods: ["link"], consent_keys: [], password_set: false, sso_provider_id: null },
  environment: environment(),
  event: eventFacts(),
  ...overrides,
});

const field = (overrides: Partial<RegistrantFormField> = {}): RegistrantFormField => ({
  label: "Parking",
  source_field: "parking",
  type: "text",
  show_on_form: true,
  ...overrides,
});

const keysOf = (input: ReadinessInput) => evaluateRegistrationReadiness(input).map((check) => check.key);
const blockersOf = (input: ReadinessInput) => readinessBlockers(evaluateRegistrationReadiness(input));

describe("a ready event", () => {
  it("meets every check, and lists them in the order of the vocabulary", () => {
    const checks = evaluateRegistrationReadiness(ready());

    expect(checks.every((check) => check.ok)).toBe(true);
    expect(readinessBlockers(checks)).toEqual([]);
    // The checks that do not apply to the link (the password, the identity provider) are not in the list; the rest keep the order.
    expect(keysOf(ready())).toEqual(
      READINESS_KEYS.filter((key) => key !== "password" && key !== "identity_provider" && key !== "bot_protection_not_used"),
    );
  });

  it("lists the password check, and only that one more, when the way in is the password", () => {
    const input = ready({ settings: { access_methods: ["password"], consent_keys: [], password_set: true, sso_provider_id: null } });

    expect(keysOf(input)).toEqual(READINESS_KEYS.filter((key) => key !== "identity_provider" && key !== "bot_protection_not_used"));
    expect(blockersOf(input)).toEqual([]);
  });
});

describe("bot protection set to not used (A2)", () => {
  const notUsed = (overrides: Partial<ReadinessInput> = {}) =>
    ready({
      environment: environment({ botProtectionMode: "not_used", botProtectionReady: false }),
      ...overrides,
    });

  it("lists the information row in the place of the bot check, and it is met", () => {
    const checks = evaluateRegistrationReadiness(notUsed());

    expect(checks.map((check) => check.key)).toContain("bot_protection_not_used");
    expect(checks.map((check) => check.key)).not.toContain("bot_protection");
    expect(checks.find((check) => check.key === "bot_protection_not_used")?.ok).toBe(true);
  });

  it("is not held up by missing Turnstile keys, for the link and for the password", () => {
    expect(blockersOf(notUsed())).toEqual([]);
    expect(blockersOf(notUsed({ settings: { access_methods: ["password"], consent_keys: [], password_set: true, sso_provider_id: null } }))).toEqual([]);
  });

  it("keeps the other checks: a password that is not set still blocks", () => {
    expect(blockersOf(notUsed({ settings: { access_methods: ["password"], consent_keys: [], password_set: false, sso_provider_id: null } }))).toEqual(["password"]);
  });

  it("says nothing about bot protection for the company sign-in", () => {
    const input = notUsed({ settings: { access_methods: ["sso"], consent_keys: [], password_set: false, sso_provider_id: null } });

    expect(keysOf(input)).not.toContain("bot_protection_not_used");
    expect(keysOf(input)).toContain("identity_provider");
  });
});

describe("the company sign-in (D-C4)", () => {
  const sso = (overrides: Partial<ReadinessInput> = {}) =>
    ready({
      settings: { access_methods: ["sso"], consent_keys: [], password_set: false, sso_provider_id: "idp-1" },
      environment: environment(),
      ...overrides,
    });

  it("asks for the identity provider in the place of the bot check, and for neither the password nor anything else", () => {
    const input = sso();

    expect(keysOf(input)).toEqual(
      READINESS_KEYS.filter((key) => key !== "password" && key !== "bot_protection" && key !== "bot_protection_not_used"),
    );
    expect(keysOf(input)).toContain("identity_provider");
    expect(blockersOf(input)).toEqual([]);
  });

  it("is not held up by the Turnstile keys: the form stands behind a sign-in, not a challenge", () => {
    const input = sso();

    expect(blockersOf({ ...input, environment: { ...input.environment, botProtectionReady: false } })).toEqual([]);
  });

  it("is held up by an identity provider that the event has not chosen, that is deleted, or that is switched off", () => {
    const input = sso();
    const withProvider = (sso_provider_id: string | null, enabledSsoProviders: ReadinessEnvironment["enabledSsoProviders"]) =>
      blockersOf({
        ...input,
        settings: { ...input.settings, sso_provider_id },
        environment: { ...input.environment, enabledSsoProviders },
      });

    expect(withProvider("idp-1", [PROVIDER])).toEqual([]);
    expect(withProvider(null, [PROVIDER])).toEqual(["identity_provider"]);
    // Deleted or switched off: the provider is not among the enabled ones.
    expect(withProvider("idp-1", [])).toEqual(["identity_provider"]);
    // Another provider is enabled, but it is not the event's.
    expect(withProvider("idp-1", [{ ...PROVIDER, id: "idp-2" }])).toEqual(["identity_provider"]);
  });

  it("does not ask the link or the password for the identity provider, whatever state it is in", () => {
    const input = ready({ environment: environment({ enabledSsoProviders: [] }) });

    expect(keysOf(input)).not.toContain("identity_provider");
    expect(blockersOf(input)).toEqual([]);
  });
});

describe("each check alone", () => {
  const rows: [RegistrationReadinessKey, ReadinessInput][] = [
    ["access_method", ready({ settings: { access_methods: [], consent_keys: [], password_set: false, sso_provider_id: null } })],
    ["access_method", ready({ settings: { access_methods: ["link", "password"], consent_keys: [], password_set: true, sso_provider_id: null } })],
    ["access_method", ready({ settings: { access_methods: ["sso", "link"], consent_keys: [], password_set: false, sso_provider_id: null } })],
    ["bot_protection", ready({ environment: environment({ botProtectionReady: false }) })],
    ["password", ready({ settings: { access_methods: ["password"], consent_keys: [], password_set: false, sso_provider_id: null } })],
    ["legal_documents", ready({ event: eventFacts({ legalRows: [] }) })],
    [
      "legal_documents",
      ready({
        settings: { access_methods: ["link"], consent_keys: ["photos"], password_set: false, sso_provider_id: null },
      }),
    ],
    ["form_questions", ready({ event: eventFacts({ fields: [field({ type: "select", required: true, options: [] })] }) })],
    ["required_fields", ready({ event: eventFacts({ fields: [field({ required: true, show_on_form: false })] }) })],
    ["mail_provider", ready({ environment: environment({ mailConfigured: false }) })],
    ["instance_url", ready({ environment: environment({ instanceBaseUrl: null }) })],
    ["event_not_archived", ready({ event: eventFacts({ archived: true }) })],
    ["event_not_ended", ready({ event: eventFacts({ ended: true }) })],
  ];

  it.each(rows)("%s alone is the only blocker", (key, input) => {
    expect(blockersOf(input)).toEqual([key]);
  });

  it("names the blockers in the order of the vocabulary when several are missing at once", () => {
    const broken = ready({
      settings: { access_methods: ["password"], consent_keys: [], password_set: false, sso_provider_id: null },
      environment: environment({ botProtectionReady: false, mailConfigured: false, instanceBaseUrl: null }),
      event: eventFacts({ legalRows: [], ended: true, archived: true }),
    });

    const blockers = blockersOf(broken);

    expect(blockers).toEqual(["bot_protection", "password", "legal_documents", "mail_provider", "instance_url", "event_not_archived", "event_not_ended"]);
    expect(blockers).toEqual(READINESS_KEYS.filter((key) => blockers.includes(key)));
  });

  it("names no check but the access method while none is chosen, and has no check of a list of enabled ways in any more", () => {
    const input = ready({ settings: { access_methods: [], consent_keys: [], password_set: false, sso_provider_id: null } });

    expect(blockersOf(input)).toEqual(["access_method"]);
    expect(READINESS_KEYS as readonly string[]).not.toContain("access_method_enabled");
  });

  it("holds a published consent as met and a draft one as missing", () => {
    const withConsent = (published_at: Date | null) =>
      ready({
        settings: { access_methods: ["link"], consent_keys: ["photos"], password_set: false, sso_provider_id: null },
        event: eventFacts({
          legalRows: [...eventFacts().legalRows, { kind: "consent", key: "photos", title: "Photos", published_at }],
        }),
      });

    expect(blockersOf(withConsent(PUBLISHED))).toEqual([]);
    expect(blockersOf(withConsent(null))).toEqual(["legal_documents"]);
  });

  it("does not take a question that the form does not ask for one that blocks it", () => {
    const hidden = ready({ event: eventFacts({ fields: [field({ required: false, show_on_form: false })] }) });
    const optionalChoiceWithoutOptions = ready({ event: eventFacts({ fields: [field({ type: "select", options: [] })] }) });

    expect(blockersOf(hidden)).toEqual([]);
    // An optional choice nobody can answer is simply left out of the form; only a required one closes it.
    expect(blockersOf(optionalChoiceWithoutOptions)).toEqual([]);
  });
});

describe("chosenAccessMethod", () => {
  it.each([
    [[], null],
    [["link"], "link"],
    [["password"], "password"],
    [["sso"], "sso"],
    [["link", "password"], null],
    [["sso", "link"], null],
    [["unknown"], null],
  ] as const)("%j is %s", (methods, expected) => {
    expect(chosenAccessMethod(methods)).toBe(expected);
  });
});

describe("isRequiredFieldOffForm", () => {
  it.each([
    [{ required: true, show_on_form: false }, true],
    [{ required: true, show_on_form: true }, false],
    [{ required: false, show_on_form: false }, false],
    [{ show_on_form: false }, false],
  ] as const)("%j is %s", (flags, expected) => {
    expect(isRequiredFieldOffForm(flags)).toBe(expected);
  });
});

describe("publicFieldsOf", () => {
  it("lists the questions the form asks, in the order given, with their label, type and whether they are required", () => {
    const fields = [
      field({ source_field: "parking", label: "Parking", type: "boolean" }),
      field({ source_field: "diet", label: "Diet", type: "select", options: ["Vegan", "Other"], required: true }),
      field({ source_field: "hidden", label: "Left from an import", show_on_form: false }),
    ];

    expect(publicFieldsOf(fields)).toEqual([
      { key: "parking", label: "Parking", type: "boolean", required: false },
      { key: "diet", label: "Diet", type: "select", required: true },
    ]);
  });

  it("lists nothing when the form cannot be drawn, because a form that is not shown asks nothing", () => {
    expect(publicFieldsOf([field({ type: "select", required: true, options: [] })])).toEqual([]);
  });
});
