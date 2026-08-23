import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import {
  handlePostAccountWebauthnRegisterBegin,
  handlePostAccountWebauthnRegisterFinish,
} from "../../src/admin/account-routes.js";
import { stashWebauthnChallenge, clearWebauthnChallengeCacheForTests } from "../../src/auth/webauthn-challenge-cache.js";

/** Mirrors `handlePostAccountWebauthnRegisterBegin`/`...Finish`'s own gates: neither depends on
 * anything else `c` exposes, so a Context this thin is enough to drive them directly - same
 * technique `external-services-crud-routes.test.ts` uses for handler-level defensive branches
 * that are unreachable through a full HTTP round trip (here: a session-less `cloudflare-access`
 * auth principal, and a user row that disappears between this handler's own lookup and
 * `beginWebauthnRegistration`'s internal one - normal HTTP can't produce either, since a
 * `Session` row is FK-cascaded to its `User` and always carries a `sessionId`). */
function mockContext(auth: { userId: string; sessionId?: string }, body?: unknown): Context {
  return {
    get: () => auth,
    req: {
      json: async () => {
        if (body === undefined) throw new SyntaxError("bad json");
        return body;
      },
    },
    json: (payload: unknown, status?: number) => Response.json(payload, { status: status ?? 200 }),
  } as unknown as Context;
}

describe("handlePostAccountWebauthnRegisterBegin - defensive branches unreachable via HTTP", () => {
  it("returns 401 for a cloudflare-access principal (no sessionId)", async () => {
    const ctx = mockContext({ userId: "user-1" });
    const res = await handlePostAccountWebauthnRegisterBegin(ctx, {} as PrismaClient);
    expect(res.status).toBe(401);
  });

  it("returns 401 when the session's own user row is gone by the time this handler queries it", async () => {
    const db = {
      systemSettings: { findUnique: async () => null },
      user: { findUnique: async () => null },
    } as unknown as PrismaClient;
    const ctx = mockContext({ userId: "user-1", sessionId: "sess-1" }, { attachment: "platform" });

    const res = await handlePostAccountWebauthnRegisterBegin(ctx, db);
    expect(res.status).toBe(401);
  });

  it("returns 401 when the user row disappears between this handler's check and beginWebauthnRegistration's own lookup", async () => {
    const userFindUnique = vi
      .fn()
      .mockResolvedValueOnce({ password_hash: "hashed" })
      .mockResolvedValue(null);
    const db = {
      systemSettings: { findUnique: async () => null },
      user: { findUnique: userFindUnique },
    } as unknown as PrismaClient;
    const ctx = mockContext({ userId: "user-1", sessionId: "sess-1" }, { attachment: "platform" });

    const res = await handlePostAccountWebauthnRegisterBegin(ctx, db, "https://admitto.example.com");
    expect(res.status).toBe(401);
    expect(userFindUnique).toHaveBeenCalledTimes(2);
  });
});

describe("resolveWebauthnRp propagates a 422 when no instance URL is configured", () => {
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

  it("register/begin returns 422 instance_url_required with no injected/env/persisted URL", async () => {
    const db = {
      systemSettings: { findUnique: async () => null },
      user: { findUnique: async () => ({ password_hash: "hashed" }) },
    } as unknown as PrismaClient;
    const ctx = mockContext({ userId: "user-1", sessionId: "sess-1" }, { attachment: "platform" });

    const res = await handlePostAccountWebauthnRegisterBegin(ctx, db);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("instance_url_required");
  });

  it("register/finish returns 422 instance_url_required with no injected/env/persisted URL", async () => {
    stashWebauthnChallenge("register", "sess-1", "some-challenge");
    const db = { systemSettings: { findUnique: async () => null } } as unknown as PrismaClient;
    const ctx = mockContext(
      { userId: "user-1", sessionId: "sess-1" },
      {
        attachment: "platform",
        response: {
          id: "cred-id",
          rawId: "cred-id",
          response: { clientDataJSON: "cdj", attestationObject: "ao" },
          clientExtensionResults: {},
          type: "public-key",
        },
      },
    );

    const res = await handlePostAccountWebauthnRegisterFinish(ctx, db);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("instance_url_required");
  });
});

describe("handlePostAccountWebauthnRegisterFinish - defensive branch unreachable via HTTP", () => {
  afterEach(() => clearWebauthnChallengeCacheForTests());

  it("returns 401 for a cloudflare-access principal (no sessionId)", async () => {
    const ctx = mockContext({ userId: "user-1" });
    const res = await handlePostAccountWebauthnRegisterFinish(ctx, {} as PrismaClient);
    expect(res.status).toBe(401);
  });
});
