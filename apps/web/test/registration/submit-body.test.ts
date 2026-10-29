import { describe, expect, it } from "vitest";
import {
  MAX_COMPANION_SLOTS,
  isReservedCustomDataSourceField,
  type RegistrantFormField,
} from "@admitto/tickets";
import { ERROR_KEY_COMPANION_NAME, companionAnswerErrorKey } from "../../src/registration/form-contract.js";
import {
  SUBMIT_MESSAGES,
  checkConsents,
  checkSubmission,
  invalidAnswerMessage,
  readEnvelope,
  type SubmissionEnvelope,
  type SubmissionRules,
} from "../../src/registration/submit-body.js";

const NOW = new Date("2026-10-23T10:00:00.000Z");

const field = (overrides: Partial<RegistrantFormField> & Pick<RegistrantFormField, "source_field">): RegistrantFormField => ({
  label: overrides.source_field,
  type: "text",
  required: false,
  show_on_form: true,
  ...overrides,
});

function rules(overrides: Partial<SubmissionRules> = {}): SubmissionRules {
  return { askCompany: true, askDepartment: true, fields: [], consentKeys: ["photos", "newsletter"], companionMax: 0, now: NOW, ...overrides };
}

const envelopeOf = (overrides: Record<string, unknown> = {}): SubmissionEnvelope => {
  const read = readEnvelope({
    first_name: "Ada",
    last_name: "Example",
    email: "ada.example@example.com",
    terms: true,
    consents: [],
    challenge: "token",
    ...overrides,
  });
  if (!read) throw new Error("the fixture body is not an envelope");
  return read;
};

/** The sentences of a refused submission, by key; fails the test when it was not refused. */
function refusals(envelope: SubmissionEnvelope, over: Partial<SubmissionRules> = {}): Record<string, string> {
  const checked = checkSubmission(envelope, rules(over));
  if (checked.kind !== "invalid") throw new Error(`expected a refusal, got ${checked.kind}`);
  return Object.fromEntries(checked.errors);
}

describe("readEnvelope", () => {
  it("reads every key of the contract by its own value, and leaves out what is not there", () => {
    const body = {
      first_name: "Ada",
      last_name: "Example",
      email: "ada.example@example.com",
      company: "Example Corp",
      department: "Operations",
      custom_data: { diet: "vegan" },
      terms: true,
      consents: ["photos"],
      challenge: "token",
      password: "test-password",
    };

    expect(readEnvelope(body)).toEqual(body);
    expect(readEnvelope({})).toEqual({
      first_name: undefined,
      last_name: undefined,
      email: undefined,
      company: undefined,
      department: undefined,
      custom_data: undefined,
      terms: undefined,
      consents: undefined,
      challenge: undefined,
      password: undefined,
    });
  });

  it("reads the password as it came, a text or not, with its spaces, and does not judge it: that is for the route of an event that has one", () => {
    expect(readEnvelope({ password: "  test password  " })?.password).toBe("  test password  ");
    for (const raw of [12, null, true, ["a"], { a: 1 }, "x".repeat(70_000)]) expect(readEnvelope({ password: raw })?.password).toEqual(raw);
    expect(Object.hasOwn(readEnvelope({}) ?? {}, "password")).toBe(true);
  });

  it.each([
    ["null", null],
    ["a list", []],
    ["a string", "text"],
    ["a number", 7],
    ["a date", new Date()],
    ["a map", new Map()],
    ["a key the contract does not have", { first_name: "A", role: "admin" }],
    ["a key of the prototype chain", JSON.parse('{"__proto__":{"x":1}}')],
    ["custom_data that is a list", { custom_data: ["x"] }],
    ["custom_data that is a string", { custom_data: "x" }],
    ["custom_data that is an instance", { custom_data: new Date() }],
  ])("refuses %s", (_name, body) => {
    expect(readEnvelope(body)).toBeNull();
  });

  it("accepts custom_data that is null or an object, and an object with no prototype", () => {
    expect(readEnvelope({ custom_data: null })?.custom_data).toBeNull();
    expect(readEnvelope({ custom_data: Object.create(null) })?.custom_data).toEqual({});
  });
});

