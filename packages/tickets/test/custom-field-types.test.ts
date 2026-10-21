import { describe, expect, it } from "vitest";
import { isValidContactPhone, type EventCustomFieldType } from "@admitto/shared";
import {
  assertCustomDataMeetsRequirements,
  buildCustomDataFromInput,
  normalizeCustomDataFieldValue,
  validateCustomDataPatch,
} from "../src/validate-custom-data.js";
import type { EventItemContent } from "../src/types.js";

const INVALID = "invalid_custom_data_value:answer";

const field = (type: EventCustomFieldType, extra: Partial<EventItemContent> = {}): EventItemContent => ({
  label: "Answer",
  source_field: "answer",
  type,
  ...extra,
});

const normalize = (f: EventItemContent, raw: string | null | undefined) => normalizeCustomDataFieldValue(f, raw);

describe("long_text", () => {
  const longText = field("long_text");

  it("keeps the text and its line breaks, and trims the ends", () => {
    expect(normalize(longText, "  First line\nSecond line  ")).toBe("First line\nSecond line");
  });

  it("writes a line break of any kind as one line feed", () => {
    expect(normalize(longText, "a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });

  it("accepts exactly 1000 characters and refuses 1001, never cutting the text", () => {
    expect(normalize(longText, "a".repeat(1000))).toBe("a".repeat(1000));
    expect(() => normalize(longText, "a".repeat(1001))).toThrow(INVALID);
  });

  it("counts a character, not a UTF-16 unit: 1000 emoji fit and 1001 do not", () => {
    expect(normalize(longText, "😀".repeat(1000))).toBe("😀".repeat(1000));
    expect(() => normalize(longText, "😀".repeat(1001))).toThrow(INVALID);
  });

  it("counts a CRLF as one character", () => {
    const text = `${"a".repeat(998)}\r\nb`;
    expect(normalize(longText, text)).toBe(`${"a".repeat(998)}\nb`);
    expect(() => normalize(longText, `${text}c`)).toThrow(INVALID);
  });

  it("refuses an enormous value without counting it", () => {
    expect(() => normalize(longText, "a".repeat(5_000_000))).toThrow(INVALID);
  });

  it("treats a blank value as no answer", () => {
    expect(normalize(longText, " \n\t ")).toBeNull();
    expect(normalize(longText, "")).toBeNull();
    expect(normalize(longText, null)).toBeNull();
    expect(normalize(longText, undefined)).toBeNull();
  });
});

describe("date", () => {
  const date = field("date");

  it.each(["2026-11-04", "2028-02-29", "2000-02-29", "2026-12-31", "2026-01-01", "9999-12-31", "0001-01-01", "0050-06-15"])(
    "accepts %s as it is",
    (value) => {
      expect(normalize(date, value)).toBe(value);
    },
  );

  it("trims the value", () => {
    expect(normalize(date, " 2026-11-04 ")).toBe("2026-11-04");
  });

  it.each([
    ["30 February", "2026-02-30"],
    ["29 February in a year that is not a leap year", "2026-02-29"],
    ["29 February in a century year that is not a leap year", "1900-02-29"],
    ["31 April", "2026-04-31"],
    ["month 13", "2026-13-01"],
    ["month 0", "2026-00-10"],
    ["day 0", "2026-11-00"],
    ["day 32", "2026-11-32"],
    ["year 0", "0000-01-01"],
    ["no zero padding", "2026-1-5"],
    ["a two-digit year", "26-11-04"],
    ["slashes", "2026/11/04"],
    ["the day first", "04.11.2026"],
    ["a time as well", "2026-11-04T10:30"],
    ["an instant", "2026-11-04T00:00:00.000Z"],
    ["Arabic-Indic digits", "\u0662\u0660\u0662\u0666-\u0661\u0661-\u0660\u0664"],
    ["words", "tomorrow"],
  ])("refuses %s", (_label, value) => {
    expect(() => normalize(date, value)).toThrow(INVALID);
  });
});

describe("datetime", () => {
  const dateTime = field("datetime");

  it.each(["2026-11-04T10:30", "2026-11-04T00:00", "2026-11-04T23:59", "2028-02-29T12:00"])("accepts %s as it is", (value) => {
    expect(normalize(dateTime, value)).toBe(value);
  });

  it.each([
    ["hour 24", "2026-11-04T24:00"],
    ["minute 60", "2026-11-04T10:60"],
    ["30 February", "2026-02-30T10:00"],
    ["a date only", "2026-11-04"],
    ["seconds", "2026-11-04T10:30:00"],
    ["a UTC designator", "2026-11-04T10:30Z"],
    ["an offset", "2026-11-04T10:30+01:00"],
    ["an instant", "2026-11-04T10:30:00.000Z"],
    ["a space as the separator", "2026-11-04 10:30"],
    ["a lower case separator", "2026-11-04t10:30"],
    ["a one-digit hour", "2026-11-04T1:30"],
    ["a time only", "10:30"],
  ])("refuses %s: the time is a wall-clock time with no zone", (_label, value) => {
    expect(() => normalize(dateTime, value)).toThrow(INVALID);
  });
});

describe("phone", () => {
  const phone = field("phone");

  it.each([
    ["+48 600 100 200", "+48600100200"],
    ["+48-600-100-200", "+48600100200"],
    ["+48.600.100.200", "+48600100200"],
    ["(22) 123-45-67", "221234567"],
    ["600100200", "600100200"],
    ["  600 100 200  ", "600100200"],
    ["+1 (555) 010-0199", "+15550100199"],
    ["0 600 100 200", "0600100200"],
    ["123", "123"],
    ["123456789012345", "123456789012345"],
    ["+123456789012345", "+123456789012345"],
  ])("writes %s in its canonical form %s", (value, canonical) => {
    expect(normalize(phone, value)).toBe(canonical);
  });

  it("is canonical already when written again, and valid as a contact phone", () => {
    for (const value of ["+48 600-100-200", "(22) 123-45-67", "600.100.200"]) {
      const once = normalize(phone, value)!;
      expect(normalize(phone, once)).toBe(once);
      expect(isValidContactPhone(once)).toBe(true);
    }
  });

  it.each([
    ["too few digits", "12"],
    ["too many digits", "1234567890123456"],
    ["letters", "call 600100200"],
    ["an extension", "600 100 200 ext 5"],
    ["a plus in the middle", "48+600"],
    ["two plus signs", "++48600100200"],
    ["a plus inside parentheses", "(+48) 600 100 200"],
    ["a plus alone", "+"],
    ["only separators", "---"],
    ["a value longer than 40 characters, though it holds only four digits", `1${" ".repeat(45)}234`],
    ["too many digits and too long", `6${" 0".repeat(21)}`],
    ["Arabic-Indic digits", "\u0666\u0660\u0660\u0661\u0660\u0660\u0662\u0660\u0660"],
  ])("refuses %s", (_label, value) => {
    expect(() => normalize(phone, value)).toThrow(INVALID);
  });
});

describe("the types that existed before", () => {
  it("cuts a text answer to 100 characters on the staff and import paths, as it always has", () => {
    expect(normalize(field("text"), "a".repeat(150))).toHaveLength(100);
    expect(normalize(field("text"), "a".repeat(100))).toBe("a".repeat(100));
  });

  it("cuts that text after 100 characters counted in code points, never inside an emoji", () => {
    expect(normalize(field("text"), "😀".repeat(101))).toBe("😀".repeat(100));
    // The 100th character is an emoji whose first UTF-16 unit is the 100th unit: it stays whole.
    expect(normalize(field("text"), `${"a".repeat(99)}😀b`)).toBe(`${"a".repeat(99)}😀`);
  });

  it("treats a type it does not know like text", () => {
    expect(normalize(field("weird" as EventCustomFieldType), "a".repeat(150))).toHaveLength(100);
  });

  it("treats a field with no type like text", () => {
    const untyped: EventItemContent = { label: "Answer", source_field: "answer" };
    expect(normalize(untyped, "  hello  ")).toBe("hello");
  });

  it("keeps select and boolean as they were", () => {
    expect(normalize(field("select", { options: ["S", "M"] }), "M")).toBe("M");
    expect(() => normalize(field("select", { options: ["S", "M"] }), "XL")).toThrow(INVALID);
    expect(normalize(field("boolean"), "Yes")).toBe("true");
    expect(normalize(field("boolean"), "0")).toBe("false");
    expect(() => normalize(field("boolean"), "maybe")).toThrow(INVALID);
  });

  it("ignores a format rule on them: the API never stores one there", () => {
    const rules = { digits_only: true, max_length: 1 };
    expect(normalize(field("select", { options: ["Large"], rules }), "Large")).toBe("Large");
    expect(normalize(field("boolean", { rules }), "yes")).toBe("true");
    expect(normalize(field("date", { rules }), "2026-11-04")).toBe("2026-11-04");
    expect(normalize(field("datetime", { rules }), "2026-11-04T10:30")).toBe("2026-11-04T10:30");
  });
});

/** One character per type that is a valid answer of any length from 3 on, to build answers of an exact length. */
const RULE_KINDS = [
  { type: "text" as const, char: "a", digits: "12345", notDigits: "12 345" },
  { type: "long_text" as const, char: "a", digits: "12345", notDigits: "123\n456" },
  // A phone number is stored as an optional + and its digits, so spaces never count and a + is not a digit.
  { type: "phone" as const, char: "1", digits: "600 100 200", notDigits: "+48 600 100 200" },
];

describe.each(RULE_KINDS)("format rules on a $type field", ({ type, char, digits, notDigits }) => {
  const answer = (length: number) => char.repeat(length);

  it("digits_only allows 0 to 9 and nothing else", () => {
    const f = field(type, { rules: { digits_only: true } });
    expect(normalize(f, digits)).not.toBeNull();
    expect(() => normalize(f, notDigits)).toThrow(INVALID);
    if (type !== "phone") {
      expect(() => normalize(f, "12a")).toThrow(INVALID);
      expect(() => normalize(f, "\u0661\u0662\u0663")).toThrow(INVALID);
    }
  });

  it("min_length refuses a shorter answer and accepts one of exactly that length", () => {
    const f = field(type, { rules: { min_length: 6 } });
    expect(() => normalize(f, answer(5))).toThrow(INVALID);
    expect(normalize(f, answer(6))).toBe(answer(6));
    expect(normalize(f, answer(7))).toBe(answer(7));
  });

  it("max_length refuses a longer answer and accepts one of exactly that length", () => {
    const f = field(type, { rules: { max_length: 6 } });
    expect(normalize(f, answer(5))).toBe(answer(5));
    expect(normalize(f, answer(6))).toBe(answer(6));
    expect(() => normalize(f, answer(7))).toThrow(INVALID);
  });

  it("combines the three rules: all of them must hold", () => {
    const f = field(type, { rules: { min_length: 4, max_length: 6, digits_only: true } });
    expect(normalize(f, "1234")).toBe("1234");
    expect(normalize(f, "123456")).toBe("123456");
    expect(() => normalize(f, "123")).toThrow(INVALID);
    expect(() => normalize(f, "1234567")).toThrow(INVALID);
    // Six characters, so only the digits rule can refuse it.
    expect(() => normalize(f, "12a456")).toThrow(INVALID);
  });

  it("never reads the example", () => {
    expect(normalize(field(type, { rules: { example: "not a number" } }), answer(5))).toBe(answer(5));
  });

  it("leaves an answer alone when the field has no rules, or an empty rules object", () => {
    expect(normalize(field(type), answer(7))).toBe(answer(7));
    expect(normalize(field(type, { rules: {} }), answer(7))).toBe(answer(7));
  });
});

describe("length rules count characters", () => {
  it("counts an emoji as one character on text and long text", () => {
    const f = field("text", { rules: { min_length: 2, max_length: 2 } });
    expect(normalize(f, "😀😀")).toBe("😀😀");
    expect(() => normalize(f, "😀")).toThrow(INVALID);
    expect(() => normalize(f, "😀😀😀")).toThrow(INVALID);
  });

  it("counts a phone number as stored: the leading + is a character", () => {
    expect(normalize(field("phone", { rules: { max_length: 12 } }), "+48 600 100 200")).toBe("+48600100200");
    expect(() => normalize(field("phone", { rules: { max_length: 11 } }), "+48 600 100 200")).toThrow(INVALID);
    expect(normalize(field("phone", { rules: { min_length: 9 } }), "600 100 200")).toBe("600100200");
    expect(() => normalize(field("phone", { rules: { min_length: 10 } }), "600 100 200")).toThrow(INVALID);
  });

  it("applies a text rule to the answer after the 100 character cut staff and import answers get", () => {
    const f = field("text", { rules: { max_length: 100 } });
    expect(normalize(f, "a".repeat(150))).toHaveLength(100);
  });

  it("keeps the type's own check first: a phone number that is not one fails whatever the rules say", () => {
    expect(() => normalize(field("phone", { rules: { max_length: 40 } }), "call me")).toThrow(INVALID);
  });
});

describe("the validators that run on stored data", () => {
  const plate = field("text", { source_field: "plate", rules: { digits_only: true, min_length: 3 } });
  const note = field("text", { source_field: "note" });

  it("buildCustomDataFromInput stores the canonical phone and refuses what breaks a rule", () => {
    const phone = field("phone", { source_field: "phone", required: true });
    expect(buildCustomDataFromInput([phone], { phone: "+48 600 100 200" })).toEqual({ phone: "+48600100200" });
    expect(() => buildCustomDataFromInput([phone], {})).toThrow("required_custom_data_field_missing:phone");
    expect(() => buildCustomDataFromInput([phone], { phone: "nope" })).toThrow("invalid_custom_data_value:phone");
    expect(() => buildCustomDataFromInput([plate], { plate: "12" })).toThrow("invalid_custom_data_value:plate");
    expect(buildCustomDataFromInput([plate], { plate: "123" })).toEqual({ plate: "123" });
  });

  it("validateCustomDataPatch normalises the value it is given", () => {
    const date = field("date", { source_field: "arrival" });
    expect(validateCustomDataPatch([date], {}, { arrival: " 2026-11-04 " })).toEqual({ arrival: "2026-11-04" });
    expect(() => validateCustomDataPatch([date], {}, { arrival: "2026-02-30" })).toThrow(
      "invalid_custom_data_value:arrival",
    );
  });

  it("holds the answers already stored to the field's rules, like a select option that was removed", () => {
    expect(() => validateCustomDataPatch([plate, note], { plate: "12a" }, { note: "x" })).toThrow(
      "invalid_custom_data_value:plate",
    );
    expect(() => assertCustomDataMeetsRequirements([plate], { plate: "12a" })).toThrow(
      "invalid_custom_data_value:plate",
    );
    expect(() => assertCustomDataMeetsRequirements([plate], { plate: "123" })).not.toThrow();
  });

  it("refuses a stored answer that is no longer a date", () => {
    const date = field("date", { source_field: "arrival" });
    expect(() => assertCustomDataMeetsRequirements([date], { arrival: "soon" })).toThrow(
      "invalid_custom_data_value:arrival",
    );
  });
});

describe("the length of an answer given by staff", () => {
  const text = field("text");
  const longText = field("long_text");

  it("refuses a text answer over 100 characters, on create and on edit, instead of cutting it", () => {
    expect(buildCustomDataFromInput([text], { answer: "a".repeat(100) })).toEqual({ answer: "a".repeat(100) });
    expect(buildCustomDataFromInput([text], { answer: ` ${"a".repeat(100)} ` })).toEqual({ answer: "a".repeat(100) });
    expect(() => buildCustomDataFromInput([text], { answer: "a".repeat(101) })).toThrow("validation_failed:answer");
    expect(validateCustomDataPatch([text], {}, { answer: "a".repeat(100) })).toEqual({ answer: "a".repeat(100) });
    expect(() => validateCustomDataPatch([text], {}, { answer: "a".repeat(101) })).toThrow("validation_failed:answer");
  });

  it("holds every type but long text to the same 100 characters", () => {
    const select = field("select", { options: ["a".repeat(101)] });
    expect(() => buildCustomDataFromInput([select], { answer: "a".repeat(101) })).toThrow("validation_failed:answer");
    expect(() => buildCustomDataFromInput([field("phone")], { answer: "1".repeat(101) })).toThrow("validation_failed:answer");
  });

  it("takes a long text up to 1000 characters, and refuses 1001 as an invalid value", () => {
    expect(buildCustomDataFromInput([longText], { answer: "a".repeat(1000) })).toEqual({ answer: "a".repeat(1000) });
    expect(validateCustomDataPatch([longText], {}, { answer: "a".repeat(1000) })).toEqual({ answer: "a".repeat(1000) });
    expect(() => buildCustomDataFromInput([longText], { answer: "a".repeat(1001) })).toThrow(INVALID);
    expect(() => validateCustomDataPatch([longText], {}, { answer: "a".repeat(1001) })).toThrow(INVALID);
  });

  it("still cuts a text answer to 100 characters where the whole answer is read from a file (the import)", () => {
    expect(normalize(text, "a".repeat(101))).toBe("a".repeat(100));
  });
});
