import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import {
  PDF_A3_PRINTABLE_WIDTH,
  PDF_A4_PRINTABLE_WIDTH,
  PDF_MIN_COLUMN_WIDTH,
  buildExportPdfBuffer,
  distributePdfColumnWidths,
  measurePdfColumnMetrics,
  resolvePdfPageSize,
  type PdfColumnMetrics,
} from "../src/attendees-export-pdf.js";
import type { SanitizedExportRow } from "../src/attendees-export.js";

const BASE_HEADERS = [
  "✓",
  "Name",
  "Email",
  "Company",
  "Department",
  "Ticket type",
  "Check-in status",
  "Admitted at",
] as const;

function makeRow(overrides: Partial<SanitizedExportRow> = {}): SanitizedExportRow {
  return {
    check_off: "",
    name: "Guest",
    email: "guest@example.com",
    company: "Acme",
    department: "",
    ticket_type: "Standard",
    check_in_status: "Not checked in",
    admitted_at: "",
    attribute_values: [],
    ...overrides,
  };
}

const require = createRequire(import.meta.url);

function makeMeasuringDoc(): PDFKit.PDFDocument {
  const doc = new PDFDocument({ autoFirstPage: false });
  doc.registerFont("DejaVuSans", require.resolve("dejavu-fonts-ttf/ttf/DejaVuSans.ttf"));
  doc.registerFont("DejaVuSans-Bold", require.resolve("dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf"));
  return doc;
}

describe("measurePdfColumnMetrics", () => {
  it("measures an unbreakable long email as minWidth === maxWidth", () => {
    const doc = makeMeasuringDoc();
    const email = "katarzyna.wisniewska@example.com";
    const metrics = measurePdfColumnMetrics(doc, [...BASE_HEADERS], [makeRow({ email })]);
    const emailMetrics = metrics[2]!;
    expect(emailMetrics.minWidth).toBeCloseTo(emailMetrics.maxWidth, 5);
    expect(emailMetrics.maxWidth).toBeGreaterThan(100);
  });

  it("measures a multi-word value as minWidth < maxWidth", () => {
    const doc = makeMeasuringDoc();
    const metrics = measurePdfColumnMetrics(
      doc,
      [...BASE_HEADERS],
      [makeRow({ company: "Very Long Company Name Ltd" })],
    );
    expect(metrics[3]!.minWidth).toBeLessThan(metrics[3]!.maxWidth);
  });

  it("includes attribute columns and floors minWidth at PDF_MIN_COLUMN_WIDTH", () => {
    const doc = makeMeasuringDoc();
    const columns = [...BASE_HEADERS, "Size"];
    const metrics = measurePdfColumnMetrics(doc, columns, [makeRow({ attribute_values: ["M"] })]);
    expect(metrics).toHaveLength(columns.length);
    expect(metrics[8]!.minWidth).toBeGreaterThanOrEqual(PDF_MIN_COLUMN_WIDTH);
  });
});

describe("resolvePdfPageSize", () => {
  it("stays on A4 for a typical export with no attribute columns", () => {
    const doc = makeMeasuringDoc();
    const metrics = measurePdfColumnMetrics(doc, [...BASE_HEADERS], [makeRow()]);
    const { pageSize, printableWidth } = resolvePdfPageSize(metrics.map((m) => m.minWidth));
    expect(pageSize).toBe("A4");
    expect(printableWidth).toBe(PDF_A4_PRINTABLE_WIDTH);
  });

  it("escalates to A3 once many long-minWidth attribute columns exceed A4's printable width", () => {
    const attributeCount = 20;
    const minWidths = Array.from({ length: 8 + attributeCount }, () => 200);
    const { pageSize, printableWidth } = resolvePdfPageSize(minWidths);
    expect(pageSize).toBe("A3");
    expect(printableWidth).toBe(PDF_A3_PRINTABLE_WIDTH);
  });
});

