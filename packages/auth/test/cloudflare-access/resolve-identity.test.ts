import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IdentityProvider, PrismaClient } from "@admitto/db";
import { ExternalIdentityLinkError } from "../../src/external-identity/resolve-user.js";

const notifyOwnAuthFactorChanged = vi.fn();
vi.mock("../../src/audit.js", () => ({
  notifyOwnAuthFactorChanged: (...args: unknown[]) => notifyOwnAuthFactorChanged(...args),
}));

import {
  clearCfAccessIdentityCacheForTests,
  extractCfAccessSourceGroups,
  extractCfAccessSourceSubject,
  resolveCfAccessIdentityFromValidatedJwt,
} from "../../src/cloudflare-access/resolve-identity.js";

describe("extractCfAccessSourceSubject", () => {
  it("accepts an opaque canonical subject copied into the verified Access JWT", () => {
    expect(
      extractCfAccessSourceSubject({
        custom: { admitto_identity: "9ea48257-8f5c-4b66-831b-207e2d3e9b16" },
      }),
    ).toBe("9ea48257-8f5c-4b66-831b-207e2d3e9b16");
  });

  it.each([
    [{}, "missing custom claim"],
    [{ custom: {} }, "missing identity value"],
    [{ custom: { admitto_identity: "" } }, "empty identity value"],
    [{ custom: { admitto_identity: "identity@example.com" } }, "email identity value"],
    [{ custom: { admitto_identity: ["not-a-subject"] } }, "non-string identity value"],
  ])("rejects %s", (payload) => {
    expect(() => extractCfAccessSourceSubject(payload)).toThrow(ExternalIdentityLinkError);
  });
});

describe("extractCfAccessSourceGroups", () => {
  it("keeps an explicit empty group assertion so mapped grants can be revoked", () => {
    expect(
      extractCfAccessSourceGroups(
        { custom: { admitto_groups: [] } },
        "admitto_groups",
      ),
    ).toEqual([]);
  });

  it.each([
    [{}, "no copied custom claims"],
    [{ custom: {} }, "no configured group claim"],
    [{ custom: { admitto_groups: ["operators", 42] } }, "a partially malformed group array"],
    [{ custom: { admitto_groups: "   " } }, "a blank group string"],
  ])("does not turn %s into an empty revocation assertion", (payload) => {
    expect(extractCfAccessSourceGroups(payload, "admitto_groups")).toBeUndefined();
  });
});

describe("resolveCfAccessIdentityFromValidatedJwt", () => {
  const input = {
    config: { enabled: true, sourceProviderId: "source-provider" },
    cloudflareProvider: {} as IdentityProvider,
    cloudflareSubject: "edge-session-subject",
    payload: { custom: { admitto_identity: "source-subject" } },
    claims: {},
  };

  it.each([
    [{ enabled: false, sourceProviderId: "source-provider" }, "disabled Cloudflare Access"],
    [{ enabled: true, sourceProviderId: "   " }, "missing direct provider"],
  ])("rejects %s before it opens a transaction", async (config) => {
    await expect(
      resolveCfAccessIdentityFromValidatedJwt({} as PrismaClient, { ...input, config }),
    ).rejects.toMatchObject({
      name: "ExternalIdentityLinkError",
      message: "source_provider_not_configured",
    });
  });

  it("retries a serialization conflict with serializable transactions", async () => {
    const transaction = vi.fn(async () => {
      throw { code: "P2034" };
    });
    const prisma = { $transaction: transaction } as unknown as PrismaClient;

    await expect(resolveCfAccessIdentityFromValidatedJwt(prisma, input)).rejects.toEqual({
      code: "P2034",
    });
    expect(transaction).toHaveBeenCalledTimes(5);
    expect(transaction).toHaveBeenLastCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });
});

