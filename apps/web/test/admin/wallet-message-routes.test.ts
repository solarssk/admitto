import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/admin/admin-helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/admin/admin-helpers.js")>();
  return {
    ...actual,
    assertEventManageAccess: vi.fn(async () => null),
    adminAuditFromContext: vi.fn(() => ({})),
    resolveClientTimezone: vi.fn(() => null),
  };
});
vi.mock("@admitto/tickets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/tickets")>();
  return {
    ...actual,
    loadEventTicketTypes: vi.fn(async () => []),
    writeBulkActionLog: vi.fn(async () => undefined),
  };
});

import { assertEventManageAccess } from "../../src/admin/admin-helpers.js";
import { loadEventTicketTypes, writeBulkActionLog } from "@admitto/tickets";
import {
  handleGetWalletMessageHistory,
  handleGetWalletMessageJob,
  handleSearchWalletMessageAttendees,
  handleWalletMessageSend,
  resolveWalletMessageAttendeeIds,
  WALLET_MESSAGE_RECIPIENT_LIMIT,
} from "../../src/admin/wallet-message-routes.js";

const HAS_WALLET_WHERE = { wallet_pass: { status: "active", provider_pass_id: { not: null } } };

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

describe("resolveWalletMessageAttendeeIds", () => {
  it("'all' resolves to every attendee on the event with an active wallet pass, no other filter", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "att-1" }, { id: "att-2" }]);
    const db = { attendee: { findMany } };

    const result = await resolveWalletMessageAttendeeIds(db as never, "evt-1", { type: "all" });

    expect(findMany).toHaveBeenCalledWith({
      where: { event_id: "evt-1", ...HAS_WALLET_WHERE },
      select: { id: true },
      take: WALLET_MESSAGE_RECIPIENT_LIMIT + 1,
    });
    expect(result).toEqual({ ids: ["att-1", "att-2"], overLimit: false });
  });

  it("'ticket_type' additionally scopes to that ticket type", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "att-1" }]);
    const db = { attendee: { findMany } };

    await resolveWalletMessageAttendeeIds(db as never, "evt-1", { type: "ticket_type", value: "vip" });

    expect(findMany).toHaveBeenCalledWith({
      where: { event_id: "evt-1", ...HAS_WALLET_WHERE, ticket_type: "vip" },
      select: { id: true },
      take: WALLET_MESSAGE_RECIPIENT_LIMIT + 1,
    });
  });

  it("'attendee_ids' still re-applies the active-wallet filter server-side, not trusting the client-picked ids blindly", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "att-1" }]);
    const db = { attendee: { findMany } };

    await resolveWalletMessageAttendeeIds(db as never, "evt-1", {
      type: "attendee_ids",
      ids: ["att-1", "att-2"],
    });

    expect(findMany).toHaveBeenCalledWith({
      where: { event_id: "evt-1", ...HAS_WALLET_WHERE, id: { in: ["att-1", "att-2"] } },
      select: { id: true },
      take: WALLET_MESSAGE_RECIPIENT_LIMIT + 1,
    });
  });

  it("reports overLimit and an empty id list when the resolved set exceeds the cap", async () => {
    const rows = Array.from({ length: WALLET_MESSAGE_RECIPIENT_LIMIT + 1 }, (_, i) => ({ id: `att-${i}` }));
    const db = { attendee: { findMany: vi.fn().mockResolvedValue(rows) } };

    const result = await resolveWalletMessageAttendeeIds(db as never, "evt-1", { type: "all" });

    expect(result).toEqual({ ids: [], overLimit: true });
  });
});

