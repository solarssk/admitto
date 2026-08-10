import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { EXPORT_BASE_COLUMNS, type SanitizedExportRow } from "../src/attendees-export.js";
import { buildExportXlsxBuffer } from "../src/attendees-export-xlsx.js";

function row(overrides: Partial<SanitizedExportRow> = {}): SanitizedExportRow {
  return {
    check_off: "",
    name: "Ada Lovelace",
    email: "ada@example.com",
    company: "Analytical Engines",
    department: "Math",
    ticket_type: "VIP",
    check_in_status: "not_admitted",
    admitted_at: "",
    attribute_values: [],
    ...overrides,
  };
}

describe("buildExportXlsxBuffer", () => {
  it("writes a worksheet with header, data row, and landscape page setup", async () => {
    const bytes = await buildExportXlsxBuffer([row()], [...EXPORT_BASE_COLUMNS]);
    expect(bytes.byteLength).toBeGreaterThan(100);

    const wb = new ExcelJS.Workbook();
    // exceljs accepts Buffer; Uint8Array is fine via Buffer.from
    await wb.xlsx.load(Buffer.from(bytes));
    const ws = wb.getWorksheet("Attendees");
    expect(ws).toBeDefined();
    expect(ws!.getRow(1).getCell(2).value).toBe("Name");
    expect(ws!.getRow(2).getCell(2).value).toBe("Ada Lovelace");
    expect(ws!.getRow(2).getCell(1).alignment).toMatchObject({ horizontal: "center" });
    expect(ws!.pageSetup.orientation).toBe("landscape");
    expect(ws!.views?.[0]).toMatchObject({ state: "frozen", ySplit: 1 });
  });

  it("appends custom attribute columns after the base fields", async () => {
    const bytes = await buildExportXlsxBuffer(
      [row({ attribute_values: ["large", "red"] })],
      [...EXPORT_BASE_COLUMNS, "Size", "Color"],
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(bytes));
    const ws = wb.getWorksheet("Attendees")!;
    expect(ws.getRow(1).getCell(9).value).toBe("Size");
    expect(ws.getRow(2).getCell(9).value).toBe("large");
    expect(ws.getRow(2).getCell(10).value).toBe("red");
  });
});
