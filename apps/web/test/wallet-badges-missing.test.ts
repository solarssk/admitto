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

  it(
    "returns 404 for allowlisted wallet assets when no bundled file is readable",
    async () => {
      // Default 5000ms budget is too tight for this specific test under CI's coverage-instrumented
      // full-suite run: vi.resetModules() + a fresh `await import("../src/app.js")` pays the full
      // app-factory bootstrap cost on every run (unlike most tests, which import app.js once at
      // module load and reuse it), and that bootstrap occasionally lands past 5s here even though
      // it stays well under 3s in isolation - confirmed by this exact test intermittently timing
      // out in CI while passing locally every time (real, repeated CI failures, not a one-off).
      const { createApp } = await import("../src/app.js");
      const app = createApp();
      for (const path of [
        "/assets/admitto-mark.svg",
        "/assets/admitto-logo.svg",
        "/assets/apple-wallet-badge.svg",
        "/assets/google-wallet-badge.svg",
        "/assets/apple-wallet-badge.png",
        "/assets/google-wallet-badge.png",
      ]) {
        const res = await app.request(path);
        expect(res.status, path).toBe(404);
      }
    },
    15000,
  );
});