describe("handleWalletMessageSend", () => {
  beforeEach(() => {
    vi.mocked(assertEventManageAccess).mockReset().mockResolvedValue(null);
    vi.mocked(loadEventTicketTypes).mockReset().mockResolvedValue([]);
    vi.mocked(writeBulkActionLog).mockReset().mockResolvedValue(undefined);
  });

  it("returns validation_failed for a malformed body", async () => {
    const db = {};
    const c = fakeContext({
      req: { param: vi.fn(() => "evt-1"), query: vi.fn(), json: vi.fn(async () => ({ nonsense: true })) },
    });

    const res = await handleWalletMessageSend(c as never, db as never);

    expect(c.json).toHaveBeenCalledWith({ error: "validation_failed" }, 400);
    expect(res).toBeDefined();
  });

  it("returns unknown_ticket_type when the ticket_type filter references a type not in the catalog", async () => {
    vi.mocked(loadEventTicketTypes).mockResolvedValue([{ key: "general" } as never]);
    const db = {};
    const c = fakeContext({
      req: {
        param: vi.fn(() => "evt-1"),
        query: vi.fn(),
        json: vi.fn(async () => ({ filter: { type: "ticket_type", value: "vip" }, text: "Hi" })),
      },
    });

    await handleWalletMessageSend(c as never, db as never);

    expect(c.json).toHaveBeenCalledWith({ error: "unknown_ticket_type" }, 400);
  });

  it("dry run returns only recipientCount, never creates a job", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "att-1" }, { id: "att-2" }]);
    const create = vi.fn();
    const db = { attendee: { findMany }, adminJob: { create } };
    const c = fakeContext({
      req: {
        param: vi.fn(() => "evt-1"),
        query: vi.fn(),
        json: vi.fn(async () => ({ filter: { type: "all" }, text: "Welcome!", dryRun: true })),
      },
    });

    await handleWalletMessageSend(c as never, db as never);

    expect(create).not.toHaveBeenCalled();
    expect(c.json).toHaveBeenCalledWith({ recipientCount: 2 });
  });

  it("dry run succeeds with no text at all - counting only resolves the filter, never reads text", async () => {
    const db = { attendee: { findMany: vi.fn().mockResolvedValue([{ id: "att-1" }]) } };
    const c = fakeContext({
      req: {
        param: vi.fn(() => "evt-1"),
        query: vi.fn(),
        json: vi.fn(async () => ({ filter: { type: "all" }, dryRun: true })),
      },
    });

    await handleWalletMessageSend(c as never, db as never);

    expect(c.json).toHaveBeenCalledWith({ recipientCount: 1 });
  });

  it("returns validation_failed for a real send with empty/whitespace-only text (not the dry-run path)", async () => {
    const db = { attendee: { findMany: vi.fn().mockResolvedValue([{ id: "att-1" }]) } };
    const c = fakeContext({
      req: {
        param: vi.fn(() => "evt-1"),
        query: vi.fn(),
        json: vi.fn(async () => ({ filter: { type: "all" }, text: "   " })),
      },
    });

    await handleWalletMessageSend(c as never, db as never);

    expect(c.json).toHaveBeenCalledWith({ error: "validation_failed" }, 400);
  });

  it("too_many_attendees when the resolved recipient set exceeds the cap", async () => {
    const rows = Array.from({ length: WALLET_MESSAGE_RECIPIENT_LIMIT + 1 }, (_, i) => ({ id: `att-${i}` }));
    const db = { attendee: { findMany: vi.fn().mockResolvedValue(rows) } };
    const c = fakeContext({
      req: {
        param: vi.fn(() => "evt-1"),
        query: vi.fn(),
        json: vi.fn(async () => ({ filter: { type: "all" }, text: "Hi" })),
      },
    });

    await handleWalletMessageSend(c as never, db as never);

    expect(c.json).toHaveBeenCalledWith(
      { error: "too_many_attendees", limit: WALLET_MESSAGE_RECIPIENT_LIMIT },
      400,
    );
  });

  it("responds with a null jobId and does not create a job when nothing matches the filter", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const create = vi.fn();
    const db = { attendee: { findMany }, adminJob: { create } };
    const c = fakeContext({
      req: {
        param: vi.fn(() => "evt-1"),
        query: vi.fn(),
        json: vi.fn(async () => ({ filter: { type: "all" }, text: "Hi" })),
      },
    });

    await handleWalletMessageSend(c as never, db as never);

    expect(create).not.toHaveBeenCalled();
    expect(c.json).toHaveBeenCalledWith({ jobId: null, recipientCount: 0 });
  });

  it("enqueues a wallet_message AdminJob with the resolved ids and text, and writes an audit log", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "att-1" }, { id: "att-2" }]);
    const create = vi.fn().mockResolvedValue({ id: "job-1" });
    const eventFindUnique = vi.fn().mockResolvedValue({ organization_id: "org-1" });
    const db = { attendee: { findMany }, adminJob: { create }, event: { findUnique: eventFindUnique } };
    const c = fakeContext({
      req: {
        param: vi.fn(() => "evt-1"),
        query: vi.fn(),
        json: vi.fn(async () => ({ filter: { type: "all" }, text: "Welcome to the event!" })),
      },
    });

    await handleWalletMessageSend(c as never, db as never);

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "wallet_message",
        status: "pending",
        organization_id: "org-1",
        event_id: "evt-1",
        result_json: {
          request: { eventId: "evt-1", attendeeIds: ["att-1", "att-2"], text: "Welcome to the event!" },
        },
      }),
    });
    expect(writeBulkActionLog).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        event_id: "evt-1",
        action_type: "wallet_message_sent",
        metadata: { filter: "all", recipient_count: 2 },
      }),
    );
    expect(c.json).toHaveBeenCalledWith({ jobId: "job-1", recipientCount: 2 });
  });

  it("still enqueues even when the best-effort audit log write itself fails (bug in logging must not block the real send)", async () => {
    vi.mocked(writeBulkActionLog).mockRejectedValueOnce(new Error("audit db down"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const findMany = vi.fn().mockResolvedValue([{ id: "att-1" }]);
    const create = vi.fn().mockResolvedValue({ id: "job-1" });
    const db = {
      attendee: { findMany },
      adminJob: { create },
      event: { findUnique: vi.fn().mockResolvedValue({ organization_id: "org-1" }) },
    };
    const c = fakeContext({
      req: {
        param: vi.fn(() => "evt-1"),
        query: vi.fn(),
        json: vi.fn(async () => ({ filter: { type: "all" }, text: "Hi" })),
      },
    });

    await handleWalletMessageSend(c as never, db as never);

    expect(create).toHaveBeenCalled();
    expect(c.json).toHaveBeenCalledWith({ jobId: "job-1", recipientCount: 1 });
    consoleErrorSpy.mockRestore();
  });
});

