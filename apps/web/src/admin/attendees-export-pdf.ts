import { createRequire } from "node:module";
import { formatEventDate } from "@admitto/mail-templates";
import {
  EXPORT_BASE_COLUMNS,
  type SanitizedExportRow,
} from "@admitto/tickets/attendees-export";

/** Fixed column PDF widths for export (includes check-off). Attribute columns appended at runtime.
 * Prefer Name + Email for paper checklists. Admitted at (≥75) fits YYYY-MM-DD HH:mm at 8pt. */
export const EXPORT_BASE_PDF_WIDTHS = [22, 100, 145, 65, 45, 55, 65, 75] as const;
export const EXPORT_ATTRIBUTE_PDF_WIDTH = 55;
/** Printable width on A4 landscape with 40pt side margins (pdfkit default). */
export const PDF_PRINTABLE_WIDTH = 762;

if (EXPORT_BASE_PDF_WIDTHS.length !== EXPORT_BASE_COLUMNS.length) {
  throw new Error("EXPORT_BASE_PDF_WIDTHS must match EXPORT_BASE_COLUMNS length");
}

const PDF_ROW_HEIGHT = 16;
const PDF_FONT_SIZE = 8;
/** Single-line cell box height for pdfkit ellipsis (must be set or ellipsis is ignored). */
export const PDF_CELL_HEIGHT = 12;
const PDF_PAGE_BOTTOM = 555;
const PDF_FONT = "DejaVuSans";
const PDF_FONT_BOLD = "DejaVuSans-Bold";

const PDF_MIN_COLUMN_WIDTH = 20;

/** pdfkit truncates with … only when both width and height are set. */
export function pdfCellTextOptions(width: number): {
  width: number;
  height: number;
  ellipsis: true;
} {
  return { width, height: PDF_CELL_HEIGHT, ellipsis: true };
}

function sumPdfColumnWidths(widths: number[]): number {
  return widths.reduce((sum, w) => sum + w, 0);
}

/** Scale columns down proportionally when the layout exceeds printable width.
 * Min-width clamp can still overshoot; shave 1pt from the widest columns until we fit
 * (or every column is already at the minimum). */
function scalePdfColumnWidths(widths: number[], maxTotal: number): number[] {
  const total = sumPdfColumnWidths(widths);
  if (total <= maxTotal) return widths;
  const scale = maxTotal / total;
  const scaled = widths.map((w) => Math.max(PDF_MIN_COLUMN_WIDTH, Math.floor(w * scale)));
  let scaledTotal = sumPdfColumnWidths(scaled);
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

export function buildExportPdfColumnWidths(attributeFieldCount: number): number[] {
  const base = [...EXPORT_BASE_PDF_WIDTHS];
  if (attributeFieldCount === 0) return base;

  const minAttrWidth = 28;
  const baseTotal = sumPdfColumnWidths(base);
  const defaultTotal = baseTotal + attributeFieldCount * EXPORT_ATTRIBUTE_PDF_WIDTH;

  if (defaultTotal <= PDF_PRINTABLE_WIDTH) {
    return [...base, ...Array.from({ length: attributeFieldCount }, () => EXPORT_ATTRIBUTE_PDF_WIDTH)];
  }

  const spaceForAttrs = PDF_PRINTABLE_WIDTH - baseTotal;
  if (spaceForAttrs >= attributeFieldCount * minAttrWidth) {
    const attrWidth = Math.floor(spaceForAttrs / attributeFieldCount);
    return [...base, ...Array.from({ length: attributeFieldCount }, () => attrWidth)];
  }

  const attrWidth = minAttrWidth;
  const targetBaseTotal = PDF_PRINTABLE_WIDTH - attributeFieldCount * minAttrWidth;
  const scaledBase =
    targetBaseTotal > 0
      ? base.map((w) =>
          Math.max(PDF_MIN_COLUMN_WIDTH, Math.floor((w * targetBaseTotal) / baseTotal)),
        )
      : base;

  return scalePdfColumnWidths(
    [...scaledBase, ...Array.from({ length: attributeFieldCount }, () => attrWidth)],
    PDF_PRINTABLE_WIDTH,
  );
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
  const pdfColWidths = buildExportPdfColumnWidths(exportColumns.length - EXPORT_BASE_COLUMNS.length);
  const pdfkitMod = await import("pdfkit");
  const PDFDocument = pdfkitMod.default ?? pdfkitMod;

  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 40 });
  doc.registerFont(PDF_FONT, resolvePdfFontFile(false));
  doc.registerFont(PDF_FONT_BOLD, resolvePdfFontFile(true));
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  const eventDateStr = formatEventDate(eventMeta.date, "UTC");
  doc.fontSize(14).font(PDF_FONT_BOLD).text(`${eventMeta.title} - ${eventDateStr}`);
  doc.moveDown(0.5);

  let y = doc.y;

  const drawTableHeader = () => {
    doc.fontSize(PDF_FONT_SIZE).font(PDF_FONT_BOLD);
    let x = 40;
    for (let i = 0; i < exportColumns.length; i++) {
      doc.text(exportColumns[i]!, x, y, pdfCellTextOptions(pdfColWidths[i]!));
      x += pdfColWidths[i]!;
    }
    y += PDF_ROW_HEIGHT;
    doc.font(PDF_FONT);
  };

  drawTableHeader();

  for (const row of exportRows) {
    if (y + PDF_ROW_HEIGHT > PDF_PAGE_BOTTOM) {
      doc.addPage({ size: "A4", layout: "landscape", margin: 40 });
      y = 40;
      drawTableHeader();
    }
    const cells = [
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
    doc.fontSize(PDF_FONT_SIZE);
    let x = 40;
    for (let i = 0; i < cells.length; i++) {
      doc.text(cells[i] ?? "", x, y, pdfCellTextOptions(pdfColWidths[i]!));
      x += pdfColWidths[i]!;
    }
    y += PDF_ROW_HEIGHT;
  }

  const done = new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);
  });
  doc.end();
  await done;

  return new Uint8Array(Buffer.concat(chunks));
}
