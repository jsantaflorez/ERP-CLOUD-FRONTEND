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
  formatGeneratedAt,
  todayLocalIso,
} from "../../utils/reportExport";

// NEW (2026-10-16): "Informe Detallado de Impuestos y Retenciones" --
// replaces what would otherwise be one report per Tax category. The
// user asked explicitly to unify IVA, Retenciones, Impoconsumo and any
// future tax into a single consolidated screen instead of building a
// separate "Informe de IVA" (Fase 3, never built) alongside the
// Retention-only report built earlier the same day (also discarded,
// uncommitted, in favor of this one). Categoria (RETENCION/IVA/OTRO) is
// just another optional filter here, same pattern as Tipo/Tercero --
// "Todas" shows every tax-linked line regardless of category.
//
// The Tipo dropdown is populated from whatever Tax rows the company's
// own catalog actually has (filtered by the chosen Categoria, if any),
// never a hardcoded list -- same extensibility principle as the
// 2026-10-15 TaxPage.jsx redesign and the Retention report it replaces.
function TaxDetailPage({ language = "es" }) {
  const today = todayLocalIso();
  const firstOfMonth = `${today.slice(0, 7)}-01`;

  const [startDate, setStartDate] = useState(firstOfMonth);
  const [endDate, setEndDate] = useState(today);
  const [category, setCategory] = useState(""); // "" = todas las categorias
  const [taxType, setTaxType] = useState(""); // "" = todos los tipos
  const [thirdPartyId, setThirdPartyId] = useState(""); // "" = todos los terceros

  const [taxes, setTaxes] = useState([]);
  const [thirdParties, setThirdParties] = useState([]);
  const [loadingCatalogs, setLoadingCatalogs] = useState(false);

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { session } = useAuth();
  const activeTenantId = session.companyName || session.companyId;

  const t = {
    es: {
      title: "Informe Detallado de Impuestos y Retenciones",
      subtitle: "IVA, Retenciones, Impoconsumo y cualquier otro impuesto -- un solo reporte para liquidar declaraciones y validar bases antes de certificar",
      startDate: "Fecha Inicial",
      endDate: "Fecha Final",
      category: "Categoría",
      allCategories: "— Todas las categorías —",
      categories: { RETENCION: "Retención", IVA: "IVA", OTRO: "Otro Impuesto" },
      taxType: "Tipo de Impuesto",
      allTypes: "— Todos los tipos —",
      thirdParty: "Tercero",
      allThirdParties: "— Todos los terceros —",
      generate: "Generar",
      generating: "Generando...",
      dateRequired: "Selecciona ambas fechas para generar el reporte.",
      endBeforeStart: "La fecha final no puede ser anterior a la fecha inicial.",
      noResults: "No hay movimientos con impuesto para los filtros seleccionados.",
      date: "Fecha",
      document: "Comprobante",
      thirdPartyCol: "Tercero",
      detail: "Detalle",
      account: "Cuenta",
      categoryType: "Categoría / Tipo",
      taxBase: "Base Gravable",
      rate: "Tarifa",
      taxValue: "Valor Impuesto",
      totalsRow: "Totales",
      totalRecords: "Registros",
      generatedAt: "Generado",
      errorConn: "Error de conexión con el servidor.",
      subtotalsByType: "Subtotales por Categoría / Tipo",
      records: "Registros",
      exportExcel: "Exportar Excel",
      exportPdf: "Exportar PDF",
      pdfReportTitle: "Informe Detallado de Impuestos y Retenciones",
      pdfPeriod: "Período",
      filterSummaryCategory: "Categoría",
      filterSummaryType: "Tipo",
      filterSummaryThirdParty: "Tercero",
      filterSummaryAll: "Todas",
    },
    en: {
      title: "Tax & Withholding Detail Report",
      subtitle: "VAT, Withholdings, and any other tax -- one report to file declarations and validate bases before issuing certificates",
      startDate: "Start Date",
      endDate: "End Date",
      category: "Category",
      allCategories: "— All categories —",
      categories: { RETENCION: "Withholding", IVA: "VAT", OTRO: "Other Tax" },
      taxType: "Tax Type",
      allTypes: "— All types —",
      thirdParty: "Third Party",
      allThirdParties: "— All third parties —",
      generate: "Generate",
      generating: "Generating...",
      dateRequired: "Select both dates to generate the report.",
      endBeforeStart: "End date can't be before start date.",
      noResults: "No tax-linked movements found for the selected filters.",
      date: "Date",
      document: "Voucher",
      thirdPartyCol: "Third Party",
      detail: "Detail",
      account: "Account",
      categoryType: "Category / Type",
      taxBase: "Taxable Base",
      rate: "Rate",
      taxValue: "Tax Value",
      totalsRow: "Totals",
      totalRecords: "Records",
      generatedAt: "Generated",
      errorConn: "Server connection error.",
      subtotalsByType: "Subtotals by Category / Type",
      records: "Records",
      exportExcel: "Export Excel",
      exportPdf: "Export PDF",
      pdfReportTitle: "Tax Detail Report",
      pdfPeriod: "Period",
      filterSummaryCategory: "Category",
      filterSummaryType: "Type",
      filterSummaryThirdParty: "Third Party",
      filterSummaryAll: "All",
    },
  }[language];

  const loadCatalogs = async () => {
    setLoadingCatalogs(true);
    try {
      const [taxRes, tpRes] = await Promise.allSettled([
        api.get("/v1/taxes"),
        api.get("/v1/third-parties?page=0&size=1000"),
      ]);

      if (taxRes.status === "fulfilled" && taxRes.value.data?.success) {
        setTaxes(Array.isArray(taxRes.value.data.data) ? taxRes.value.data.data : []);
      }

      if (tpRes.status === "fulfilled") {
        // ThirdPartyController#list returns the Spring Page<> directly,
        // not wrapped in the usual ApiResponse envelope -- same fallback
        // chain used elsewhere (JournalEntryPage.jsx, AuxiliaryLedgerPage.jsx).
        const raw = tpRes.value.data;
        const list = Array.isArray(raw?.content)
          ? raw.content
          : Array.isArray(raw?.data)
          ? raw.data
          : Array.isArray(raw)
          ? raw
          : [];
        setThirdParties(list.filter((tp) => tp.active));
      }
    } catch (err) {
      console.error("Failed to load filters for tax detail report", err);
    } finally {
      setLoadingCatalogs(false);
    }
  };

  useEffect(() => {
    loadCatalogs();
  }, []);

  // Never a hardcoded list (see file-level comment) -- only the tax
  // types the company's own catalog actually has in use, narrowed to
  // the chosen Categoria (if any), deduplicated and alphabetized. If
  // the Categoria filter changes to something that no longer has the
  // currently-selected Tipo, the effect below clears it rather than
  // silently sending a stale/invalid combination to the backend.
  const availableTaxTypes = useMemo(() => {
    const scoped = category ? taxes.filter((tx) => tx.category === category) : taxes;
    return Array.from(new Set(scoped.map((tx) => tx.type))).sort();
  }, [taxes, category]);

  useEffect(() => {
    if (taxType && !availableTaxTypes.includes(taxType)) {
      setTaxType("");
    }
  }, [availableTaxTypes, taxType]);

  const formatAmount = (value) => {
    const num = Number(value);
    if (!value || Number.isNaN(num) || num === 0) return "";
    return num.toLocaleString(language === "es" ? "es-CO" : "en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const rawAmount = (value) => {
    const num = Number(value);
    return !value || Number.isNaN(num) ? 0 : num;
  };

  const formatRate = (value) => {
    const num = Number(value);
    if (Number.isNaN(num)) return "";
    // Up to 4 decimals, trimmed (11.0000 -> 11, 0.6900 -> 0.69), to
    // match how TaxPage.jsx itself stores/shows the rate.
    return `${parseFloat(num.toFixed(4))}%`;
  };

  const categoryLabel = (value) => (value ? t.categories[value] || value : "");

  const categoryTypeLabel = (line) =>
    line.taxType ? `${line.taxType} (${categoryLabel(line.taxCategory)})` : categoryLabel(line.taxCategory);

  const handleGenerate = async (e) => {
    e.preventDefault();
    setError(null);

    if (!startDate || !endDate) {
      setError(t.dateRequired);
      return;
    }
    if (endDate < startDate) {
      setError(t.endBeforeStart);
      return;
    }

    const selectedThirdParty = thirdPartyId
      ? thirdParties.find((tp) => String(tp.id) === String(thirdPartyId))
      : null;

    const params = { startDate, endDate };
    if (category) params.category = category;
    if (taxType) params.taxType = taxType;
    if (selectedThirdParty) params.thirdPartyDocument = selectedThirdParty.documentNumber;

    setLoading(true);
    setReport(null);
    try {
      const response = await api.get("/v1/reports/tax-detail", { params });
      if (response.data && response.data.success) {
        setReport(response.data.data);
      } else {
        setError(response.data?.message || t.errorConn);
      }
    } catch (err) {
      setError(getApiErrorMessage(err, language, t.errorConn));
    } finally {
      setLoading(false);
    }
  };

  const reportPeriodLabel = () => {
    const categoryFilterLabel = report?.categoryFilter ? categoryLabel(report.categoryFilter) : t.filterSummaryAll;
    const typeLabel = report?.taxTypeFilter ? report.taxTypeFilter : t.filterSummaryAll;
    const tpLabel = report?.thirdPartyDocumentFilter
      ? `${report.thirdPartyDocumentFilter} - ${report.thirdPartyNameFilter || ""}`
      : t.filterSummaryAll;
    return `${t.pdfPeriod}: ${report?.startDate || startDate} – ${report?.endDate || endDate}   |   ${t.filterSummaryCategory}: ${categoryFilterLabel}   |   ${t.filterSummaryType}: ${typeLabel}   |   ${t.filterSummaryThirdParty}: ${tpLabel}`;
  };

  const exportFileStem = () => {
    const range = `${report?.startDate || startDate}_a_${report?.endDate || endDate}`;
    return `${t.pdfReportTitle.replace(/\s+/g, "_")}_${range}`;
  };

  const handleExportExcel = () => {
    if (!report?.lines?.length) return;

    const headerInfo = {
      companyName: report.companyName,
      reportTitle: t.pdfReportTitle,
      period: reportPeriodLabel(),
      generatedAtLabel: t.generatedAt,
      generatedAt: report.generatedAt,
    };

    const rows = [
      ...buildExcelHeaderRows(headerInfo),
      [
        t.date,
        t.document,
        t.thirdPartyCol,
        t.detail,
        t.account,
        t.categoryType,
        t.taxBase,
        t.rate,
        t.taxValue,
      ],
      ...report.lines.map((line) => [
        line.entryDate,
        line.documentNumber,
        `${line.thirdPartyDocument || ""} - ${line.thirdPartyName || ""}`,
        line.detail || "",
        `${line.accountCode || ""} - ${line.accountName || ""}`,
        categoryTypeLabel(line),
        rawAmount(line.taxBase),
        rawAmount(line.taxRate),
        rawAmount(line.taxValue),
      ]),
      [
        t.totalsRow,
        "",
        "",
        "",
        "",
        "",
        rawAmount(report.totalBase),
        "",
        rawAmount(report.totalValue),
      ],
      [],
      [t.subtotalsByType],
      [t.category, t.taxType, t.records, t.taxBase, t.taxValue],
      ...(report.subtotalsByType || []).map((s) => [
        categoryLabel(s.taxCategory),
        s.taxType,
        s.recordCount,
        rawAmount(s.totalBase),
        rawAmount(s.totalValue),
      ]),
    ];

    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, t.pdfReportTitle.slice(0, 31));
    XLSX.writeFile(workbook, `${exportFileStem()}.xlsx`);
  };

  const handleExportPdf = () => {
    if (!report?.lines?.length) return;

    const doc = new jsPDF({ orientation: "landscape" });
    const pageHeight = doc.internal.pageSize.getHeight();
    const bottomMargin = 15;

    const headerInfo = {
      companyName: report.companyName,
      reportTitle: t.pdfReportTitle,
      period: reportPeriodLabel(),
      generatedAtLabel: t.generatedAt,
      generatedAt: report.generatedAt,
    };

    let cursorY = addPdfReportHeader(doc, headerInfo);

    const body = report.lines.map((line) => [
      line.entryDate,
      line.documentNumber,
      `${line.thirdPartyDocument || ""} - ${line.thirdPartyName || ""}`,
      line.detail || "",
      `${line.accountCode || ""} - ${line.accountName || ""}`,
      categoryTypeLabel(line),
      formatAmount(line.taxBase),
      formatRate(line.taxRate),
      formatAmount(line.taxValue),
    ]);
    body.push([
      t.totalsRow,
      "",
      "",
      "",
      "",
      "",
      formatAmount(report.totalBase),
      "",
      formatAmount(report.totalValue),
    ]);

    const pageBeforeTable = doc.internal.getCurrentPageInfo().pageNumber;

    autoTable(doc, {
      startY: cursorY,
      head: [[t.date, t.document, t.thirdPartyCol, t.detail, t.account, t.categoryType, t.taxBase, t.rate, t.taxValue]],
      body,
      styles: { fontSize: 7.5 },
      headStyles: { fillColor: [30, 41, 59] },
      columnStyles: {
        6: { halign: "right" },
        7: { halign: "right" },
        8: { halign: "right" },
      },
      margin: { top: 20, bottom: bottomMargin },
      didParseCell: (data) => {
        if (data.section === "body" && data.row.index === body.length - 1) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [241, 245, 249];
        }
      },
      didDrawPage: (data) => {
        if (data.pageNumber > pageBeforeTable) {
          addPdfRunningHeader(doc, headerInfo);
        }
      },
    });

    if (report.subtotalsByType?.length) {
      let y = doc.lastAutoTable.finalY + 10;
      if (y + 30 > pageHeight - bottomMargin) {
        doc.addPage();
        y = addPdfRunningHeader(doc, headerInfo) + 6;
      }

      doc.setFontSize(11);
      doc.text(t.subtotalsByType, 14, y);

      autoTable(doc, {
        startY: y + 4,
        head: [[t.category, t.taxType, t.records, t.taxBase, t.taxValue]],
        body: report.subtotalsByType.map((s) => [
          categoryLabel(s.taxCategory),
          s.taxType,
          s.recordCount,
          formatAmount(s.totalBase),
          formatAmount(s.totalValue),
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [30, 41, 59] },
        columnStyles: { 3: { halign: "right" }, 4: { halign: "right" } },
        margin: { top: 20, bottom: bottomMargin },
      });
    }

    doc.save(`${exportFileStem()}.pdf`);
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

        <div className="flex min-w-[200px] flex-col gap-1">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {t.category}
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
          >
            <option value="">{t.allCategories}</option>
            {Object.keys(t.categories).map((key) => (
              <option key={key} value={key}>
                {t.categories[key]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex min-w-[220px] flex-col gap-1">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {t.taxType}
          </label>
          <select
            value={taxType}
            onChange={(e) => setTaxType(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
          >
            <option value="">{t.allTypes}</option>
            {availableTaxTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>

        <div className="flex min-w-[260px] flex-col gap-1">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {t.thirdParty}
          </label>
          <select
            value={thirdPartyId}
            onChange={(e) => setThirdPartyId(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
          >
            <option value="">{t.allThirdParties}</option>
            {thirdParties.map((tp) => (
              <option key={tp.id} value={tp.id}>
                {tp.documentNumber} — {tp.legalDisplayName}
              </option>
            ))}
          </select>
        </div>

        <Button type="submit" variant="primary" loading={loading} disabled={loadingCatalogs}>
          {loading ? t.generating : t.generate}
        </Button>
      </form>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {report && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-400">
              {report.companyName && <strong className="text-slate-500">{report.companyName}</strong>}
              {report.companyName && report.generatedAt && " — "}
              {report.generatedAt && `${t.generatedAt}: ${formatGeneratedAt(report.generatedAt)}`}
            </p>
            {report.lines?.length > 0 && (
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={handleExportExcel}>
                  {t.exportExcel}
                </Button>
                <Button variant="secondary" size="sm" onClick={handleExportPdf}>
                  {t.exportPdf}
                </Button>
              </div>
            )}
          </div>

          {(!report.lines || report.lines.length === 0) && (
            <div className="rounded-xl border border-gray-100 bg-white p-10 text-center text-slate-400 shadow-sm">
              {t.noResults}
            </div>
          )}

          {report.lines?.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="px-4 py-3">{t.date}</th>
                      <th className="px-4 py-3">{t.document}</th>
                      <th className="px-4 py-3">{t.thirdPartyCol}</th>
                      <th className="px-4 py-3">{t.detail}</th>
                      <th className="px-4 py-3">{t.account}</th>
                      <th className="px-4 py-3">{t.categoryType}</th>
                      <th className="px-4 py-3 text-right">{t.taxBase}</th>
                      <th className="px-4 py-3 text-right">{t.rate}</th>
                      <th className="px-4 py-3 text-right">{t.taxValue}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {report.lines.map((line, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/60">
                        <td className="px-4 py-2.5 text-slate-600">{line.entryDate}</td>
                        <td className="px-4 py-2.5 text-slate-600">{line.documentNumber}</td>
                        <td className="px-4 py-2.5 text-slate-600">
                          {line.thirdPartyDocument || "—"}
                          {line.thirdPartyName ? ` — ${line.thirdPartyName}` : ""}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500">{line.detail}</td>
                        <td className="px-4 py-2.5 text-slate-500">
                          {line.accountCode} — {line.accountName}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">{categoryTypeLabel(line)}</td>
                        <td className="px-4 py-2.5 text-right text-slate-700">{formatAmount(line.taxBase)}</td>
                        <td className="px-4 py-2.5 text-right text-slate-500">{formatRate(line.taxRate)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-800">
                          {formatAmount(line.taxValue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-slate-50 font-semibold text-slate-700">
                      <td className="px-4 py-3" colSpan={6}>
                        {t.totalRecords}: {report.totalRecords ?? 0}
                      </td>
                      <td className="px-4 py-3 text-right">{formatAmount(report.totalBase)}</td>
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3 text-right">{formatAmount(report.totalValue)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {report.subtotalsByType?.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
              <div className="border-b border-gray-100 bg-slate-50 px-5 py-3 text-[11px] font-black uppercase tracking-widest text-slate-400">
                {t.subtotalsByType}
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <th className="px-4 py-3">{t.category}</th>
                    <th className="px-4 py-3">{t.taxType}</th>
                    <th className="px-4 py-3 text-right">{t.records}</th>
                    <th className="px-4 py-3 text-right">{t.taxBase}</th>
                    <th className="px-4 py-3 text-right">{t.taxValue}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {report.subtotalsByType.map((s) => (
                    <tr key={`${s.taxCategory}-${s.taxType}`} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2.5 text-slate-500">{categoryLabel(s.taxCategory)}</td>
                      <td className="px-4 py-2.5 font-semibold text-slate-700">{s.taxType}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500">{s.recordCount}</td>
                      <td className="px-4 py-2.5 text-right text-slate-700">{formatAmount(s.totalBase)}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-slate-800">
                        {formatAmount(s.totalValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default TaxDetailPage;
