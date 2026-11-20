import { describe, expect, it } from "vitest";
import {
  answerExpectation,
  answerHint,
  answerImportNote,
  answerProblem,
  codePointLength,
  joinDateTime,
  longTextLimit,
  splitDateTime,
  type AnswerField,
} from "../../src/attendees/answerFormat.js";

const field = (type: AnswerField["type"], rules: AnswerField["rules"] = null, label = "Field"): AnswerField => ({ label, type, rules });
const EMOJI = String.fromCodePoint(0x1f600);

describe("codePointLength", () => {
  it("counts an emoji as one character, the way the server does, where .length counts two", () => {
    expect(codePointLength("")).toBe(0);
    expect(codePointLength("abc")).toBe(3);
    expect(codePointLength(`a${EMOJI}b`)).toBe(3);
    expect(`a${EMOJI}b`).toHaveLength(4);
    expect(codePointLength(EMOJI.repeat(100))).toBe(100);
  });
});

describe("longTextLimit", () => {
  it("is the 1000 characters the type holds, or the field's own shorter maximum", () => {
    expect(longTextLimit(field("long_text"))).toBe(1000);
    expect(longTextLimit(field("long_text", { max_length: 500 }))).toBe(500);
    expect(longTextLimit(field("long_text", { min_length: 20 }))).toBe(1000);
  });
});

describe("answerExpectation", () => {
  it("says what a date, a date and time and a phone number must be", () => {
    expect(answerExpectation(field("date"))).toBe("a valid date");
    expect(answerExpectation(field("datetime"))).toBe("a valid date and time");
    expect(answerExpectation(field("phone"))).toBe("a phone number with 3 to 15 digits");
  });

  it("adds the field's rules in words, for the types that take them", () => {
    expect(answerExpectation(field("phone", { digits_only: true, max_length: 10 }))).toBe(
      "a phone number with 3 to 15 digits, digits only, at most 10 characters",
    );
    expect(answerExpectation(field("text", { digits_only: true, min_length: 5, max_length: 5 }))).toBe("digits only, exactly 5 characters");
    expect(answerExpectation(field("text", { min_length: 2, max_length: 6 }))).toBe("2 to 6 characters");
    expect(answerExpectation(field("text", { min_length: 1 }))).toBe("at least 1 character");
    expect(answerExpectation(field("text", { max_length: 1 }))).toBe("at most 1 character");
  });

  it("is nothing for a text with no rules and for a choice, and the type's 1000 characters for a long text", () => {
    expect(answerExpectation(field("text"))).toBeNull();
    expect(answerExpectation(field("select"))).toBeNull();
    expect(answerExpectation(field("boolean"))).toBeNull();
    expect(answerExpectation(field("long_text"))).toBe("at most 1000 characters");
    expect(answerExpectation(field("long_text", { max_length: 300 }))).toBe("at most 300 characters");
  });
});

describe("answerHint", () => {
  it("is the rules and the example of a text field, as one sentence", () => {
    expect(answerHint(field("text", { digits_only: true, min_length: 5, max_length: 5, example: "01234" }))).toBe(
      "Digits only, exactly 5 characters, for example 01234.",
    );
    expect(answerHint(field("text", { example: "Alex" }))).toBe("For example Alex.");
    expect(answerHint(field("text"))).toBeUndefined();
  });

  it("asks a phone number for its digits, and adds the rules", () => {
    expect(answerHint(field("phone"))).toBe("A phone number with 3 to 15 digits.");
    expect(answerHint(field("phone", { example: "+1 555 0100" }))).toBe("A phone number with 3 to 15 digits, for example +1 555 0100.");
  });

  it("leaves the longest long text to the counter, and says the rest", () => {
    expect(answerHint(field("long_text"))).toBeUndefined();
    expect(answerHint(field("long_text", { max_length: 500 }))).toBeUndefined();
    expect(answerHint(field("long_text", { min_length: 20, max_length: 500 }))).toBe("At least 20 characters.");
  });

  it("names the event's time zone for a date and time, and is nothing for a date or a choice", () => {
    expect(answerHint(field("datetime"), "Europe/Warsaw")).toBe("Time at the event (Europe/Warsaw).");
    expect(answerHint(field("datetime"))).toBe("Time at the event.");
    expect(answerHint(field("date"))).toBeUndefined();
    expect(answerHint(field("select"))).toBeUndefined();
    expect(answerHint(field("boolean"))).toBeUndefined();
  });
});