describe("checkSubmission: a form that is fine", () => {
  it("stores the names, the address and the time the terms were accepted, as the boundary normalises them", () => {
    const checked = checkSubmission(
      envelopeOf({ first_name: "  Ada ", last_name: "Lovelace-Example", email: "  Ada.Example@Example.COM " }),
      rules(),
    );

    expect(checked).toEqual({
      kind: "valid",
      registrant: {
        first_name: "Ada",
        last_name: "Lovelace-Example",
        email: "ada.example@example.com",
        accepted_at: NOW,
        consents: {},
      },
    });
  });

  it("records the extra consents that were ticked with the time, each once, and none that were not", () => {
    const checked = checkSubmission(envelopeOf({ consents: ["newsletter", "newsletter"] }), rules());

    expect(checked.kind === "valid" && checked.registrant.consents).toEqual({ newsletter: NOW.toISOString() });
  });

  it("takes company and department when the event asks for them, trimmed, and leaves out an empty one", () => {
    const asked = checkSubmission(envelopeOf({ company: "  Example Corp ", department: "   " }), rules());
    expect(asked.kind === "valid" && asked.registrant).toMatchObject({ company: "Example Corp" });
    expect(asked.kind === "valid" && "department" in asked.registrant).toBe(false);
  });

  it("does not read company or department when the event does not ask, even if the value is hostile", () => {
    const checked = checkSubmission(
      envelopeOf({ company: "<script>alert(1)</script>\u0000", department: 12 }),
      rules({ askCompany: false, askDepartment: false }),
    );

    expect(checked.kind).toBe("valid");
    expect(checked.kind === "valid" && "company" in checked.registrant).toBe(false);
    expect(checked.kind === "valid" && "department" in checked.registrant).toBe(false);
  });
});

describe("checkSubmission: the password of the event is not its business", () => {
  it("gives the same answer to a body with a password, of any kind, as to one without: the registrant holds none of it, and no field is refused for it", () => {
    const without = checkSubmission(envelopeOf(), rules());

    for (const password of ["test-password", "", "x".repeat(70_000), 12, null, ["test-password"], { value: "test-password" }]) {
      const checked = checkSubmission(envelopeOf({ password }), rules());
      expect(checked).toEqual(without);
      expect(JSON.stringify(checked)).not.toContain("test-password");
    }
  });

  it("refuses the same fields when a password comes with them, and never names the password among them", () => {
    const plain = refusals(envelopeOf({ email: "not an address", terms: false }));

    expect(refusals(envelopeOf({ email: "not an address", terms: false, password: "test-password" }))).toEqual(plain);
    expect(Object.keys(plain)).not.toContain("password");
  });
});

describe("checkSubmission: the fixed fields", () => {
  const tooLong = "x".repeat(101);

  it.each([
    ["empty", ""],
    ["only spaces", "   "],
    ["a link", "see https://evil.example"],
    ["a scheme without slashes", "mailto:ada"],
    ["an address", "ada@example.com"],
    ["more than 100 characters", tooLong],
    ["a control character", "Ada\u0000"],
    ["a right-to-left override", "Ada\u202eEvil"],
    ["a zero-width character", "Ada\u200bEvil"],
    ["a number", 7],
    ["an object", { first_name: "Ada" }],
    ["nothing", undefined],
  ])("refuses a first name that is %s, with the sentence for first names", (_name, value) => {
    expect(refusals(envelopeOf({ first_name: value }))).toEqual({ first_name: SUBMIT_MESSAGES.firstName });
  });

  it("refuses a last name the same way, with its own key", () => {
    expect(refusals(envelopeOf({ last_name: "ada@example.com" }))).toEqual({ last_name: SUBMIT_MESSAGES.lastName });
  });

  it.each([
    ["no at sign", "ada.example.com"],
    ["no domain", "ada@"],
    ["more than 254 characters", `${"a".repeat(250)}@example.com`],
    ["an address of erased attendees", "erased-ada@erased.invalid"],
    ["the same in capitals", "ERASED-ADA@Erased.Invalid"],
    ["a control character", "ada@example.com\r\nBcc: x@example.com"],
    ["a number", 5],
    ["nothing", undefined],
  ])("refuses an address that is %s", (_name, value) => {
    expect(refusals(envelopeOf({ email: value }))).toEqual({ email: SUBMIT_MESSAGES.email });
  });

  it.each([[false], [undefined], [null], ["true"], [1], ["yes"]])(
    "does not take %s for the acceptance of the terms",
    (value) => {
      expect(refusals(envelopeOf({ terms: value }))).toEqual({ terms: SUBMIT_MESSAGES.terms });
    },
  );

  it("says everything that is wrong in one answer", () => {
    const all = refusals(
      envelopeOf({ first_name: "", last_name: "", email: "x", company: "\u0000", department: "\u0000", terms: false }),
    );

    expect(Object.keys(all).sort()).toEqual(["company", "department", "email", "first_name", "last_name", "terms"]);
  });

  it("refuses company and department that are hostile when the event asks for them", () => {
    expect(refusals(envelopeOf({ company: "x".repeat(101) }))).toEqual({ company: SUBMIT_MESSAGES.company });
    expect(refusals(envelopeOf({ department: "a\u202eb" }))).toEqual({ department: SUBMIT_MESSAGES.department });
    expect(refusals(envelopeOf({ company: 3 }))).toEqual({ company: SUBMIT_MESSAGES.company });
  });
});

