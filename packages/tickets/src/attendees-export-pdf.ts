import { createRequire } from "node:module";
import { formatEventDate } from "@admitto/mail-templates";
import type { SanitizedExportRow } from "./attendees-export.js";

export const PDF_MARGIN = 40;
const A4_LANDSCAPE_WIDTH = 841.89;
const A3_LANDSCAPE_WIDTH = 1190.55;
/** ISO 216 landscape page widths minus 2x side margin - physical constants, not guesses. */
export const PDF_A4_PRINTABLE_WIDTH = A4_LANDSCAPE_WIDTH - 2 * PDF_MARGIN;
export const PDF_A3_PRINTABLE_WIDTH = A3_LANDSCAPE_WIDTH - 2 * PDF_MARGIN;

export const PDF_MIN_COLUMN_WIDTH = 20;
export const PDF_MIN_ROW_HEIGHT = 16;
const PDF_FONT_SIZE = 8;
/** Reserved gap after each column so wrapped text never touches the next column. */
const PDF_CELL_PADDING = 6;
/** Single-line cell box height for the ellipsis fallback (must be set or ellipsis is ignored). */
const PDF_ELLIPSIS_CELL_HEIGHT = 12;
const PDF_FONT = "DejaVuSans";
const PDF_FONT_BOLD = "DejaVuSans-Bold";

export type PdfColumnMetrics = { minWidth: number; maxWidth: number };
export type PdfPageSize = "A4" | "A3";
export type PdfColumnWidthPlan = {
  contentWidths: number[];
  slotWidths: number[];
  mode: "wrap" | "ellipsis-fallback";
};

function exportRowCells(row: SanitizedExportRow): string[] {
  return [
    row.check_off,
    row.name,
    row.email,
    row.company,
    row.department,
    row.ticket_type,
    row.check_in_status,
    row.admitted_at,
    ...row.attribute_values,
  ];
}

/** Widest single whitespace-delimited token - pdfkit can still force character-level breaks
 * inside a wider unbroken token, so this is a readability target, not a hard rendering floor. */
function widestTokenWidth(doc: PDFKit.PDFDocument, value: string): number {
  let widest = 0;
  for (const token of value.split(/\s+/)) {
    if (!token) continue;
    widest = Math.max(widest, doc.widthOfString(token));
  }
  return widest;
}

export function measurePdfColumnMetrics(
  doc: PDFKit.PDFDocument,
  exportColumns: string[],
  exportRows: SanitizedExportRow[],
): PdfColumnMetrics[] {
  doc.font(PDF_FONT_BOLD).fontSize(PDF_FONT_SIZE);
  const metrics = exportColumns.map((header) => ({
    maxWidth: doc.widthOfString(header),
    minWidth: widestTokenWidth(doc, header),
  }));

  doc.font(PDF_FONT).fontSize(PDF_FONT_SIZE);
  for (const row of exportRows) {
    const cells = exportRowCells(row);
    for (let i = 0; i < metrics.length; i++) {
      const value = cells[i] ?? "";
      metrics[i]!.maxWidth = Math.max(metrics[i]!.maxWidth, doc.widthOfString(value));
      metrics[i]!.minWidth = Math.max(metrics[i]!.minWidth, widestTokenWidth(doc, value));
    }
  }

  return metrics.map(({ minWidth, maxWidth }) => {
    const flooredMin = Math.max(minWidth, PDF_MIN_COLUMN_WIDTH);
    return { minWidth: flooredMin, maxWidth: Math.max(maxWidth, flooredMin) };
  });
}

export function resolvePdfPageSize(minWidths: number[]): {
  pageSize: PdfPageSize;
  printableWidth: number;
} {
  const sumMin = minWidths.reduce((sum, w) => sum + w, 0) + minWidths.length * PDF_CELL_PADDING;
  return sumMin <= PDF_A4_PRINTABLE_WIDTH
    ? { pageSize: "A4", printableWidth: PDF_A4_PRINTABLE_WIDTH }
    : { pageSize: "A3", printableWidth: PDF_A3_PRINTABLE_WIDTH };
}

/** Scale widths down proportionally toward the column floor; shave 1pt from the widest columns
 * until the total fits (or every column is already at the floor). Last-resort fallback only. */
function clampToFloor(widths: number[], maxTotal: number): number[] {
  const total = widths.reduce((sum, w) => sum + w, 0);
  if (total <= maxTotal) return widths;
  const scale = maxTotal / total;
  const scaled = widths.map((w) => Math.max(PDF_MIN_COLUMN_WIDTH, Math.floor(w * scale)));
  let scaledTotal = scaled.reduce((sum, w) => sum + w, 0);
  while (scaledTotal > maxTotal) {
    let widest = -1;
    let widestWidth = PDF_MIN_COLUMN_WIDTH;
    for (let i = 0; i < scaled.length; i++) {
      if (scaled[i]! > widestWidth) {
        widestWidth = scaled[i]!;
        widest = i;
      }
    }
    if (widest < 0) break;
    scaled[widest]!--;
    scaledTotal--;
  }
  return scaled;
}

