import { useMemo, useState } from "react";
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

// NEW (2026-10-12): hierarchical Estado de Resultados (Pérdidas y
// Ganancias) requested by the user right after closing fiscal year
// 2025, modeled after their legacy system's "PERDIDA O GANANCIA"
// report. Same indentation/bold-header rendering pattern as
// TrialBalanceDetailedPage (level + postingAccount), but with three
// independent sections (Ingresos / Gastos / Costo de Ventas) instead
// of one flat list, and a final result line whose label
// ("Utilidad antes de Impuestos" / "Pérdida antes de Impuestos") is
// derived here from the sign of netResultBeforeTaxes -- the backend
// also sends resultLabel/resultLabelEs as plain strings, but the
// profit/loss boolean and the positive magnitude are computed here
// instead of relying on the backend's derived (non-field) getters,
// which Jackson may or may not expose the same way other reports'
// plain fields are exposed.
function IncomeStatementPage({ language = "es" }) {
  const today = todayLocalIso();
  const firstOfYear = `${today.slice(0, 4)}-01-01`;

  const [startDate, setStartDate] = useState(firstOfYear);
  const [endDate, setEndDate] = useState(today);

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { session } = useAuth();
  const activeTenantId = session.companyName || session.companyId;

  const t = {
    es: {
      title: "Estado de Resultados",
      subtitle: "Pérdidas y Ganancias por rango de fechas, con desglose jerárquico del PUC",
      startDate: "Fecha Inicial",
      endDate: "Fecha Final",
      generate: "Generar",
      generating: "Generando...",
      dateRequired: "Selecciona ambas fechas para generar el reporte.",
      endBeforeStart: "La fecha final no puede ser anterior a la fecha inicial.",
      noResults: "No hay movimientos de Ingresos, Gastos o Costos en este periodo.",
      accountCode: "Código",
      accountName: "Cuenta",
      amount: "Valor",
      revenue: "Ingresos",
      expenses: "Gastos",
      costs: "Costo de Ventas",
      totalRevenue: "Total Ingresos",
      totalExpenses: "Total Gastos",
      totalCosts: "Total Costo de Ventas",
      profit: "Utilidad antes de Impuestos",
      loss: "Pérdida antes de Impuestos",
      generatedAt: "Generado",
      errorConn: "Error de conexión con el servidor.",
      exportExcel: "Exportar Excel",
      exportPdf: "Exportar PDF",
      pdfReportTitle: "Estado de Resultados",
      pdfPeriod: "Periodo",
    },
    en: {
      title: "Income Statement",
      subtitle: "Profit & Loss for a date range, with full PUC hierarchy breakdown",
      startDate: "Start Date",
      endDate: "End Date",
      generate: "Generate",
      generating: "Generating...",
      dateRequired: "Select both dates to generate the report.",
      endBeforeStart: "End date can't be before start date.",
      noResults: "No Revenue, Expense or Cost activity for this period.",
      accountCode: "Code",
      accountName: "Account",
      amount: "Amount",
      revenue: "Revenue",
      expenses: "Expenses",
      costs: "Cost of Sales",
      totalRevenue: "Total Revenue",
      totalExpenses: "Total Expenses",
      totalCosts: "Total Cost of Sales",
      profit: "Profit Before Taxes",
      loss: "Loss Before Taxes",
      generatedAt: "Generated",
      errorConn: "Server connection error.",
      exportExcel: "Export to Excel",
      exportPdf: "Export to PDF",
      pdfReportTitle: "Income Statement",
      pdfPeriod: "Period",
    },
  }[language];

  const formatAmount = (value) => {
    const num = Number(value);
    if (value === null || value === undefined || Number.isNaN(num)) return "";
    return num.toLocaleString(language === "es" ? "es-CO" : "en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  // Raw numeric amount for spreadsheet cells -- Excel needs real
  // numbers, not localized display strings, or the column can't be
  // summed.
  const rawAmount = (value) => {
    const num = Number(value);
    return !value || Number.isNaN(num) ? 0 : num;
  };

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

    setLoading(true);
    setReport(null);
    try {
      const response = await api.get("/v1/reports/income-statement-detailed", {
        params: { startDate, endDate },
      });
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

  // netResultBeforeTaxes is signed (positive = profit); everything the
  // UI needs about it (which label, which color, the positive
  // magnitude to display) is derived here from that one plain field,
  // rather than trusting the backend's derived getters to serialize
  // the same way its plain @Data fields do.
  const netResult = useMemo(() => {
    const value = Number(report?.netResultBeforeTaxes ?? 0);
    const isProfit = value >= 0;
    return {
      value,
      isProfit,
      magnitude: Math.abs(value),
      label: isProfit ? t.profit : t.loss,
    };
  }, [report, t]);

  const hasAnyLines = (report?.revenueLines?.length || 0) > 0 || (report?.expenseLines?.length || 0) > 0 || (report?.costLines?.length || 0) > 0;

  const reportPeriodLabel = () =>
    `${t.pdfPeriod}: ${report?.startDate || startDate} – ${report?.endDate || endDate}`;

  const exportFileStem = () => {
    const range = `${report?.startDate || startDate}_a_${report?.endDate || endDate}`;
    return `${t.pdfReportTitle.replace(/\s+/g, "_")}_${range}`;
  };

  const sections = report
    ? [
        { key: "revenue", label: t.revenue, lines: report.revenueLines, total: report.totalRevenue, totalLabel: t.totalRevenue },
        { key: "expenses", label: t.expenses, lines: report.expenseLines, total: report.totalExpenses, totalLabel: t.totalExpenses },
        { key: "costs", label: t.costs, lines: report.costLines, total: report.totalCosts, totalLabel: t.totalCosts },
      ].filter((section) => section.lines?.length > 0)
    : [];

  const handleExportExcel = () => {
    if (!hasAnyLines) return;

    const headerInfo = {
      companyName: report.companyName,
      reportTitle: t.pdfReportTitle,
      period: reportPeriodLabel(),
      generatedAtLabel: t.generatedAt,
      generatedAt: report.generatedAt,
    };

    const rows = [...buildExcelHeaderRows(headerInfo)];

    sections.forEach((section) => {
      rows.push([section.label]);
      rows.push([t.accountCode, t.accountName, t.amount]);
      section.lines.forEach((line) => {
        rows.push([
          line.accountCode,
          `${"  ".repeat(Math.max((line.level || 1) - 1, 0))}${line.accountName}`,
          rawAmount(line.amount),
        ]);
      });
      rows.push([section.totalLabel, "", rawAmount(section.total)]);
      rows.push([]);
    });

    rows.push([netResult.label, "", netResult.isProfit ? netResult.magnitude : -netResult.magnitude]);

    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, t.pdfReportTitle.slice(0, 31));
    XLSX.writeFile(workbook, `${exportFileStem()}.xlsx`);
  };

  const handleExportPdf = () => {
    if (!hasAnyLines) return;

    const doc = new jsPDF();
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

    sections.forEach((section) => {
      // Don't orphan a section title at the very bottom of the page --
      // same "does it fit" guard as the summary block elsewhere.
      if (cursorY + 20 > pageHeight - bottomMargin) {
        doc.addPage();
        cursorY = addPdfRunningHeader(doc, headerInfo) + 6;
      }

      doc.setFontSize(11);
      doc.setTextColor(0);
      doc.text(section.label, 14, cursorY);
      cursorY += 4;

      const isHeaderFlags = section.lines.map((line) => line.postingAccount === false);

      const body = section.lines.map((line) => [
        line.accountCode,
        `${"  ".repeat(Math.max((line.level || 1) - 1, 0))}${line.accountName}`,
        formatAmount(line.amount),
      ]);
      body.push([section.totalLabel, "", formatAmount(section.total)]);

      const pageBeforeTable = doc.internal.getCurrentPageInfo().pageNumber;

      autoTable(doc, {
        startY: cursorY,
        head: [[t.accountCode, t.accountName, t.amount]],
        body,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [30, 41, 59] },
        columnStyles: { 2: { halign: "right" } },
        margin: { top: 20, bottom: bottomMargin },
        didParseCell: (data) => {
          const isTotalsRow = data.section === "body" && data.row.index === body.length - 1;
          if (isTotalsRow || (data.section === "body" && isHeaderFlags[data.row.index])) {
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

      cursorY = doc.lastAutoTable.finalY + 10;
    });

    if (cursorY + 16 > pageHeight - bottomMargin) {
      doc.addPage();
      cursorY = addPdfRunningHeader(doc, headerInfo) + 10;
    }

    doc.setFontSize(12);
    doc.setFont(undefined, "bold");
    doc.setTextColor(...(netResult.isProfit ? [22, 130, 70] : [185, 28, 28]));
    doc.text(`${netResult.label}: ${formatAmount(netResult.magnitude)}`, 14, cursorY);
    doc.setTextColor(0);
    doc.setFont(undefined, "normal");

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

        <Button type="submit" variant="primary" loading={loading}>
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            {report.generatedAt || report.companyName ? (
              <p className="text-xs text-slate-400">
                {report.companyName && <strong className="text-slate-500">{report.companyName}</strong>}
                {report.companyName && report.generatedAt && " — "}
                {report.generatedAt && `${t.generatedAt}: ${formatGeneratedAt(report.generatedAt)}`}
              </p>
            ) : (
              <span />
            )}

            {hasAnyLines && (
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

          {!hasAnyLines && (
            <div className="rounded-xl border border-gray-100 bg-white p-10 text-center text-slate-400 shadow-sm">
              {t.noResults}
            </div>
          )}

          {sections.map((section) => (
            <div key={section.key} className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
              <div className="border-b border-gray-100 bg-slate-50 px-5 py-3 text-[11px] font-black uppercase tracking-widest text-slate-400">
                {section.label}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="px-4 py-3">{t.accountCode}</th>
                      <th className="px-4 py-3">{t.accountName}</th>
                      <th className="px-4 py-3 text-right">{t.amount}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {section.lines.map((line) => {
                      const isHeader = line.postingAccount === false;
                      return (
                        <tr
                          key={line.accountCode}
                          className={isHeader ? "bg-slate-50/80 hover:bg-slate-100" : "hover:bg-slate-50/60"}
                        >
                          <td
                            className={`px-4 py-2.5 ${
                              isHeader ? "font-bold text-slate-800" : "font-semibold text-slate-700"
                            }`}
                          >
                            <span style={{ paddingLeft: `${((line.level || 1) - 1) * 16}px` }}>
                              {line.accountCode}
                            </span>
                          </td>
                          <td className={`px-4 py-2.5 ${isHeader ? "font-bold text-slate-800" : "text-slate-600"}`}>
                            {line.accountName}
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right font-semibold ${
                              isHeader ? "text-slate-900" : "text-slate-700"
                            }`}
                          >
                            {formatAmount(line.amount)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-slate-50 font-semibold text-slate-700">
                      <td className="px-4 py-3" colSpan={2}>
                        {section.totalLabel}
                      </td>
                      <td className="px-4 py-3 text-right">{formatAmount(section.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ))}

          {hasAnyLines && (
            <div
              className={`rounded-xl border px-5 py-4 text-right ${
                netResult.isProfit
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-red-200 bg-red-50"
              }`}
            >
              <span
                className={`text-sm font-bold uppercase tracking-wide ${
                  netResult.isProfit ? "text-emerald-700" : "text-red-700"
                }`}
              >
                {netResult.label}
              </span>
              <span
                className={`ml-4 text-xl font-black ${
                  netResult.isProfit ? "text-emerald-800" : "text-red-800"
                }`}
              >
                {formatAmount(netResult.magnitude)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default IncomeStatementPage;
