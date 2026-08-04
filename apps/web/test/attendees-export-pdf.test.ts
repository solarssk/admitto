import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import {
  EXPORT_BASE_PDF_WIDTHS,
  EXPORT_ATTRIBUTE_PDF_WIDTH,
  PDF_CELL_HEIGHT,
  PDF_PRINTABLE_WIDTH,
  buildExportPdfBuffer,
  buildExportPdfColumnWidths,
  pdfCellTextOptions,
} from "../src/admin/attendees-export-pdf.js";
import type { SanitizedExportRow } from "@admitto/tickets/attendees-export";

const LONG_EMAIL = "verylong.localpart@verylong-domain.example.com";
/** Typical work email length that should fit in the Email column. */
const TYPICAL_WORK_EMAIL = "jane.doe@acme-example.com";
const ADMITTED_AT = "2026-07-07 09:44";

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
    check_in_status: "not_admitted",
    admitted_at: "",
    attribute_values: [],
    ...overrides,
  };
}

/** Inflate FlateDecode content streams so operators are searchable. */
function inflatePdfContent(buf: Buffer): string {
  const latin = buf.toString("latin1");
  const parts: string[] = [];
  for (const match of latin.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try {
      parts.push(inflateSync(Buffer.from(match[1]!, "latin1")).toString("latin1"));
    } catch {
      // Non-flate or object streams: ignore.
    }
  }
  return parts.join("\n");
}

/** Decode PDF hex string operands (`<…>`) from a content stream into latin1 text. */
function decodePdfHexText(content: string): string {
  let out = "";
  for (const match of content.matchAll(/<([0-9a-fA-F]+)>/g)) {
    out += Buffer.from(match[1]!, "hex").toString("latin1");
  }
  return out;
}

async function renderHelveticaProbe(
  email: string,
  opts: { width: number; height?: number; ellipsis?: boolean },
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 40 });
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);
  });
  doc.font("Helvetica").fontSize(8);
  doc.text(email, 40, 60, opts);
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