export function distributePdfColumnWidths(
  metrics: PdfColumnMetrics[],
  printableWidth: number,
): PdfColumnWidthPlan {
  const columnCount = metrics.length;
  const available = printableWidth - columnCount * PDF_CELL_PADDING;
  const sumMin = metrics.reduce((sum, m) => sum + m.minWidth, 0);
  const sumMax = metrics.reduce((sum, m) => sum + m.maxWidth, 0);

  let contentWidths: number[];
  let mode: PdfColumnWidthPlan["mode"] = "wrap";

  if (sumMax <= available) {
    const totalFlex = metrics.reduce((sum, m) => sum + (m.maxWidth - m.minWidth), 0);
    const slack = available - sumMax;
    contentWidths = metrics.map((m) => {
      const flex = m.maxWidth - m.minWidth;
      const bonus = totalFlex > 0 ? (slack * flex) / totalFlex : slack / columnCount;
      return m.maxWidth + bonus;
    });
  } else if (sumMin <= available) {
    // sumMin <= available <=> totalFlex >= deficit, so every assigned width stays >= minWidth.
    const totalFlex = sumMax - sumMin;
    const deficit = sumMax - available;
    contentWidths = metrics.map((m) => {
      const flex = m.maxWidth - m.minWidth;
      return m.maxWidth - (deficit * flex) / totalFlex;
    });
  } else {
    mode = "ellipsis-fallback";
    contentWidths = clampToFloor(
      metrics.map((m) => m.minWidth),
      available,
    );
  }

  return {
    contentWidths,
    slotWidths: contentWidths.map((w) => w + PDF_CELL_PADDING),
    mode,
  };
}

/** Caps at maxHeight (a fresh page's full printable height) so one cell's wrapped content can
 * never exceed what doc.text's own height option will clip to - an unbounded row height would
 * still overflow a freshly page-broken row instead of being contained on it. */
function measureRowHeight(
  doc: PDFKit.PDFDocument,
  cells: string[],
  contentWidths: number[],
  maxHeight: number,
): number {
  let height = PDF_MIN_ROW_HEIGHT;
  for (let i = 0; i < cells.length; i++) {
    height = Math.max(height, doc.heightOfString(cells[i] ?? "", { width: contentWidths[i]! }));
  }
  return Math.min(height, Math.max(maxHeight, PDF_MIN_ROW_HEIGHT));
}

function ellipsisFallbackTextOptions(width: number): {
  width: number;
  height: number;
  ellipsis: true;
} {
  return { width, height: PDF_ELLIPSIS_CELL_HEIGHT, ellipsis: true };
}

const require = createRequire(import.meta.url);

function resolvePdfFontFile(bold: boolean): string {
  const file = bold ? "DejaVuSans-Bold.ttf" : "DejaVuSans.ttf";
  return require.resolve(`dejavu-fonts-ttf/ttf/${file}`);
}

/** Build PDF bytes for export rows (dynamic pdfkit import, ESM-safe). */
export async function buildExportPdfBuffer(
  exportRows: SanitizedExportRow[],
  exportColumns: string[],
  eventMeta: { title: string; date: Date },
): Promise<Uint8Array> {
  const pdfkitMod = await import("pdfkit");
  const PDFDocument = pdfkitMod.default ?? pdfkitMod;

  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ autoFirstPage: false });
  doc.registerFont(PDF_FONT, resolvePdfFontFile(false));
  doc.registerFont(PDF_FONT_BOLD, resolvePdfFontFile(true));
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  const metrics = measurePdfColumnMetrics(doc, exportColumns, exportRows);
  const { pageSize, printableWidth } = resolvePdfPageSize(metrics.map((m) => m.minWidth));
  const plan = distributePdfColumnWidths(metrics, printableWidth);
  const pageOptions = { size: pageSize, layout: "landscape" as const, margin: PDF_MARGIN };

  doc.addPage(pageOptions);

  const eventDateStr = formatEventDate(eventMeta.date, "UTC");
  doc.fontSize(14).font(PDF_FONT_BOLD).text(`${eventMeta.title} - ${eventDateStr}`);
  doc.moveDown(0.5);

  let y = doc.y;
  const pageBottom = () => doc.page.height - doc.page.margins.bottom;
  const printableHeight = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;

  const cellOptions = (width: number, rowHeight: number) =>
    plan.mode === "wrap" ? { width, height: rowHeight } : ellipsisFallbackTextOptions(width);

  const drawTableHeader = () => {
    doc.fontSize(PDF_FONT_SIZE).font(PDF_FONT_BOLD);
    const headerHeight =
      plan.mode === "wrap"
        ? measureRowHeight(doc, exportColumns, plan.contentWidths, printableHeight)
        : PDF_MIN_ROW_HEIGHT;
    let x = PDF_MARGIN;
    for (let i = 0; i < exportColumns.length; i++) {
      doc.text(exportColumns[i]!, x, y, cellOptions(plan.contentWidths[i]!, headerHeight));
      x += plan.slotWidths[i]!;
    }
    y += headerHeight;
    doc.font(PDF_FONT);
  };

  drawTableHeader();

  for (const row of exportRows) {
    const cells = exportRowCells(row);
    doc.fontSize(PDF_FONT_SIZE).font(PDF_FONT);
    const rowHeight =
      plan.mode === "wrap"
        ? measureRowHeight(doc, cells, plan.contentWidths, printableHeight)
        : PDF_MIN_ROW_HEIGHT;

    if (y + rowHeight > pageBottom()) {
      doc.addPage(pageOptions);
      y = PDF_MARGIN;
      drawTableHeader();
    }

    let x = PDF_MARGIN;
    for (let i = 0; i < cells.length; i++) {
      doc.text(cells[i] ?? "", x, y, cellOptions(plan.contentWidths[i]!, rowHeight));
      x += plan.slotWidths[i]!;
    }
    y += rowHeight;
  }

  const done = new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);
  });
  doc.end();
  await done;

  return new Uint8Array(Buffer.concat(chunks));
}
