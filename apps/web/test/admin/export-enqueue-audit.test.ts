import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@admitto/tickets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/tickets")>();
  return {
    ...actual,
    countFilteredAttendees: vi.fn(async () => 3),
  };
});

vi.mock("../../src/admin/admin-helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/admin/admin-helpers.js")>();
  return {
    ...actual,
    requireEventId: vi.fn(() => "evt-export-enqueue"),
    assertEventManageAccess: vi.fn(async () => null),
    adminAuditFromContext: vi.fn(),
    resolveClientTimezone: vi.fn(() => null),
  };
});

import { adminAuditFromContext } from "../../src/admin/admin-helpers.js";
import { handleExportAttendees } from "../../src/admin/attendees-api-routes.js";

describe("handleExportAttendees enqueue audit fields", () => {
  beforeEach(() => {
    vi.mocked(adminAuditFromContext).mockReset();
  });

  it("stores null actor_user_id and session_id when audit context omits them", async () => {
    vi.mocked(adminAuditFromContext).mockReturnValue({
      ip: "127.0.0.1",
    });

    const create = vi.fn().mockResolvedValue({ id: "job-1" });
    const c = {
      req: {
        query: (name: string) => (name === "format" ? "csv" : undefined),
      },
      json: (body: unknown, status?: number) =>
        new Response(JSON.stringify(body), { status: status ?? 200 }),
      get: () => undefined,
    };
    const db = {
      event: {
        findUnique: vi.fn().mockResolvedValue({
          title: "Export",
          date: new Date("2026-09-01T09:00:00Z"),
          timezone: "UTC",
          organization_id: "org-1",
        }),
      },
      adminJob: { create },
    };

    const res = await handleExportAttendees(c as never, db as never);
    expect(res.status).toBe(202);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actor_user_id: null,
        session_id: null,
        client_timezone: null,
      }),
    });
  });
});
