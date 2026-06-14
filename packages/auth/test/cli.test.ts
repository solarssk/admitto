import { describe, expect, it } from "vitest";
import { assertNoPasswordArgv, CliError } from "../src/cli-helpers.js";

describe("CLI break-glass", () => {
  it("rejects --password on argv for break-glass commands", () => {
    expect(() =>
      assertNoPasswordArgv(["node", "cli.js", "reset-mfa", "--email", "a@example.com", "--password", "x"]),
    ).toThrow(CliError);
    expect(() =>
      assertNoPasswordArgv([
        "node",
        "cli.js",
        "generate-emergency-recovery",
        "--email",
        "a@example.com",
        "--password",
        "x",
      ]),
    ).toThrow(CliError);
  });

  it("allows break-glass argv without --password", () => {
    expect(() =>
      assertNoPasswordArgv(["node", "cli.js", "reset-mfa", "--email", "admin@example.com"]),
    ).not.toThrow();
  });
});