describe("distributePdfColumnWidths", () => {
  it("gives a high-flex column more bonus space than a zero-flex column when content fits", () => {
    const metrics: PdfColumnMetrics[] = [
      { minWidth: 20, maxWidth: 20 },
      { minWidth: 30, maxWidth: 100 },
    ];
    const plan = distributePdfColumnWidths(metrics, 300);
    expect(plan.mode).toBe("wrap");
    const zeroFlexBonus = plan.contentWidths[0]! - metrics[0]!.maxWidth;
    const highFlexBonus = plan.contentWidths[1]! - metrics[1]!.maxWidth;
    expect(highFlexBonus).toBeGreaterThan(zeroFlexBonus);
  });

  it("keeps every column at or above its minWidth while interpolating between min and max", () => {
    const metrics: PdfColumnMetrics[] = [
      { minWidth: 20, maxWidth: 200 },
      { minWidth: 50, maxWidth: 150 },
      { minWidth: 30, maxWidth: 80 },
    ];
    const plan = distributePdfColumnWidths(metrics, 300);
    expect(plan.mode).toBe("wrap");
    for (let i = 0; i < metrics.length; i++) {
      expect(plan.contentWidths[i]!).toBeGreaterThanOrEqual(metrics[i]!.minWidth);
      expect(plan.contentWidths[i]!).toBeLessThanOrEqual(metrics[i]!.maxWidth);
    }
  });

  it("falls back to clamped ellipsis widths when even minWidth totals exceed the printable width", () => {
    const metrics: PdfColumnMetrics[] = Array.from({ length: 20 }, () => ({
      minWidth: 200,
      maxWidth: 200,
    }));
    const plan = distributePdfColumnWidths(metrics, PDF_A3_PRINTABLE_WIDTH);
    expect(plan.mode).toBe("ellipsis-fallback");
    expect(plan.contentWidths.every((w) => w >= PDF_MIN_COLUMN_WIDTH)).toBe(true);
    const total = plan.slotWidths.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(PDF_A3_PRINTABLE_WIDTH);
  });
});

describe("buildExportPdfBuffer", () => {
  it("builds a valid multi-page PDF with attribute columns and a page break", async () => {
    const rows = Array.from({ length: 45 }, (_, i) =>
      makeRow({
        name: `Guest ${i}`,
        email: `guest-${i}@example.com`,
        check_in_status: i % 2 === 0 ? "Checked in" : "Not checked in",
        admitted_at: i % 2 === 0 ? "2026-08-01 09:00" : "",
        attribute_values: ["M", i % 3 === 0 ? "Vegetarian" : ""],
      }),
    );
    const bytes = await buildExportPdfBuffer(rows, [...BASE_HEADERS, "Size", "Diet"], {
      title: "Coverage Smoke Event",
      date: new Date("2026-08-01T00:00:00Z"),
    });
    expect(Buffer.from(bytes.subarray(0, 4)).toString("ascii")).toBe("%PDF");
    const latin = Buffer.from(bytes).toString("latin1");
    expect((latin.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("escalates to A3 and exercises the ellipsis-fallback draw path for an extreme attribute count", async () => {
    const attributeCount = 20;
    const columns = [
      ...BASE_HEADERS,
      ...Array.from({ length: attributeCount }, (_, i) => `Attribute Field ${i}`),
    ];
    const row = makeRow({
      attribute_values: Array.from(
        { length: attributeCount },
        (_, i) => `unbreakable-long-value-${i}-1234567890`,
      ),
    });
    const doc = makeMeasuringDoc();
    const metrics = measurePdfColumnMetrics(doc, columns, [row]);
    const { printableWidth } = resolvePdfPageSize(metrics.map((m) => m.minWidth));
    const plan = distributePdfColumnWidths(metrics, printableWidth);
    expect(plan.mode).toBe("ellipsis-fallback");

    const bytes = await buildExportPdfBuffer([row], columns, {
      title: "Attribute Heavy Event",
      date: new Date("2026-09-24T00:00:00Z"),
    });
    const latin = Buffer.from(bytes).toString("latin1");
    const match = latin.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThan(1000);
  });
});
