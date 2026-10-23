import type { PrismaClient } from "@admitto/db";
import { loadRegistrantFormFields, type RegistrantFormField } from "@admitto/tickets";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadRegistrationPage, resolveConfirmation, resolveRegistration } from "../../src/registration/form-model.js";
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
      { key: "q", label: "q", description: null, required: true, type, options: [], rules: null, icon: null, showWhen: null, suggestions: [] },
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

  describe("an icon, a condition and suggestions", () => {
    const parking = field({ source_field: "parking", type: "boolean" });
    const plate = (rules: RegistrantFormField["rules"], overrides: Partial<RegistrantFormField> = {}) =>
      field({ source_field: "plate", type: "text", rules, ...overrides });
    const when = { field: "parking", value: true } as const;
    const keysOf = async (fields: RegistrantFormField[]) => (await questionsOf(fields)).map((q) => q.key);

    it("reads them into fields of their own, and keeps only the format rules in `rules`", async () => {
      const [, drawn] = await questionsOf([
        parking,
        plate({ icon: "car", show_when: when, suggestions: ["WA 1", "KR 2"], min_length: 2, max_length: 9, digits_only: false, example: "WA 12345" }),
      ]);
      expect(drawn).toEqual({
        key: "plate",
        label: "plate",
        description: null,
        required: false,
        type: "text",
        options: [],
        rules: { min_length: 2, max_length: 9, digits_only: false, example: "WA 12345" },
        icon: "car",
        showWhen: when,
        suggestions: ["WA 1", "KR 2"],
      });
    });

    it("has no format rules for a question that has only an icon, a condition or suggestions", async () => {
      const drawn = await questionsOf([parking, plate({ icon: "car", show_when: when, suggestions: ["WA 1"] })]);
      expect(drawn[1]!.rules).toBeNull();
    });

    it("has none of the three for a question saved without rules", async () => {
      const [drawn] = await questionsOf([plate(undefined)]);
      expect([drawn!.icon, drawn!.showWhen, drawn!.suggestions]).toEqual([null, null, []]);
    });

    it("keeps the icon of a question of every type, which all take one", async () => {
      const types = ["text", "long_text", "date", "datetime", "phone", "select", "boolean"] as const;
      const drawn = await questionsOf(
        types.map((type) => field({ source_field: type, type, rules: { icon: "pin" }, options: type === "select" ? ["One"] : undefined })),
      );
      expect(drawn.map((q) => [q.type, q.icon])).toEqual(types.map((type) => [type, "pin"]));
    });

    it("offers suggestions on a text question only, whatever a row holds", async () => {
      const suggestions = ["One", "Two"];
      const drawn = await questionsOf(
        (["text", "long_text", "phone", "date", "select", "boolean"] as const).map((type) =>
          field({ source_field: type, type, rules: { suggestions }, options: type === "select" ? ["One"] : undefined }),
        ),
      );
      expect(drawn.map((q) => [q.key, q.suggestions])).toEqual([
        ["text", suggestions],
        ["long_text", []],
        ["phone", []],
        ["date", []],
        ["select", []],
        ["boolean", []],
      ]);
    });

    it("draws a question with a condition, in the organiser's order, even before the question it names", async () => {
      expect(await keysOf([plate({ show_when: when }), parking])).toEqual(["plate", "parking"]);
    });

    it("draws a question under a choice, for an option of it", async () => {
      const day = field({ source_field: "day", type: "select", options: ["Both days", "Day 1"] });
      const hotel = field({ source_field: "hotel", rules: { show_when: { field: "day", value: "Both days" } } });
      expect(await keysOf([day, hotel])).toEqual(["day", "hotel"]);
    });

    it("leaves out a question with a condition that nothing can meet, whatever it asks, and does not close the form for it", async () => {
      const nothingToShow: Array<[string, RegistrantFormField[]]> = [
        ["a question that is not on the page", [plate({ show_when: when })]],
        ["a question that is off the form", [{ ...parking, show_on_form: false }, plate({ show_when: when })]],
        ["a question that is not a Yes/No or a choice", [field({ source_field: "parking", type: "text" }), plate({ show_when: when })]],
        ["a question that has a condition of its own", [parking, field({ source_field: "mid", rules: { show_when: when } }), plate({ show_when: { field: "mid", value: true } })]],
        ["the question itself", [plate({ show_when: { field: "plate", value: true } })]],
        ["a choice with no choices", [field({ source_field: "parking", type: "select" }), plate({ show_when: when })]],
      ];
      for (const [name, fields] of nothingToShow) {
        expect((await keysOf(fields)).includes("plate"), name).toBe(false);
        expect(await pageWith([...fields, plate({ show_when: when }, { required: true })]), `${name}, required`).not.toEqual({ kind: "not_found" });
      }
    });

    it("does not ask a required question that nothing can show, so it does not close the form", async () => {
      const state = await pageWith([plate({ show_when: when }, { required: true })]);
      expect(state.kind).toBe("open");
      if (state.kind === "open") expect(state.form.questions).toEqual([]);
    });

    it("closes the form for a required question it cannot draw when a guest can ask it, and not when nothing can", async () => {
      const stuck = (overrides: Partial<RegistrantFormField>) => field({ source_field: "later", type: unknownType, required: true, ...overrides });
      expect(await pageWith([parking, stuck({ rules: { show_when: when } })])).toEqual({ kind: "not_found" });
      expect((await pageWith([stuck({ rules: { show_when: when } })])).kind).toBe("open");
      expect(await pageWith([stuck({})])).toEqual({ kind: "not_found" });
      const noChoices = field({ source_field: "pick", type: "select", required: true, options: [], rules: { show_when: when } });
      expect(await pageWith([parking, noChoices])).toEqual({ kind: "not_found" });
      expect((await pageWith([noChoices])).kind).toBe("open");
    });

    it("closes the form for a required question it cannot draw only when the answer its condition asks for can be given", async () => {
      const stuck = (show_when: { field: string; value: string | true }) =>
        field({ source_field: "later", type: unknownType, required: true, rules: { show_when } });
      const meal = field({ source_field: "meal", type: "select", options: ["Standard", "Vegan"] });
      expect(await pageWith([meal, stuck({ field: "meal", value: "Vegan" })])).toEqual({ kind: "not_found" });
      // An option that was removed, or an answer a Yes/No cannot have, shows nothing, so nobody is stuck.
      expect((await pageWith([meal, stuck({ field: "meal", value: "Kosher" })])).kind).toBe("open");
      expect((await pageWith([parking, stuck({ field: "parking", value: "maybe" })])).kind).toBe("open");
      // A tick can only say Yes; a list of Yes and No can say No as well.
      expect((await pageWith([parking, stuck({ field: "parking", value: "false" })])).kind).toBe("open");
      expect(await pageWith([{ ...parking, required: true }, stuck({ field: "parking", value: "false" })])).toEqual({ kind: "not_found" });
    });

    it("leaves out a question whose condition asks for an answer its question cannot have, and does not close the form for it", async () => {
      const day = field({ source_field: "day", type: "select", options: ["Both days", "Day 1"] });
      const hotel = (value: string, overrides: Partial<RegistrantFormField> = {}) =>
        field({ source_field: "hotel", rules: { show_when: { field: "day", value } }, ...overrides });
      expect(await keysOf([day, hotel("Both days")])).toEqual(["day", "hotel"]);
      expect(await keysOf([day, hotel("Day 3")])).toEqual(["day"]);
      expect(await keysOf([parking, plate({ show_when: { field: "parking", value: "false" } })])).toEqual(["parking"]);
      expect((await pageWith([day, hotel("Day 3", { required: true })])).kind).toBe("open");
    });

    it("does not draw an optional question it cannot draw, under a condition or not", async () => {
      expect(await keysOf([parking, field({ source_field: "later", type: unknownType, rules: { show_when: when } })])).toEqual(["parking"]);
    });
  });
});

