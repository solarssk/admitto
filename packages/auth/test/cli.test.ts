import { describe, expect, it } from "vitest";

describe("CLI bootstrap-superadmin", () => {
  it("does not accept password via argv", () => {
    const argv = [
      "node",
      "cli.js",
      "bootstrap-superadmin",
      "--email",
      "admin@example.com",
    ];
    expect(argv.includes("--password")).toBe(false);
    const passwordFlagIndex = argv.indexOf("--password");
    expect(passwordFlagIndex).toBe(-1);
  });
});
