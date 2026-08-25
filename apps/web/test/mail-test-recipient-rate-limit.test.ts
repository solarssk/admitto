import { describe, expect, it, vi } from "vitest";
import type { Context } from "hono";
import {
  checkMailTestRecipientRateLimit,
  guardMailTestRecipientRateLimit,
} from "../src/rate-limit/policies.js";
import { InMemoryRateLimitStore } from "../src/rate-limit/in-memory.js";
import type { RateLimitStore } from "../src/rate-limit/types.js";

vi.mock("@hono/node-server/conninfo", () => ({
  getConnInfo: vi.fn(() => ({ remote: { address: "127.0.0.1", port: 1234 } })),
}));

const RECIPIENT_MAX = 5;
const IP = "203.0.113.1";

function fakeContext(): Context {
  return {
    req: { header: () => undefined },
    json: (data: unknown, status?: number) =>
      new Response(JSON.stringify(data), {
        status: status ?? 200,
        headers: { "content-type": "application/json" },
      }),
  } as unknown as Context;
}

/** Records every key passed to `hit()` without enforcing any real limit - lets a test inspect
 * the literal key the store would persist, without a test-only introspection method on
 * InMemoryRateLimitStore that production code has no other use for. */
function recordingStore(): RateLimitStore & { keys: string[] } {
  const keys: string[] = [];
  return {
    keys,
    async hit(key) {
      keys.push(key);
      return { allowed: true, remaining: 999, resetAt: Date.now() + 1000 };
    },
    async health() {
      return { ok: true, latencyMs: null };
    },
  };
}

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

  it("never passes the recipient address itself as (or within) the store key - only a keyed hash of it", async () => {
    const store = recordingStore();
    await checkMailTestRecipientRateLimit(store, "someone@example.com", IP);

    expect(store.keys).toHaveLength(1);
    const key = store.keys[0]!;
    expect(key).not.toContain("someone");
    expect(key).not.toContain("example.com");
    expect(key).not.toContain("@");
    // Fixed-length lowercase-hex tag (HMAC-SHA256 digest) after the "mail:test-recipient:" prefix.
    expect(key).toMatch(/^mail:test-recipient:[0-9a-f]{64}$/);
  });

  it("hashes deterministically (same address -> same key) but produces different tags for different addresses", async () => {
    const storeA = recordingStore();
    const storeB = recordingStore();
    await checkMailTestRecipientRateLimit(storeA, "same@example.com", IP);
    await checkMailTestRecipientRateLimit(storeB, "same@example.com", IP);
    expect(storeA.keys[0]).toBe(storeB.keys[0]);

    const storeC = recordingStore();
    await checkMailTestRecipientRateLimit(storeC, "different@example.com", IP);
    expect(storeC.keys[0]).not.toBe(storeA.keys[0]);
  });
});

describe("guardMailTestRecipientRateLimit", () => {
  it("returns null when the recipient is under budget", async () => {
    const store = new InMemoryRateLimitStore();
    const result = await guardMailTestRecipientRateLimit(fakeContext(), store, "guard@example.com");
    expect(result).toBeNull();
  });

  it("returns a 429 JSON response once the recipient budget is exhausted", async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < RECIPIENT_MAX; i++) {
      expect(await guardMailTestRecipientRateLimit(fakeContext(), store, "guard@example.com")).toBeNull();
    }
    const response = await guardMailTestRecipientRateLimit(fakeContext(), store, "guard@example.com");
    expect(response).not.toBeNull();
    expect(response!.status).toBe(429);
    expect(await response!.json()).toEqual({ error: "too many requests" });
  });
});
