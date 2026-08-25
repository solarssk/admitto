import { describe, expect, it } from "vitest";
import { checkMailTestRecipientRateLimit } from "../src/rate-limit/policies.js";
import { InMemoryRateLimitStore } from "../src/rate-limit/in-memory.js";

const RECIPIENT_MAX = 5;
const IP = "203.0.113.1";

describe("checkMailTestRecipientRateLimit", () => {
  it("blocks after the per-recipient budget is exhausted", async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < RECIPIENT_MAX; i++) {
      expect(await checkMailTestRecipientRateLimit(store, "target@example.com", IP)).toBe(true);
    }
    expect(await checkMailTestRecipientRateLimit(store, "target@example.com", IP)).toBe(false);
  });

  it("is global, not scoped by IP - a different caller against the same exhausted recipient is still blocked", async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < RECIPIENT_MAX; i++) {
      expect(await checkMailTestRecipientRateLimit(store, "target@example.com", `198.51.100.${i}`)).toBe(
        true,
      );
    }
    expect(await checkMailTestRecipientRateLimit(store, "target@example.com", "198.51.100.99")).toBe(
      false,
    );
  });

  it("keeps separate recipients on separate budgets", async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < RECIPIENT_MAX; i++) {
      expect(await checkMailTestRecipientRateLimit(store, "target-a@example.com", IP)).toBe(true);
    }
    expect(await checkMailTestRecipientRateLimit(store, "target-a@example.com", IP)).toBe(false);
    expect(await checkMailTestRecipientRateLimit(store, "target-b@example.com", IP)).toBe(true);
  });

  it("normalizes recipient case, so the same address does not get two separate budgets", async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < RECIPIENT_MAX; i++) {
      expect(await checkMailTestRecipientRateLimit(store, "Target@Example.com", IP)).toBe(true);
    }
    expect(await checkMailTestRecipientRateLimit(store, "target@example.com", IP)).toBe(false);
  });
});