describe("handleGetWalletMessageJob", () => {
  it("maps job fields and result_json counts into the response DTO", async () => {
    const job = {
      id: "job-1",
      status: "succeeded",
      error: null,
      progress_total: 3,
      progress_done: 3,
      result_json: { sent: 2, skipped: 1, errored: 0 },
      created_at: new Date("2026-08-14T10:00:00Z"),
      started_at: new Date("2026-08-14T10:00:01Z"),
    };
    const db = { adminJob: { findFirst: vi.fn().mockResolvedValue(job) } };
    const c = fakeContext({ req: { param: vi.fn(() => "job-1"), query: vi.fn(), json: vi.fn() } });

    await handleGetWalletMessageJob(c as never, db as never);

    expect(c.json).toHaveBeenCalledWith({
      jobId: "job-1",
      status: "succeeded",
      error: null,
      progressTotal: 3,
      progressDone: 3,
      sent: 2,
      skipped: 1,
      errored: 0,
      created_at: "2026-08-14T10:00:00.000Z",
      started_at: "2026-08-14T10:00:01.000Z",
    });
  });

  it("returns not_found for a job id that doesn't match this event/type", async () => {
    const db = { adminJob: { findFirst: vi.fn().mockResolvedValue(null) } };
    const c = fakeContext({ req: { param: vi.fn(() => "missing"), query: vi.fn(), json: vi.fn() } });

    await handleGetWalletMessageJob(c as never, db as never);

    expect(c.json).toHaveBeenCalledWith({ error: "not_found" }, 404);
  });
});

describe("handleGetWalletMessageHistory", () => {
  it("maps terminal jobs newest-first with sent/skipped/errored counts", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "job-1",
        created_at: new Date("2026-08-14T09:00:00Z"),
        finished_at: new Date("2026-08-14T09:05:00Z"),
        status: "succeeded",
        error: null,
        result_json: { sent: 5, skipped: 1, errored: 0 },
      },
      {
        id: "job-2",
        created_at: new Date("2026-08-13T09:00:00Z"),
        finished_at: null,
        status: "failed",
        error: "wallet_not_configured",
        result_json: null,
      },
    ]);
    const db = { adminJob: { findMany } };
    const c = fakeContext();

    await handleGetWalletMessageHistory(c as never, db as never);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { event_id: "evt-1", type: "wallet_message", status: { in: ["succeeded", "failed"] } },
      }),
    );
    expect(c.json).toHaveBeenCalledWith({
      items: [
        {
          id: "job-1",
          created_at: "2026-08-14T09:05:00.000Z",
          sent: 5,
          skipped: 1,
          errored: 0,
          status: "succeeded",
          error: null,
        },
        {
          id: "job-2",
          created_at: "2026-08-13T09:00:00.000Z",
          sent: 0,
          skipped: 0,
          errored: 0,
          status: "failed",
          error: "wallet_not_configured",
        },
      ],
    });
  });
});

describe("handleSearchWalletMessageAttendees", () => {
  it("returns an empty list without querying the db when the query is shorter than the minimum length", async () => {
    const findMany = vi.fn();
    const db = { attendee: { findMany } };
    const c = fakeContext({ req: { param: vi.fn(() => "evt-1"), query: vi.fn(() => "a"), json: vi.fn() } });

    await handleSearchWalletMessageAttendees(c as never, db as never);

    expect(findMany).not.toHaveBeenCalled();
    expect(c.json).toHaveBeenCalledWith({ items: [] });
  });

  it("searches only attendees with an active wallet pass, by name or email", async () => {
    const rows = [{ id: "att-1", name: "Jane Doe", email: "jane@example.com" }];
    const findMany = vi.fn().mockResolvedValue(rows);
    const db = { attendee: { findMany } };
    const c = fakeContext({ req: { param: vi.fn(() => "evt-1"), query: vi.fn(() => "jane"), json: vi.fn() } });

    await handleSearchWalletMessageAttendees(c as never, db as never);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          event_id: "evt-1",
          ...HAS_WALLET_WHERE,
          OR: [
            { name: { contains: "jane", mode: "insensitive" } },
            { email: { contains: "jane", mode: "insensitive" } },
          ],
        },
      }),
    );
    expect(c.json).toHaveBeenCalledWith({ items: rows });
  });
});
