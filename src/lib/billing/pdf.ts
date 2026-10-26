import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { prisma } from "../db";
import { getSetting } from "../settings";
import { formatMoney, D } from "../money";
import { fmtDate } from "../time";

// Standard PDF fonts only cover WinAnsi; replace anything else so drawing never throws.
const clean = (s: string) => s.replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const out: string[] = [];
  for (const para of clean(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** Render an invoice as a PDF from stored (not recomputed) amounts. */
export async function invoicePdf(invoiceId: string): Promise<{ bytes: Uint8Array; filename: string }> {
  const inv = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { client: true, agency: true, releaseOrder: true, lines: true, creditNotes: { where: { status: "ISSUED" } }, allocations: { include: { payment: true } } },
  });
  const [company, layout] = await Promise.all([getSetting("company.profile"), getSetting("billing.invoiceLayout")]);
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${inv.number ?? "DRAFT"}`);
  doc.setProducer("TRENDS Traffic & Scheduling");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.12, 0.16);
  const muted = rgb(0.42, 0.45, 0.5);
  const accent = rgb(0.06, 0.46, 0.43);
  const W = 595.28;
  const H = 841.89;
  const M = 48;
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;
  const text = (s: string, x: number, size = 9, f = font, color = ink) => page.drawText(clean(s), { x, y, size, font: f, color });
  const right = (s: string, xRight: number, size = 9, f = font, color = ink) => page.drawText(clean(s), { x: xRight - f.widthOfTextAtSize(clean(s), size), y, size, font: f, color });
  const ensure = (h: number) => {
    if (y - h < M + 40) {
      page = doc.addPage([W, H]);
      y = H - M;
    }
  };

  // Header
  text(company.name || "Company", M, 16, bold, accent);
  right(inv.status === "DRAFT" ? "DRAFT INVOICE" : "TAX INVOICE", W - M, 16, bold);
  y -= 16;
  for (const l of [company.address, [company.email, company.phone].filter(Boolean).join(" · "), company.taxId ? `Tax ID ${company.taxId}` : ""].filter(Boolean)) {
    for (const w of wrap(l, font, 8.5, 240)) {
      text(w, M, 8.5, font, muted);
      y -= 11;
    }
  }
  let ry = H - M - 16;
  const meta: [string, string][] = [
    ["Invoice no.", inv.number ?? "Not issued"],
    ["Issue date", fmtDate(inv.issueDate)],
    ["Due date", fmtDate(inv.dueDate)],
    ["Release order", inv.releaseOrder?.number ?? "-"],
    ["Period", inv.periodStart ? `${fmtDate(inv.periodStart)} - ${fmtDate(inv.periodEnd)}` : "-"],
  ];
  for (const [k, v] of meta) {
    page.drawText(k, { x: W - M - 200, y: ry, size: 8.5, font, color: muted });
    page.drawText(clean(v), { x: W - M - 200 + 80, y: ry, size: 8.5, font: bold, color: ink });
    ry -= 12;
  }
  y = Math.min(y, ry) - 18;

  // Bill to
  text("BILL TO", M, 8, bold, muted);
  y -= 12;
  const billTo = inv.agency ? [`${inv.agency.name} (agency)`, `On behalf of ${inv.client.name}`, inv.agency.billingAddress ?? "", inv.agency.taxId ? `Tax ID ${inv.agency.taxId}` : ""] : [inv.client.name, inv.client.billingAddress ?? "", inv.client.taxId ? `Tax ID ${inv.client.taxId}` : ""];
  for (const l of billTo.filter(Boolean)) {
    for (const w of wrap(l, font, 9, 300)) {
      text(w, M, 9, l === billTo[0] ? bold : font);
      y -= 12;
    }
  }
  y -= 14;

  // Lines
  const cols = { desc: M, qty: 330, price: 400, disc: 460, total: W - M };
  page.drawRectangle({ x: M - 4, y: y - 4, width: W - 2 * M + 8, height: 16, color: rgb(0.95, 0.96, 0.97) });
  text("Description", cols.desc, 8, bold, muted);
  right("Qty", cols.qty + 30, 8, bold, muted);
  right("Unit price", cols.price + 50, 8, bold, muted);
  right("Discount", cols.disc + 40, 8, bold, muted);
  right("Net", cols.total, 8, bold, muted);
  y -= 18;
  for (const l of inv.lines) {
    const desc = wrap(l.description, font, 9, 270);
    ensure(desc.length * 12 + 6);
    const net = D(l.grossAmount).sub(l.discountAmount);
    right(D(l.quantity).toDecimalPlaces(2).toString(), cols.qty + 30);
    right(formatMoney(l.unitPrice, inv.currency), cols.price + 50);
    right(D(l.discountPct).gt(0) ? `${D(l.discountPct).toString()}%` : "-", cols.disc + 40);
    right(formatMoney(net, inv.currency), cols.total);
    for (const d of desc) {
      text(d, cols.desc);
      y -= 12;
    }
    page.drawLine({ start: { x: M - 4, y: y + 4 }, end: { x: W - M + 4, y: y + 4 }, thickness: 0.5, color: rgb(0.88, 0.89, 0.9) });
    y -= 4;
  }
  y -= 8;

  // Totals
  const totals: [string, string, boolean?][] = [
    ["Gross", formatMoney(inv.subtotal, inv.currency)],
    ["Discount", `-${formatMoney(inv.discountTotal, inv.currency)}`],
    ...(layout.showCommission && D(inv.commissionTotal).gt(0) ? [["Agency commission", `-${formatMoney(inv.commissionTotal, inv.currency)}`] as [string, string]] : []),
    ["Tax", formatMoney(inv.taxTotal, inv.currency)],
    ["Total", formatMoney(inv.total, inv.currency), true],
    ...(D(inv.amountPaid).gt(0) ? [["Paid", `-${formatMoney(inv.amountPaid, inv.currency)}`] as [string, string]] : []),
    ...(D(inv.creditedTotal).gt(0) ? [["Credited", `-${formatMoney(inv.creditedTotal, inv.currency)}`] as [string, string]] : []),
    ["Balance due", formatMoney(inv.balance, inv.currency), true],
  ];
  ensure(totals.length * 14 + 20);
  for (const [k, v, strong] of totals) {
    right(k, W - M - 110, 9, strong ? bold : font, strong ? ink : muted);
    right(v, W - M, 9, strong ? bold : font);
    y -= 14;
  }
  y -= 16;

  const footer = [inv.notes ?? "", layout.paymentInstructions ?? "", inv.paymentToken && process.env.APP_URL ? `Pay online: ${process.env.APP_URL}/pay/${inv.paymentToken}` : "", layout.footer ?? ""].filter(Boolean);
  for (const f of footer) {
    const ls = wrap(f, font, 8.5, W - 2 * M);
    ensure(ls.length * 11 + 6);
    for (const l of ls) {
      text(l, M, 8.5, font, muted);
      y -= 11;
    }
    y -= 6;
  }

  const pages = doc.getPages();
  pages.forEach((p, i) => p.drawText(`Page ${i + 1} of ${pages.length}`, { x: W - M - 60, y: 24, size: 7.5, font, color: muted }));
  return { bytes: await doc.save(), filename: `${inv.number ?? `draft-${inv.id.slice(-6)}`}.pdf` };
}
