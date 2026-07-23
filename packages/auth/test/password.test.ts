import { describe, expect, it } from "vitest";
import { verifyPasswordOrDummy } from "../src/password.js";

describe("verifyPasswordOrDummy", () => {
  it("runs and reuses the dummy verification path for an unknown user", async () => {
    await expect(verifyPasswordOrDummy("not-a-password", null)).resolves.toBe(false);
    await expect(verifyPasswordOrDummy("not-a-password", null)).resolves.toBe(false);
  });
});
