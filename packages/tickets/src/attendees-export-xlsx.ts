import type { SanitizedExportRow } from "./attendees-export.js";

export async function buildExportXlsxBuffer(
  exportRows: SanitizedExportRow[],
  exportColumns: string[],
): Promise<Uint8Array> {
  const exceljs = await import("exceljs");
  const ExcelJS = exceljs.default ?? exceljs;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Attendees");
  ws.columns = exportColumns.map((h, i) => ({
    header: h,
    width: i === 0 ? 5 : 28,
  }));
  for (const r of exportRows) {
    const row = ws.addRow([
      r.check_off,
      r.name,
      r.email,
      r.company,
      r.department,
      r.ticket_type,
      r.check_in_status,
      r.admitted_at,
      ...r.attribute_values,
    ]);
    row.getCell(1).alignment = { horizontal: "center" };
  }
  ws.pageSetup = {
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    orientation: "landscape",
    paperSize: 9,
  };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

