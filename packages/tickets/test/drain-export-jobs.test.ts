import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/claim-admin-job.js", () => ({
  claimNextAdminJob: vi.fn(),
}));
vi.mock("../src/attendees-export-artifact.js", () => ({
  buildAttendeesExportArtifact: vi.fn(),
}));
vi.mock("../src/attendees-list-filters.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/attendees-list-filters.js")>();
  return {
    ...actual,
    countFilteredAttendees: vi.fn(),
    findFilteredAttendeesForExport: vi.fn(),
  };
});
vi.mock("../src/ops-audit.js", () => ({
  writeBulkActionLog: vi.fn(),
}));

import { claimNextAdminJob } from "../src/claim-admin-job.js";
import { buildAttendeesExportArtifact } from "../src/attendees-export-artifact.js";
import {
  countFilteredAttendees,
  findFilteredAttendeesForExport,
  EXPORT_ROW_CAP,
} from "../src/attendees-list-filters.js";
import { writeBulkActionLog } from "../src/ops-audit.js";
import { drainExportJobs } from "../src/drain-export-jobs.js";

function baseJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-export-1",
    type: "export",
    status: "running",
    event_id: "evt-1",
    organization_id: "org-1",
    actor_user_id: "user-1",
    session_id: "sess-1",
    client_timezone: "Europe/Warsaw",
    result_json: {
      request: {
        kind: "attendees_filtered",
        format: "csv",
        filters: { status: "all", q: "vip" },
      },
    },
    ...overrides,
  };
}

