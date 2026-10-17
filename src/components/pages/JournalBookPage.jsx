import { useEffect, useMemo, useState } from "react";
import AppHeader from "../common/AppHeader";
import Button from "../ui/Button";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { getApiErrorMessage } from "../../constants/apiErrors";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  addPdfReportHeader,
  addPdfRunningHeader,
  buildExcelHeaderRows,
  nowLocalIso,
  todayLocalIso,
} from "../../utils/reportExport";

// NEW (2026-10-11): "Libro Diario" -- the user could already list journal
// entries (JournalEntryPage) and export that list to Excel/PDF, but both
// were always ONE ROW PER COMPROBANTE (doc number, date, totals) -- the
// full line-by-line content (cuenta/tercero/centro de costo/débito/
// crédito per line) was only reachable one voucher at a time, via "Ver".
// The user asked for a report that shows every comprobante in a date
// range WITH its full content, not just its totals, so they don't have
// to open them one by one. This reuses the same backend endpoint the
// list screen already calls (GET /v1/journal-entries) -- its DTO already
// returns every line's full detail (JournalEntryResponseDTO.ItemResponse),
// so no backend change was needed; this is a pure frontend report, built
// on the exact same "fetch everything matching the filters, not just one
// page" pattern already used by JournalEntryPage's own list export
// (fetchAllFilteredEntries), and the exact same per-voucher table layout
// already used by JeDetailModal there -- just repeated for every
// comprobante in the range instead of a single one.
function JournalBookPage({ language = "es" }) {
  const today = todayLocalIso();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [documentTypeId, setDocumentTypeId] = useState("");
  const [documentTypes, setDocumentTypes] = useState([]);
  // NEW (2026-10-17, user request): "imprimir todos, los no anulados y
  // los anulados" -- filters the already-fetched register by voucher
  // status without a new request, since every entry already carries
  // its own `annulled` flag (see displayedEntries below).
  const [statusFilter, setStatusFilter] = useState("ALL");

  const [entries, setEntries] = useState(null); // null = not generated yet
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);

  const { session } = useAuth();
  const activeTenantId = session.companyName || session.companyId;

  const t = {
    es: {
      title: "Libro Diario",
      subtitle: "Todos los comprobantes contabilizados en un rango de fechas, con el detalle completo de cada uno",
      startDate: "Fecha Desde",
      endDate: "Fecha Hasta",
      documentType: "Tipo de Documento",
      allDocumentTypes: "Todos",
      status: "Estado",
      statusAll: "Todos",
      statusActive: "No Anulados",
      statusAnnulled: "Anulados",
      generate: "Generar",
      generating: "Generando...",
      dateRequired: "Selecciona la fecha desde y la fecha hasta para generar el reporte.",
      dateRangeInvalid: "La fecha desde no puede ser posterior a la fecha hasta.",
      noResults: "No hay comprobantes contabilizados en ese rango de fechas.",
      noResultsFiltered: "No hay comprobantes que cumplan el filtro de estado seleccionado en ese rango de fechas.",
      account: "Cuenta",
      thirdParty: "Tercero",
      costCenter: "Centro de Costo",
      debit: "Débito",
      credit: "Crédito",
      totalsRow: "Total",
      annulled: "Anulado",
      generatedAt: "Generado",
      errorConn: "Error de conexión con el servidor.",
      exportExcel: "Exportar Excel",
      exportPdf: "Exportar PDF",
      exportTitle: "Libro Diario",
      entriesCount: "Comprobantes",
      grandTotal: "Total General",
      noDocType: "—",
    },
    en: {
      title: "General Journal",
      subtitle: "Every voucher posted in a date range, with each one's full content",
      startDate: "Start Date",
      endDate: "End Date",
      documentType: "Document Type",
      allDocumentTypes: "All",
      status: "Status",
      statusAll: "All",
      statusActive: "Not Annulled",
      statusAnnulled: "Annulled",
      generate: "Generate",
      generating: "Generating...",
      dateRequired: "Select a start date and an end date to generate the report.",
      dateRangeInvalid: "The start date cannot be after the end date.",
      noResults: "No vouchers were posted in that date range.",
      noResultsFiltered: "No vouchers match the selected status filter in that date range.",
      account: "Account",
      thirdParty: "Third Party",
      costCenter: "Cost Center",
      debit: "Debit",
      credit: "Credit",
      totalsRow: "Total",
      annulled: "Voided",
      generatedAt: "Generated",
      errorConn: "Server connection error.",
      exportExcel: "Export to Excel",
      exportPdf: "Export to PDF",
      exportTitle: "General Journal",
      entriesCount: "Vouchers",
      grandTotal: "Grand Total",
      noDocType: "—",
    },
  }[language];

  const money = (n) =>
    (Number.isFinite(n) ? n : 0).toLocaleString(language === "es" ? "es-CO" : "en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  // Document types come back as a flat array (not a Spring Page<>),
  // same shape JournalEntryPage.loadCatalogs() already handles for this
  // endpoint -- only needed here to label each entry ("CODE - Name"),
  // since JournalEntryResponseDTO only carries documentTypeId.
  useEffect(() => {
    api
      .get("/v1/document-types")
      .then((res) => {
        const data = res.data?.data ?? res.data;
        setDocumentTypes(Array.isArray(data) ? data : []);
      })
      .catch(() => setDocumentTypes([]));
  }, []);

  const documentTypeById = (id) => documentTypes.find((d) => String(d.id) === String(id));
  const documentTypeLabel = (entry) => {
    const dt = documentTypeById(entry.documentTypeId);
    return dt ? `${dt.code} - ${dt.name}` : t.noDocType;
  };

  const entryTotals = (entry) => {
    const totalDebit = (entry.items || []).reduce((s, i) => s + (i.debit || 0), 0);
    const totalCredit = (entry.items || []).reduce((s, i) => s + (i.credit || 0), 0);
    return { totalDebit, totalCredit };
  };

  const statusFilterLabel = () => {
    if (statusFilter === "ACTIVE") return t.statusActive;
    if (statusFilter === "ANNULLED") return t.statusAnnulled;
    return t.statusAll;
  };

  const reportPeriodLabel = () => `${startDate} — ${endDate}`;
  const exportFileStem = () => `${t.exportTitle.replace(/\s+/g, "_")}_${startDate}_${endDate}`;

  const handleGenerate = async (e) => {
    e.preventDefault();
    setError(null);

    if (!startDate || !endDate) {
      setError(t.dateRequired);
      return;
    }
    if (startDate > endDate) {
      setError(t.dateRangeInvalid);
      return;
    }

    setLoading(true);
    setEntries(null);
    try {
      // Same "fetch everything matching the filters in one shot, not
      // paginated" pattern already used by JournalEntryPage's own export
      // (fetchAllFilteredEntries) -- this report has no on-screen
      // pagination of its own, it's meant to be read/printed as one
      // continuous register, same as a real Libro Diario.
      const response = await api.get("/v1/journal-entries", {
        params: {
          startDate,
          endDate,
          ...(documentTypeId ? { documentTypeId } : {}),
          page: 0,
          size: 10000,
          sort: "entryDate,asc",
        },
      });
      const pageData = response.data?.data;
      setEntries(Array.isArray(pageData?.content) ? pageData.content : []);
    } catch (err) {
      setError(getApiErrorMessage(err, language, t.errorConn));
    } finally {
      setLoading(false);
    }
  };

  // The raw fetch stays unfiltered (one request per date range/document
  // type, same as before); the status filter is applied here so flipping
  // it between Todos/No Anulados/Anulados is instant and never re-queries
  // the backend.
  const displayedEntries = useMemo(() => {
    if (!Array.isArray(entries)) return entries;
    if (statusFilter === "ACTIVE") return entries.filter((entry) => !entry.annulled);
    if (statusFilter === "ANNULLED") return entries.filter((entry) => entry.annulled);
    return entries;
  }, [entries, statusFilter]);

  const hasRawData = Array.isArray(entries) && entries.length > 0;
  const hasData = Array.isArray(displayedEntries) && displayedEntries.length > 0;

  const grandTotals = () => {
    let totalDebit = 0;
    let totalCredit = 0;
    (displayedEntries || []).forEach((entry) => {
      const { totalDebit: d, totalCredit: c } = entryTotals(entry);
      totalDebit += d;
      totalCredit += c;
    });
    return { totalDebit, totalCredit };
  };

  const handleExportExcel = () => {
    if (!hasData) return;
    setExporting(true);

    const headerInfo = {
      companyName: activeTenantId,
      reportTitle: t.exportTitle,
      period: `${reportPeriodLabel()}   ·   ${statusFilterLabel()}`,
      generatedAtLabel: t.generatedAt,
      generatedAt: nowLocalIso(),
    };

    const { totalDebit: grandDebit, totalCredit: grandCredit } = grandTotals();

    const rows = [
      ...buildExcelHeaderRows(headerInfo),
      [t.entriesCount, displayedEntries.length],
      [],
    ];

    displayedEntries.forEach((entry) => {
      const { totalDebit, totalCredit } = entryTotals(entry);
      rows.push([
        `${entry.documentNumber}   ·   ${entry.entryDate}   ·   ${documentTypeLabel(entry)}${
          entry.annulled ? `   ·   ${t.annulled}` : ""
        }`,
      ]);
      if (entry.description) rows.push([entry.description]);
      rows.push([t.account, t.thirdParty, t.costCenter, t.debit, t.credit]);
      (entry.items || []).forEach((item) => {
        rows.push([
          `${item.accountCode} - ${item.accountName}`,
          item.thirdPartyName || "",
          item.costCenterName || "",
          item.debit || 0,
          item.credit || 0,
        ]);
      });
      rows.push([t.totalsRow, "", "", totalDebit, totalCredit]);
      rows.push([]);
    });

    rows.push([t.grandTotal, "", "", grandDebit, grandCredit]);

    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, t.exportTitle.slice(0, 31));
    XLSX.writeFile(workbook, `${exportFileStem()}.xlsx`);
    setExporting(false);
  };

  const handleExportPdf = () => {
    if (!hasData) return;
    setExporting(true);

    const doc = new jsPDF({ orientation: "landscape" });

    const headerInfo = {
      companyName: activeTenantId,
      reportTitle: t.exportTitle,
      period: `${reportPeriodLabel()}   ·   ${statusFilterLabel()}   ·   ${t.entriesCount}: ${displayedEntries.length}`,
      generatedAtLabel: t.generatedAt,
      generatedAt: nowLocalIso(),
    };

    let cursorY = addPdfReportHeader(doc, headerInfo);
    const bottomMargin = 15;
    const pageHeight = doc.internal.pageSize.getHeight();

    displayedEntries.forEach((entry) => {
      const { totalDebit, totalCredit } = entryTotals(entry);

      // A voucher header line never splits across a table boundary --
      // if there isn't room left for at least the header + one row,
      // start a fresh page for it instead of orphaning the header at
      // the very bottom of the previous one.
      if (cursorY + 20 > pageHeight - bottomMargin) {
        doc.addPage();
        cursorY = addPdfRunningHeader(doc, headerInfo);
      }

      doc.setFontSize(10);
      doc.setFont(undefined, "bold");
      doc.text(
        `${entry.documentNumber}   ·   ${entry.entryDate}   ·   ${documentTypeLabel(entry)}`,
        14,
        cursorY
      );
      doc.setFont(undefined, "normal");
      cursorY += 5;

      if (entry.description) {
        doc.setFontSize(9);
        doc.setTextColor(80);
        doc.text(entry.description, 14, cursorY);
        doc.setTextColor(0);
        cursorY += 5;
      }

      if (entry.annulled) {
        doc.setFontSize(9);
        doc.setTextColor(185, 28, 28);
        doc.text(`${t.annulled}${entry.annulmentReason ? `: ${entry.annulmentReason}` : ""}`, 14, cursorY);
        doc.setTextColor(0);
        cursorY += 5;
      }

      const body = (entry.items || []).map((item) => [
        `${item.accountCode} - ${item.accountName}`,
        item.thirdPartyName || "—",
        item.costCenterName || "—",
        money(item.debit),
        money(item.credit),
      ]);
      body.push([t.totalsRow, "", "", money(totalDebit), money(totalCredit)]);

      const pageBeforeTable = doc.internal.getCurrentPageInfo().pageNumber;

      autoTable(doc, {
        startY: cursorY,
        head: [[t.account, t.thirdParty, t.costCenter, t.debit, t.credit]],
        body,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [30, 41, 59] },
        columnStyles: { 3: { halign: "right" }, 4: { halign: "right" } },
        margin: { top: 20, bottom: bottomMargin },
        didDrawPage: (data) => {
          if (data.pageNumber > pageBeforeTable) {
            addPdfRunningHeader(doc, headerInfo);
          }
        },
      });

      cursorY = doc.lastAutoTable.finalY + 8;
    });

    const { totalDebit: grandDebit, totalCredit: grandCredit } = grandTotals();
    if (cursorY + 10 > pageHeight - bottomMargin) {
      doc.addPage();
      cursorY = addPdfRunningHeader(doc, headerInfo);
    }
    doc.setFontSize(10);
    doc.setFont(undefined, "bold");
    doc.text(`${t.grandTotal}:   ${t.debit} ${money(grandDebit)}   |   ${t.credit} ${money(grandCredit)}`, 14, cursorY);
    doc.setFont(undefined, "normal");

    doc.save(`${exportFileStem()}.pdf`);
    setExporting(false);
  };

  const { totalDebit: screenGrandDebit, totalCredit: screenGrandCredit } = hasData
    ? grandTotals()
    : { totalDebit: 0, totalCredit: 0 };

  return (
    <div className="space-y-6 p-4">
      <AppHeader title={t.title} subtitle={t.subtitle} tenantId={activeTenantId} />

      <form
        onSubmit={handleGenerate}
        className="flex flex-wrap items-end gap-4 rounded-xl border border-gray-100 bg-white p-5 shadow-sm"
      >
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {t.startDate}
          </label>
          <input
            type="date"
            max={today}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {t.endDate}
          </label>
          <input
            type="date"
            max={today}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {t.documentType}
          </label>
          <select
            value={documentTypeId}
            onChange={(e) => setDocumentTypeId(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
          >
            <option value="">{t.allDocumentTypes}</option>
            {documentTypes.map((dt) => (
              <option key={dt.id} value={dt.id}>
                {dt.code} - {dt.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {t.status}
          </label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
          >
            <option value="ALL">{t.statusAll}</option>
            <option value="ACTIVE">{t.statusActive}</option>
            <option value="ANNULLED">{t.statusAnnulled}</option>
          </select>
        </div>

        <Button type="submit" variant="primary" loading={loading}>
          {loading ? t.generating : t.generate}
        </Button>
      </form>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {entries !== null && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-400">
              {activeTenantId && <strong className="text-slate-500">{activeTenantId}</strong>}
              {activeTenantId && " — "}
              {reportPeriodLabel()}
              {`   ·   ${statusFilterLabel()}`}
              {hasData && `   ·   ${t.entriesCount}: ${displayedEntries.length}`}
            </p>

            {hasData && (
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={handleExportExcel} disabled={exporting}>
                  {t.exportExcel}
                </Button>
                <Button variant="secondary" size="sm" onClick={handleExportPdf} disabled={exporting}>
                  {t.exportPdf}
                </Button>
              </div>
            )}
          </div>

          {!hasData && (
            <div className="rounded-xl border border-gray-100 bg-white p-10 text-center text-slate-400 shadow-sm">
              {hasRawData ? t.noResultsFiltered : t.noResults}
            </div>
          )}

          {hasData && (
            <div className="space-y-4">
              {displayedEntries.map((entry) => {
                const { totalDebit, totalCredit } = entryTotals(entry);
                return (
                  <div
                    key={entry.id}
                    className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm"
                  >
                    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <span className="font-black text-slate-800">{entry.documentNumber}</span>
                        <span className="ml-2 text-sm text-slate-500">
                          {entry.entryDate} · {documentTypeLabel(entry)}
                        </span>
                        {entry.description && (
                          <span className="ml-2 text-sm text-slate-400">— {entry.description}</span>
                        )}
                      </div>
                    </div>

                    {entry.annulled && (
                      <div className="mb-3 rounded-lg bg-red-50 px-4 py-2 text-xs text-red-700">
                        <b>{t.annulled}</b>{entry.annulmentReason ? `: ${entry.annulmentReason}` : ""}
                      </div>
                    )}

                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          <th className="px-3 py-2">{t.account}</th>
                          <th className="px-3 py-2">{t.thirdParty}</th>
                          <th className="px-3 py-2">{t.costCenter}</th>
                          <th className="px-3 py-2 text-right">{t.debit}</th>
                          <th className="px-3 py-2 text-right">{t.credit}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {(entry.items || []).map((item) => (
                          <tr key={item.id}>
                            <td className="px-3 py-2 text-slate-700">
                              {item.accountCode} - {item.accountName}
                            </td>
                            <td className="px-3 py-2 text-xs text-slate-500">{item.thirdPartyName || "—"}</td>
                            <td className="px-3 py-2 text-xs text-slate-500">{item.costCenterName || "—"}</td>
                            <td className="px-3 py-2 text-right text-slate-700">{money(item.debit)}</td>
                            <td className="px-3 py-2 text-right text-slate-700">{money(item.credit)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t font-bold text-slate-700">
                          <td className="px-3 py-2" colSpan={3}>
                            {t.totalsRow}
                          </td>
                          <td className="px-3 py-2 text-right">{money(totalDebit)}</td>
                          <td className="px-3 py-2 text-right">{money(totalCredit)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                );
              })}

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm font-black text-slate-700">
                <div className="flex justify-between">
                  <span>{t.grandTotal}</span>
                  <span>
                    {t.debit} {money(screenGrandDebit)} &nbsp;|&nbsp; {t.credit} {money(screenGrandCredit)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default JournalBookPage;
