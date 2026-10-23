import { describe, expect, it } from "vitest";
import type { RegistrantFormField } from "@admitto/tickets";
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
  return { askCompany: true, askDepartment: true, fields: [], consentKeys: ["photos", "newsletter"], now: NOW, ...overrides };
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
