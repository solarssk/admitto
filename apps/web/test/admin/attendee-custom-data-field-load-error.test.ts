import { beforeEach, describe, expect, it, vi } from "vitest";

const loadEventCustomDataFields = vi.fn();

vi.mock("@admitto/tickets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/tickets")>();
  return {
    ...actual,
    loadEventCustomDataFields: (...args: unknown[]) => loadEventCustomDataFields(...args),
  };
});

vi.mock("../../src/admin/admin-helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/admin/admin-helpers.js")>();
  return {
    ...actual,
    requireEventId: vi.fn(() => "evt-field-load-error"),
    assertEventManageAccess: vi.fn(async () => null),
    adminAuditFromContext: vi.fn(() => ({
      operator: "user-1",
      sessionId: "sess-1",
      ip: "127.0.0.1",
    })),
  };
});

import {
  handleCreateEventAttendee,
  handlePatchEventAttendee,
} from "../../src/admin/attendees-api-routes.js";

// A real DB connection failure - never safe to echo into the response body, and this message
// happens to contain a colon for unrelated reasons (docs/dev/error-and-notice-copy.md rule 2).
const dbFailure = () => new Error("Can't reach database server at `db.internal:5432`");

describe("custom-data field-load failures never leak into the client response", () => {
  beforeEach(() => {
    loadEventCustomDataFields.mockReset();
  });

  it("returns a safe validation_failed on create when loading the field registry throws", async () => {
    loadEventCustomDataFields.mockRejectedValue(dbFailure());

    const c = {
      req: {
        json: async () => ({
          email: "guest@example.com",
          first_name: "Guest",
          last_name: "Person",
        }),
      },
      json: (body: unknown, status?: number) =>
        new Response(JSON.stringify(body), { status: status ?? 200 }),
      get: () => undefined,
    };

    const db = {
      attendee: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };

    const res = await handleCreateEventAttendee(c as never, db as never);
    expect(res.status).toBe(400);
    const responseText = await res.text();
    expect(JSON.parse(responseText)).toEqual({ error: "validation_failed" });
    expect(responseText).not.toContain("db.internal");
    expect(responseText).not.toContain("5432");
  });

  it("returns a safe validation_failed on patch when loading the field registry throws", async () => {
    loadEventCustomDataFields.mockRejectedValue(dbFailure());

    const c = {
      req: {
        json: async () => ({ company: "Acme" }),
        param: (name: string) => (name === "id" ? "att-1" : undefined),
      },
      json: (body: unknown, status?: number) =>
        new Response(JSON.stringify(body), { status: status ?? 200 }),
      get: () => undefined,
    };

    const db = {
      attendee: {
        findUnique: vi.fn().mockResolvedValue({
          id: "att-1",
          event_id: "evt-field-load-error",
          name: "Guest Person",
          first_name: "Guest",
          last_name: "Person",
          email: "guest@example.com",
          company: null,
          department: null,
          ticket_type: null,
          custom_data: null,
          rsvp_status: "none",
          status: "registered",
        }),
      },
    };

    const res = await handlePatchEventAttendee(c as never, db as never);
    expect(res.status).toBe(400);
    const responseText = await res.text();
    expect(JSON.parse(responseText)).toEqual({ error: "validation_failed" });
    expect(responseText).not.toContain("db.internal");
    expect(responseText).not.toContain("5432");
  });
});
