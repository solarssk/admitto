import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/event-custom-fields.js", () => ({
  loadEventCustomDataFields: vi.fn(),
}));
vi.mock("../src/ticket-types.js", () => ({
  loadEventTicketTypes: vi.fn(),
}));
vi.mock("../src/attendees-export-pdf.js", () => ({
  buildExportPdfBuffer: vi.fn(),
}));
vi.mock("../src/attendees-export-xlsx.js", () => ({
  buildExportXlsxBuffer: vi.fn(),
}));
vi.mock("../src/lock-check.js", () => ({
  keepLiveRows: vi.fn(),
}));

import { loadEventCustomDataFields } from "../src/event-custom-fields.js";
import { loadEventTicketTypes } from "../src/ticket-types.js";
import { buildExportPdfBuffer } from "../src/attendees-export-pdf.js";
import { buildExportXlsxBuffer } from "../src/attendees-export-xlsx.js";
import { keepLiveRows } from "../src/lock-check.js";
import { buildAttendeesExportArtifact } from "../src/attendees-export-artifact.js";
import type { ExportAttendeeSqlRow } from "../src/attendees-list-filters.js";

const event = {
  title: "Export Artifact Event",
  date: new Date("2026-09-01T09:00:00Z"),
  timezone: "UTC",
};

const rows: ExportAttendeeSqlRow[] = [
  {
    id: "att-1",
    name: "Guest One",
    email: "guest-one@example.com",
    company: null,
    department: null,
    custom_data: null,
    ticket_type: null,
    admitted_at: null,
  },
];

describe("buildAttendeesExportArtifact", () => {
  beforeEach(() => {
    vi.mocked(loadEventCustomDataFields).mockReset().mockResolvedValue([]);
    vi.mocked(loadEventTicketTypes).mockReset().mockResolvedValue([]);
    vi.mocked(buildExportPdfBuffer).mockReset().mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
    vi.mocked(buildExportXlsxBuffer).mockReset().mockResolvedValue(new Uint8Array([80, 75]));
    // By default the last check keeps every row.
    vi.mocked(keepLiveRows)
      .mockReset()
      .mockImplementation((async (_db: unknown, list: readonly unknown[]) => [...list]) as never);
  });

  it("builds a CSV artifact", async () => {
    const file = await buildAttendeesExportArtifact({} as never, "evt-1", rows, "csv", event);
    expect(file.contentType).toBe("text/csv; charset=utf-8");
    expect(file.filename).toMatch(/^attendees-evt-1-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(file.rowCount).toBe(1);
    expect(file.bytes.toString("utf8")).toContain("guest-one@example.com");
    expect(buildExportPdfBuffer).not.toHaveBeenCalled();
    expect(buildExportXlsxBuffer).not.toHaveBeenCalled();
  });

  it("builds a PDF artifact via buildExportPdfBuffer", async () => {
    const file = await buildAttendeesExportArtifact({} as never, "evt-1", rows, "pdf", event);
    expect(file.contentType).toBe("application/pdf");
    expect(file.filename).toMatch(/\.pdf$/);
    expect(file.bytes.equals(Buffer.from([37, 80, 68, 70]))).toBe(true);
    expect(buildExportPdfBuffer).toHaveBeenCalledOnce();
  });

  it("builds an XLSX artifact via buildExportXlsxBuffer", async () => {
    const file = await buildAttendeesExportArtifact({} as never, "evt-1", rows, "xlsx", event);
    expect(file.contentType).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(file.filename).toMatch(/\.xlsx$/);
    expect(file.bytes.equals(Buffer.from([80, 75]))).toBe(true);
    expect(buildExportXlsxBuffer).toHaveBeenCalledOnce();
  });

  it("builds the file only from the rows the last check keeps, and counts only those", async () => {
    const two: ExportAttendeeSqlRow[] = [
      ...rows,
      { ...rows[0]!, id: "att-2", name: "Guest Two", email: "guest-two@example.com" },
    ];
    vi.mocked(keepLiveRows).mockResolvedValue([two[0]!] as never);
    const db = {} as never;

    const file = await buildAttendeesExportArtifact(db, "evt-1", two, "csv", event);

    expect(keepLiveRows).toHaveBeenCalledWith(db, two);
    expect(file.rowCount).toBe(1);
    expect(file.bytes.toString("utf8")).toContain("guest-one@example.com");
    expect(file.bytes.toString("utf8")).not.toContain("guest-two@example.com");
  });

  it("makes the last check after the lookups it needs, just before the rows are built", async () => {
    const order: string[] = [];
    vi.mocked(loadEventTicketTypes).mockImplementation(async () => (order.push("ticket types"), []));
    vi.mocked(keepLiveRows).mockImplementation((async (_db: unknown, list: readonly unknown[]) => (
      order.push("last check"),
      [...list]
    )) as never);

    await buildAttendeesExportArtifact({} as never, "evt-1", rows, "xlsx", event);

    expect(order).toEqual(["ticket types", "last check"]);
    expect(buildExportXlsxBuffer).toHaveBeenCalledAfter(vi.mocked(keepLiveRows));
  });
});
