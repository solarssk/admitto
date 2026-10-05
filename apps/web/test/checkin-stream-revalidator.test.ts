import type { Context } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const canPerformCheckIn = vi.hoisted(() => vi.fn());
const isSessionIdleExpired = vi.hoisted(() => vi.fn());
const isFullSessionMfaPolicySatisfied = vi.hoisted(() => vi.fn());
const getCfAccessConfigCached = vi.hoisted(() => vi.fn());
const validateAccessJwt = vi.hoisted(() => vi.fn());
const findCloudflareAccessProvider = vi.hoisted(() => vi.fn());
const resolveCfAccessIdentityFromValidatedJwt = vi.hoisted(() => vi.fn());
const extractClaims = vi.hoisted(() => vi.fn());
vi.mock("@admitto/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@admitto/auth")>()),
  canPerformCheckIn,
  isSessionIdleExpired,
  isFullSessionMfaPolicySatisfied,
  getCfAccessConfigCached,
  validateAccessJwt,
  findCloudflareAccessProvider,
  resolveCfAccessIdentityFromValidatedJwt,
  extractClaims,
}));

import { CfAccessJwtError, ExternalIdentityLinkError } from "@admitto/auth";
import { createCheckinStreamRevalidator } from "../src/checkin-gate.js";

const FUTURE = new Date(Date.now() + 3_600_000);

function setup(opts: {
  event?: { archived_at: Date | null } | null;
  session?: { revoked_at: Date | null; expires_at: Date } | null;
  user?: { is_active: boolean } | null;
  vars: Record<string, unknown>;
  headers?: Record<string, string>;
  throwOn?: "event";
}) {
  const prisma = {
    event: {
      findUnique: opts.throwOn
        ? vi.fn().mockRejectedValue(new Error("db down"))
        : vi.fn().mockResolvedValue(opts.event === undefined ? { archived_at: null } : opts.event),
    },
    session: { findUnique: vi.fn().mockResolvedValue(opts.session ?? null) },
    user: {
      findUnique: vi.fn().mockResolvedValue(opts.user === undefined ? { is_active: true } : opts.user),
    },
  };
  const revalidate = createCheckinStreamRevalidator({ prisma, config: {} } as never);
  const c = {
    get: (key: string) => opts.vars[key],
    req: { raw: { headers: new Headers(opts.headers ?? {}) } },
  } as unknown as Context;
  return { prisma, run: () => revalidate(c, "evt-1") };
}

const liveSession = { revoked_at: null, expires_at: FUTURE };