describe("resolveConfirmation: the event of a confirmation link", () => {
  const withRow = (changes: Record<string, unknown>) =>
    ({ event: { findUnique: vi.fn(async () => ({ ...row, ...changes })) } }) as unknown as PrismaClient;
  const settings = (changes: Record<string, unknown>) => ({ ...row.registration_settings, ...changes });

  it("opens for an event with registration on, with its id, its page and its contact", async () => {
    const state = await resolveConfirmation(db, "northwind-summit", NOW);

    expect(state).toMatchObject({ kind: "open", eventId: "evt-1", event: { slug: "northwind-summit", title: "Northwind" }, contact: null });
  });

  it("does not ask what the form needs: the way in, the keys of the bot check, the texts and the questions", async () => {
    vi.mocked(resolveAccessMethodAvailability).mockClear();
    vi.mocked(resolveTurnstileKeys).mockClear();
    vi.mocked(resolveAccessMethodAvailability).mockResolvedValue(availability(false));
    vi.mocked(resolveTurnstileKeys).mockResolvedValue({ state: "incomplete" });
    vi.mocked(loadRegistrantFormFields).mockClear();

    expect((await resolveConfirmation(db, "northwind-summit", NOW)).kind).toBe("open");
    expect((await resolveConfirmation(withRow({ registration_settings: settings({ access_methods: ["password"] }) }), "northwind-summit", NOW)).kind).toBe("open");

    expect(resolveAccessMethodAvailability).not.toHaveBeenCalled();
    expect(resolveTurnstileKeys).not.toHaveBeenCalled();
    expect(loadRegistrantFormFields).not.toHaveBeenCalled();
    // The form itself is closed meanwhile, as the same two answers say.
    expect(await resolveRegistration(db, "northwind-summit", NOW)).toEqual({ kind: "not_found" });
  });

  it("is not found for an event with registration off, without settings, or archived, and for a slug that cannot be an event's", async () => {
    expect(await resolveConfirmation(withRow({ registration_settings: settings({ mode: null }) }), "northwind-summit", NOW)).toEqual({ kind: "not_found" });
    expect(await resolveConfirmation(withRow({ registration_settings: null }), "northwind-summit", NOW)).toEqual({ kind: "not_found" });
    expect(await resolveConfirmation(withRow({ archived_at: new Date("2026-10-01T00:00:00Z") }), "northwind-summit", NOW)).toEqual({ kind: "not_found" });
    const untouched = withRow({});
    expect(await resolveConfirmation(untouched, "Bad Slug", NOW)).toEqual({ kind: "not_found" });
    expect(untouched.event.findUnique).not.toHaveBeenCalled();
    expect(await resolveConfirmation({ event: { findUnique: vi.fn(async () => null) } } as unknown as PrismaClient, "no-such-event", NOW)).toEqual({ kind: "not_found" });
  });

  it("is closed, with the event, once the event is over", async () => {
    const state = await resolveConfirmation(db, "northwind-summit", new Date("2099-05-15T12:00:00Z"));

    expect(state).toMatchObject({ kind: "closed", page: { event: { title: "Northwind" } } });
  });

  it("lets the same events through, shut out and close as the form does, which has the same rule", async () => {
    const rows: Array<Record<string, unknown>> = [
      {},
      { registration_settings: settings({ mode: null }) },
      { registration_settings: null },
      { archived_at: new Date("2026-10-01T00:00:00Z") },
    ];
    for (const now of [NOW, new Date("2099-05-15T12:00:00Z")]) {
      for (const changes of rows) {
        const fake = withRow(changes);
        expect((await resolveConfirmation(fake, "northwind-summit", now)).kind, JSON.stringify(changes)).toBe(
          (await resolveRegistration(fake, "northwind-summit", now)).kind,
        );
      }
    }
  });
});