describe("checkConsents", () => {
  const allowed = ["photos", "newsletter"];

  it("takes none when there is no list", () => {
    expect(checkConsents(undefined, allowed)).toEqual([]);
    expect(checkConsents(null, allowed)).toEqual([]);
    expect(checkConsents([], allowed)).toEqual([]);
  });

  it("keeps each ticked key once", () => {
    expect(checkConsents(["photos"], allowed)).toEqual(["photos"]);
    expect(checkConsents(["photos", "photos"], allowed)).toEqual(["photos"]);
  });

  it.each([
    ["a key of no consent of this event", ["marketing"]],
    ["a key of a consent of another event", ["photos", "partners"]],
    ["a list longer than the consents there are", ["photos", "photos", "newsletter"]],
    ["something that is not a string", [7]],
    ["a key that tries the prototype chain", ["__proto__"]],
    ["a string instead of a list", "photos"],
    ["an object", { photos: true }],
  ])("refuses %s", (_name, value) => {
    expect(checkConsents(value, allowed)).toBeNull();
  });

  it("is a malformed request, with no word about a field, when the list is not that", () => {
    expect(checkSubmission(envelopeOf({ consents: ["marketing"] }), rules())).toEqual({ kind: "malformed" });
    expect(checkSubmission(envelopeOf({ consents: "photos" }), rules())).toEqual({ kind: "malformed" });
  });
});

