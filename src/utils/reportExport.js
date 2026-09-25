// Shared header helpers for exported reports (PDF/Excel).
//
// Every report screen under the "Reportes" section (Libro Auxiliar today;
// Balance de Comprobación, Balance General, etc. to follow) exports the
// same kind of standalone document -- one that leaves the app and has to
// identify itself on its own, with no surrounding UI. That means every
// exported file needs, at minimum: which company it's for, and when it
// was generated -- pulled directly out of the app the moment this was
// asked for (2026-09-08), rather than being reinvented per report.
//
// companyName and generatedAt always come from the backend report DTO
// itself (e.g. AuxiliaryLedgerReport.companyName / .generatedAt), not from
// the frontend session, so the exported file reflects exactly what the
// server generated -- not a client-side guess.

/**
 * Formats an ISO-ish "generatedAt" timestamp (as sent by the backend,
 * e.g. "2026-09-08T14:32:10") into "YYYY-MM-DD HH:mm" for display.
 * Returns "" if there's nothing to format, so callers can render
 * conditionally without extra null checks.
 */
export function formatGeneratedAt(generatedAt) {
  if (!generatedAt) return "";
  return String(generatedAt).replace("T", " ").slice(0, 16);
}

/**
 * Writes a standard report header onto a jsPDF document at the given
 * (or default) starting Y position:
 *   Company Name        (bold, larger)
 *   Report Title
 *   Period (optional)
 *   Generado: <date time>
 * Returns the Y coordinate immediately below the header, so the caller
 * knows where to start the next table/section.
 */
export function addPdfReportHeader(doc, { companyName, reportTitle, period, generatedAtLabel, generatedAt }, startY = 15) {
  let y = startY;

  if (companyName) {
    doc.setFontSize(13);
    doc.setFont(undefined, "bold");
    doc.text(companyName, 14, y);
    doc.setFont(undefined, "normal");
    y += 6;
  }

  doc.setFontSize(11);
  doc.text(reportTitle, 14, y);
  y += 6;

  if (period) {
    doc.setFontSize(9);
    doc.text(period, 14, y);
    y += 5;
  }

  const generatedText = formatGeneratedAt(generatedAt);
  if (generatedText) {
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text(`${generatedAtLabel}: ${generatedText}`, 14, y);
    doc.setTextColor(0);
    y += 5;
  }

  return y + 3;
}

/**
 * Writes a compact one-line running header (company name + generated-at)
 * meant for every page AFTER the first in a multi-page PDF export, where
 * the full header above would be repetitive. Returns the Y coordinate
 * immediately below it.
 */
export function addPdfRunningHeader(doc, { companyName, generatedAtLabel, generatedAt }, startY = 12) {
  const generatedText = formatGeneratedAt(generatedAt);
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(
    [companyName, generatedText ? `${generatedAtLabel}: ${generatedText}` : null].filter(Boolean).join("   |   "),
    14,
    startY
  );
  doc.setTextColor(0);
  return startY + 6;
}

/**
 * Draws two blank signature lines side by side near the bottom of the
 * PDF (left/right labels underneath, e.g. "GERENTE" / "CONTADOR") --
 * first requested for Balance General (2026-09-25), written here rather
 * than inline so any other report can reuse it later. Starts below
 * whatever content ends at `afterY` (e.g. an autoTable's `finalY`); if
 * there isn't enough room left on the current page, adds a new page
 * first (repeating the running header via `headerInfo`, same as
 * autoTable's own didDrawPage callback does) instead of overlapping the
 * table or running off the bottom margin. Returns the Y coordinate the
 * lines were drawn at.
 */
export function addPdfSignatureLines(doc, { leftLabel, rightLabel }, afterY, headerInfo) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const bottomMargin = 15;
  const gapAboveLines = 22;

  let y = afterY + gapAboveLines;
  if (y + 10 > pageHeight - bottomMargin) {
    doc.addPage();
    y = (headerInfo ? addPdfRunningHeader(doc, headerInfo) : 15) + gapAboveLines;
  }

  const sideMargin = 20;
  const gapBetween = 15;
  const halfWidth = (pageWidth - sideMargin * 2 - gapBetween) / 2;

  const leftX1 = sideMargin;
  const leftX2 = sideMargin + halfWidth;
  const rightX1 = leftX2 + gapBetween;
  const rightX2 = rightX1 + halfWidth;

  doc.setDrawColor(0);
  doc.line(leftX1, y, leftX2, y);
  doc.line(rightX1, y, rightX2, y);

  doc.setFontSize(9);
  doc.setTextColor(0);
  doc.text(leftLabel, (leftX1 + leftX2) / 2, y + 5, { align: "center" });
  doc.text(rightLabel, (rightX1 + rightX2) / 2, y + 5, { align: "center" });

  return y;
}

/**
 * Builds the header rows (array-of-arrays, ready for
 * XLSX.utils.aoa_to_sheet) shared by every exported report sheet:
 *   Company Name
 *   Report Title
 *   Period (optional)
 *   Generado: <date time>
 *   (blank row)
 */
export function buildExcelHeaderRows({ companyName, reportTitle, period, generatedAtLabel, generatedAt }) {
  const rows = [];
  if (companyName) rows.push([companyName]);
  rows.push([reportTitle]);
  if (period) rows.push([period]);
  const generatedText = formatGeneratedAt(generatedAt);
  if (generatedText) rows.push([`${generatedAtLabel}: ${generatedText}`]);
  rows.push([]);
  return rows;
}

// Account-class summaries (Trial Balance's "Resumen por Clase" today; the
// same grouping will show up in Balance de Comprobación Detallado and
// Balance General) used to come from the backend as a ready-made display
// string like "1 - Assets" -- hardcoded in English, with no way for a
// Spanish-language report to show "1 - Activos" instead, since the
// string WAS the map key. The backend now sends a bare, language-neutral
// code ("1".."5", "6-7", or "OTHER") and this table translates it for
// display, the same way apiErrors.js translates backend error codes.
const ACCOUNT_CLASS_LABELS = {
  "1": { es: "1 - Activos", en: "1 - Assets" },
  "2": { es: "2 - Pasivos", en: "2 - Liabilities" },
  "3": { es: "3 - Patrimonio", en: "3 - Equity" },
  "4": { es: "4 - Ingresos", en: "4 - Revenue" },
  "5": { es: "5 - Gastos", en: "5 - Expenses" },
  "6-7": { es: "6/7 - Costos", en: "6/7 - Costs" },
  OTHER: { es: "Otras", en: "Other" },
};

/**
 * Translates a backend account-class code into a display label. Falls
 * back to the raw code for anything not in the table above, so a future
 * backend class never silently disappears from the report -- it just
 * shows untranslated instead of translated.
 */
export function translateAccountClass(code, language = "es") {
  const entry = ACCOUNT_CLASS_LABELS[code];
  if (!entry) return code;
  return entry[language] || entry.es;
}
