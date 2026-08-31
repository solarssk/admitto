import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/admin/admin-helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/admin/admin-helpers.js")>();
  return {
    ...actual,
    assertEventManageAccess: vi.fn(async () => null),
    adminAuditFromContext: vi.fn(() => ({})),
  };
});
vi.mock("@admitto/tickets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/tickets")>();
  return {
    ...actual,
    resolveEventWalletProvider: vi.fn(),
  };
});

import { Prisma } from "@admitto/db";
import { assertEventManageAccess } from "../../src/admin/admin-helpers.js";
import { resolveEventWalletProvider } from "@admitto/tickets";
import {
  enqueueEventWideWalletRefreshStatusJob,
  handleTriggerEventWideWalletRefreshStatus,
  handleGetWalletRefreshStatusJob,
} from "../../src/admin/wallet-refresh-status-routes.js";

function fakeContext(overrides: Record<string, unknown> = {}) {
  return {
    req: {
      param: vi.fn(() => "evt-1"),
      query: vi.fn(() => undefined),
      json: vi.fn(async () => ({})),
    },
    // A real Response (not a plain object) - loadEventAdminJob's internal `instanceof Response`
    // check on its own c.json(...) result needs this to actually be one.
    json: vi.fn((body: unknown, status?: number) => new Response(JSON.stringify(body), { status: status ?? 200 })),
    header: vi.fn(),
    get: vi.fn(() => undefined),
    ...overrides,
  };
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("unique constraint violated", {
    code: "P2002",
    clientVersion: "test",
  });
}

describe("enqueueEventWideWalletRefreshStatusJob", () => {
  it("creates a new pending job when none is already queued for the event", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue({ id: "job-1" });
    const db = { adminJob: { findFirst, create } };
    const c = fakeContext();

    const jobId = await enqueueEventWideWalletRefreshStatusJob(db as never, c as never, "evt-1", "org-1");

    expect(jobId).toBe("job-1");
    expect(findFirst).toHaveBeenCalledWith({
      where: { event_id: "evt-1", type: "wallet_refresh_status", status: { in: ["pending", "running"] } },
      select: { id: true },
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "wallet_refresh_status",
        status: "pending",
        organization_id: "org-1",
        event_id: "evt-1",
        result_json: { request: { eventId: "evt-1" } },
      }),
    });
  });

  it("reuses an already-pending/running job instead of creating a duplicate", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "existing-job" });
    const create = vi.fn();
    const db = { adminJob: { findFirst, create } };
    const c = fakeContext();

    const jobId = await enqueueEventWideWalletRefreshStatusJob(db as never, c as never, "evt-1", "org-1");

    expect(jobId).toBe("existing-job");
    expect(create).not.toHaveBeenCalled();
  });

  it("on a P2002 race against a concurrent enqueue, returns whichever job won instead of failing the caller", async () => {
    const findFirst = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "winner-job" });
    const create = vi.fn().mockRejectedValueOnce(p2002());
    const db = { adminJob: { findFirst, create } };
    const c = fakeContext();

    const jobId = await enqueueEventWideWalletRefreshStatusJob(db as never, c as never, "evt-1", "org-1");

    expect(jobId).toBe("winner-job");
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it("rethrows a non-P2002 error from create", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockRejectedValue(new Error("db down"));
    const db = { adminJob: { findFirst, create } };
    const c = fakeContext();

    await expect(
      enqueueEventWideWalletRefreshStatusJob(db as never, c as never, "evt-1", "org-1"),
    ).rejects.toThrow("db down");
  });

  it("rethrows when a P2002 race's own re-check still finds nothing pending", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockRejectedValueOnce(p2002());
    const db = { adminJob: { findFirst, create } };
    const c = fakeContext();

    await expect(
      enqueueEventWideWalletRefreshStatusJob(db as never, c as never, "evt-1", "org-1"),
    ).rejects.toThrow(p2002());
  });
});

