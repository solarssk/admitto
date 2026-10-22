import type { PrismaClient } from "@admitto/db";
import { loadRegistrantFormFields, type RegistrantFormField } from "@admitto/tickets";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadRegistrationPage } from "../../src/registration/form-model.js";
import { resolveAccessMethodAvailability } from "../../src/registration/access-methods.js";
import { resolveTurnstileKeys } from "../../src/registration/turnstile-settings.js";

vi.mock("../../src/registration/access-methods.js", () => ({ resolveAccessMethodAvailability: vi.fn() }));
vi.mock("../../src/registration/turnstile-settings.js", () => ({ resolveTurnstileKeys: vi.fn() }));
vi.mock("../../src/legal/registration-gate.js", () => ({
  loadRequiredLegalDocuments: vi.fn(async () => ({
    published: [
      { kind: "privacy_notice", key: "", title: "Privacy notice" },
      { kind: "event_terms", key: "", title: "Event terms" },
    ],
    missing: [],
  })),
}));
vi.mock("@admitto/mail-templates", () => ({
  resolveEventContactVars: vi.fn(async () => ({ contact_name: "", contact_email: "", contact_line: "" })),
}));
vi.mock("@admitto/tickets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@admitto/tickets")>()),
  loadRegistrantFormFields: vi.fn(async () => []),
}));

const row = {
  id: "evt-1",
  slug: "northwind-summit",
  title: "Northwind",
  date: new Date("2099-05-14T12:00:00Z"),
  timezone: "Europe/Warsaw",
  event_hours_start: null,
  event_hours_end: null,
  archived_at: null,
  logo_url: null,
  header_image_url: null,
  organization: { logo_url: null, header_image_url: null },
  location_details: null,
  registration_settings: {
    mode: "approval",
    access_methods: ["link"],
    verify_email: true,
    ask_company: false,
    ask_department: false,
    consent_keys: [],
  },
};

const db = { event: { findUnique: vi.fn(async () => row) } } as unknown as PrismaClient;
const NOW = new Date("2026-10-21T12:00:00Z");

const availability = (available: boolean) => [
  { method: "link" as const, enabled: true, available, blockedBy: null },
  { method: "password" as const, enabled: false, available: false, blockedBy: null },
  { method: "sso" as const, enabled: false, available: false, blockedBy: null },
];

beforeEach(() => {
  vi.mocked(resolveAccessMethodAvailability).mockResolvedValue(availability(true));
  vi.mocked(resolveTurnstileKeys).mockResolvedValue({ state: "ready", siteKey: "site-key", secret: "secret" });
});

describe("loadRegistrationPage, when the answers of its dependencies do not agree", () => {
  it("opens for an event whose link is available and whose keys are ready", async () => {
    const state = await loadRegistrationPage(db, "northwind-summit", NOW);
    expect(state.kind).toBe("open");
    if (state.kind === "open") expect(state.form.turnstileSiteKey).toBe("site-key");
  });

  it("does not open when the link was available a moment ago but the keys are not ready now", async () => {
    vi.mocked(resolveTurnstileKeys).mockResolvedValue({ state: "incomplete" });
    expect(await loadRegistrationPage(db, "northwind-summit", NOW)).toEqual({ kind: "not_found" });
    vi.mocked(resolveTurnstileKeys).mockResolvedValue({ state: "unreadable" });
    expect(await loadRegistrationPage(db, "northwind-summit", NOW)).toEqual({ kind: "not_found" });
  });

  it("does not open when the link is not available", async () => {
    vi.mocked(resolveAccessMethodAvailability).mockResolvedValue(availability(false));
    expect(await loadRegistrationPage(db, "northwind-summit", NOW)).toEqual({ kind: "not_found" });
  });

  it("is closed, with no contact, once the event is over, whatever the keys say", async () => {
    vi.mocked(resolveTurnstileKeys).mockResolvedValue({ state: "incomplete" });
    const over = new Date("2099-05-15T12:00:00Z");
    const state = await loadRegistrationPage(db, "northwind-summit", over);
    expect(state.kind).toBe("closed");
    if (state.kind === "closed") expect(state.page.contact).toBeNull();
  });

  it("does not look anything else up for a slug that cannot be an event's", async () => {
    const findUnique = vi.mocked(db.event.findUnique);
    findUnique.mockClear();
    expect(await loadRegistrationPage(db, "Bad Slug", NOW)).toEqual({ kind: "not_found" });
    expect(findUnique).not.toHaveBeenCalled();
    expect(resolveAccessMethodAvailability).not.toHaveBeenCalled();
  });
});

