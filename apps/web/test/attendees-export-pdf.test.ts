import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import {
  EXPORT_BASE_PDF_WIDTHS,
  PDF_CELL_HEIGHT,
  PDF_PRINTABLE_WIDTH,
  buildExportPdfBuffer,
  buildExportPdfColumnWidths,
  pdfCellTextOptions,
} from "../src/admin/attendees-export-pdf.js";
import type { SanitizedExportRow } from "@admitto/tickets/attendees-export";

const LONG_EMAIL = "verylong.localpart@verylong-domain.example.com";
/** Typical work email length (~31 chars) that should fit in the Email column. */
const TYPICAL_WORK_EMAIL = "jane.doe@acme-example.com";

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
    expect(widths[2]).toBe(150);
    expect(widths[1]).toBe(100);
  });

  it("two attribute columns still fit without scaling below email preference when room remains", () => {
    const widths = buildExportPdfColumnWidths(2);
    expect(widths.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(PDF_PRINTABLE_WIDTH);
    expect(widths[2]).toBe(150);
  });
});

describe("pdfkit cell ellipsis contract", () => {
  it("truncates long emails when height is set (pdfCellTextOptions)", async () => {
    const emailWidth = EXPORT_BASE_PDF_WIDTHS[2];
    const content = inflatePdfContent(
      await renderHelveticaProbe(LONG_EMAIL, pdfCellTextOptions(emailWidth)),
    );
    const text = decodePdfHexText(content);
    // Single line only (no second text block for the wrapped domain).
    expect(content.match(/BT/g)?.length ?? 0).toBe(1);
    // WinAnsi 0x85 is the ellipsis glyph pdfkit appends.
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

  it("pdfCellTextOptions always pairs height with ellipsis", () => {
    expect(pdfCellTextOptions(100)).toEqual({
      width: 100,
      height: PDF_CELL_HEIGHT,
      ellipsis: true,
    });
  });
});

describe("buildExportPdfBuffer", () => {
  it("exports a long email row as a valid PDF without mid-word wrap leakage", async () => {
    const row: SanitizedExportRow = {
      check_off: "",
      name: "Long Email Guest",
      email: LONG_EMAIL,
      company: "Acme",
      department: "",
      ticket_type: "Standard",
      check_in_status: "not_admitted",
      admitted_at: "",
      attribute_values: ["M", ""],
    };
    const bytes = await buildExportPdfBuffer(
      [row],
      [
        "✓",
        "Name",
        "Email",
        "Company",
        "Department",
        "Ticket type",
        "Check-in status",
        "Admitted at",
        "Pants",
        "Bottle",
      ],
      { title: "Probe Event", date: new Date("2026-07-31T00:00:00Z") },
    );
    expect(bytes[0]).toBe(0x25);
    expect(bytes[1]).toBe(0x50);
    expect(bytes[2]).toBe(0x44);
    expect(bytes[3]).toBe(0x46);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
