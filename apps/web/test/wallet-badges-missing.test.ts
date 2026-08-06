import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }),
  };
});

describe("wallet badge assets when files are missing", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns 404 for allowlisted wallet assets when no bundled file is readable", async () => {
    const { createApp } = await import("../src/app.js");
    const app = createApp();
    for (const path of [
      "/assets/admitto-mark.svg",
      "/assets/admitto-logo.svg",
      "/assets/apple-wallet-badge.svg",
      "/assets/google-wallet-badge.svg",
    ]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(404);
    }
  });
});