describe("loadRegistrationPage, and the questions it draws", () => {
  const field = (overrides: Partial<RegistrantFormField> & Pick<RegistrantFormField, "source_field">): RegistrantFormField => ({
    label: overrides.source_field,
    show_on_form: true,
    ...overrides,
  });
  /** The page of an event whose questions on the form are `fields`. */
  async function pageWith(fields: RegistrantFormField[]) {
    vi.mocked(loadRegistrantFormFields).mockResolvedValueOnce(fields);
    return loadRegistrationPage(db, "northwind-summit", NOW);
  }
  const questionsOf = async (fields: RegistrantFormField[]) => {
    const state = await pageWith(fields);
    if (state.kind !== "open") throw new Error(`the form is ${state.kind}`);
    return state.form.questions;
  };
  // A type this version of the page does not know, as a database row from a later version could hold it.
  const unknownType = "multi_select" as unknown as RegistrantFormField["type"];

  it.each(["long_text", "date", "datetime", "phone"] as const)("draws a required %s question, and the form stays open", async (type) => {
    expect(await questionsOf([field({ source_field: "q", type, required: true })])).toEqual([
      { key: "q", label: "q", description: null, required: true, type, options: [], rules: null },
    ]);
  });

  it("draws a text, a choice and a Yes/No question as before", async () => {
    const drawn = await questionsOf([
      field({ source_field: "a", type: "text", required: true }),
      field({ source_field: "b", type: "select", options: ["One"] }),
      field({ source_field: "c", type: "boolean" }),
      field({ source_field: "d" }),
    ]);
    expect(drawn.map((q) => [q.key, q.type])).toEqual([
      ["a", "text"],
      ["b", "select"],
      ["c", "boolean"],
      ["d", "text"],
    ]);
  });

  it("closes the form, as if registration were off, for a required question of a type it does not know", async () => {
    expect(await pageWith([field({ source_field: "later", type: unknownType, required: true })])).toEqual({ kind: "not_found" });
    expect(
      await pageWith([field({ source_field: "ok", type: "phone", required: true }), field({ source_field: "later", type: unknownType, required: true })]),
    ).toEqual({ kind: "not_found" });
  });

  it("leaves out an optional question of a type it does not know, and keeps the rest", async () => {
    const drawn = await questionsOf([field({ source_field: "later", type: unknownType }), field({ source_field: "ok", type: "date" })]);
    expect(drawn.map((q) => q.key)).toEqual(["ok"]);
  });

  it("closes the form for a required choice with no choices, as before", async () => {
    expect(await pageWith([field({ source_field: "pick", type: "select", required: true, options: [] })])).toEqual({ kind: "not_found" });
  });

  it("hands the rules of a text, a long text and a phone number to the page, and none for a type that takes none", async () => {
    const rules = { min_length: 3, max_length: 6, digits_only: true, example: "1234" };
    const drawn = await questionsOf(
      (["text", "long_text", "phone", "date", "datetime", "select", "boolean"] as const).map((type) =>
        field({ source_field: type, type, rules, options: type === "select" ? ["One"] : undefined }),
      ),
    );
    expect(drawn.map((q) => [q.key, q.rules])).toEqual([
      ["text", rules],
      ["long_text", rules],
      ["phone", rules],
      ["date", null],
      ["datetime", null],
      ["select", null],
      ["boolean", null],
    ]);
  });

  it("has no rules for a question that was saved without any", async () => {
    expect((await questionsOf([field({ source_field: "q", type: "phone" })]))[0]!.rules).toBeNull();
  });

  it("carries the event's time zone, and UTC for an event that has none saved", async () => {
    const zone = async () => {
      const state = await pageWith([]);
      return state.kind === "open" ? state.form.event.timezone : state.kind;
    };
    expect(await zone()).toBe("Europe/Warsaw");
    for (const none of ["", null]) {
      vi.mocked(db.event.findUnique).mockResolvedValueOnce({ ...row, timezone: none } as never);
      expect(await zone(), String(none)).toBe("UTC");
    }
  });
});