describe("handleTriggerEventWideWalletRefreshStatus", () => {
  beforeEach(() => {
    vi.mocked(assertEventManageAccess).mockReset().mockResolvedValue(null);
    vi.mocked(resolveEventWalletProvider).mockReset();
  });

  it("returns the eventId-required response when the route has no eventId param", async () => {
    const db = {};
    const c = fakeContext({ req: { param: vi.fn(() => undefined), query: vi.fn(), json: vi.fn() } });

    await handleTriggerEventWideWalletRefreshStatus(c as never, db as never);

    expect(c.json).toHaveBeenCalledWith({ error: "eventId required" }, 400);
  });

  it("returns the forbidden response from assertEventManageAccess without looking up the event", async () => {
    const forbiddenResponse = new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
    vi.mocked(assertEventManageAccess).mockResolvedValueOnce(forbiddenResponse);
    const eventFindUnique = vi.fn();
    const db = { event: { findUnique: eventFindUnique } };
    const c = fakeContext();

    const res = await handleTriggerEventWideWalletRefreshStatus(c as never, db as never);

    expect(eventFindUnique).not.toHaveBeenCalled();
    expect(res).toBe(forbiddenResponse);
  });

  it("returns not_found when the event doesn't exist", async () => {
    const db = { event: { findUnique: vi.fn().mockResolvedValue(null) } };
    const c = fakeContext();

    await handleTriggerEventWideWalletRefreshStatus(c as never, db as never);

    expect(c.json).toHaveBeenCalledWith({ error: "not_found" }, 404);
  });

  it("returns wallet_not_configured without enqueuing when the event has no resolvable wallet provider", async () => {
    vi.mocked(resolveEventWalletProvider).mockResolvedValue(null);
    const create = vi.fn();
    const db = {
      event: { findUnique: vi.fn().mockResolvedValue({ organization_id: "org-1" }) },
      adminJob: { findFirst: vi.fn(), create },
    };
    const c = fakeContext();

    await handleTriggerEventWideWalletRefreshStatus(c as never, db as never);

    expect(create).not.toHaveBeenCalled();
    expect(c.json).toHaveBeenCalledWith({ error: "wallet_not_configured" }, 409);
  });

  it("enqueues a job and returns its id, with no-store caching", async () => {
    vi.mocked(resolveEventWalletProvider).mockResolvedValue({} as never);
    const create = vi.fn().mockResolvedValue({ id: "job-1" });
    const db = {
      event: { findUnique: vi.fn().mockResolvedValue({ organization_id: "org-1" }) },
      adminJob: { findFirst: vi.fn().mockResolvedValue(null), create },
    };
    const c = fakeContext();

    const res = await handleTriggerEventWideWalletRefreshStatus(c as never, db as never);

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "wallet_refresh_status",
        event_id: "evt-1",
        organization_id: "org-1",
      }),
    });
    expect(c.header).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(c.json).toHaveBeenCalledWith({ jobId: "job-1" });
    expect(res).toBeInstanceOf(Response);
  });
});

describe("handleGetWalletRefreshStatusJob", () => {
  it("maps job fields and result_json counts into the response DTO", async () => {
    const job = {
      id: "job-1",
      status: "succeeded",
      error: null,
      progress_total: 5,
      progress_done: 5,
      result_json: { refreshed: 3, skipped: 2, errored: 0 },
      created_at: new Date("2026-08-14T10:00:00Z"),
      started_at: new Date("2026-08-14T10:00:01Z"),
    };
    const db = { adminJob: { findFirst: vi.fn().mockResolvedValue(job) } };
    const c = fakeContext({ req: { param: vi.fn(() => "job-1"), query: vi.fn(), json: vi.fn() } });

    await handleGetWalletRefreshStatusJob(c as never, db as never);

    expect(c.header).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(c.json).toHaveBeenCalledWith({
      jobId: "job-1",
      status: "succeeded",
      error: null,
      progressTotal: 5,
      progressDone: 5,
      refreshed: 3,
      skipped: 2,
      errored: 0,
      created_at: "2026-08-14T10:00:00.000Z",
      started_at: "2026-08-14T10:00:01.000Z",
    });
  });

  it("returns not_found for a job id that doesn't match this event/type", async () => {
    const db = { adminJob: { findFirst: vi.fn().mockResolvedValue(null) } };
    const c = fakeContext({ req: { param: vi.fn(() => "missing"), query: vi.fn(), json: vi.fn() } });

    await handleGetWalletRefreshStatusJob(c as never, db as never);

    expect(c.json).toHaveBeenCalledWith({ error: "not_found" }, 404);
  });

  it("falls back to nulls when the job has no result yet and hasn't started", async () => {
    const job = {
      id: "job-1",
      status: "pending",
      error: null,
      progress_total: null,
      progress_done: 0,
      result_json: null,
      created_at: new Date("2026-08-14T10:00:00Z"),
      started_at: null,
    };
    const db = { adminJob: { findFirst: vi.fn().mockResolvedValue(job) } };
    const c = fakeContext({ req: { param: vi.fn(() => "job-1"), query: vi.fn(), json: vi.fn() } });

    await handleGetWalletRefreshStatusJob(c as never, db as never);

    expect(c.json).toHaveBeenCalledWith({
      jobId: "job-1",
      status: "pending",
      error: null,
      progressTotal: null,
      progressDone: 0,
      refreshed: null,
      skipped: null,
      errored: null,
      created_at: "2026-08-14T10:00:00.000Z",
      started_at: null,
    });
  });
});