describe("checkSubmission: the questions of the organiser", () => {
  const diet = field({ source_field: "diet", type: "select", options: ["vegan", "none"], required: true });
  const note = field({ source_field: "note", type: "text", rules: { max_length: 5 } });
  const story = field({ source_field: "story", type: "long_text" });
  const day = field({ source_field: "day", type: "date" });
  const arrival = field({ source_field: "arrival", type: "datetime" });
  const mobile = field({ source_field: "mobile", type: "phone" });
  const badge = field({ source_field: "badge", type: "boolean" });
  const fields = [diet, note, story, day, arrival, mobile, badge];

  const answers = (custom: Record<string, unknown>) => envelopeOf({ custom_data: custom });
  const refusedWith = (custom: Record<string, unknown>, over: Partial<SubmissionRules> = {}) =>
    refusals(answers(custom), { fields, ...over });

  it("stores the answers as the boundary writes them, and leaves out the questions that were not answered", () => {
    const checked = checkSubmission(
      answers({ diet: "vegan", mobile: " +48 600 100 200 ", day: "2099-05-13", arrival: "2099-05-13T18:30", badge: "true" }),
      rules({ fields }),
    );

    expect(checked.kind === "valid" && checked.registrant.custom_data).toEqual({
      diet: "vegan",
      mobile: "+48600100200",
      day: "2099-05-13",
      arrival: "2099-05-13T18:30",
      badge: "true",
    });
  });

  it("stores no custom_data when there is none to store", () => {
    const checked = checkSubmission(envelopeOf(), rules({ fields: [note] }));
    expect(checked.kind === "valid" && "custom_data" in checked.registrant).toBe(false);
  });

  it("says a required question is unanswered, whether it is left out or empty", () => {
    expect(refusedWith({})).toEqual({ "custom_data.diet": SUBMIT_MESSAGES.answerMissing });
    expect(refusedWith({ diet: "   " })).toEqual({ "custom_data.diet": SUBMIT_MESSAGES.answerMissing });
    expect(refusedWith({ diet: null })).toEqual({ "custom_data.diet": SUBMIT_MESSAGES.answerMissing });
  });

  it.each([
    ["a choice that is not an option", "diet", "carnivore", "Choose one of the options."],
    ["a short text over its rule", "note", "123456", "Check this answer. It is too long or does not follow the rules shown."],
    ["a long text over 1000 characters", "story", "x".repeat(1001), "Check this answer. It is too long or has characters we cannot accept."],
    ["a day that does not exist", "day", "2099-02-30", "Enter a valid date."],
    ["a time that does not exist", "arrival", "2099-05-13T25:00", "Enter a valid date and time."],
    ["a phone number that is no number", "mobile", "call me", "Enter a valid phone number."],
    ["a Yes/No that is neither", "badge", "maybe", "Choose Yes or No."],
  ])("names the question and gives the sentence of its kind for %s", (_name, key, value, sentence) => {
    expect(refusedWith({ diet: "vegan", [key]: value })).toEqual({ [`custom_data.${key}`]: sentence });
  });

  it.each([[7], [true], [["vegan"]], [{ value: "vegan" }]])("refuses an answer that is %j, where a string belongs, for that question only", (value) => {
    expect(Object.keys(refusedWith({ diet: "vegan", note: value }))).toEqual(["custom_data.note"]);
  });

  it("reports every question that is refused, and no other", () => {
    expect(Object.keys(refusedWith({ diet: "nope", day: "yesterday", mobile: "x" })).sort()).toEqual([
      "custom_data.day",
      "custom_data.diet",
      "custom_data.mobile",
    ]);
  });

  it("drops the answers to keys that are no question of the form, with no word about them", () => {
    const payload = JSON.parse(
      '{"diet":"vegan","import_only":"x","company":"y","constructor":"z","__proto__":"w","hidden":"v"}',
    ) as Record<string, unknown>;
    const withHidden = [diet, field({ source_field: "hidden", show_on_form: false })];

    const checked = checkSubmission(answers(payload), rules({ fields: withHidden }));

    expect(checked.kind === "valid" && checked.registrant.custom_data).toEqual({ diet: "vegan" });
  });

  it("treats a question about a companion as none of the guest's: not asked, not required, its answer dropped", () => {
    const asked = [diet, field({ source_field: "companion_badge", required: true, applies_to: "companion" })];

    const unanswered = checkSubmission(answers({ diet: "vegan" }), rules({ fields: asked }));
    expect(unanswered.kind === "valid" && unanswered.registrant.custom_data).toEqual({ diet: "vegan" });

    const answered = checkSubmission(answers({ diet: "vegan", companion_badge: "Badge Name" }), rules({ fields: asked }));
    expect(answered.kind === "valid" && answered.registrant.custom_data).toEqual({ diet: "vegan" });

    // Not even a hostile answer to it is looked at: it is no question of the guest's, so there is nothing to refuse.
    const hostile = checkSubmission(answers({ diet: "vegan", companion_badge: 5 }), rules({ fields: asked }));
    expect(hostile.kind === "valid" && hostile.registrant.custom_data).toEqual({ diet: "vegan" });
  });

  it("refuses a body with more answers than an event may have questions, as malformed, naming no question", () => {
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, "x"]));

    expect(checkSubmission(answers({ diet: "vegan", ...many }), rules({ fields }))).toEqual({ kind: "malformed" });
  });

  describe("a question that waits for another answer", () => {
    const parking = field({ source_field: "parking", type: "boolean" });
    const plate = field({
      source_field: "plate",
      type: "text",
      required: true,
      rules: { show_when: { field: "parking", value: true } },
    });
    const conditional = [parking, plate];
    const refuseCondition = (custom: Record<string, unknown>) => refusals(answers(custom), { fields: conditional });

    it("does not read the answer to a question that is not asked, however hostile, and does not require it", () => {
      for (const custom of [{}, { plate: "\u0000" }, { parking: "false", plate: 12 }, { plate: "x".repeat(500) }]) {
        const checked = checkSubmission(answers(custom), rules({ fields: conditional }));
        expect(checked.kind).toBe("valid");
        expect(checked.kind === "valid" && checked.registrant.custom_data?.["plate"]).toBeUndefined();
      }
    });

    it("requires it once the answer that asks it is given, and judges it", () => {
      expect(refuseCondition({ parking: "true" })).toEqual({ "custom_data.plate": SUBMIT_MESSAGES.answerMissing });
      expect(refuseCondition({ parking: "true", plate: "x".repeat(101) })).toEqual({
        "custom_data.plate": "Check this answer. It is too long or does not follow the rules shown.",
      });
      const ok = checkSubmission(answers({ parking: "true", plate: "AB 123" }), rules({ fields: conditional }));
      expect(ok.kind === "valid" && ok.registrant.custom_data).toEqual({ parking: "true", plate: "AB 123" });
    });

    it("blames the question the condition names, and only that one, when its own answer is refused", () => {
      expect(refuseCondition({ parking: "maybe", plate: "AB 123" })).toEqual({ "custom_data.parking": "Choose Yes or No." });
    });
  });
});