describe("drainExportJobs", () => {
  const storage = {
    put: vi.fn().mockResolvedValue({ key: "org/evt/export.csv" }),
  };

  let db: {
    adminJob: {
      update: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
    };
    event: { findUniqueOrThrow: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    vi.mocked(claimNextAdminJob).mockReset();
    vi.mocked(buildAttendeesExportArtifact).mockReset();
    vi.mocked(countFilteredAttendees).mockReset();
    vi.mocked(findFilteredAttendeesForExport).mockReset();
    vi.mocked(writeBulkActionLog).mockReset().mockResolvedValue(undefined);
    storage.put.mockReset().mockResolvedValue({ key: "org/evt/export.csv" });

    db = {
      adminJob: {
        update: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue({ result_json: null }),
      },
      event: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          title: "Event",
          date: new Date("2026-09-01T09:00:00Z"),
          timezone: "UTC",
        }),
      },
    };

    vi.mocked(countFilteredAttendees).mockResolvedValue(1);
    vi.mocked(findFilteredAttendeesForExport).mockResolvedValue([
      {
        name: "Guest",
        email: "guest@example.com",
        company: null,
        department: null,
        custom_data: null,
        ticket_type: null,
        admitted_at: null,
      },
    ]);
    vi.mocked(buildAttendeesExportArtifact).mockResolvedValue({
      bytes: Buffer.from("csv"),
      filename: "attendees.csv",
      contentType: "text/csv; charset=utf-8",
      rowCount: 1,
    });
  });

  it("returns zeros when there is nothing to claim", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValue(null);
    await expect(drainExportJobs(db as never, storage, { limit: 3 })).resolves.toEqual({
      claimed: 0,
      succeeded: 0,
      failed: 0,
      reclaimed: 0,
    });
  });

  it("succeeds for csv and writes audit + storage", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob() as never).mockResolvedValue(null);

    await expect(drainExportJobs(db as never, storage)).resolves.toEqual({
      claimed: 1,
      succeeded: 1,
      failed: 0,
      reclaimed: 0,
    });

    expect(storage.put).toHaveBeenCalledWith(Buffer.from("csv"), {
      orgId: "org-1",
      eventId: "evt-1",
      scope: "event",
      ext: ".csv",
    });
    expect(db.adminJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-export-1" },
        data: expect.objectContaining({
          status: "succeeded",
          storage_key: "org/evt/export.csv",
          filename: "attendees.csv",
          created_count: 1,
        }),
      }),
    );
    expect(writeBulkActionLog).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        event_id: "evt-1",
        action_type: "attendees_exported",
        metadata: expect.objectContaining({
          format: "csv",
          count: 1,
          filters: expect.objectContaining({ has_query: true, status: "all" }),
        }),
      }),
    );
  });

  it("defaults missing request.filters and omits null audit actor fields", async () => {
    vi.mocked(claimNextAdminJob)
      .mockResolvedValueOnce(
        baseJob({
          actor_user_id: null,
          session_id: null,
          client_timezone: null,
          result_json: {
            request: { kind: "attendees_filtered", format: "csv" },
          },
        }) as never,
      )
      .mockResolvedValue(null);

    await expect(drainExportJobs(db as never, storage)).resolves.toEqual({
      claimed: 1,
      succeeded: 1,
      failed: 0,
      reclaimed: 0,
    });
    expect(writeBulkActionLog).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        audit: {
          operator: undefined,
          sessionId: undefined,
          timezone: undefined,
        },
        metadata: expect.objectContaining({
          filters: expect.objectContaining({
            status: "all",
            ticket_type: null,
            has_query: false,
          }),
        }),
      }),
    );
  });

  it("maps pdf and xlsx storage extensions", async () => {
    vi.mocked(claimNextAdminJob)
      .mockResolvedValueOnce(
        baseJob({
          id: "job-pdf",
          result_json: {
            request: { kind: "attendees_filtered", format: "pdf", filters: {} },
          },
        }) as never,
      )
      .mockResolvedValueOnce(
        baseJob({
          id: "job-xlsx",
          result_json: {
            request: { kind: "attendees_filtered", format: "xlsx", filters: { ticket_type: "vip" } },
          },
        }) as never,
      )
      .mockResolvedValue(null);

    await expect(drainExportJobs(db as never, storage, { limit: 2 })).resolves.toEqual({
      claimed: 2,
      succeeded: 2,
      failed: 0,
      reclaimed: 0,
    });

    expect(storage.put.mock.calls[0]![1].ext).toBe(".pdf");
    expect(storage.put.mock.calls[1]![1].ext).toBe(".xlsx");
    expect(writeBulkActionLog.mock.calls[1]![1].metadata.filters).toMatchObject({
      ticket_type: "vip",
      mail_status: null,
      has_query: false,
    });
  });

  it("fails incomplete jobs and jobs with a bad request payload", async () => {
    vi.mocked(claimNextAdminJob)
      .mockResolvedValueOnce(
        baseJob({ id: "job-incomplete", event_id: null, organization_id: null }) as never,
      )
      .mockResolvedValueOnce(
        baseJob({
          id: "job-bad",
          result_json: { request: { kind: "other", format: "csv" } },
        }) as never,
      )
      .mockResolvedValueOnce(baseJob({ id: "job-null-json", result_json: null }) as never)
      .mockResolvedValueOnce(baseJob({ id: "job-array", result_json: [] }) as never)
      .mockResolvedValueOnce(
        baseJob({
          id: "job-bad-fmt",
          result_json: {
            request: { kind: "attendees_filtered", format: "docx", filters: {} },
          },
        }) as never,
      )
      .mockResolvedValueOnce(
        baseJob({
          id: "job-no-req",
          result_json: { request: null },
        }) as never,
      )
      .mockResolvedValue(null);

    await expect(drainExportJobs(db as never, storage, { limit: 10 })).resolves.toEqual({
      claimed: 6,
      succeeded: 0,
      failed: 6,
      reclaimed: 0,
    });

    expect(db.adminJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-incomplete" },
        data: expect.objectContaining({
          status: "failed",
          error: "export_job_incomplete",
        }),
      }),
    );
    expect(db.adminJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-bad" },
        data: expect.objectContaining({ error: "export_job_bad_request" }),
      }),
    );
  });

  it("fails when the filtered row count exceeds EXPORT_ROW_CAP", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob() as never).mockResolvedValue(null);
    vi.mocked(countFilteredAttendees).mockResolvedValue(EXPORT_ROW_CAP + 1);

    await expect(drainExportJobs(db as never, storage)).resolves.toEqual({
      claimed: 1,
      succeeded: 0,
      failed: 1,
      reclaimed: 0,
    });
    expect(db.adminJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ error: "export_too_large" }),
      }),
    );
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("stringifies non-Error failures when marking the job failed", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob() as never).mockResolvedValue(null);
    vi.mocked(buildAttendeesExportArtifact).mockRejectedValue("boom-string");

    await expect(drainExportJobs(db as never, storage)).resolves.toEqual({
      claimed: 1,
      succeeded: 0,
      failed: 1,
      reclaimed: 0,
    });
    expect(db.adminJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ error: "boom-string" }),
      }),
    );
  });

  it("keeps succeeded when audit logging fails after the file is stored", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob() as never).mockResolvedValue(null);
    vi.mocked(writeBulkActionLog).mockRejectedValue(new Error("audit down"));

    await expect(drainExportJobs(db as never, storage)).resolves.toEqual({
      claimed: 1,
      succeeded: 1,
      failed: 0,
      reclaimed: 0,
    });
    expect(db.adminJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "succeeded" }),
      }),
    );
    expect(db.adminJob.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed" }),
      }),
    );
  });

  it("scrubs search text from result_json when marking a job failed", async () => {
    vi.mocked(claimNextAdminJob).mockResolvedValueOnce(baseJob() as never).mockResolvedValue(null);
    db.adminJob.findUnique.mockResolvedValue({
      result_json: {
        request: {
          kind: "attendees_filtered",
          format: "csv",
          filters: { q: "secret@example.com", status: "all" },
        },
      },
    });
    vi.mocked(buildAttendeesExportArtifact).mockRejectedValue(new Error("render boom"));

    await expect(drainExportJobs(db as never, storage)).resolves.toMatchObject({ failed: 1 });
    expect(db.adminJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
          error: "render boom",
          result_json: {
            request: {
              kind: "attendees_filtered",
              format: "csv",
              filters: {
                status: "all",
                ticket_type: null,
                rsvp_status: undefined,
                mail_status: undefined,
                has_query: true,
              },
            },
          },
        }),
      }),
    );
  });

  it("floors a positive limit and defaults invalid limits to 1", async () => {
    vi.mocked(claimNextAdminJob)
      .mockResolvedValueOnce(baseJob({ id: "job-a" }) as never)
      .mockResolvedValueOnce(baseJob({ id: "job-b" }) as never)
      .mockResolvedValue(null);
    await expect(drainExportJobs(db as never, storage, { limit: 2.9 })).resolves.toEqual({
      claimed: 2,
      succeeded: 2,
      failed: 0,
      reclaimed: 0,
    });
    expect(claimNextAdminJob).toHaveBeenCalledTimes(2);

    vi.mocked(claimNextAdminJob).mockClear().mockResolvedValue(null);
    await drainExportJobs(db as never, storage, { limit: 0 });
    expect(claimNextAdminJob).toHaveBeenCalledTimes(1);
  });
});
