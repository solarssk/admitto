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

import { loadEventCustomDataFields } from "../src/event-custom-fields.js";
import { loadEventTicketTypes } from "../src/ticket-types.js";
import { buildExportPdfBuffer } from "../src/attendees-export-pdf.js";
import { buildExportXlsxBuffer } from "../src/attendees-export-xlsx.js";
import { buildAttendeesExportArtifact } from "../src/attendees-export-artifact.js";
import type { ExportAttendeeSqlRow } from "../src/attendees-list-filters.js";

const event = {
  title: "Export Artifact Event",
  date: new Date("2026-09-01T09:00:00Z"),
  timezone: "UTC",
};

const rows: ExportAttendeeSqlRow[] = [
  {
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
});
