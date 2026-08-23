import { createRequire } from "node:module";
import { inflateSync } from "node:zlib";
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
} from "@admitto/tickets";
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
    check_in_status: "Not checked in",
    admitted_at: "",
    attribute_values: [],
    ...overrides,
  };
}

const require = createRequire(import.meta.url);

/** Same font-registration mechanism as the production file, duplicated so this test doesn't
 * depend on an exported measuring helper - it exercises the real DejaVuSans metrics. */
function makeMeasuringDoc(): PDFKit.PDFDocument {
  const doc = new PDFDocument({ autoFirstPage: false });
  doc.registerFont("DejaVuSans", require.resolve("dejavu-fonts-ttf/ttf/DejaVuSans.ttf"));
  doc.registerFont("DejaVuSans-Bold", require.resolve("dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf"));
  return doc;
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
  text: string,
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
  doc.text(text, 40, 60, opts);
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

describe("attendees-export-pdf column measurement and distribution", () => {
  it("an unbreakable long email column gets minWidth equal to maxWidth", () => {
    const doc = makeMeasuringDoc();
    const metrics = measurePdfColumnMetrics(doc, [...BASE_HEADERS], [makeRow({ email: LONG_EMAIL })]);
    const email = metrics[2]!;
    expect(email.minWidth).toBeCloseTo(email.maxWidth, 5);
    expect(email.maxWidth).toBeGreaterThan(100);
  });

  it("a multi-word company name has a smaller minWidth than maxWidth", () => {
    const doc = makeMeasuringDoc();
    const metrics = measurePdfColumnMetrics(
      doc,
      [...BASE_HEADERS],
      [makeRow({ company: "Very Long Company Name Ltd" })],
    );
    const company = metrics[3]!;
    expect(company.minWidth).toBeLessThan(company.maxWidth);
  });

  it("resolves A4 for a typical export with no attribute columns", () => {
    const doc = makeMeasuringDoc();
    const metrics = measurePdfColumnMetrics(doc, [...BASE_HEADERS], [makeRow({ email: LONG_EMAIL })]);
    const { pageSize, printableWidth } = resolvePdfPageSize(metrics.map((m) => m.minWidth));
    expect(pageSize).toBe("A4");
    expect(printableWidth).toBe(PDF_A4_PRINTABLE_WIDTH);
  });

  it("resolves A3 once many long-minWidth attribute columns exceed A4's printable width", () => {
    const doc = makeMeasuringDoc();
    const attributeCount = 20;
    const columns = [
      ...BASE_HEADERS,
      ...Array.from({ length: attributeCount }, (_, i) => `Attribute ${i}`),
    ];
    const rows = [
      makeRow({
        attribute_values: Array.from(
          { length: attributeCount },
          () => "unbreakable-long-value-1234567890",
        ),
      }),
    ];
    const metrics = measurePdfColumnMetrics(doc, columns, rows);
    const { pageSize } = resolvePdfPageSize(metrics.map((m) => m.minWidth));
    expect(pageSize).toBe("A3");
  });

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

  it("keeps every column at or above its minWidth while in wrap mode", () => {
    const metrics: PdfColumnMetrics[] = [
      { minWidth: 20, maxWidth: 200 },
      { minWidth: 50, maxWidth: 150 },
      { minWidth: 30, maxWidth: 80 },
    ];
    const plan = distributePdfColumnWidths(metrics, 300);
    expect(plan.mode).toBe("wrap");
    for (let i = 0; i < metrics.length; i++) {
      expect(plan.contentWidths[i]!).toBeGreaterThanOrEqual(metrics[i]!.minWidth);
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

describe("attendees-export-pdf wrap vs ellipsis-fallback text rendering", () => {
  it("long unbreakable value force-wraps across multiple lines instead of truncating (default wrap mode)", async () => {
    const content = inflatePdfContent(
      await renderHelveticaProbe(LONG_EMAIL, { width: 100, ellipsis: true }),
    );
    const text = decodePdfHexText(content);
    expect(content.match(/BT/g)?.length ?? 0).toBeGreaterThan(1);
    expect(text).toContain("example.com");
    expect(text).not.toContain("\x85");
  });

  it("wraps a multi-word value across lines at a width that fits about two words per line", async () => {
    const value = "Very Long Company Name Ltd";
    const content = inflatePdfContent(await renderHelveticaProbe(value, { width: 60 }));
    const text = decodePdfHexText(content);
    expect(content.match(/BT/g)?.length ?? 0).toBeGreaterThan(1);
    for (const word of value.split(" ")) {
      expect(text).toContain(word);
    }
    expect(text).not.toContain("\x85");
  });

  it("fits a typical work email in a comfortably wide column without wrapping", async () => {
    const doc = new PDFDocument({ autoFirstPage: false });
    doc.font("Helvetica").fontSize(8);
    const width = doc.widthOfString(TYPICAL_WORK_EMAIL) + 10;

    const content = inflatePdfContent(await renderHelveticaProbe(TYPICAL_WORK_EMAIL, { width }));
    const text = decodePdfHexText(content);
    expect(content.match(/BT/g)?.length ?? 0).toBe(1);
    expect(text).toContain(TYPICAL_WORK_EMAIL);
    expect(text).not.toContain("\x85");
  });

  it("fits admitted_at timestamps without wrapping", async () => {
    const doc = new PDFDocument({ autoFirstPage: false });
    doc.font("Helvetica").fontSize(8);
    const width = doc.widthOfString(ADMITTED_AT) + 10;

    const content = inflatePdfContent(await renderHelveticaProbe(ADMITTED_AT, { width }));
    const text = decodePdfHexText(content);
    expect(content.match(/BT/g)?.length ?? 0).toBe(1);
    expect(text).toContain(ADMITTED_AT);
    expect(text).not.toContain("\x85");
  });

  it("still truncates with an ellipsis when width and a bounded height are both set (last-resort fallback mechanism)", async () => {
    const content = inflatePdfContent(
      await renderHelveticaProbe(LONG_EMAIL, { width: 100, height: 12, ellipsis: true }),
    );
    const text = decodePdfHexText(content);
    expect(content.match(/BT/g)?.length ?? 0).toBe(1);
    expect(text).toContain("\x85");
    expect(text).not.toContain(LONG_EMAIL);
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
      check_in_status: "Checked in",
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

  it("keeps a real long corporate email fully intact with no ellipsis in the rendered PDF", async () => {
    // The rendered PDF embeds DejaVuSans as a subsetted font, so its content stream uses
    // glyph-index (CID) encoding, not literal character codes - decodePdfHexText only works for
    // the base-14 Helvetica probes above. Assert the algorithm's actual decision for this exact
    // real-world case instead: it must choose to wrap this email, not truncate it.
    const email = "katarzyna.wisniewska@example.com";
    const columns = [...BASE_HEADERS];
    const rows = [makeRow({ name: "Katarzyna Wiśniewska", email })];

    const doc = makeMeasuringDoc();
    const metrics = measurePdfColumnMetrics(doc, columns, rows);
    const { printableWidth } = resolvePdfPageSize(metrics.map((m) => m.minWidth));
    const plan = distributePdfColumnWidths(metrics, printableWidth);
    expect(plan.mode).toBe("wrap");
    expect(plan.contentWidths[2]!).toBeGreaterThanOrEqual(metrics[2]!.maxWidth);

    const bytes = await buildExportPdfBuffer(rows, columns, {
      title: "Cybersecurity Awareness Month",
      date: new Date("2026-09-24T00:00:00Z"),
    });
    expect(bytes.byteLength).toBeGreaterThan(500);
  });

  it("escalates to A3 landscape when many long attribute columns don't fit A4", async () => {
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
    const bytes = await buildExportPdfBuffer([row], columns, {
      title: "Attribute Heavy Event",
      date: new Date("2026-09-24T00:00:00Z"),
    });
    const latin = Buffer.from(bytes).toString("latin1");
    const match = latin.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
    expect(match).not.toBeNull();
    // A3 landscape width ~1190.55, vs A4's ~841.89.
    expect(Number(match![1])).toBeGreaterThan(1000);
  });
});
