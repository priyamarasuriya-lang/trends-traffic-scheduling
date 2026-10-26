import ExcelJS from "exceljs";
import type { ReportColumn } from "./definitions";

export async function toXlsx(title: string, columns: ReportColumn[], rows: Record<string, unknown>[], meta: string[] = []) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "TRENDS";
  wb.created = new Date();
  const ws = wb.addWorksheet(title.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
  ws.addRow([title]).font = { bold: true, size: 14 };
  for (const m of meta) ws.addRow([m]).font = { italic: true, color: { argb: "FF666666" } };
  ws.addRow([]);
  const header = ws.addRow(columns.map((c) => c.label));
  header.font = { bold: true };
  header.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } }));
  for (const r of rows) {
    ws.addRow(
      columns.map((c) => {
        const v = r[c.key];
        if (v == null) return "";
        if (c.type === "money" || c.type === "number") return Number(v);
        if (c.type === "date" || c.type === "datetime") return v instanceof Date ? v : new Date(String(v));
        const s = String(v);
        return /^[=+\-@]/.test(s) ? `'${s}` : s;
      }),
    );
  }
  columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.min(50, Math.max(12, c.label.length + 4));
    if (c.type === "money") col.numFmt = "#,##0.00";
    if (c.type === "date") col.numFmt = "yyyy-mm-dd";
    if (c.type === "datetime") col.numFmt = "yyyy-mm-dd hh:mm";
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
