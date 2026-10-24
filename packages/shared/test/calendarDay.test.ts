import { describe, expect, it } from "vitest";
import { isDateAnswer, isDateTimeAnswer } from "../src/calendarDay.js";

describe("isDateAnswer", () => {
  it("accepts a day that exists, and refuses one that does not (the days are counted here, not by Date)", () => {
    expect(isDateAnswer("2026-11-04")).toBe(true);
    expect(isDateAnswer("2026-02-29")).toBe(false);
    expect(isDateAnswer("2026-02-30")).toBe(false);
    expect(isDateAnswer("2026-04-31")).toBe(false);
    expect(isDateAnswer("2026-13-01")).toBe(false);
    expect(isDateAnswer("2026-00-10")).toBe(false);
    expect(isDateAnswer("2026-01-00")).toBe(false);
    expect(isDateAnswer("2026-01-32")).toBe(false);
  });

  it("knows which years have a 29 February: every fourth, except the centuries that are not a multiple of 400", () => {
    expect(isDateAnswer("2028-02-29")).toBe(true);
    expect(isDateAnswer("2000-02-29")).toBe(true);
    expect(isDateAnswer("1900-02-29")).toBe(false);
    expect(isDateAnswer("2100-02-29")).toBe(false);
  });

  it("reads the early years as they are written, not as Date does (0 to 99 as 1900 to 1999)", () => {
    expect(isDateAnswer("0001-01-01")).toBe(true);
    expect(isDateAnswer("0099-12-31")).toBe(true);
    expect(isDateAnswer("0000-01-01")).toBe(false);
  });

  it("wants exactly YYYY-MM-DD and nothing around it", () => {
    expect(isDateAnswer("04.11.2026")).toBe(false);
    expect(isDateAnswer("2026-1-04")).toBe(false);
    expect(isDateAnswer("2026-11-04T10:30")).toBe(false);
    expect(isDateAnswer(" 2026-11-04")).toBe(false);
    expect(isDateAnswer("")).toBe(false);
  });
});

describe("isDateTimeAnswer", () => {
  it("needs the T, a clock that exists and a day that exists, and nothing else", () => {
    expect(isDateTimeAnswer("2026-11-04T10:30")).toBe(true);
    expect(isDateTimeAnswer("2026-11-04T00:00")).toBe(true);
    expect(isDateTimeAnswer("2026-11-04T23:59")).toBe(true);
    expect(isDateTimeAnswer("2026-11-04T24:00")).toBe(false);
    expect(isDateTimeAnswer("2026-11-04T10:60")).toBe(false);
    expect(isDateTimeAnswer("2026-02-30T10:30")).toBe(false);
    expect(isDateTimeAnswer("2028-02-29T10:30")).toBe(true);
  });

  it("refuses a zone, seconds, another separator and a half that is empty", () => {
    expect(isDateTimeAnswer("2026-11-04 10:30")).toBe(false);
    expect(isDateTimeAnswer("2026-11-04T10:30:00")).toBe(false);
    expect(isDateTimeAnswer("2026-11-04T10:30Z")).toBe(false);
    expect(isDateTimeAnswer("2026-11-04T")).toBe(false);
    expect(isDateTimeAnswer("T10:30")).toBe(false);
    expect(isDateTimeAnswer("")).toBe(false);
  });
});
