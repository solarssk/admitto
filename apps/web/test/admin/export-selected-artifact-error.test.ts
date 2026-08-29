import { beforeEach, describe, expect, it, vi } from "vitest";

const buildAttendeesExportArtifact = vi.fn();

vi.mock("@admitto/tickets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/tickets")>();
  return {
    ...actual,
    buildAttendeesExportArtifact: (...args: unknown[]) => buildAttendeesExportArtifact(...args),
  };
});

vi.mock("../../src/admin/admin-helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/admin/admin-helpers.js")>();
  return {
    ...actual,
    requireEventId: vi.fn(() => "evt-export-artifact"),
    assertEventManageAccess: vi.fn(async () => null),
    adminAuditFromContext: vi.fn(() => ({
      operator: "user-1",
      sessionId: "sess-1",
      ip: "127.0.0.1",
    })),
  };
});

import { handleExportSelectedAttendees } from "../../src/admin/attendees-api-routes.js";

function buildMockContext() {
  return {
    req: {
      json: async () => ({ attendee_ids: ["att-1"], format: "csv" }),
    },
    json: (body: unknown, status?: number) =>
      new Response(JSON.stringify(body), { status: status ?? 200 }),
    get: () => undefined,
  };
}

function buildMockDb() {
  return {
    event: {
      findUnique: vi.fn().mockResolvedValue({
        id: "evt-export-artifact",
        title: "Export Artifact",
        date: new Date("2026-09-01T09:00:00Z"),
        timezone: "UTC",
        organization_id: "org-1",
      }),
    },
    attendee: {
      findMany: vi.fn().mockResolvedValue([
        {
          name: "Guest",
          email: "guest@example.com",
          company: null,
          department: null,
          custom_data: null,
          ticket_type: null,
          admitted_at: null,
        },
      ]),
    },
    attendeeActionLog: {
      create: vi.fn(),
    },
  };
}

describe("handleExportSelectedAttendees artifact failures", () => {
  beforeEach(() => {
    buildAttendeesExportArtifact.mockReset();
  });

  it("returns 400 validation_failed when buildAttendeesExportArtifact throws", async () => {
    buildAttendeesExportArtifact.mockRejectedValue(new Error("artifact boom"));

    const res = await handleExportSelectedAttendees(buildMockContext() as never, buildMockDb() as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "validation_failed" });
    expect(buildAttendeesExportArtifact).toHaveBeenCalledOnce();
  });

  it("returns unknown_custom_data_field when the artifact error uses that prefix", async () => {
    buildAttendeesExportArtifact.mockRejectedValue(
      new Error("unknown_custom_data_field:sock_size"),
    );

    const res = await handleExportSelectedAttendees(buildMockContext() as never, buildMockDb() as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown_custom_data_field", field: "sock_size" });
  });

  it("never extracts a field from an unrecognized error, even one containing a colon", async () => {
    // A real Prisma/DB connection failure, not one of the codes packages/tickets throws - the
    // field-slug parser must not treat "db.internal", "5432", etc. as a safe public field value.
    buildAttendeesExportArtifact.mockRejectedValue(
      new Error("Can't reach database server at `db.internal:5432`"),
    );

    const res = await handleExportSelectedAttendees(buildMockContext() as never, buildMockDb() as never);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; field?: string };
    expect(body).toEqual({ error: "validation_failed" });
    expect(body.field).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("db.internal");
    expect(JSON.stringify(body)).not.toContain("5432");
  });

  it("returns a bare code with no field when the artifact error carries no slug at all", async () => {
    // Legacy error shape (no `:<field_slug>` suffix) - still a known code, just without a field
    // to attach.
    buildAttendeesExportArtifact.mockRejectedValue(new Error("unknown_custom_data_field"));

    const res = await handleExportSelectedAttendees(buildMockContext() as never, buildMockDb() as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown_custom_data_field" });
  });

  it("drops a trailing empty field slug rather than attaching a blank field", async () => {
    buildAttendeesExportArtifact.mockRejectedValue(new Error("validation_failed:"));

    const res = await handleExportSelectedAttendees(buildMockContext() as never, buildMockDb() as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "validation_failed" });
  });
});
