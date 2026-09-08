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
