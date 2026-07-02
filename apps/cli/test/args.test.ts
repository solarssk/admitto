import { describe, expect, it } from "vitest";
import { CliError, arg, hasFlag, parseFormat } from "../src/lib/args.js";

describe("arg", () => {
  it("returns value after --name", () => {
    expect(arg("event", ["admitto", "checkin", "lookup", "--event", "evt_1"])).toBe("evt_1");
  });

  it("returns undefined when flag missing", () => {
    expect(arg("event", ["admitto", "checkin", "lookup"])).toBeUndefined();
  });

  it("throws when flag is missing a value", () => {
    expect(() => arg("event", ["admitto", "checkin", "lookup", "--event", "--query", "x"])).toThrow(
      CliError,
    );
  });
});

describe("hasFlag", () => {
  it("detects long flags", () => {
    expect(hasFlag("dry-run", ["admitto", "retention", "run", "--dry-run"])).toBe(true);
  });

  it("detects short -y alias for yes", () => {
    expect(hasFlag("yes", ["admitto", "sessions", "purge", "--all", "-y"])).toBe(true);
  });
});

describe("parseFormat", () => {
  it("defaults to table", () => {
    expect(parseFormat(["admitto", "checkin", "lookup"])).toBe("table");
  });

  it("accepts json", () => {
    expect(parseFormat(["admitto", "checkin", "lookup", "--format", "json"])).toBe("json");
  });

  it("rejects unknown format", () => {
    expect(() => parseFormat(["admitto", "checkin", "lookup", "--format", "xml"])).toThrow(
      CliError,
    );
  });
});