describe("the sentences", () => {
  it("are a fixed set: whatever the input, no refusal repeats a word of it", () => {
    const hostile = [
      "<script>alert('xss-marker')</script>",
      "secret.guest@example.com",
      "Ünïcödé 🎉 marker",
      "line one\nline two marker",
      "x".repeat(2000),
      "\u202emarker",
      "'; DROP TABLE users; -- marker",
    ];
    const fixed = new Set<string>([
      ...Object.values(SUBMIT_MESSAGES),
      "Check this answer. It is too long or does not follow the rules shown.",
      "Check this answer. It is too long or has characters we cannot accept.",
      "Enter a valid date.",
      "Enter a valid date and time.",
      "Enter a valid phone number.",
      "Choose one of the options.",
      "Choose Yes or No.",
      "Check this answer.",
    ]);
    const fields = [
      field({ source_field: "a", type: "text", rules: { max_length: 3 } }),
      field({ source_field: "b", type: "long_text", rules: { max_length: 3 } }),
      field({ source_field: "c", type: "date" }),
      field({ source_field: "d", type: "datetime" }),
      field({ source_field: "e", type: "phone" }),
      field({ source_field: "f", type: "select", options: ["x"] }),
      field({ source_field: "g", type: "boolean" }),
    ];

    for (const value of hostile) {
      const custom = Object.fromEntries(fields.map((f) => [f.source_field, value]));
      const checked = checkSubmission(
        envelopeOf({ first_name: value, last_name: value, email: value, company: value, department: value, terms: value, custom_data: custom }),
        rules({ fields }),
      );
      expect(checked.kind).toBe("invalid");
      if (checked.kind !== "invalid") continue;
      // Every question is refused, and so is the acceptance of the terms; a name may be any text that is no link.
      for (const key of ["a", "b", "c", "d", "e", "f", "g"]) expect(checked.errors.has(`custom_data.${key}`)).toBe(true);
      expect(checked.errors.has("terms")).toBe(true);
      for (const message of checked.errors.values()) {
        expect(fixed.has(message)).toBe(true);
        expect(message).not.toContain("marker");
        expect(message).not.toContain("@example.com");
      }
    }
  });

  it("have a fallback for a question of a type this version does not know", () => {
    expect(invalidAnswerMessage(field({ source_field: "x", type: "hologram" as never }))).toBe("Check this answer.");
    expect(invalidAnswerMessage(field({ source_field: "y", type: undefined }))).toBe(
      "Check this answer. It is too long or does not follow the rules shown.",
    );
  });
});

