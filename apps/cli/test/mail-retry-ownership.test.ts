import type { PrismaClient } from "@admitto/db";
import { afterEach, describe, expect, it, vi } from "vitest";
const retry = vi.hoisted(() => vi.fn());
vi.mock("@admitto/mail-delivery", () => ({ retryDelivery: retry }));
vi.mock("@admitto/auth", () => ({ resolveInstanceBaseUrl: async () => "https://tickets.example.com", InstanceUrlRequiredError: class extends Error {} }));
import { runMailRetryFailed } from "../src/commands/mail.js";
const originalArgv = process.argv;
afterEach(() => { process.argv = originalArgv; vi.restoreAllMocks(); retry.mockReset(); });
describe("CLI retry ownership reporting", () => {
  it.each(["in_flight", "not_retryable", "missing_snapshot"])("counts %s as skipped rather than failed", async (reason) => {
    process.argv = ["node", "admitto", "mail", "retry-failed", "--event", "synthetic", "--format", "json"];
    retry.mockResolvedValue({ ok: false, reason });
    const db = { emailDelivery: { findMany: async () => [{ id: "synthetic-delivery" }] } } as unknown as PrismaClient;
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runMailRetryFailed(db);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({ retried: 0, skipped: 1, failed: 0, total: 1 });
  });
});
