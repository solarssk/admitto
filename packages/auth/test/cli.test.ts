import { describe, expect, it } from "vitest";

describe("CLI break-glass", () => {
  it("reset-mfa does not accept password via argv", () => {
    const argv = ["node", "cli.js", "reset-mfa", "--email", "admin@example.com"];
    expect(argv.includes("--password")).toBe(false);
  });

  it("generate-emergency-recovery does not accept password via argv", () => {
    const argv = [
      "node",
      "cli.js",
      "generate-emergency-recovery",
      "--email",
      "admin@example.com",
    ];
    expect(argv.includes("--password")).toBe(false);
  });
});
