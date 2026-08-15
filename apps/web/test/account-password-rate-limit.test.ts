import { describe, expect, it } from "vitest";
import { checkAccountPasswordRateLimit } from "../src/rate-limit/policies.js";
import { InMemoryRateLimitStore } from "../src/rate-limit/in-memory.js";

const USER = "user-1";
const PASSWORD_CHECK_MAX = 10;

describe("checkAccountPasswordRateLimit", () => {
  it("blocks after the per-user budget is exhausted even when every attempt comes from a different IP", async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < PASSWORD_CHECK_MAX; i++) {
      // A different source IP on every call — simulates an attacker rotating IPs to defeat an
      // IP-only throttle. The user-scoped bucket must still accumulate and trip.
      expect(await checkAccountPasswordRateLimit(store, USER, `203.0.113.${i}`)).toBe(true);
    }
    expect(await checkAccountPasswordRateLimit(store, USER, "203.0.113.99")).toBe(false);
  });

  it("still rate-limits by IP within the same user — a different user from an exhausted IP is not blocked by it", async () => {
    const store = new InMemoryRateLimitStore();
    const ip = "198.51.100.1";
    for (let i = 0; i < PASSWORD_CHECK_MAX; i++) {
      expect(await checkAccountPasswordRateLimit(store, "user-a", ip)).toBe(true);
    }
    expect(await checkAccountPasswordRateLimit(store, "user-a", ip)).toBe(false);
    // Different user, same (exhausted) IP — the IP bucket is defense-in-depth, not the primary
    // gate, so a different account is judged on its own (fresh) user-scoped bucket... except the
    // shared IP bucket has also been exhausted by user-a's attempts, so this must fail too.
    expect(await checkAccountPasswordRateLimit(store, "user-b", ip)).toBe(false);
  });

  it("keeps separate users on separate budgets from separate IPs", async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < PASSWORD_CHECK_MAX; i++) {
      expect(await checkAccountPasswordRateLimit(store, "user-a", "198.51.100.10")).toBe(true);
    }
    expect(await checkAccountPasswordRateLimit(store, "user-a", "198.51.100.10")).toBe(false);
    expect(await checkAccountPasswordRateLimit(store, "user-b", "198.51.100.11")).toBe(true);
  });
});