describe("answerImportNote", () => {
  it("writes a date and a date and time the way the import reads them", () => {
    expect(answerImportNote(field("date"))).toBe("date as YYYY-MM-DD");
    expect(answerImportNote(field("datetime"))).toBe("date and time as YYYY-MM-DDTHH:mm, the time at the event");
  });

  it("names a phone number and a long text, with the rules of the field", () => {
    expect(answerImportNote(field("phone"))).toBe("phone number with 3 to 15 digits");
    expect(answerImportNote(field("phone", { digits_only: true }))).toBe("phone number with 3 to 15 digits, digits only");
    expect(answerImportNote(field("long_text"))).toBe("long text, at most 1000 characters");
    expect(answerImportNote(field("long_text", { max_length: 500, example: "A few lines" }))).toBe(
      "long text, at most 500 characters, for example A few lines",
    );
  });

  it("is the rules of a text field, or nothing", () => {
    expect(answerImportNote(field("text", { digits_only: true, min_length: 3, max_length: 6, example: "123456" }))).toBe(
      "digits only, 3 to 6 characters, for example 123456",
    );
    expect(answerImportNote(field("text"))).toBeNull();
  });
});

describe("splitDateTime and joinDateTime", () => {
  it("split an answer at its T, and join the halves back, also while one is still empty", () => {
    expect(splitDateTime("2026-11-04T10:30")).toEqual({ date: "2026-11-04", time: "10:30" });
    expect(splitDateTime("2026-11-04T")).toEqual({ date: "2026-11-04", time: "" });
    expect(splitDateTime("T10:30")).toEqual({ date: "", time: "10:30" });
    expect(splitDateTime("")).toEqual({ date: "", time: "" });
    expect(splitDateTime("tomorrow")).toEqual({ date: "tomorrow", time: "" });
    expect(joinDateTime("2026-11-04", "10:30")).toBe("2026-11-04T10:30");
    expect(joinDateTime("2026-11-04", "")).toBe("2026-11-04T");
    expect(joinDateTime("", "10:30")).toBe("T10:30");
    expect(joinDateTime("", "")).toBe("");
  });
});