describe("attendees-export-pdf column widths", () => {
  it("base widths prefer Email and stay within printable width", () => {
    const widths = buildExportPdfColumnWidths(0);
    expect(widths).toEqual([...EXPORT_BASE_PDF_WIDTHS]);
    expect(widths.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(PDF_PRINTABLE_WIDTH);
    expect(widths[2]).toBeGreaterThanOrEqual(140);
    expect(widths[1]).toBe(100);
    expect(widths[7]).toBeGreaterThanOrEqual(75);
  });

  it("two attribute columns still keep Email preference when room remains", () => {
    const widths = buildExportPdfColumnWidths(2);
    expect(widths.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(PDF_PRINTABLE_WIDTH);
    expect(widths.slice(-2)).toEqual([EXPORT_ATTRIBUTE_PDF_WIDTH, EXPORT_ATTRIBUTE_PDF_WIDTH]);
    expect(widths[2]).toBe(EXPORT_BASE_PDF_WIDTHS[2]);
  });

  it("shrinks attribute columns when default 55pt attrs would overflow", () => {
    const widths = buildExportPdfColumnWidths(4);
    expect(widths).toHaveLength(EXPORT_BASE_PDF_WIDTHS.length + 4);
    expect(widths.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(PDF_PRINTABLE_WIDTH);
    const attrWidth = widths[EXPORT_BASE_PDF_WIDTHS.length]!;
    expect(attrWidth).toBeLessThan(EXPORT_ATTRIBUTE_PDF_WIDTH);
    expect(attrWidth).toBeGreaterThanOrEqual(28);
    expect(widths.slice(-4).every((w) => w === attrWidth)).toBe(true);
    // Base columns unchanged on this path.
    expect(widths.slice(0, EXPORT_BASE_PDF_WIDTHS.length)).toEqual([...EXPORT_BASE_PDF_WIDTHS]);
  });

  it("scales base columns when many attributes force min attr width", () => {
    const widths = buildExportPdfColumnWidths(7);
    expect(widths).toHaveLength(EXPORT_BASE_PDF_WIDTHS.length + 7);
    expect(widths.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(PDF_PRINTABLE_WIDTH);
    expect(widths.slice(-7).every((w) => w === 28)).toBe(true);
    // Email column is scaled down from the preferred base width.
    expect(widths[2]!).toBeLessThan(EXPORT_BASE_PDF_WIDTHS[2]);
    expect(widths[2]!).toBeGreaterThanOrEqual(20);
  });

  it("still produces a printable layout for a large attribute count", () => {
    const widths = buildExportPdfColumnWidths(20);
    expect(widths).toHaveLength(EXPORT_BASE_PDF_WIDTHS.length + 20);
    expect(widths.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(PDF_PRINTABLE_WIDTH);
    expect(widths.every((w) => w >= 20)).toBe(true);
  });

  it("keeps min column width when attrs exhaust the printable budget", () => {
    // targetBaseTotal <= 0 when attrs * 28 >= printable width → unscaled base then clamp.
    const widths = buildExportPdfColumnWidths(28);
    expect(widths).toHaveLength(EXPORT_BASE_PDF_WIDTHS.length + 28);
    expect(widths.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(PDF_PRINTABLE_WIDTH);
    expect(widths.every((w) => w >= 20)).toBe(true);
  });
});

describe("pdfkit cell ellipsis contract", () => {
  it("truncates long emails when height is set (pdfCellTextOptions)", async () => {
    const emailWidth = EXPORT_BASE_PDF_WIDTHS[2];
    const content = inflatePdfContent(
      await renderHelveticaProbe(LONG_EMAIL, pdfCellTextOptions(emailWidth)),
    );
    const text = decodePdfHexText(content);
    expect(content.match(/BT/g)?.length ?? 0).toBe(1);
    expect(text).toContain("\x85");
    expect(text).not.toContain("example.com");
    expect(text).not.toContain(LONG_EMAIL);
  });

  it("wraps mid-token without height even if ellipsis:true (regression of old bug)", async () => {
    const emailWidth = EXPORT_BASE_PDF_WIDTHS[2];
    const content = inflatePdfContent(
      await renderHelveticaProbe(LONG_EMAIL, {
        width: emailWidth,
        ellipsis: true,
      }),
    );
    const text = decodePdfHexText(content);
    expect(content.match(/BT/g)?.length ?? 0).toBeGreaterThan(1);
    expect(text).toContain("example.com");
    expect(text).not.toContain("\x85");
  });

  it("fits a typical work email in the Email column width", async () => {
    const emailWidth = EXPORT_BASE_PDF_WIDTHS[2];
    const content = inflatePdfContent(
      await renderHelveticaProbe(TYPICAL_WORK_EMAIL, pdfCellTextOptions(emailWidth)),
    );
    const text = decodePdfHexText(content);
    expect(content.match(/BT/g)?.length ?? 0).toBe(1);
    expect(text).toContain(TYPICAL_WORK_EMAIL);
    expect(text).not.toContain("\x85");
  });

  it("fits admitted_at timestamps in the Admitted at column without ellipsis", async () => {
    const admittedWidth = EXPORT_BASE_PDF_WIDTHS[7];
    const content = inflatePdfContent(
      await renderHelveticaProbe(ADMITTED_AT, pdfCellTextOptions(admittedWidth)),
    );
    const text = decodePdfHexText(content);
    expect(content.match(/BT/g)?.length ?? 0).toBe(1);
    expect(text).toContain(ADMITTED_AT);
    expect(text).not.toContain("\x85");
  });

  it("pdfCellTextOptions always pairs height with ellipsis", () => {
    expect(pdfCellTextOptions(100)).toEqual({
      width: 100,
      height: PDF_CELL_HEIGHT,
      ellipsis: true,
    });
  });
});

describe("buildExportPdfBuffer", () => {
  it("exports a long email row as a valid PDF with attribute columns", async () => {
    const row = makeRow({
      name: "Long Email Guest",
      email: LONG_EMAIL,
      attribute_values: ["M", ""],
    });
    const bytes = await buildExportPdfBuffer(
      [row],
      [...BASE_HEADERS, "Pants", "Bottle"],
      { title: "Probe Event", date: new Date("2026-07-31T00:00:00Z") },
    );
    expect(bytes[0]).toBe(0x25);
    expect(bytes[1]).toBe(0x50);
    expect(bytes[2]).toBe(0x44);
    expect(bytes[3]).toBe(0x46);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it("renders admitted_at and empty optional cells without throwing", async () => {
    const row = makeRow({
      name: "Alice Smith",
      email: "alice@example.com",
      company: "",
      department: "",
      check_in_status: "admitted",
      admitted_at: ADMITTED_AT,
      attribute_values: [],
    });
    const bytes = await buildExportPdfBuffer([row], [...BASE_HEADERS], {
      title: "Event with Polish ł ą characters",
      date: new Date("2026-07-31T00:00:00Z"),
    });
    expect(Buffer.from(bytes.subarray(0, 4)).toString("ascii")).toBe("%PDF");
    expect(bytes.byteLength).toBeGreaterThan(500);
  });

  it("adds a new page and redraws the header when rows overflow the page", async () => {
    const rows = Array.from({ length: 45 }, (_, i) =>
      makeRow({
        name: `Guest ${i}`,
        email: `guest-${i}@example.com`,
        check_off: i % 2 === 0 ? "✓" : "",
      }),
    );
    const bytes = await buildExportPdfBuffer(rows, [...BASE_HEADERS], {
      title: "Multi-page Event",
      date: new Date("2026-08-01T00:00:00Z"),
    });
    const latin = Buffer.from(bytes).toString("latin1");
    // Two or more page objects ⇒ page break path ran.
    expect((latin.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