describe("createCheckinStreamRevalidator", () => {
  beforeEach(() => {
    canPerformCheckIn.mockReset().mockResolvedValue(true);
    isSessionIdleExpired.mockReset().mockResolvedValue(false);
    isFullSessionMfaPolicySatisfied.mockReset().mockResolvedValue(true);
    getCfAccessConfigCached.mockReset().mockResolvedValue({ enabled: true });
    validateAccessJwt.mockReset().mockResolvedValue({});
    findCloudflareAccessProvider.mockReset().mockResolvedValue({ enabled: true });
    resolveCfAccessIdentityFromValidatedJwt.mockReset().mockResolvedValue({ userId: "u1" });
    extractClaims.mockReset().mockReturnValue({});
    validateAccessJwt.mockResolvedValue({ sub: "cf-sub" });
  });

  it("denies once the event is archived, even for the emergency bearer", async () => {
    const { run } = setup({ event: { archived_at: new Date() }, vars: { checkinAuth: "bearer" } });
    expect(await run()).toBe(false);
  });

  it("denies once the event no longer exists, even for the emergency bearer", async () => {
    const { run } = setup({ event: null, vars: { checkinAuth: "bearer" } });
    expect(await run()).toBe(false);
  });

  it("keeps a bearer stream open while the event is active", async () => {
    const { run, prisma } = setup({ vars: { checkinAuth: "bearer" } });
    expect(await run()).toBe(true);
    expect(prisma.session.findUnique).not.toHaveBeenCalled();
  });

  it("denies a session caller without an operator user id", async () => {
    const { run } = setup({ vars: {} });
    expect(await run()).toBe(false);
  });

  it.each([
    ["is gone", null],
    ["was revoked", { ...liveSession, revoked_at: new Date() }],
    ["expired", { ...liveSession, expires_at: new Date(Date.now() - 1000) }],
  ])("denies when the session %s", async (_name, session) => {
    const { run } = setup({ session, vars: { operatorUserId: "u1", checkinSessionId: "s1" } });
    expect(await run()).toBe(false);
    expect(canPerformCheckIn).not.toHaveBeenCalled();
  });

  it("denies a session that has been idle longer than its role allows", async () => {
    isSessionIdleExpired.mockResolvedValue(true);
    const { run } = setup({ session: liveSession, vars: { operatorUserId: "u1", checkinSessionId: "s1" } });
    expect(await run()).toBe(false);
    expect(canPerformCheckIn).not.toHaveBeenCalled();
  });

  it("denies a session that no longer satisfies the MFA policy (role granted after sign-in)", async () => {
    isFullSessionMfaPolicySatisfied.mockResolvedValue(false);
    const { run } = setup({ session: liveSession, vars: { operatorUserId: "u1", checkinSessionId: "s1" } });
    expect(await run()).toBe(false);
    expect(canPerformCheckIn).not.toHaveBeenCalled();
  });

  describe("Cloudflare Access streams", () => {
    const cf = {
      vars: { operatorUserId: "u1", checkinAuthSource: "cloudflare-access" },
      headers: { "cf-access-jwt-assertion": "jwt" },
    };

    it("stays open while the assertion, integration and provider are valid", async () => {
      expect(await setup(cf).run()).toBe(true);
      expect(validateAccessJwt).toHaveBeenCalledWith("jwt", expect.anything());
    });

    it("closes once the integration is disabled, the token is gone or the provider is disabled", async () => {
      getCfAccessConfigCached.mockResolvedValueOnce({ enabled: false });
      expect(await setup(cf).run()).toBe(false);
      expect(await setup({ ...cf, headers: {} }).run()).toBe(false);
      findCloudflareAccessProvider.mockResolvedValueOnce({ enabled: false });
      expect(await setup(cf).run()).toBe(false);
      findCloudflareAccessProvider.mockResolvedValueOnce(null);
      expect(await setup(cf).run()).toBe(false);
    });

    it("closes once the identity no longer resolves to this operator", async () => {
      resolveCfAccessIdentityFromValidatedJwt.mockRejectedValueOnce(
        new ExternalIdentityLinkError("source_identity_not_linked"),
      );
      expect(await setup(cf).run()).toBe(false);
      resolveCfAccessIdentityFromValidatedJwt.mockResolvedValueOnce({ userId: "someone-else" });
      expect(await setup(cf).run()).toBe(false);
      expect(resolveCfAccessIdentityFromValidatedJwt).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ cloudflareSubject: "cf-sub" }),
      );
    });

    it("keeps the stream open on a database error during the resolution, and denies a token without sub", async () => {
      resolveCfAccessIdentityFromValidatedJwt.mockRejectedValueOnce(new Error("db down"));
      expect(await setup(cf).run()).toBe(true);
      validateAccessJwt.mockResolvedValueOnce({});
      expect(await setup(cf).run()).toBe(false);
    });

    it("closes when the assertion expired but not on a transient verification failure", async () => {
      validateAccessJwt.mockRejectedValueOnce(new CfAccessJwtError("expired", "expired"));
      expect(await setup(cf).run()).toBe(false);
      validateAccessJwt.mockRejectedValueOnce(new Error("jwks fetch failed"));
      expect(await setup(cf).run()).toBe(true);
      // validateAccessJwt wraps whatever verification threw; a network cause stays transient.
      validateAccessJwt.mockRejectedValueOnce(
        new CfAccessJwtError("fetch failed", "invalid_jwt", { cause: new TypeError("fetch failed") }),
      );
      expect(await setup(cf).run()).toBe(true);
    });
  });

  it.each([
    ["deactivated", { is_active: false }],
    ["missing", null],
  ])("denies a %s user, with or without a session row", async (_name, user) => {
    for (const vars of [{ operatorUserId: "u1" }, { operatorUserId: "u1", checkinSessionId: "s1" }]) {
      const { run } = setup({ user, session: liveSession, vars });
      expect(await run()).toBe(false);
    }
    expect(canPerformCheckIn).not.toHaveBeenCalled();
  });

  it("follows canPerformCheckIn for a live session", async () => {
    const { run } = setup({ session: liveSession, vars: { operatorUserId: "u1", checkinSessionId: "s1" } });
    expect(await run()).toBe(true);
    canPerformCheckIn.mockResolvedValue(false);
    expect(await run()).toBe(false);
  });

  it("checks only the role when there is no session row (Cloudflare Access)", async () => {
    const { run, prisma } = setup({ vars: { operatorUserId: "u1" } });
    expect(await run()).toBe(true);
    expect(prisma.session.findUnique).not.toHaveBeenCalled();
    expect(canPerformCheckIn).toHaveBeenCalledWith(expect.anything(), "u1", "evt-1");
  });

  it("keeps the stream open when the database check itself fails", async () => {
    const { run } = setup({ vars: { operatorUserId: "u1" }, throwOn: "event" });
    expect(await run()).toBe(true);
  });
});
