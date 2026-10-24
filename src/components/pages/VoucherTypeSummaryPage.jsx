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

// NEW (2026-10-24, user request): "Consolidado por Tipo de Comprobante"
// (a.k.a. "Resumen de Comprobantes por Fuente") for the Libros Legales
// submenu. For each document type with movement in a date range, shows
// the range of consecutive numbers actually issued, the list of
// vouchers, and debit/credit subtotals, plus a final consolidated
// summary across all types.
//
// Two decisions the user made explicitly when this was specified (see
// session discussion, 2026-10-24):
//   1. The consecutive RANGE (N° Inicial / N° Final) per type ALWAYS
//      includes annulled vouchers, regardless of the "Incluir Documentos
//      Anulados" checkbox below -- a consecutive is spent the moment
//      it's assigned; annulling the voucher later doesn't give the
//      number back, so excluding annulled ones from the range would hide
//      real gaps in the numbering an auditor needs to be able to
//      explain. The checkbox only controls whether annulled vouchers
//      show up in each type's voucher list/subtotal/count -- it
//      defaults to CHECKED (showing everything) since that's the normal
//      "para control" use of this report.
//   2. The "Tercero Principal / Detalle" column uses the voucher's own
//      description when it has one, otherwise the third party of its
//      first line that has one -- see thirdPartyLabel()/detailLabel() below.
//
// Pure frontend report, same "fetch everything in the date range, then
// group/compute client-side" pattern already used by JournalBookPage.jsx
// -- reuses GET /v1/journal-entries (whose response now also carries
// each entry's own numeric `consecutive`, added specifically so this
// report can find the lowest/highest one used per type without having
// to string-parse documentNumber) and GET /v1/document-types for each
// type's code/name/prefix.
function VoucherTypeSummaryPage({ language = "es" }) {
  const today = todayLocalIso();
  const firstOfMonth = `${today.slice(0, 7)}-01`;

  const [startDate, setStartDate] = useState(firstOfMonth);
  const [endDate, setEndDate] = useState(today);
  const [documentTypeId, setDocumentTypeId] = useState("");
  const [includeAnnulled, setIncludeAnnulled] = useState(true);

  const [documentTypes, setDocumentTypes] = useState([]);
  const [entries, setEntries] = useState(null); // null = not generated yet
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);

  const { session } = useAuth();
  const activeTenantId = session.companyName || session.companyId;

  const t = {
    es: {
      title: "Consolidado por Tipo de Comprobante",
      subtitle: "Totales de movimiento y rango de consecutivos usados por cada tipo de documento, en un rango de fechas",
      startDate: "Fecha Inicial",
      endDate: "Fecha Final",
      documentType: "Tipo de Documento",
      allDocumentTypes: "— Todos los tipos —",
      includeAnnulled: "Incluir Documentos Anulados",
      generate: "Generar",
      generating: "Generando...",
      dateRequired: "Selecciona la fecha inicial y la fecha final para generar el reporte.",
      dateRangeInvalid: "La fecha final no puede ser anterior a la fecha inicial.",
      noResults: "No hay comprobantes contabilizados en ese rango de fechas.",
      date: "Fecha",
      document: "Número de Comprobante",
      thirdParty: "Tercero",
      detail: "Detalle",
      debit: "Total Débito",
      credit: "Total Crédito",
      totalsRow: "Subtotal",
      grandTotal: "Total General",
      annulled: "Anulado",
      generatedAt: "Generado",
      errorConn: "Error de conexión con el servidor.",
      exportExcel: "Exportar Excel",
      exportPdf: "Exportar PDF",
      exportTitle: "Consolidado por Tipo de Comprobante",
      exporting: "Exportando...",
      consecutiveRange: "Consecutivos",
      rangeTo: "al",
      noConsecutives: "Sin consecutivos en el período",
      documentCount: "Cantidad de Documentos",
      summaryTitle: "Resumen General",
      summaryCode: "Código",
      summaryName: "Tipo de Documento",
      prefixLabel: "Prefijo",
      noDocType: "—",
    },
    en: {
      title: "Voucher Type Summary",
      subtitle: "Movement totals and consecutive ranges used per document type, in a date range",
      startDate: "Start Date",
      endDate: "End Date",
      documentType: "Document Type",
      allDocumentTypes: "— All types —",
      includeAnnulled: "Include Annulled Vouchers",
      generate: "Generate",
      generating: "Generating...",
      dateRequired: "Select a start date and an end date to generate the report.",
      dateRangeInvalid: "End date can't be before start date.",
      noResults: "No vouchers were posted in that date range.",
      date: "Date",
      document: "Voucher Number",
      thirdParty: "Third Party",
      detail: "Detail",
      debit: "Total Debit",
      credit: "Total Credit",
      totalsRow: "Subtotal",
      grandTotal: "Grand Total",
      annulled: "Voided",
      generatedAt: "Generated",
      errorConn: "Server connection error.",
      exportExcel: "Export to Excel",
      exportPdf: "Export to PDF",
      exportTitle: "Voucher Type Summary",
      exporting: "Exporting...",
      consecutiveRange: "Consecutive Numbers",
      rangeTo: "to",
      noConsecutives: "No consecutive numbers in the period",
      documentCount: "Document Count",
      summaryTitle: "Grand Summary",
      summaryCode: "Code",
      summaryName: "Document Type",
      prefixLabel: "Prefix",
      noDocType: "—",
    },
  }[language];

  const money = (n) =>
    (Number.isFinite(n) ? n : 0).toLocaleString(language === "es" ? "es-CO" : "en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  // Same shape JournalBookPage.jsx already fetches this from -- flat
  // array, tenant-scoped, active types only (see that endpoint's own
  // scoping; a deactivated type with historical movement in the period
  // still groups correctly below, it just falls back to t.noDocType for
  // its code/name since it won't be in this list).
  useEffect(() => {
    api
      .get("/v1/document-types")
      .then((res) => {
        const data = res.data?.data ?? res.data;
        setDocumentTypes(Array.isArray(data) ? data : []);
      })
      .catch(() => setDocumentTypes([]));
  }, []);

  const findDocType = (id) => documentTypes.find((d) => String(d.id) === String(id));

  const entryTotals = (entry) => {
    const totalDebit = (entry.items || []).reduce((s, i) => s + (i.debit || 0), 0);
    const totalCredit = (entry.items || []).reduce((s, i) => s + (i.credit || 0), 0);
    return { totalDebit, totalCredit };
  };

  // "Tercero Principal / Detalle": the voucher's own description when it
  // has one, otherwise the third party of its first line that carries
  // one -- see the file-level comment above for why (user's explicit
  // choice over always using the first line's third party, or listing
  // every distinct one).
  // FIX (2026-10-24, user-reported): a single combined "Tercero /
  // Detalle" column left no room to show both once the third party is
  // shown too (see the earlier fix right above this one in git history)
  // -- split into two separate columns instead. Tercero: the first
  // line's third party, if any. Detalle: the voucher's own description,
  // independent of whether it has a third party or not.
  const thirdPartyLabel = (entry) => {
    const withThirdParty = (entry.items || []).find((i) => i.thirdPartyName);
    return withThirdParty ? withThirdParty.thirdPartyName : "—";
  };

  const detailLabel = (entry) =>
    entry.description && entry.description.trim() ? entry.description : "—";

  const handleGenerate = async (e) => {
    e.preventDefault();
    setError(null);

    if (!startDate || !endDate) {
      setError(t.dateRequired);
      return;
    }
    if (endDate < startDate) {
      setError(t.dateRangeInvalid);
      return;
    }

    setLoading(true);
    setEntries(null);
    try {
      // Same "fetch everything matching the filters in one shot, not
      // paginated" pattern already used by JournalBookPage.jsx -- always
      // fetches BOTH annulled and non-annulled entries (the backend has
      // no annulled filter param), since the consecutive range below
      // needs every entry regardless of includeAnnulled.
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

  // One group per document type with ANY movement (annulled or not) in
  // the period. firstDocNumber/lastDocNumber are computed from EVERY
  // entry of that type regardless of includeAnnulled (the consecutive
  // range decision above); `transactions`/`documentCount`/totals respect
  // the checkbox.
  const groups = useMemo(() => {
    if (!Array.isArray(entries) || entries.length === 0) return [];

    const byType = new Map();
    entries.forEach((entry) => {
      const key = String(entry.documentTypeId);
      if (!byType.has(key)) byType.set(key, []);
      byType.get(key).push(entry);
    });

    return Array.from(byType.entries())
      .map(([key, allForType]) => {
        const docType = findDocType(key);

        const withConsecutive = allForType.filter((e) => e.consecutive != null);
        let firstDocNumber = null;
        let lastDocNumber = null;
        if (withConsecutive.length) {
          const minEntry = withConsecutive.reduce((a, b) => (a.consecutive <= b.consecutive ? a : b));
          const maxEntry = withConsecutive.reduce((a, b) => (a.consecutive >= b.consecutive ? a : b));
          firstDocNumber = minEntry.documentNumber;
          lastDocNumber = maxEntry.documentNumber;
        }

        const shown = (includeAnnulled ? allForType : allForType.filter((e) => !e.annulled))
          .slice()
          .sort((a, b) => {
            if (a.entryDate !== b.entryDate) return a.entryDate < b.entryDate ? -1 : 1;
            return (a.consecutive || 0) - (b.consecutive || 0);
          });

        let totalDebit = 0;
        let totalCredit = 0;
        shown.forEach((entry) => {
          const { totalDebit: d, totalCredit: c } = entryTotals(entry);
          totalDebit += d;
          totalCredit += c;
        });

        return {
          key,
          code: docType?.code || t.noDocType,
          name: docType?.name || t.noDocType,
          prefix: docType?.prefix || "",
          firstDocNumber,
          lastDocNumber,
          transactions: shown,
          documentCount: shown.length,
          totalDebit,
          totalCredit,
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, documentTypes, includeAnnulled]);

  const hasData = groups.length > 0;

  const grandTotals = useMemo(
    () =>
      groups.reduce(
        (acc, g) => ({
          documentCount: acc.documentCount + g.documentCount,
          totalDebit: acc.totalDebit + g.totalDebit,
          totalCredit: acc.totalCredit + g.totalCredit,
        }),
        { documentCount: 0, totalDebit: 0, totalCredit: 0 }
      ),
    [groups]
  );

  const reportPeriodLabel = () => `${startDate} — ${endDate}`;
  const exportFileStem = () => `${t.exportTitle.replace(/\s+/g, "_")}_${startDate}_${endDate}`;

  const groupHeaderLabel = (g) => {
    const base = `${g.code} - ${g.name}`;
    return g.prefix ? `${base} (${t.prefixLabel}: ${g.prefix})` : base;
  };

  const consecutiveRangeLabel = (g) => {
    if (!g.firstDocNumber || !g.lastDocNumber) return t.noConsecutives;
    if (g.firstDocNumber === g.lastDocNumber) return `${t.consecutiveRange}: ${g.firstDocNumber}`;
    return `${t.consecutiveRange}: ${g.firstDocNumber} ${t.rangeTo} ${g.lastDocNumber}`;
  };

  const handleExportExcel = () => {
    if (!hasData) return;
    setExporting(true);
    try {
      const headerInfo = {
        companyName: activeTenantId,
        reportTitle: t.exportTitle,
        period: reportPeriodLabel(),
        generatedAtLabel: t.generatedAt,
        generatedAt: nowLocalIso(),
      };

      const rows = [...buildExcelHeaderRows(headerInfo)];

      groups.forEach((g) => {
        rows.push([groupHeaderLabel(g)]);
        rows.push([consecutiveRangeLabel(g)]);
        rows.push([t.date, t.document, t.thirdParty, t.detail, t.debit, t.credit]);
        g.transactions.forEach((entry) => {
          const { totalDebit, totalCredit } = entryTotals(entry);
          rows.push([
            entry.entryDate,
            entry.annulled ? `${entry.documentNumber} (${t.annulled.toUpperCase()})` : entry.documentNumber,
            thirdPartyLabel(entry),
            detailLabel(entry),
            totalDebit,
            totalCredit,
          ]);
        });
        rows.push([t.totalsRow, "", "", "", g.totalDebit, g.totalCredit]);
        rows.push([]);
      });

      rows.push([t.summaryTitle]);
      rows.push([t.summaryCode, t.summaryName, t.documentCount, t.debit, t.credit]);
      groups.forEach((g) => {
        rows.push([g.code, g.name, g.documentCount, g.totalDebit, g.totalCredit]);
      });
      rows.push([t.grandTotal, "", grandTotals.documentCount, grandTotals.totalDebit, grandTotals.totalCredit]);

      const sheet = XLSX.utils.aoa_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, t.exportTitle.slice(0, 31));
      XLSX.writeFile(workbook, `${exportFileStem()}.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = () => {
    if (!hasData) return;
    setExporting(true);
    try {
      const doc = new jsPDF({ orientation: "landscape" });
      const pageHeight = doc.internal.pageSize.getHeight();
      const bottomMargin = 15;
      const minGroupSpace = 35;

      const headerInfo = {
        companyName: activeTenantId,
        reportTitle: t.exportTitle,
        period: reportPeriodLabel(),
        generatedAtLabel: t.generatedAt,
        generatedAt: nowLocalIso(),
      };

      let isFirstPage = true;
      const drawPageHeader = () => {
        if (isFirstPage) {
          isFirstPage = false;
          return addPdfReportHeader(doc, headerInfo);
        }
        return addPdfRunningHeader(doc, headerInfo);
      };

      let cursorY = drawPageHeader();

      groups.forEach((g) => {
        if (cursorY + minGroupSpace > pageHeight - bottomMargin) {
          doc.addPage();
          cursorY = drawPageHeader();
        }

        doc.setFontSize(11);
        doc.setFont(undefined, "bold");
        doc.text(groupHeaderLabel(g), 14, cursorY);
        doc.setFont(undefined, "normal");
        doc.setFontSize(9);
        doc.text(consecutiveRangeLabel(g), 14, cursorY + 6);

        const body = g.transactions.map((entry) => {
          const { totalDebit, totalCredit } = entryTotals(entry);
          return [
            entry.entryDate,
            entry.annulled ? `${entry.documentNumber} (${t.annulled.toUpperCase()})` : entry.documentNumber,
            thirdPartyLabel(entry),
            detailLabel(entry),
            money(totalDebit),
            money(totalCredit),
          ];
        });
        body.push([t.totalsRow, "", "", "", money(g.totalDebit), money(g.totalCredit)]);

        const pageBeforeTable = doc.internal.getCurrentPageInfo().pageNumber;

        autoTable(doc, {
          startY: cursorY + 10,
          head: [[t.date, t.document, t.thirdParty, t.detail, t.debit, t.credit]],
          body,
          styles: { fontSize: 8 },
          headStyles: { fillColor: [30, 41, 59] },
          columnStyles: { 2: { cellWidth: 35 }, 3: { cellWidth: 45 }, 4: { halign: "right" }, 5: { halign: "right" } },
          margin: { top: 20, bottom: bottomMargin },
          didDrawPage: (data) => {
            if (data.pageNumber > pageBeforeTable) {
              drawPageHeader();
            }
          },
        });

        cursorY = doc.lastAutoTable.finalY + 8;
      });

      // Resumen General -- same "start a fresh page if there isn't room"
      // guard as every group above.
      if (cursorY + minGroupSpace > pageHeight - bottomMargin) {
        doc.addPage();
        cursorY = drawPageHeader();
      }
      doc.setFontSize(11);
      doc.setFont(undefined, "bold");
      doc.text(t.summaryTitle, 14, cursorY);
      doc.setFont(undefined, "normal");

      const summaryBody = groups.map((g) => [
        g.code,
        g.name,
        String(g.documentCount),
        money(g.totalDebit),
        money(g.totalCredit),
      ]);
      summaryBody.push([
        t.grandTotal,
        "",
        String(grandTotals.documentCount),
        money(grandTotals.totalDebit),
        money(grandTotals.totalCredit),
      ]);

      const pageBeforeSummary = doc.internal.getCurrentPageInfo().pageNumber;

      autoTable(doc, {
        startY: cursorY + 6,
        head: [[t.summaryCode, t.summaryName, t.documentCount, t.debit, t.credit]],
        body: summaryBody,
        styles: { fontSize: 9 },
        headStyles: { fillColor: [30, 41, 59] },
        columnStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
        margin: { top: 20, bottom: bottomMargin },
        didDrawPage: (data) => {
          if (data.pageNumber > pageBeforeSummary) {
            drawPageHeader();
          }
        },
      });

      doc.save(`${exportFileStem()}.pdf`);
    } finally {
      setExporting(false);
    }
  };

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
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex min-w-[260px] flex-col gap-1">
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

        <label className="flex items-center gap-2 pb-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={includeAnnulled}
            onChange={(e) => setIncludeAnnulled(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          {t.includeAnnulled}
        </label>

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
            </p>

            {hasData && (
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={handleExportExcel} disabled={exporting}>
                  {exporting ? t.exporting : t.exportExcel}
                </Button>
                <Button variant="secondary" size="sm" onClick={handleExportPdf} disabled={exporting}>
                  {exporting ? t.exporting : t.exportPdf}
                </Button>
              </div>
            )}
          </div>

          {!hasData && (
            <div className="rounded-xl border border-gray-100 bg-white p-10 text-center text-slate-400 shadow-sm">
              {t.noResults}
            </div>
          )}

          {groups.map((g) => (
            <div
              key={g.key}
              className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-slate-50 px-5 py-4">
                <div>
                  <span className="font-bold text-slate-700">{g.code}</span>{" "}
                  <span className="text-slate-600">{g.name}</span>
                  {g.prefix && (
                    <span className="ml-2 text-xs text-slate-400">
                      ({t.prefixLabel}: {g.prefix})
                    </span>
                  )}
                </div>
                <div className="text-right text-xs text-slate-500">
                  <div>{consecutiveRangeLabel(g)}</div>
                  <div>
                    {t.documentCount}: {g.documentCount}
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="px-4 py-3">{t.date}</th>
                      <th className="px-4 py-3">{t.document}</th>
                      <th className="px-4 py-3">{t.thirdParty}</th>
                      <th className="px-4 py-3">{t.detail}</th>
                      <th className="px-4 py-3 text-right">{t.debit}</th>
                      <th className="px-4 py-3 text-right">{t.credit}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {g.transactions.map((entry) => {
                      const { totalDebit, totalCredit } = entryTotals(entry);
                      return (
                        <tr
                          key={entry.id}
                          className={`hover:bg-slate-50/60 ${entry.annulled ? "bg-red-50/40" : ""}`}
                        >
                          <td className="px-4 py-2.5 text-slate-600">{entry.entryDate}</td>
                          <td className="px-4 py-2.5 text-slate-600">
                            <div className="flex items-center gap-2">
                              <span>{entry.documentNumber}</span>
                              {entry.annulled && (
                                <span className="rounded-full bg-red-100 px-2 py-0.5 text-[9px] font-bold uppercase text-red-700">
                                  {t.annulled}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-slate-500">{thirdPartyLabel(entry)}</td>
                          <td className="px-4 py-2.5 text-slate-500">{detailLabel(entry)}</td>
                          <td className="px-4 py-2.5 text-right text-slate-700">{money(totalDebit)}</td>
                          <td className="px-4 py-2.5 text-right text-slate-700">{money(totalCredit)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-slate-50 font-semibold text-slate-700">
                      <td className="px-4 py-3" colSpan={4}>
                        {t.totalsRow}
                      </td>
                      <td className="px-4 py-3 text-right">{money(g.totalDebit)}</td>
                      <td className="px-4 py-3 text-right">{money(g.totalCredit)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ))}

          {hasData && (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 bg-slate-50 px-5 py-4">
                <span className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                  {t.summaryTitle}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="px-4 py-3">{t.summaryCode}</th>
                      <th className="px-4 py-3">{t.summaryName}</th>
                      <th className="px-4 py-3 text-right">{t.documentCount}</th>
                      <th className="px-4 py-3 text-right">{t.debit}</th>
                      <th className="px-4 py-3 text-right">{t.credit}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {groups.map((g) => (
                      <tr key={g.key}>
                        <td className="px-4 py-2.5 font-bold text-slate-700">{g.code}</td>
                        <td className="px-4 py-2.5 text-slate-600">{g.name}</td>
                        <td className="px-4 py-2.5 text-right text-slate-700">{g.documentCount}</td>
                        <td className="px-4 py-2.5 text-right text-slate-700">{money(g.totalDebit)}</td>
                        <td className="px-4 py-2.5 text-right text-slate-700">{money(g.totalCredit)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-slate-50 font-black text-slate-800">
                      <td className="px-4 py-3" colSpan={2}>
                        {t.grandTotal}
                      </td>
                      <td className="px-4 py-3 text-right">{grandTotals.documentCount}</td>
                      <td className="px-4 py-3 text-right">{money(grandTotals.totalDebit)}</td>
                      <td className="px-4 py-3 text-right">{money(grandTotals.totalCredit)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default VoucherTypeSummaryPage;