describe("answerProblem", () => {
  it("has nothing to say about an empty answer, whatever the type: whether it is allowed is the field's required", () => {
    for (const type of ["text", "long_text", "date", "datetime", "phone", "select", "boolean"] as const) {
      expect(answerProblem(field(type, { min_length: 3 }), "")).toBeNull();
      expect(answerProblem(field(type, { min_length: 3 }), "   ")).toBeNull();
    }
  });

  it("refuses a date that is not a day, in a sentence that starts with the field's name", () => {
    const arrival = field("date", null, "Arrival");
    expect(answerProblem(arrival, "2026-11-04")).toBeNull();
    expect(answerProblem(arrival, " 2026-11-04 ")).toBeNull();
    expect(answerProblem(arrival, "2026-02-30")).toBe("Arrival must be a valid date.");
    expect(answerProblem(arrival, "04.11.2026")).toBe("Arrival must be a valid date.");
  });

  it("asks for both halves of a date and time, and a clock and a day that exist", () => {
    const arrival = field("datetime", null, "Arrival");
    expect(answerProblem(arrival, "2026-11-04T10:30")).toBeNull();
    expect(answerProblem(arrival, "2026-11-04T")).toBe("Arrival needs both a date and a time.");
    expect(answerProblem(arrival, "T10:30")).toBe("Arrival needs both a date and a time.");
    expect(answerProblem(arrival, "2026-11-04T24:00")).toBe("Arrival must be a valid date and time.");
    expect(answerProblem(arrival, "2026-02-30T10:30")).toBe("Arrival must be a valid date and time.");
    expect(answerProblem(arrival, "tomorrow")).toBe("Arrival must be a valid date and time.");
  });

  it("accepts a phone number written the way people write one, and refuses what is not one", () => {
    const mobile = field("phone", null, "Mobile");
    for (const number of ["+1 555 0100", "555-0100", "(555) 0100", "+48 600 100 200", "123"]) {
      expect(answerProblem(mobile, number), number).toBeNull();
    }
    for (const number of ["12", "call me", "555 0100 ext 5", "+1234567890123456", "1234567890123456"]) {
      expect(answerProblem(mobile, number), number).toBe("Mobile must be a phone number with 3 to 15 digits.");
    }
  });

  it("checks the rules of a phone field on the number as the server saves it: a + and the digits", () => {
    // "+1 555 0100" is saved as "+15550100", 9 characters, and a + is not a digit.
    expect(answerProblem(field("phone", { max_length: 9 }, "Mobile"), "+1 555 0100")).toBeNull();
    expect(answerProblem(field("phone", { max_length: 8 }, "Mobile"), "+1 555 0100")).toBe(
      "Mobile must be a phone number with 3 to 15 digits, at most 8 characters.",
    );
    expect(answerProblem(field("phone", { digits_only: true }, "Mobile"), "+1 555 0100")).toBe(
      "Mobile must be a phone number with 3 to 15 digits, digits only.",
    );
    expect(answerProblem(field("phone", { digits_only: true }, "Mobile"), "555 0100")).toBeNull();
    expect(answerProblem(field("phone", { min_length: 10 }, "Mobile"), "555 0100")).toBe(
      "Mobile must be a phone number with 3 to 15 digits, at least 10 characters.",
    );
  });

  it("counts a text in characters as a person does: a hundred emoji are a hundred characters, not two hundred", () => {
    const diet = field("text", null, "Diet");
    expect(answerProblem(diet, "x".repeat(100))).toBeNull();
    expect(answerProblem(diet, EMOJI.repeat(100))).toBeNull();
    expect(answerProblem(diet, "x".repeat(101))).toBe("Diet must be at most 100 characters.");
    expect(answerProblem(diet, EMOJI.repeat(101))).toBe("Diet must be at most 100 characters.");
  });

  it("checks the rules of a text: digits only, and the lengths, on the answer without the spaces at its ends", () => {
    const postcode = field("text", { digits_only: true, min_length: 5, max_length: 5 }, "Postcode");
    expect(answerProblem(postcode, "01234")).toBeNull();
    expect(answerProblem(postcode, "  01234  ")).toBeNull();
    expect(answerProblem(postcode, "0123")).toBe("Postcode must be digits only, exactly 5 characters.");
    expect(answerProblem(postcode, "012345")).toBe("Postcode must be digits only, exactly 5 characters.");
    expect(answerProblem(postcode, "0123a")).toBe("Postcode must be digits only, exactly 5 characters.");
    // Only 0 to 9: another script's digits and full-width digits are not.
    expect(answerProblem(postcode, String.fromCodePoint(0x661, 0x662, 0x663, 0x664, 0x665))).toBe("Postcode must be digits only, exactly 5 characters.");
    expect(answerProblem(field("text", { min_length: 3 }, "Code"), EMOJI.repeat(3))).toBeNull();
    expect(answerProblem(field("text", { min_length: 3 }, "Code"), EMOJI.repeat(2))).toBe("Code must be at least 3 characters.");
  });

  it("holds a long text to 1000 characters and to its own maximum, counting a line break as one character", () => {
    const abstract = field("long_text", null, "Abstract");
    expect(answerProblem(abstract, "x".repeat(1000))).toBeNull();
    expect(answerProblem(abstract, EMOJI.repeat(1000))).toBeNull();
    expect(answerProblem(abstract, "x".repeat(1001))).toBe("Abstract must be at most 1000 characters.");
    // 500 lines of "a" and a Windows line break are 1500 characters as typed and 1000 as the server counts them.
    expect(answerProblem(abstract, "a\r\n".repeat(500).trim())).toBeNull();
    expect(answerProblem(abstract, `${"a\r\n".repeat(500)}b`)).toBe("Abstract must be at most 1000 characters.");
    expect(answerProblem(field("long_text", { max_length: 20 }, "Abstract"), "x".repeat(21))).toBe("Abstract must be at most 20 characters.");
    expect(answerProblem(field("long_text", { min_length: 20 }, "Abstract"), "short")).toBe("Abstract must be 20 to 1000 characters.");
  });

  it("leaves a choice to its own options", () => {
    expect(answerProblem(field("select", { min_length: 3 }), "S")).toBeNull();
    expect(answerProblem(field("boolean"), "maybe")).toBeNull();
  });
});