describe("resolveCfAccessIdentityFromValidatedJwt caching", () => {
  const input = {
    config: { enabled: true, sourceProviderId: "source-provider" },
    cloudflareProvider: {} as IdentityProvider,
    cloudflareSubject: "edge-session-subject",
    claims: {},
  };

  beforeEach(() => {
    clearCfAccessIdentityCacheForTests();
  });

  it("coalesces concurrent calls presenting the same issued token into one transaction", async () => {
    const transaction = vi.fn(async () => ({ userId: "resolved-user" }));
    const prisma = { $transaction: transaction } as unknown as PrismaClient;
    const sameToken = {
      ...input,
      payload: { sub: "cf-sub-a", iat: 1000, custom: { admitto_identity: "source-subject" } },
    };

    const [first, second] = await Promise.all([
      resolveCfAccessIdentityFromValidatedJwt(prisma, sameToken),
      resolveCfAccessIdentityFromValidatedJwt(prisma, sameToken),
    ]);

    expect(first).toEqual({ userId: "resolved-user" });
    expect(second).toEqual({ userId: "resolved-user" });
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("never serves a cached result once the resolution has settled, even for the identical token - a deactivated account or disabled provider must be caught on the very next call", async () => {
    const transaction = vi.fn(async () => ({ userId: "resolved-user" }));
    const prisma = { $transaction: transaction } as unknown as PrismaClient;
    const sameToken = {
      ...input,
      payload: { sub: "cf-sub-sequential", iat: 1000, custom: { admitto_identity: "source-subject" } },
    };

    await resolveCfAccessIdentityFromValidatedJwt(prisma, sameToken);
    await resolveCfAccessIdentityFromValidatedJwt(prisma, sameToken);
    await resolveCfAccessIdentityFromValidatedJwt(prisma, sameToken);

    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it("does not reuse the cache once Cloudflare issues a new token (different iat)", async () => {
    const transaction = vi.fn(async () => ({ userId: "resolved-user" }));
    const prisma = { $transaction: transaction } as unknown as PrismaClient;

    await resolveCfAccessIdentityFromValidatedJwt(prisma, {
      ...input,
      payload: { sub: "cf-sub-b", iat: 1000, custom: { admitto_identity: "source-subject" } },
    });
    await resolveCfAccessIdentityFromValidatedJwt(prisma, {
      ...input,
      payload: { sub: "cf-sub-b", iat: 2000, custom: { admitto_identity: "source-subject" } },
    });

    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed resolution - the next call retries fresh", async () => {
    const transaction = vi
      .fn()
      .mockRejectedValueOnce({ code: "P2034" })
      .mockRejectedValueOnce({ code: "P2034" })
      .mockRejectedValueOnce({ code: "P2034" })
      .mockRejectedValueOnce({ code: "P2034" })
      .mockRejectedValueOnce({ code: "P2034" })
      .mockResolvedValueOnce({ userId: "resolved-user" });
    const prisma = { $transaction: transaction } as unknown as PrismaClient;
    const sameToken = {
      ...input,
      payload: { sub: "cf-sub-c", iat: 1000, custom: { admitto_identity: "source-subject" } },
    };

    await expect(resolveCfAccessIdentityFromValidatedJwt(prisma, sameToken)).rejects.toEqual({
      code: "P2034",
    });
    await expect(resolveCfAccessIdentityFromValidatedJwt(prisma, sameToken)).resolves.toEqual({
      userId: "resolved-user",
    });
  });
});

describe("resolveCfAccessIdentityFromValidatedJwt notifies on a real new link", () => {
  const input = {
    config: { enabled: true, sourceProviderId: "source-provider" },
    cloudflareProvider: {} as IdentityProvider,
    cloudflareSubject: "edge-session-subject",
    claims: {},
  };

  beforeEach(() => {
    clearCfAccessIdentityCacheForTests();
    notifyOwnAuthFactorChanged.mockReset().mockResolvedValue(undefined);
  });

  it("notifies the account owner when a new Cloudflare Access ExternalIdentity was actually created (bot review finding, PR #1308)", async () => {
    const transaction = vi.fn(async () => ({ userId: "resolved-user", linked: true }));
    const prisma = { $transaction: transaction } as unknown as PrismaClient;

    const result = await resolveCfAccessIdentityFromValidatedJwt(prisma, {
      ...input,
      payload: { sub: "cf-sub-notify-new", iat: 1000, custom: { admitto_identity: "source-subject" } },
    });

    expect(result).toEqual({ userId: "resolved-user" });
    expect(notifyOwnAuthFactorChanged).toHaveBeenCalledWith(
      prisma,
      "resolved-user",
      "A new SSO connection was linked",
      expect.any(String),
    );
  });

  it("does not notify when the Cloudflare Access identity already existed (a re-authentication, not a new link)", async () => {
    const transaction = vi.fn(async () => ({ userId: "resolved-user", linked: false }));
    const prisma = { $transaction: transaction } as unknown as PrismaClient;

    await resolveCfAccessIdentityFromValidatedJwt(prisma, {
      ...input,
      payload: { sub: "cf-sub-notify-existing", iat: 1000, custom: { admitto_identity: "source-subject" } },
    });

    expect(notifyOwnAuthFactorChanged).not.toHaveBeenCalled();
  });

  it("fires notify only once when concurrent callers share the same coalesced transaction", async () => {
    const transaction = vi.fn(async () => ({ userId: "resolved-user", linked: true }));
    const prisma = { $transaction: transaction } as unknown as PrismaClient;
    const sameToken = {
      ...input,
      payload: { sub: "cf-sub-notify-coalesced", iat: 1000, custom: { admitto_identity: "source-subject" } },
    };

    await Promise.all([
      resolveCfAccessIdentityFromValidatedJwt(prisma, sameToken),
      resolveCfAccessIdentityFromValidatedJwt(prisma, sameToken),
    ]);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(notifyOwnAuthFactorChanged).toHaveBeenCalledOnce();
  });
});
