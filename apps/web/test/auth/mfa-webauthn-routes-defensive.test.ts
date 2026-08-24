import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import { SESSION_STAGE } from "@admitto/auth";
import { handlePostMfaWebauthnBegin, handlePostMfaWebauthnVerify } from "../../src/auth/routes.js";
import { stashWebauthnChallenge, clearWebauthnChallengeCacheForTests } from "../../src/auth/webauthn-challenge-cache.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/in-memory.js";

/** Mirrors account-routes-webauthn.test.ts's own `mockContext` - same technique for a
 * defensive branch (`resolveWebauthnRp` propagating a 422) that a real HTTP round trip can't
 * produce, since this suite's other integration tests always pass an explicit `injectedBaseUrl`. */
function mockContext(partialAuth: { userId: string; sessionId: string; stage: string }, body?: unknown): Context {
  return {
    get: () => partialAuth,
    req: {
      json: async () => {
        if (body === undefined) throw new SyntaxError("bad json");
        return body;
      },
      header: () => undefined,
    },
    json: (payload: unknown, status?: number) => Response.json(payload, { status: status ?? 200 }),
  } as unknown as Context;
}

describe("handlePostMfaWebauthnBegin/Verify propagate a 422 when no instance URL is configured", () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevBaseUrl = process.env.BASE_URL;

  beforeEach(() => {
    // Only reachable in a real deployment: this test file's shared env fixes both NODE_ENV=test
    // and BASE_URL, either of which alone would make `resolveInstanceBaseUrl` fall back instead
    // of throwing (see packages/auth/src/settings/resolve-instance-base-url.ts).
    process.env.NODE_ENV = "production";
    delete process.env.BASE_URL;
  });

  afterEach(() => {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevBaseUrl === undefined) delete process.env.BASE_URL;
    else process.env.BASE_URL = prevBaseUrl;
    clearWebauthnChallengeCacheForTests();
  });

  const db = { systemSettings: { findUnique: async () => null } } as unknown as PrismaClient;

  it("begin returns 422 instance_url_required with no injected/env/persisted URL", async () => {
    const ctx = mockContext({ userId: "user-1", sessionId: "sess-1", stage: SESSION_STAGE.MFA_PENDING });

    const res = await handlePostMfaWebauthnBegin(ctx, db);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("instance_url_required");
  });

  it("verify returns 422 instance_url_required with no injected/env/persisted URL", async () => {
    stashWebauthnChallenge("assert", "sess-1", "some-challenge");
    const ctx = mockContext(
      { userId: "user-1", sessionId: "sess-1", stage: SESSION_STAGE.MFA_PENDING },
      {
        response: {
          id: "x",
          rawId: "x",
          type: "public-key",
          clientExtensionResults: {},
          response: { clientDataJSON: "x", authenticatorData: "x", signature: "x" },
        },
      },
    );

    const res = await handlePostMfaWebauthnVerify(ctx, db, new InMemoryRateLimitStore());
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("instance_url_required");
  });
});