describe("the companions of the body (D-E5)", () => {
  const asked = (key: string, overrides: Partial<RegistrantFormField> = {}) => field({ source_field: key, applies_to: "companion", ...overrides });
  /** The guest's own question, and the questions about a companion: a required one, a choice, a Yes/No and a question that waits for the Yes/No. */
  const FIELDS: RegistrantFormField[] = [
    field({ source_field: "diet", type: "select", options: ["Vegan", "None"] }),
    asked("badge", { required: true }),
    asked("allergy", { type: "select", options: ["Nuts", "None"] }),
    asked("car", { type: "boolean" }),
    asked("plate", { rules: { show_when: { field: "car", value: true } } }),
  ];
  const takes = (over: Partial<SubmissionRules> = {}) => rules({ fields: FIELDS, companionMax: 1, ...over });
  const bring = (companions: unknown, over: Partial<SubmissionRules> = {}) => checkSubmission(envelopeOf({ companions }), takes(over));
  const withAnswers = (answers: Record<string, unknown>, name: unknown = "Piotr Kowalski") => [{ name, answers }];
  const registrantOf = (result: ReturnType<typeof checkSubmission>) => {
    if (result.kind !== "valid") throw new Error(`expected a valid submission, got ${result.kind}`);
    return result.registrant;
  };
  const errorsOf = (result: ReturnType<typeof checkSubmission>): Record<string, string> => {
    if (result.kind !== "invalid") throw new Error(`expected a refusal, got ${result.kind}`);
    return Object.fromEntries(result.errors);
  };

  it("reads the key from the body, and nothing of the list or its entries yet", () => {
    const companions = [{ name: "Piotr", answers: { badge: "P" } }];
    expect(readEnvelope({ companions })?.companions).toEqual(companions);
    expect(readEnvelope({})?.companions).toBeUndefined();
  });

  it.each([0, 1])("takes none from a body that has none, whatever the event takes (%i): no required question about a companion is asked", (max) => {
    const registrant = registrantOf(bring(undefined, { companionMax: max }));
    expect(registrant).not.toHaveProperty("companions");
  });

  it("takes `companions: null` as none only for an event that takes companions: for one that takes none the key is not one the page sends", () => {
    expect(registrantOf(bring(null, { companionMax: 1 }))).not.toHaveProperty("companions");
    expect(bring(null, { companionMax: 0 }).kind).toBe("malformed");
  });

  it.each([[[]], [[{ name: "Piotr" }]], ["Piotr"], [{}], [1], [true]])(
    "refuses a body that has the companions of an event that takes none (%j) as a body the page did not send, as it does a key it does not know",
    (companions) => {
      expect(bring(companions, { companionMax: 0 }).kind).toBe("malformed");
    },
  );

  it.each([
    ["not a list", "Piotr"],
    ["an object", { name: "Piotr" }],
    ["a number", 1],
    ["an entry that is null", [null]],
    ["an entry that is a text", ["Piotr"]],
    ["an entry that is a list", [["Piotr"]]],
    ["an entry that is a number", [1]],
    ["an entry with a key the page does not send", [{ name: "Piotr", email: "p@example.com" }]],
    ["answers that are a text", [{ name: "Piotr", answers: "badge" }]],
    ["answers that are a list", [{ name: "Piotr", answers: ["badge"] }]],
    ["answers that are a number", [{ name: "Piotr", answers: 1 }]],
  ])("refuses a body whose companions are %s, as a body the page did not send", (_label, companions) => {
    expect(bring(companions).kind).toBe("malformed");
  });

  it("refuses an entry that has a `__proto__` key of its own, as it does any key the page does not send", () => {
    const body: unknown = JSON.parse('{"companions":[{"name":"Piotr","__proto__":{"polluted":"yes"}}]}');
    expect(checkSubmission(readEnvelope(body)!, takes()).kind).toBe("malformed");
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("refuses more companions than the event takes, with one sentence under the row, and judges nothing else of them", () => {
    const two = [{ name: "" }, { name: "Maria", answers: { badge: 5 } }];
    expect(errorsOf(bring(two))).toEqual({ companions: SUBMIT_MESSAGES.tooManyCompanions });
  });

  it("takes a companion with the name composed and trimmed, and the answers to the questions about a companion", () => {
    const answers = { badge: "Piotr", allergy: "Nuts", car: "true", plate: "WA 12345" };
    expect(registrantOf(bring(withAnswers(answers, "  Zoe\u0301 Kowalski  "))).companions).toEqual([
      { name: "Zo\u00e9 Kowalski", custom_data: answers },
    ]);
  });

  it("stores no answers as null, as the registration keeps them", () => {
    const optionalOnly = takes({ fields: [asked("allergy", { type: "select", options: ["Nuts"] })] });
    const registrant = registrantOf(checkSubmission(envelopeOf({ companions: [{ name: "Piotr" }] }), optionalOnly));
    expect(registrant.companions).toEqual([{ name: "Piotr", custom_data: null }]);
  });

  it("takes a name of a hundred characters, and of a hundred emoji", () => {
    for (const name of ["x".repeat(100), "\u{1F600}".repeat(100)]) {
      expect(registrantOf(bring(withAnswers({ badge: "b" }, name))).companions?.[0]?.name).toBe(name);
    }
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["a number", 5],
    ["a list", ["Piotr"]],
    ["empty", ""],
    ["only spaces", "   "],
    ["over a hundred characters", "x".repeat(101)],
    ["a link", "https://evil.example"],
    ["a link without slashes", "javascript:alert(1)"],
    ["an address", "piotr@example.com"],
    ["a web address", "www.evil.example"],
    ["a control character", "Piotr\u0000"],
    ["a line break", "Piotr\nKowalski"],
    ["a bidirectional override", "Piotr\u202eKowalski"],
    ["a zero-width character", "Piotr\u200bKowalski"],
  ])("refuses a name that is %s, with the one sentence of the name field and none of what was typed", (_label, name) => {
    const errors = errorsOf(bring([{ name, answers: { badge: "b" } }]));
    expect(errors).toEqual({ companion_name: SUBMIT_MESSAGES.companionName });
  });

  it("reads only the questions about a companion that are on the form: the guest's own, an unknown key and the names that an object has of its own are left out, with no error", () => {
    const answers: unknown = JSON.parse(
      '{"badge":"b","diet":"Vegan","foo":"bar","constructor":"x","prototype":"y","__proto__":{"polluted":"yes"},"toString":"z"}',
    );
    const registrant = registrantOf(bring([{ name: "Piotr", answers }]));
    const stored = registrant.companions?.[0]?.custom_data;
    expect(stored).toEqual({ badge: "b" });
    expect(Object.getPrototypeOf(stored)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("leaves out a question about a companion that is not on the form, and refuses nothing for it", () => {
    const hidden = takes({ fields: [asked("badge"), asked("secret", { show_on_form: false, required: true })] });
    const registrant = registrantOf(checkSubmission(envelopeOf({ companions: withAnswers({ badge: "b", secret: "s" }) }), hidden));
    expect(registrant.companions?.[0]?.custom_data).toEqual({ badge: "b" });
  });

  it("refuses answers with more keys than an event may have questions, when no single question is to blame", () => {
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`unknown_${i}`, "x"]));
    expect(bring(withAnswers({ badge: "b", ...many })).kind).toBe("malformed");
  });

  it("asks a required question about the companion, once a companion is brought", () => {
    for (const answers of [{}, { badge: "" }, { badge: "   " }]) {
      expect(errorsOf(bring(withAnswers(answers)))).toEqual({ companion_badge: SUBMIT_MESSAGES.answerMissing });
    }
  });

  it("refuses an answer that is not one of the question, with the sentence of its type, under the name of the companion's question", () => {
    const errors = errorsOf(bring(withAnswers({ badge: "b", allergy: "Dust", car: "maybe" })));
    expect(errors).toEqual({
      companion_allergy: invalidAnswerMessage(asked("allergy", { type: "select" })),
      companion_car: invalidAnswerMessage(asked("car", { type: "boolean" })),
    });
  });

  it("refuses an answer that is not a text, and a text that is hostile, as it does the guest's own", () => {
    expect(Object.keys(errorsOf(bring(withAnswers({ badge: 7 }))))).toEqual(["companion_badge"]);
    expect(Object.keys(errorsOf(bring(withAnswers({ badge: "b\u202ec" }))))).toEqual(["companion_badge"]);
  });

  it("does not read a question that waits for another answer unless that answer is given, and then requires it only if it is required", () => {
    expect(registrantOf(bring(withAnswers({ badge: "b", plate: "WA 1" }))).companions?.[0]?.custom_data).toEqual({ badge: "b" });
    expect(registrantOf(bring(withAnswers({ badge: "b", car: "true", plate: "WA 1" }))).companions?.[0]?.custom_data).toEqual({
      badge: "b",
      car: "true",
      plate: "WA 1",
    });
    const strict = takes({ fields: [asked("car", { type: "boolean" }), asked("plate", { required: true, rules: { show_when: { field: "car", value: true } } })] });
    expect(registrantOf(checkSubmission(envelopeOf({ companions: withAnswers({}) }), strict)).companions?.[0]?.custom_data).toBeNull();
    expect(errorsOf(checkSubmission(envelopeOf({ companions: withAnswers({ car: "true" }) }), strict))).toEqual({
      companion_plate: SUBMIT_MESSAGES.answerMissing,
    });
  });

  it("names only the controller when it is refused itself: the answer to a question that waits for it is not known", () => {
    expect(Object.keys(errorsOf(bring(withAnswers({ badge: "b", car: "maybe", plate: "WA 1" }))))).toEqual(["companion_car"]);
  });

  it("judges the guest's answers and the companion's apart, each by its own question, even for a key that both would have (an event has each key once)", () => {
    const both = takes({
      fields: [
        field({ source_field: "size", type: "select", options: ["S", "M"] }),
        asked("size", { type: "select", options: ["XL", "XXL"] }),
      ],
    });
    const ok = checkSubmission(envelopeOf({ custom_data: { size: "S" }, companions: withAnswers({ size: "XL" }) }), both);
    const registrant = registrantOf(ok);
    expect(registrant.custom_data).toEqual({ size: "S" });
    expect(registrant.companions?.[0]?.custom_data).toEqual({ size: "XL" });
    const swapped = checkSubmission(envelopeOf({ custom_data: { size: "XL" }, companions: withAnswers({ size: "S" }) }), both);
    expect(errorsOf(swapped)).toEqual({
      "custom_data.size": "Choose one of the options.",
      companion_size: "Choose one of the options.",
    });
  });

  it("asks no question about the companion when the guest brings none, even a required one", () => {
    expect(registrantOf(checkSubmission(envelopeOf(), takes()))).not.toHaveProperty("companions");
  });

  it("tells the guest all that is wrong at once, the companion's included, and says nothing of what was typed", () => {
    const body = envelopeOf({ first_name: "", terms: false, companions: withAnswers({ allergy: "Dust" }, "<script>alert(1)</script>@x") });
    const errors = errorsOf(checkSubmission(body, takes()));
    expect(Object.keys(errors).sort()).toEqual(["companion_allergy", "companion_badge", "companion_name", "first_name", "terms"]);
    expect(Object.values(errors).some((message) => message.includes("script") || message.includes("Dust"))).toBe(false);
  });

  it("keeps the names of the errors of the companion apart from the guest's: the one key that would take the place of the name cannot be a question's", () => {
    expect(["badge", "allergy", "car", "plate"].map((key) => companionAnswerErrorKey(key))).toEqual([
      "companion_badge",
      "companion_allergy",
      "companion_car",
      "companion_plate",
    ]);
    // `companion_` and `name` would be the name field's own: `name` is a fixed column, so no question has that key.
    expect(companionAnswerErrorKey("name")).toBe(ERROR_KEY_COMPANION_NAME);
    expect(isReservedCustomDataSourceField("name")).toBe(true);
  });

  it("is built for one companion: the page draws one, and its errors are named without a position", () => {
    expect(MAX_COMPANION_SLOTS, "the page draws one guest and names its errors by field: change both before raising this").toBe(1);
  });
});
