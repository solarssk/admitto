import { describe, expect, it } from "vitest";
import {
  MAX_CUSTOM_FIELDS_PER_EVENT,
  RegistrantInputError,
  buildRegistrantCustomData,
  normalizeRegistrantText,
  pickRegistrantProfileFields,
  registrantEmailSchema,
  registrantNameSchema,
  registrantTextSchema,
  type RegistrantFormField,
} from "../src/registrant-input.js";

const LONE_HIGH = "ab\uD800cd";
const LONE_LOW = "ab\uDC00cd";

describe("registrantNameSchema", () => {
  it("trims, composes to NFC and keeps ordinary names (accents, apostrophes, non-Latin)", () => {
    expect(registrantNameSchema.parse("  Zoé  ")).toBe("Zoé");
    expect(registrantNameSchema.parse("O'Brien-Nowak")).toBe("O'Brien-Nowak");
    expect(registrantNameSchema.parse("Łukasz")).toBe("Łukasz");
    expect(registrantNameSchema.parse("田中 太郎")).toBe("田中 太郎");
    expect(registrantNameSchema.parse("Zoë 😀")).toBe("Zoë 😀");
  });

  it.each([
    ["empty", ""],
    ["only spaces", "   "],
    ["NUL", "Ann\u0000"],
    ["CR", "Ann\rBob"],
    ["LF", "Ann\nBob"],
    ["CRLF in the middle", "Ann\r\nBcc: x@example.com"],
    ["tab", "Ann\tBob"],
    ["DEL", "Ann\u007f"],
    ["C1 control", "Ann\u0085"],
    ["right-to-left override U+202E", "Ann\u202etxt.exe"],
    ["bidi isolate U+2067", "Ann\u2067Bob"],
    ["left-to-right mark", "Ann\u200eBob"],
    ["zero-width space", "An​n"],
    ["zero-width joiner", "An‍n"],
    ["word joiner", "An⁠n"],
    ["BOM", "﻿Ann"],
    ["soft hyphen", "An­n"],
    ["line separator", "Ann Bob"],
    ["tag character", "Ann\u{E0041}"],
    ["combining grapheme joiner U+034F", "Ad\u034Fmin"],
    ["variation selector U+FE0F", "Ann\uFE0F"],
    ["Hangul filler U+3164", "Ann\u3164"],
    ["a scheme without slashes", "https:evil.example"],
    ["an uppercase scheme without slashes", "HTTP:evil.example"],
    ["lone high surrogate", LONE_HIGH],
    ["lone low surrogate", LONE_LOW],
    ["trailing high surrogate", "Ann\uD83D"],
    ["an address", "ann@example.com"],
    ["a bare at sign", "@ann"],
    ["a URL", "http://evil.example/x"],
    ["a scheme-relative URL", "see https://evil.example"],
    ["www", "www.evil.example"],
    ["a mailto", "mailto:a"],
    ["a javascript scheme", "javascript:alert(1)"],
    ["101 characters", "a".repeat(101)],
    ["a huge value", "a".repeat(2_000_000)],
  ])("rejects %s", (_label, value) => {
    expect(registrantNameSchema.safeParse(value).success).toBe(false);
  });

  it("counts code points, so 100 emoji fit and 101 do not", () => {
    expect(registrantNameSchema.safeParse("😀".repeat(100)).success).toBe(true);
    expect(registrantNameSchema.safeParse("😀".repeat(101)).success).toBe(false);
    expect(registrantNameSchema.safeParse("a".repeat(100)).success).toBe(true);
  });

  it("measures the length after trimming", () => {
    expect(registrantNameSchema.safeParse(`  ${"a".repeat(100)}  `).success).toBe(true);
  });

  it("rejects values that are not strings", () => {
    for (const value of [null, undefined, 1, true, {}, [], ["Ann"]]) {
      expect(registrantNameSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("registrantTextSchema", () => {
  it("rejects text longer than the limit instead of cutting it", () => {
    expect(registrantTextSchema(5).safeParse("abcdef").success).toBe(false);
    expect(registrantTextSchema(5).parse("abcde")).toBe("abcde");
  });

  it("allows an empty answer", () => {
    expect(registrantTextSchema(5).parse("  ")).toBe("");
  });
});

describe("normalizeRegistrantText", () => {
  it("returns null for anything that is not a string", () => {
    expect(normalizeRegistrantText(5, 10)).toBeNull();
    expect(normalizeRegistrantText(undefined, 10)).toBeNull();
  });
});

describe("registrantEmailSchema", () => {
  it("trims and lowercases", () => {
    expect(registrantEmailSchema.parse("  Jane.Doe@Example.COM ")).toBe("jane.doe@example.com");
  });

  it("treats the same address in another case as the same stored value", () => {
    expect(registrantEmailSchema.parse("A@x.com")).toBe(registrantEmailSchema.parse("a@X.COM"));
  });

  it.each([
    ["the erased placeholder", "erased-abc@erased.invalid"],
    ["the erased namespace in capitals", "Someone@ERASED.INVALID"],
    ["the erased namespace with padding", "  someone@erased.invalid  "],
    ["no at sign", "plain"],
    ["two at signs", "a@b@example.com"],
    ["no domain dot", "a@localhost"],
    ["a display name", "Ann <a@example.com>"],
    ["CRLF header injection", "a@example.com\r\nBcc: b@example.com"],
    ["LF", "a@example.com\n"],
    ["NUL", "a\u0000@example.com"],
    ["bidi override", "a@example.com\u202e"],
    ["zero-width space", "a​@example.com"],
    ["a lone surrogate", "a\uD800@example.com"],
    ["a non-ASCII look-alike", "аnn@example.com"],
    ["255 characters", `${"a".repeat(243)}@example.com`],
    ["a huge value", `${"a".repeat(2_000_000)}@example.com`],
  ])("rejects %s", (_label, value) => {
    expect(registrantEmailSchema.safeParse(value).success).toBe(false);
  });

  it("accepts an address of exactly 254 characters", () => {
    const local = "a".repeat(64);
    const domain = `${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(57)}.com`;
    const address = `${local}@${domain}`;
    expect(address).toHaveLength(254);
    expect(registrantEmailSchema.safeParse(address).success).toBe(true);
  });

  it("does not treat a lookalike domain as the reserved one", () => {
    expect(registrantEmailSchema.parse("a@erased.invalid.example.com")).toBe(
      "a@erased.invalid.example.com",
    );
  });

  it("rejects values that are not strings", () => {
    for (const value of [null, undefined, 1, {}, ["a@example.com"]]) {
      expect(registrantEmailSchema.safeParse(value).success).toBe(false);
    }
  });
});

const field = (over: Partial<RegistrantFormField> & { source_field: string }): RegistrantFormField => ({
  label: over.source_field,
  type: "text",
  show_on_form: true,
  ...over,
});

const FIELDS: RegistrantFormField[] = [
  field({ source_field: "diet" }),
  field({ source_field: "size", type: "select", options: ["S", "M"], required: true }),
  field({ source_field: "parking", type: "boolean" }),
  field({ source_field: "badge_note", show_on_form: false }),
  field({ source_field: "required_hidden", show_on_form: false, required: true }),
  field({ source_field: "plus_one_diet", applies_to: "companion" }),
  field({ source_field: "company" }),
];

describe("buildRegistrantCustomData", () => {
  it("keeps answers to form fields and nothing else", () => {
    const out = buildRegistrantCustomData(FIELDS, {
      diet: "  vegan ",
      size: "M",
      parking: true,
      badge_note: "import only",
      unknown: "x",
      plus_one_diet: "x",
      company: "Acme",
    });
    expect(out).toEqual({ diet: "vegan", size: "M", parking: "true" });
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });

  it("writes a checkbox as the strings 'true' and 'false'", () => {
    expect(buildRegistrantCustomData(FIELDS, { size: "S", parking: false })).toEqual({
      size: "S",
      parking: "false",
    });
    expect(buildRegistrantCustomData(FIELDS, { size: "S", parking: "yes" })).toEqual({
      size: "S",
      parking: "true",
    });
  });

  it("reads companion fields only when asked for them", () => {
    expect(
      buildRegistrantCustomData(FIELDS, { plus_one_diet: "halal", diet: "x", size: "S" }, "companion"),
    ).toEqual({ plus_one_diet: "halal" });
  });

  it("ignores __proto__, constructor and prototype without an error and without pollution", () => {
    const payload = JSON.parse(
      '{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}},"prototype":"x","size":"S"}',
    ) as unknown;
    const out = buildRegistrantCustomData(FIELDS, payload);
    expect(out).toEqual({ size: "S" });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(out ?? {})).toEqual(["size"]);
  });

  it("refuses an object with a custom prototype, so an inherited value is never read", () => {
    const input = Object.create({ diet: "inherited" }) as Record<string, unknown>;
    input.size = "S";
    expect(() => buildRegistrantCustomData(FIELDS, input)).toThrow(RegistrantInputError);
  });

  it("handles a field whose own key is a prototype name when the registry carries one", () => {
    const hostile = [field({ source_field: "__proto__" }), field({ source_field: "size", type: "select", options: ["S"] })];
    const out = buildRegistrantCustomData(hostile, JSON.parse('{"__proto__":"x","size":"S"}') as unknown);
    expect(out).toEqual({ size: "S" });
  });

  it("refuses a payload with more keys than an event may have fields (5000 keys)", () => {
    const payload: Record<string, string> = {};
    for (let i = 0; i < 5000; i += 1) payload[`k${i}`] = "x";
    expect(() => buildRegistrantCustomData(FIELDS, payload)).toThrow(RegistrantInputError);
  });

  it("accepts exactly the maximum number of keys", () => {
    const payload: Record<string, string> = { size: "S" };
    for (let i = 1; i < MAX_CUSTOM_FIELDS_PER_EVENT; i += 1) payload[`k${i}`] = "x";
    expect(buildRegistrantCustomData(FIELDS, payload)).toEqual({ size: "S" });
    payload.one_more = "x";
    expect(() => buildRegistrantCustomData(FIELDS, payload)).toThrow(RegistrantInputError);
  });

  it("refuses text over the limit instead of cutting it", () => {
    expect(() => buildRegistrantCustomData(FIELDS, { size: "S", diet: "a".repeat(101) })).toThrow(
      RegistrantInputError,
    );
    expect(buildRegistrantCustomData(FIELDS, { size: "S", diet: "a".repeat(100) })).toEqual({
      size: "S",
      diet: "a".repeat(100),
    });
  });

  it("refuses an enormous value without walking it", () => {
    expect(() => buildRegistrantCustomData(FIELDS, { size: "S", diet: "a".repeat(5_000_000) })).toThrow(
      RegistrantInputError,
    );
    expect(() => buildRegistrantCustomData(FIELDS, { size: "a".repeat(5_000_000) })).toThrow(
      RegistrantInputError,
    );
  });

  it.each([
    ["NUL", "a\u0000b"],
    ["CRLF", "a\r\nb"],
    ["U+202E", "a\u202eb"],
    ["zero-width space", "a​b"],
    ["a lone surrogate", LONE_HIGH],
  ])("refuses %s in a text answer", (_label, value) => {
    expect(() => buildRegistrantCustomData(FIELDS, { size: "S", diet: value })).toThrow(RegistrantInputError);
  });

  it("refuses values of the wrong type", () => {
    for (const diet of [1, ["a"], { a: 1 }, true]) {
      expect(() => buildRegistrantCustomData(FIELDS, { size: "S", diet })).toThrow(RegistrantInputError);
    }
  });

  it("refuses a select answer that is not an option and a boolean that is not one", () => {
    expect(() => buildRegistrantCustomData(FIELDS, { size: "XL" })).toThrow(RegistrantInputError);
    expect(() => buildRegistrantCustomData(FIELDS, { size: "S", parking: "maybe" })).toThrow(RegistrantInputError);
  });

  it("requires the required fields that are on the form, and only those", () => {
    expect(() => buildRegistrantCustomData(FIELDS, {})).toThrow(RegistrantInputError);
    expect(() => buildRegistrantCustomData(FIELDS, undefined)).toThrow(RegistrantInputError);
    expect(buildRegistrantCustomData(FIELDS, { size: "M" })).toEqual({ size: "M" });
  });

  it("returns undefined when nothing was answered and nothing is required", () => {
    const optional = [field({ source_field: "diet" })];
    expect(buildRegistrantCustomData(optional, {})).toBeUndefined();
    expect(buildRegistrantCustomData(optional, null)).toBeUndefined();
    expect(buildRegistrantCustomData(optional, { diet: "", other: "x" })).toBeUndefined();
  });

  it("refuses a payload that is not a plain object", () => {
    for (const input of ["x", 1, true, [], [["size", "S"]], new Map(), new Date()]) {
      expect(() => buildRegistrantCustomData(FIELDS, input)).toThrow(RegistrantInputError);
    }
  });

  it("fails with a fixed code that carries no field key or value", () => {
    for (const input of [{ size: "XL" }, {}, { size: "S", diet: "a\u0000secret" }]) {
      try {
        buildRegistrantCustomData(FIELDS, input);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(RegistrantInputError);
        expect((error as Error).message).toBe("validation_failed");
      }
    }
  });
});

describe("pickRegistrantProfileFields", () => {
  it("ignores company and department when the event does not ask for them", () => {
    expect(
      pickRegistrantProfileFields({ company: false, department: false }, { company: "Acme", department: "R&D" }),
    ).toEqual({});
  });

  it("reads only the enabled ones", () => {
    const body = { company: " Acme ", department: "R&D" };
    expect(pickRegistrantProfileFields({ company: true, department: false }, body)).toEqual({ company: "Acme" });
    expect(pickRegistrantProfileFields({ company: false, department: true }, body)).toEqual({ department: "R&D" });
  });

  it("does not look at a disabled field, even a hostile one", () => {
    expect(
      pickRegistrantProfileFields({ company: false, department: true }, { company: "a\u0000", department: "Ops" }),
    ).toEqual({ department: "Ops" });
  });

  it("leaves out an empty answer and refuses a hostile or too long one", () => {
    expect(pickRegistrantProfileFields({ company: true, department: true }, { company: "  " })).toEqual({});
    expect(() => pickRegistrantProfileFields({ company: true, department: true }, { company: "a\r\nb" })).toThrow(
      RegistrantInputError,
    );
    expect(() => pickRegistrantProfileFields({ company: true, department: true }, { department: "a".repeat(101) })).toThrow(
      RegistrantInputError,
    );
    expect(() => pickRegistrantProfileFields({ company: true, department: true }, { company: 5 })).toThrow(
      RegistrantInputError,
    );
  });

  it("refuses a body that is not a plain object", () => {
    expect(() => pickRegistrantProfileFields({ company: true, department: true }, [])).toThrow(RegistrantInputError);
    expect(() => pickRegistrantProfileFields({ company: true, department: true }, null)).toThrow(RegistrantInputError);
  });
});