describe("the password as the way in (D-C3)", () => {
  const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g";
  const withSettings = (changes: Record<string, unknown>) =>
    ({
      event: { findUnique: vi.fn(async () => ({ ...row, registration_settings: { ...row.registration_settings, access_methods: ["password"], password_hash: HASH, ...changes } })) },
    }) as unknown as PrismaClient;
  const passwordAvailability = (available: boolean) => [
    { method: "link" as const, enabled: false, available: false, blockedBy: null },
    { method: "password" as const, enabled: true, available, blockedBy: null },
    { method: "sso" as const, enabled: false, available: false, blockedBy: null },
  ];
  const OVER = new Date("2099-05-15T12:00:00Z");

  beforeEach(() => {
    vi.mocked(resolveAccessMethodAvailability).mockResolvedValue(passwordAvailability(true));
  });

  it("opens an event whose way in is the password and which has one, and asks for the password on its page", async () => {
    const state = await resolveRegistration(withSettings({}), "northwind-summit", NOW);

    expect(state.kind).toBe("open");
    if (state.kind === "open") {
      expect(state.form.needsPassword).toBe(true);
      expect(state.access).toEqual({ method: "password", passwordHash: HASH });
    }
  });

  it("gives the hash to the route that checks the password, and never to the page: the model of the page holds no word of it", async () => {
    const fake = withSettings({});
    const resolved = await resolveRegistration(fake, "northwind-summit", NOW);
    const page = await loadRegistrationPage(fake, "northwind-summit", NOW);

    expect(JSON.stringify(page)).not.toContain(HASH);
    expect(JSON.stringify(page)).not.toContain("argon2");
    expect(page).toEqual({ kind: "open", form: resolved.kind === "open" ? resolved.form : null });
    expect(page.kind === "open" ? Object.keys(page.form) : []).not.toContain("passwordHash");
  });

  it("is not found while the event has no password, over or not: as good as off", async () => {
    for (const passwordHash of [null, undefined, ""]) {
      const fake = withSettings({ password_hash: passwordHash });
      expect(await resolveRegistration(fake, "northwind-summit", NOW), String(passwordHash)).toEqual({ kind: "not_found" });
      expect(await resolveRegistration(fake, "northwind-summit", OVER), String(passwordHash)).toEqual({ kind: "not_found" });
      expect(await loadRegistrationPage(fake, "northwind-summit", NOW)).toEqual({ kind: "not_found" });
    }
  });

  it("is closed, like any event, once it is over, when it has a password", async () => {
    expect((await resolveRegistration(withSettings({}), "northwind-summit", OVER)).kind).toBe("closed");
  });

  it("is not found while the password is not available: the system administrator has not allowed it, or the keys of the bot check are not ready", async () => {
    vi.mocked(resolveAccessMethodAvailability).mockResolvedValue(passwordAvailability(false));
    expect(await resolveRegistration(withSettings({}), "northwind-summit", NOW)).toEqual({ kind: "not_found" });

    vi.mocked(resolveAccessMethodAvailability).mockResolvedValue(passwordAvailability(true));
    vi.mocked(resolveTurnstileKeys).mockResolvedValue({ state: "incomplete" });
    expect(await resolveRegistration(withSettings({}), "northwind-summit", NOW)).toEqual({ kind: "not_found" });
  });

  it("asks the availability of the way the event has, not of the link: an event of the link is not opened by a password that is available", async () => {
    vi.mocked(resolveAccessMethodAvailability).mockResolvedValue(passwordAvailability(true));

    expect(await resolveRegistration(withSettings({ access_methods: ["link"], password_hash: null }), "northwind-summit", NOW)).toEqual({ kind: "not_found" });
  });

  it("opens an event of the link as the link, whether or not a hash was left in its settings, and asks for no password", async () => {
    vi.mocked(resolveAccessMethodAvailability).mockResolvedValue(availability(true));
    for (const hash of [null, HASH]) {
      const state = await resolveRegistration(withSettings({ access_methods: ["link"], password_hash: hash }), "northwind-summit", NOW);

      expect(state.kind).toBe("open");
      if (state.kind === "open") {
        expect(state.access).toEqual({ method: "link" });
        expect(state.form.needsPassword).toBe(false);
      }
    }
  });

  it("is not found for a way in that is not built (the company sign-in), for none, and for more than one", async () => {
    for (const access_methods of [["sso"], [], ["password", "link"], ["link", "password"], ["unknown"]]) {
      expect(await resolveRegistration(withSettings({ access_methods }), "northwind-summit", NOW), access_methods.join()).toEqual({ kind: "not_found" });
    }
  });
});
